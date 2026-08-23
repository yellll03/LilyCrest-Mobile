const axios = require('axios');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { getDb } = require('../config/database');
const {
  BILL_UNAVAILABLE_MESSAGE,
  fetchUserBills,
  isPayableBill,
  mapRealBill,
} = require('./billing.controller');
const { notifyPaymentConfirmed } = require('../services/pushService');
const { sendPaymentReceiptEmail } = require('../services/emailService');

const PAYMONGO_BASE = 'https://api.paymongo.com/v1';
const DEFAULT_BACKEND_URL = 'https://api.lilycrest.space';

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function resolveRedirectBaseUrl() {
  const configured = normalizeBaseUrl(process.env.BACKEND_URL);
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (['http:', 'https:'].includes(parsed.protocol)) return configured;
    } catch (_error) {
      // Fall through to the known production origin.
    }
  }
  return DEFAULT_BACKEND_URL;
}

function getSecretKey() {
  return process.env.PAYMONGO_SECRET_KEY || '';
}

function paymongoHeaders() {
  const key = getSecretKey();
  if (!key) throw new Error('PAYMONGO_SECRET_KEY is not configured');
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Basic ${Buffer.from(key + ':').toString('base64')}`,
  };
}

function getCheckoutSessionPayments(session = {}) {
  const payments = session?.attributes?.payments;
  return Array.isArray(payments) ? payments : [];
}

function normalizePaymongoStatus(value, fallback = '') {
  const normalized = String(value || fallback || '').trim().toLowerCase();
  return normalized || String(fallback || '').trim().toLowerCase();
}

function getCheckoutSessionPaymentState(session = {}) {
  const payments = getCheckoutSessionPayments(session);
  const intentStatus = normalizePaymongoStatus(session?.attributes?.payment_intent?.attributes?.status);
  const sessionStatus = normalizePaymongoStatus(session?.attributes?.status, 'pending');
  const paymentStatus = intentStatus || sessionStatus;
  const hasConfirmedPayments = payments.length > 0 && payments.every((payment) => {
    const status = normalizePaymongoStatus(payment?.attributes?.status || payment?.status);
    return status === 'paid' || status === 'succeeded';
  });
  const sessionClosedWithPayment = sessionStatus === 'inactive' && payments.length > 0;
  const paymentConfirmed = paymentStatus === 'succeeded'
    || paymentStatus === 'paid'
    || hasConfirmedPayments
    || sessionClosedWithPayment;

  return {
    payments,
    intentStatus,
    sessionStatus,
    paymentStatus: paymentStatus || 'pending',
    paymentConfirmed,
  };
}

// Raw PayMongo payment_intent/session statuses collapsed into the small,
// stable enum the tenant app actually needs to render a distinct UI state
// for. The mobile UI previously only distinguished "paid" from everything
// else, so a declined card and a merely-slow verification looked identical
// ("still processing"). Backend/PayMongo remains the authority — this is
// purely a display-status normalization, not a new source of truth.
function normalizeCheckoutStatusForClient({ paymentConfirmed, paymentStatus, sessionStatus }) {
  if (paymentConfirmed) return 'paid';

  const FAILED_STATUSES = new Set(['failed', 'payment_failed', 'declined']);
  if (FAILED_STATUSES.has(paymentStatus)) return 'failed';

  const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'voided']);
  if (CANCELLED_STATUSES.has(paymentStatus) || sessionStatus === 'expired') return 'cancelled';

  const PENDING_STATUSES = new Set(['pending', 'awaiting_payment_method', 'awaiting_next_action', 'processing']);
  if (PENDING_STATUSES.has(paymentStatus) || sessionStatus === 'active') return 'pending';

  return 'unknown';
}

function parsePaymongoTimestamp(value) {
  if (!value && value !== 0) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      const numericValue = Number(trimmed);
      if (Number.isFinite(numericValue)) {
        const millis = trimmed.length >= 13 ? numericValue : numericValue * 1000;
        const parsed = new Date(millis);
        if (!Number.isNaN(parsed.getTime())) return parsed;
      }
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function getCheckoutSessionPaymentDate(session = {}) {
  const payments = getCheckoutSessionPayments(session);
  const primaryPayment = payments[0] || null;
  const candidates = [
    primaryPayment?.attributes?.paid_at,
    primaryPayment?.attributes?.updated_at,
    primaryPayment?.attributes?.created_at,
    session?.attributes?.paid_at,
    session?.attributes?.updated_at,
    session?.attributes?.created_at,
  ];

  for (const candidate of candidates) {
    const parsed = parsePaymongoTimestamp(candidate);
    if (parsed) return parsed;
  }

  return null;
}

async function fetchCheckoutSessionRecord(checkoutId) {
  if (!checkoutId) return null;

  const response = await axios.get(`${PAYMONGO_BASE}/checkout_sessions/${checkoutId}`, {
    headers: paymongoHeaders(),
  });

  return response.data?.data || null;
}

// ── Resolve a bill from any of the three sources ─────────────────────────────
// Returns { bill, source } so callers know which collection to update.
// source: 'legacy' | 'real'
async function resolveBillWithSource(db, billingId, user) {
  const bill = (await fetchUserBills(db, user, { billingId, limit: 1 }))[0] || null;

  if (!bill) {
    return { bill: null, source: null };
  }

  const realBill = await findRealBillByBillingId(
    db,
    billingId,
    user?._id,
    { projection: { _id: 1 } },
    user?.user_id,
  );
  const source = realBill ? 'real' : 'legacy';

  return { bill, source };
}

// ── Save checkout reference to the correct collection ────────────────────────
function checkoutStorageDescriptor(source, billingId, user = {}) {
  if (source === 'real') {
    return {
      source,
      collectionName: 'bills',
      filter: buildRealBillLookupFilter(billingId, user?._id, {}, user?.user_id),
      fields: {
        sessionId: 'paymongoSessionId',
        checkoutUrl: 'paymongoCheckoutUrl',
        createdAt: 'paymongoSessionCreatedAt',
        reference: 'paymongoReference',
        claim: 'checkoutClaimedAt',
        idempotencyKey: 'checkoutIdempotencyKey',
      },
    };
  }
  if (source === 'legacy') {
    return {
      source,
      collectionName: 'billing',
      filter: { billing_id: billingId, user_id: user?.user_id },
      fields: {
        sessionId: 'paymongo_checkout_id',
        checkoutUrl: 'paymongo_checkout_url',
        createdAt: 'paymongo_session_created_at',
        reference: 'paymongo_reference',
        claim: 'checkout_claimed_at',
        idempotencyKey: 'checkout_idempotency_key',
      },
    };
  }
  return null;
}

function readStoredCheckout(doc, descriptor) {
  if (!doc || !descriptor) return null;
  const { fields } = descriptor;
  return {
    sessionId: doc[fields.sessionId] || '',
    checkoutUrl: doc[fields.checkoutUrl] || '',
    createdAt: doc[fields.createdAt] || null,
    claimAt: doc[fields.claim] || null,
    idempotencyKey: doc[fields.idempotencyKey] || '',
  };
}

async function loadStoredCheckout(db, descriptor) {
  if (!descriptor?.filter) return null;
  const projection = Object.fromEntries(Object.values(descriptor.fields).map((field) => [field, 1]));
  const doc = await db.collection(descriptor.collectionName).findOne(descriptor.filter, { projection });
  return readStoredCheckout(doc, descriptor);
}

async function claimCheckoutCreation(db, descriptor, now, idempotencyKey) {
  const { fields } = descriptor;
  const claimed = unwrapMongoDocument(await db.collection(descriptor.collectionName).findOneAndUpdate(
    {
      $and: [
        descriptor.filter,
        {
          $or: [
            { [fields.claim]: { $exists: false } },
            { [fields.claim]: { $lt: new Date(now.getTime() - CHECKOUT_CLAIM_TTL_MS) } },
          ],
        },
      ],
    },
    { $set: { [fields.claim]: now, [fields.idempotencyKey]: idempotencyKey } },
    { returnDocument: 'after' },
  ));
  return claimed ? readStoredCheckout(claimed, descriptor) : null;
}

async function releaseCheckoutClaim(db, descriptor, { clearIdempotencyKey = false } = {}) {
  if (!descriptor?.filter) return;
  const unset = { [descriptor.fields.claim]: '' };
  if (clearIdempotencyKey) unset[descriptor.fields.idempotencyKey] = '';
  await db.collection(descriptor.collectionName).updateOne(descriptor.filter, { $unset: unset });
}

async function saveCheckoutRef(db, descriptor, checkoutId, referenceNumber, checkoutUrl) {
  const { fields } = descriptor;
  const now = new Date();
  const result = await db.collection(descriptor.collectionName).updateOne(
    descriptor.filter,
    {
      $set: {
        [fields.sessionId]: checkoutId,
        [fields.checkoutUrl]: checkoutUrl || null,
        [fields.createdAt]: now,
        [fields.reference]: referenceNumber,
        ...(descriptor.source === 'real'
          ? { paymentMethod: 'paymongo', updatedAt: now }
          : { payment_method: 'paymongo', updated_at: now }),
      },
      $unset: { [fields.claim]: '' },
    },
  );
  if (result.matchedCount !== 1) {
    const error = new Error('Created PayMongo checkout could not be bound to its exact bill.');
    error.code = 'PAYMONGO_CHECKOUT_BIND_FAILED';
    throw error;
  }
}

async function findBillByCheckoutId(db, checkoutId) {
  const real = await db.collection('bills').findOne(
    { paymongoSessionId: checkoutId },
    { projection: { _id: 1, userId: 1, tenantId: 1, billing_id: 1, legacyBillingId: 1 } },
  );
  if (real) return { source: 'real', bill: real };
  const legacy = await db.collection('billing').findOne(
    { paymongo_checkout_id: checkoutId },
    { projection: { _id: 1, user_id: 1, userId: 1, billing_id: 1 } },
  );
  return legacy ? { source: 'legacy', bill: legacy } : null;
}

function userOwnsCheckoutBill(user, located) {
  if (!user || !located?.bill) return false;
  if (['admin', 'superadmin'].includes(String(user.role || '').toLowerCase())) return true;
  const ownerCandidates = [located.bill.user_id, located.bill.userId, located.bill.tenantId]
    .filter(Boolean)
    .map((value) => String(value));
  return ownerCandidates.includes(String(user.user_id || ''))
    || ownerCandidates.includes(String(user._id || ''));
}

function isPaidStatus(status) {
  return ['paid', 'settled'].includes(String(status || '').toLowerCase());
}

function unwrapMongoDocument(result) {
  return result?.value ?? result ?? null;
}

function toObjectIdIfValid(value) {
  if (!value) return null;
  try {
    const candidate = typeof value?.toHexString === 'function'
      ? value.toHexString()
      : String(value);
    return ObjectId.isValid(candidate) ? new ObjectId(candidate) : null;
  } catch (_error) {
    return null;
  }
}

function pushUniqueMatch(matches, match) {
  if (!match || typeof match !== 'object') return;
  const key = JSON.stringify(match, (_name, value) => (
    value instanceof ObjectId ? value.toHexString() : value
  ));
  if (matches.some((existing) => JSON.stringify(existing, (_name, value) => (
    value instanceof ObjectId ? value.toHexString() : value
  )) === key)) {
    return;
  }
  matches.push(match);
}

function buildRealBillOwnerMatches(userId, mongoId) {
  const matches = [];
  const tenantUserId = typeof userId === 'string' ? userId.trim() : '';
  const ownerObjectId = toObjectIdIfValid(mongoId);
  const ownerObjectIdString = ownerObjectId ? ownerObjectId.toHexString() : '';

  if (ownerObjectId) {
    pushUniqueMatch(matches, { userId: ownerObjectId });
    pushUniqueMatch(matches, { tenantId: ownerObjectId });
    pushUniqueMatch(matches, { user_id: ownerObjectId });
  }

  if (ownerObjectIdString) {
    pushUniqueMatch(matches, { userId: ownerObjectIdString });
    pushUniqueMatch(matches, { tenantId: ownerObjectIdString });
    pushUniqueMatch(matches, { user_id: ownerObjectIdString });
  }

  if (tenantUserId) {
    pushUniqueMatch(matches, { user_id: tenantUserId });
    pushUniqueMatch(matches, { tenantUserId });
    pushUniqueMatch(matches, { tenant_user_id: tenantUserId });
    pushUniqueMatch(matches, { userId: tenantUserId });
  }

  return matches;
}

function buildRealBillLookupFilter(billingId, mongoId, extraFilter = {}, userId = '') {
  const id = String(billingId || '').trim();
  if (!id) return null;

  const matches = [
    { billing_id: id },
    { legacyBillingId: id },
  ];

  if (ObjectId.isValid(id)) {
    matches.unshift({ _id: new ObjectId(id) });
  }

  const filterParts = [{ $or: matches }];
  const ownerMatches = buildRealBillOwnerMatches(userId, mongoId);

  if (ownerMatches.length) {
    filterParts.push({ $or: ownerMatches });
  }
  if (extraFilter && Object.keys(extraFilter).length > 0) {
    filterParts.unshift(extraFilter);
  }

  return filterParts.length === 1 ? filterParts[0] : { $and: filterParts };
}

async function findRealBillByBillingId(db, billingId, mongoId, options = {}, userId = '') {
  const filter = buildRealBillLookupFilter(billingId, mongoId, {}, userId);
  if (!filter) return null;
  return db.collection('bills').findOne(filter, options);
}

// PayMongo Checkout Sessions charge a fixed line-item amount set when the
// session was created, so a mismatch at settlement time means the bill's
// expected amount moved after that (an admin edit, a penalty applied, or a
// stale/reused session paid late) — it is not an intentional partial
// payment. This codebase has no partial-payment settlement state machine
// ('partially_paid' exists only as an admin-settable display value, never
// auto-derived from an amount comparison), so instead of inventing one, an
// underpaid settlement fails closed: payment evidence is recorded for audit
// but the bill is NOT flipped to paid and the balance is NOT zeroed.
function isUnderpaid(paidAmountCentavos, expectedAmount) {
  if (!Number.isFinite(paidAmountCentavos)) return false;
  const expectedCentavos = Math.round(Number(expectedAmount || 0) * 100);
  return expectedCentavos > 0 && paidAmountCentavos < expectedCentavos - 1;
}

async function markLegacyBillPaidAtomic(db, filter, {
  paymentId,
  eventType,
  checkoutId,
  paymentDate,
  referenceNumber,
  paymentChannel,
  paidAmountCentavos = null,
} = {}) {
  const resolvedPaymentDate = paymentDate instanceof Date ? paymentDate : new Date();

  if (Number.isFinite(paidAmountCentavos)) {
    const current = await db.collection('billing').findOne(filter, {
      projection: { remaining_amount: 1, total: 1, amount: 1, status: 1 },
    });
    if (current && !isPaidStatus(current.status) && isUnderpaid(paidAmountCentavos, current.remaining_amount ?? current.total ?? current.amount)) {
      const underpaidUpdated = unwrapMongoDocument(await db.collection('billing').findOneAndUpdate(
        { ...filter, status: { $nin: ['paid', 'settled'] } },
        {
          $set: {
            payment_method: 'paymongo',
            payment_date: resolvedPaymentDate,
            paymongo_payment_id: paymentId || null,
            paymongo_underpaid_amount: paidAmountCentavos / 100,
            paymongo_underpaid_at: new Date(),
            ...(paymentChannel ? { payment_channel: paymentChannel } : {}),
            ...(checkoutId ? { paymongo_checkout_id: checkoutId } : {}),
            ...(referenceNumber ? { paymongo_reference: referenceNumber } : {}),
            ...(eventType ? { paymongo_event: eventType } : {}),
            updated_at: new Date(),
          },
        },
        { returnDocument: 'after' },
      ));
      if (underpaidUpdated) {
        console.warn(`[markBillPaid] Underpaid settlement for legacy bill (paid ${paidAmountCentavos}c) — not marking paid, flagged for manual review.`);
        return { existing: underpaidUpdated, alreadyPaid: false, matched: true, resolvedUserId: underpaidUpdated.user_id || filter.user_id || null, underpaid: true };
      }
    }
  }

  const updated = unwrapMongoDocument(await db.collection('billing').findOneAndUpdate(
    { ...filter, status: { $nin: ['paid', 'settled'] } },
    {
      $set: {
        status: 'paid',
        remaining_amount: 0,
        payment_method: 'paymongo',
        payment_date: resolvedPaymentDate,
        paymongo_payment_id: paymentId || null,
        ...(paymentChannel ? { payment_channel: paymentChannel } : {}),
        ...(checkoutId ? { paymongo_checkout_id: checkoutId } : {}),
        ...(referenceNumber ? { paymongo_reference: referenceNumber } : {}),
        ...(eventType ? { paymongo_event: eventType } : {}),
        updated_at: new Date(),
      },
    },
    { returnDocument: 'after' }
  ));

  if (updated) {
    return { existing: updated, alreadyPaid: false, matched: true, resolvedUserId: updated.user_id || filter.user_id || null };
  }

  const existing = await db.collection('billing').findOne(filter);
  if (!existing) {
    return { existing: null, alreadyPaid: false, matched: false, resolvedUserId: null };
  }

  return { existing, alreadyPaid: isPaidStatus(existing.status), matched: true, resolvedUserId: existing.user_id || filter.user_id || null };
}

async function markRealBillPaidAtomic(db, filter, userId, {
  paymentId,
  eventType,
  checkoutId,
  paymentDate,
  referenceNumber,
  paymentChannel,
  paidAmountCentavos = null,
} = {}) {
  const resolvedPaymentDate = paymentDate instanceof Date ? paymentDate : new Date();

  if (Number.isFinite(paidAmountCentavos)) {
    const current = await db.collection('bills').findOne(filter, {
      projection: { remainingAmount: 1, totalAmount: 1, grossAmount: 1, status: 1 },
    });
    if (current && !isPaidStatus(current.status) && isUnderpaid(paidAmountCentavos, current.remainingAmount ?? current.totalAmount ?? current.grossAmount)) {
      const underpaidUpdated = unwrapMongoDocument(await db.collection('bills').findOneAndUpdate(
        { ...filter, status: { $nin: ['paid', 'settled'] } },
        {
          $set: {
            paymentMethod: 'paymongo',
            paymentDate: resolvedPaymentDate,
            paymongoPaymentId: paymentId || null,
            paymongoUnderpaidAmount: paidAmountCentavos / 100,
            paymongoUnderpaidAt: new Date(),
            ...(paymentChannel ? { paymentChannel } : {}),
            ...(checkoutId ? { paymongoSessionId: checkoutId } : {}),
            ...(referenceNumber ? { paymongoReference: referenceNumber } : {}),
            ...(eventType ? { paymongoEvent: eventType } : {}),
            updatedAt: new Date(),
          },
        },
        { returnDocument: 'after' },
      ));
      if (underpaidUpdated) {
        console.warn(`[markBillPaid] Underpaid settlement for real bill (paid ${paidAmountCentavos}c) — not marking paid, flagged for manual review.`);
        return { existing: mapRealBill(underpaidUpdated, userId), alreadyPaid: false, matched: true, resolvedUserId: userId, underpaid: true };
      }
    }
  }

  const updated = unwrapMongoDocument(await db.collection('bills').findOneAndUpdate(
    { ...filter, status: { $nin: ['paid', 'settled'] } },
    {
      $set: {
        status: 'paid',
        remainingAmount: 0,
        paymentMethod: 'paymongo',
        paidAt: resolvedPaymentDate,
        paymentDate: resolvedPaymentDate,
        paymongoPaymentId: paymentId || null,
        ...(paymentChannel ? { paymentChannel } : {}),
        ...(checkoutId ? { paymongoSessionId: checkoutId } : {}),
        ...(referenceNumber ? { paymongoReference: referenceNumber } : {}),
        ...(eventType ? { paymongoEvent: eventType } : {}),
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  ));

  if (updated) {
    return { existing: mapRealBill(updated, userId), alreadyPaid: false, matched: true, resolvedUserId: userId };
  }

  const existing = await db.collection('bills').findOne(filter);
  if (!existing) {
    return { existing: null, alreadyPaid: false, matched: false, resolvedUserId: null };
  }

  return { existing: mapRealBill(existing, userId), alreadyPaid: isPaidStatus(existing.status), matched: true, resolvedUserId: userId };
}

// ── Mark a bill as paid in the correct collection ────────────────────────────
async function resolveRealBillOwnerUserId(db, bill = {}, fallbackUserId = '') {
  const directUserId = String(
    bill.user_id
      || bill.tenantUserId
      || bill.tenant_user_id
      || '',
  ).trim();
  if (directUserId) return directUserId;

  const ownerObjectId = toObjectIdIfValid(bill.userId || bill.tenantId);
  if (ownerObjectId) {
    const owner = await db.collection('users').findOne(
      { _id: ownerObjectId },
      { projection: { _id: 0, user_id: 1 } },
    );
    if (owner?.user_id) return owner.user_id;
  }

  return String(fallbackUserId || '').trim();
}

// Returns the bill document (pre-update) for push notification context.
// checkoutId is an optional fallback key used when billing_id/user_id matching
// fails (e.g. metadata mismatch or presentation-mode bills that were upgraded).
async function markBillPaid(db, billingId, userId, options = {}) {
  const { checkoutId } = options;

  const user = await db.collection('users').findOne({ user_id: userId });
  const mongoId = user?._id;
  const realFilter = buildRealBillLookupFilter(billingId, mongoId, {}, userId);
  if (realFilter) {
    const realResult = await markRealBillPaidAtomic(
      db,
      realFilter,
      userId,
      options
    );
    if (realResult.matched) {
      console.log(`[markBillPaid] Bill ${billingId} resolved in bills collection`);
      return realResult;
    }
  }

  if (!mongoId) {
    console.warn(`[markBillPaid] User not found for user_id=${userId}`);
  }

  const legacyResult = await markLegacyBillPaidAtomic(
    db,
    { billing_id: billingId, user_id: userId },
    options
  );
  if (legacyResult.matched) {
    return legacyResult;
  }

  // Fallback: find by paymongo checkout id (handles metadata mismatch cases).
  // paymongoSessionId is written to exactly one bill, exclusively by our own
  // createCheckoutSession — at creation time it atomically claims a single,
  // already-ownership-verified bill (buildRealBillLookupFilter includes an
  // owner match), so this identifier is not a weaker/looser proof than the
  // billing_id/user_id metadata path above; it is a foreign-key-style
  // binding we control, used here only because the metadata PayMongo echoes
  // back can drift in formatting. The owner used for settlement is always
  // re-derived from the bill's own stored owner field (resolveRealBillOwnerUserId),
  // never trusted from the possibly-mismatched webhook metadata.
  //
  // Fail closed if this ever turns up more than one bill for the same
  // session ID (should be impossible given the atomic claim above, but a
  // duplicate would mean this identifier is no longer proof of one exact
  // bill, and settling an arbitrary match from an ambiguous set is exactly
  // the kind of wrong-bill risk this fallback exists to avoid).
  if (checkoutId) {
    const sessionMatches = await db.collection('bills').find(
      { paymongoSessionId: checkoutId },
      { projection: { userId: 1, tenantId: 1, user_id: 1, tenantUserId: 1, tenant_user_id: 1 } }
    ).limit(2).toArray();

    if (sessionMatches.length > 1) {
      console.error(`[markBillPaid] REFUSING to settle — checkout ${checkoutId} matches more than one bill. Failing closed.`);
      return { existing: null, alreadyPaid: false, matched: false, conflict: true };
    } else if (sessionMatches.length === 1) {
      const bySession = sessionMatches[0];
      const resolvedUserId = await resolveRealBillOwnerUserId(db, bySession, userId);
      const realCheckoutResult = await markRealBillPaidAtomic(
        db,
        { paymongoSessionId: checkoutId },
        resolvedUserId,
        options
      );
      if (realCheckoutResult.matched) {
        console.log(`[markBillPaid] Bill found by paymongoSessionId ${checkoutId}`);
        return realCheckoutResult;
      }
    }

    const legacySessionMatches = await db.collection('billing').find(
      { paymongo_checkout_id: checkoutId },
      { projection: { _id: 1 } },
    ).limit(2).toArray();

    if (legacySessionMatches.length > 1) {
      console.error(`[markBillPaid] REFUSING to settle — legacy checkout ${checkoutId} matches more than one bill. Failing closed.`);
      return { existing: null, alreadyPaid: false, matched: false, conflict: true };
    } else if (legacySessionMatches.length === 1) {
      const legacyCheckoutResult = await markLegacyBillPaidAtomic(
        db,
        { paymongo_checkout_id: checkoutId },
        options
      );
      if (legacyCheckoutResult.matched) {
        console.log(`[markBillPaid] Bill found by checkout_id ${checkoutId}`);
        return legacyCheckoutResult;
      }
    }
  }

  // 4. Presentation mode (no DB record — no update needed)
  return { existing: null, alreadyPaid: false };
}

async function sendPaymentReceiptForBill(db, {
  userId,
  billingId,
  bill,
  paymentId,
  referenceNumber,
  userEmailHint,
}) {
  try {
    const userDoc = await db.collection('users').findOne(
      { user_id: userId },
      {
        projection: {
          _id: 0,
          name: 1,
          fullName: 1,
          firstName: 1,
          lastName: 1,
          email: 1,
          emailAddress: 1,
          google_email: 1,
        },
      },
    );

    const userEmail = String(
      userEmailHint || userDoc?.email || userDoc?.emailAddress || userDoc?.google_email || '',
    ).trim();

    if (!userEmail) {
      console.warn(`[PayMongo] Skipping receipt email for bill ${billingId}: no tenant email found`);
      return false;
    }

    const fallbackName = [userDoc?.firstName, userDoc?.lastName].filter(Boolean).join(' ').trim();
    const userName = userDoc?.name || userDoc?.fullName || fallbackName || 'Tenant';
    const amountPaid = Number(
      bill?.original_total
      ?? bill?.gross_amount
      ?? bill?.total
      ?? bill?.amount
      ?? bill?.remaining_amount
      ?? 0
    );
    const description = bill?.description || `Bill ${billingId}`;

    return sendPaymentReceiptEmail(userEmail, userName, {
      billingId,
      description,
      amount: amountPaid,
      paymentMethod: 'PayMongo',
      paymentDate: new Date(),
      referenceNumber,
      paymentId,
    });
  } catch (error) {
    console.warn(`[PayMongo] Failed to send receipt email for bill ${billingId}:`, error?.message);
    return false;
  }
}

async function reconcileCheckoutSessionPayment(db, checkoutId, {
  session = null,
  eventType = '',
  sendSideEffects = true,
} = {}) {
  const resolvedSession = session || await fetchCheckoutSessionRecord(checkoutId);
  const state = getCheckoutSessionPaymentState(resolvedSession || {});

  if (!resolvedSession || !state.paymentConfirmed) {
    return {
      session: resolvedSession,
      ...state,
      existing: null,
      alreadyPaid: false,
      resolvedUserId: '',
      referenceNumber: '',
      paymentId: '',
      reconciled: false,
    };
  }

  const metadata = resolvedSession?.attributes?.metadata || {};
  const billingId = String(metadata.billing_id || '').trim();
  const userId = String(metadata.user_id || '').trim();
  const paymentId = String(state.payments[0]?.id || '').trim();
  // The actual channel the tenant paid with (gcash/card/grab_pay/paymaya/...),
  // as reported by PayMongo on the settled Payment resource itself — not
  // inferred from the checkout's offered payment_method_types, since a
  // tenant only ever actually uses one of them.
  const paymentChannel = String(state.payments[0]?.attributes?.source?.type || '').trim().toLowerCase();
  const referenceNumber = String(resolvedSession?.attributes?.reference_number || '').trim();
  const userEmailHint = String(metadata.user_email || '').trim();
  const paymentDate = getCheckoutSessionPaymentDate(resolvedSession) || new Date();
  // PayMongo reports the actual settled Payment amount (centavos) on the
  // Payment resource itself — this is the authoritative "what did the
  // tenant actually pay" figure, independent of what the checkout session
  // was originally created for. Compared against the bill's own current
  // expected amount inside markRealBillPaidAtomic/markLegacyBillPaidAtomic
  // before the bill is ever flipped to paid.
  const paidAmountCentavosRaw = state.payments[0]?.attributes?.amount;
  const paidAmountCentavos = Number.isFinite(Number(paidAmountCentavosRaw)) ? Number(paidAmountCentavosRaw) : null;
  if (!Number.isFinite(paidAmountCentavos) || paidAmountCentavos <= 0) {
    return {
      session: resolvedSession,
      ...state,
      existing: null,
      alreadyPaid: false,
      underpaid: false,
      conflict: false,
      resolvedUserId: '',
      referenceNumber,
      paymentId,
      settlementIssue: 'missing_payment_amount',
      reconciled: false,
    };
  }
  const { existing, alreadyPaid, resolvedUserId, underpaid, conflict } = await markBillPaid(db, billingId, userId, {
    paymentId,
    eventType,
    checkoutId,
    paymentDate,
    referenceNumber,
    paymentChannel,
    paidAmountCentavos,
  });
  const paymentUserId = resolvedUserId || userId;

  if (sendSideEffects && !alreadyPaid && !underpaid && existing && paymentUserId) {
    notifyPaymentConfirmed(paymentUserId, { ...existing, status: 'paid' }).catch(() => {});
    sendPaymentReceiptForBill(db, {
      userId: paymentUserId,
      billingId,
      bill: { ...existing, status: 'paid' },
      paymentId,
      referenceNumber,
      userEmailHint,
    }).catch(() => {});
  }

  if (underpaid) {
    console.warn(`[PayMongo] Bill ${billingId} received an underpaid settlement (checkout ${checkoutId}) — left unsettled for manual review.`);
  }

  return {
    session: resolvedSession,
    ...state,
    existing,
    alreadyPaid,
    underpaid: Boolean(underpaid),
    conflict: Boolean(conflict),
    resolvedUserId: paymentUserId,
    referenceNumber,
    paymentId,
    reconciled: Boolean(existing),
  };
}

// Create a PayMongo Checkout Session for a specific bill
// A tenant re-opening the same unpaid bill, a double tap, or a client retry
// must not each mint a brand-new PayMongo checkout session. A persisted
// idempotency key and a short atomic claim cover both collections during the
// migration window. Existing sessions are verified with PayMongo before they
// are reused or replaced; an inconclusive provider lookup never creates a
// second session. Only webhook/poll reconciliation can mark a bill paid.
const CHECKOUT_CLAIM_TTL_MS = 20 * 1000;

function checkoutReferenceNumber(billingId, idempotencyKey) {
  const billPart = String(billingId || 'bill').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36) || 'bill';
  const attemptPart = crypto.createHash('sha256').update(String(idempotencyKey)).digest('hex').slice(0, 12);
  return `LC-${billPart}-${attemptPart}`;
}

async function createCheckoutSession(req, res) {
  const db = getDb();
  let checkoutDescriptor = null;
  let claimHeld = false;
  try {
    const { billingId } = req.body;
    if (!billingId) {
      return res.status(400).json({ detail: 'billingId is required' });
    }

    const { bill, source } = await resolveBillWithSource(db, billingId, req.user);

    if (!bill) {
      return res.status(404).json({ detail: BILL_UNAVAILABLE_MESSAGE });
    }

    const status = String(bill.status || '').toLowerCase();
    if (status === 'paid' || status === 'settled') {
      return res.status(400).json({ detail: 'This bill has already been paid' });
    }

    if (!isPayableBill(bill)) {
      return res.status(404).json({ detail: BILL_UNAVAILABLE_MESSAGE });
    }

    const amount = Math.round((bill.remaining_amount ?? bill.total ?? bill.amount ?? 0) * 100); // centavos
    if (amount <= 0) {
      return res.status(400).json({ detail: 'Invalid bill amount' });
    }

    checkoutDescriptor = checkoutStorageDescriptor(source, billingId, req.user);
    if (!checkoutDescriptor?.filter) {
      return res.status(503).json({
        code: 'BILLING_SOURCE_UNAVAILABLE',
        detail: 'The authoritative billing record could not be resolved. Please try again.',
        retryable: true,
      });
    }
    const now = new Date();

    const storedCheckout = await loadStoredCheckout(db, checkoutDescriptor);
    let replaceStoredAttempt = false;
    if (storedCheckout?.sessionId) {
      let existingSession;
      try {
        existingSession = await fetchCheckoutSessionRecord(storedCheckout.sessionId);
      } catch (error) {
        const lookupStatus = Number(error?.response?.status || 0);
        if ([404, 410].includes(lookupStatus)) {
          replaceStoredAttempt = true;
        } else {
          console.warn('[PayMongo] Existing checkout could not be verified; refusing to create a duplicate:', error.message);
          return res.status(503).json({
            code: 'PAYMONGO_STATUS_UNAVAILABLE',
            detail: 'Your existing payment session could not be checked. It has been kept; please retry shortly.',
            retryable: true,
          });
        }
      }

      if (!replaceStoredAttempt) {
        const state = getCheckoutSessionPaymentState(existingSession || {});
        const normalizedStatus = normalizeCheckoutStatusForClient(state);
        if (state.paymentConfirmed) {
          await reconcileCheckoutSessionPayment(db, storedCheckout.sessionId, {
            session: existingSession,
            eventType: 'checkout_reuse_check',
          });
          return res.status(409).json({
            code: 'BILL_ALREADY_PAID',
            detail: 'This bill has already been paid.',
            paid: true,
            checkout_id: storedCheckout.sessionId,
          });
        }

        if (normalizedStatus === 'failed' || normalizedStatus === 'cancelled') {
          replaceStoredAttempt = true;
        } else if (normalizedStatus === 'pending') {
          const checkoutUrl = storedCheckout.checkoutUrl || existingSession?.attributes?.checkout_url;
          if (!checkoutUrl) {
            return res.status(503).json({
              code: 'PAYMONGO_CHECKOUT_INCOMPLETE',
              detail: 'Your payment session exists but its checkout link is unavailable. Please retry shortly.',
              retryable: true,
            });
          }
          if (!storedCheckout.checkoutUrl) {
            await saveCheckoutRef(
              db,
              checkoutDescriptor,
              storedCheckout.sessionId,
              existingSession?.attributes?.reference_number || '',
              checkoutUrl,
            );
          }
          return res.json({ checkout_url: checkoutUrl, checkout_id: storedCheckout.sessionId, reused: true });
        } else {
          return res.status(503).json({
            code: 'PAYMONGO_STATUS_UNRESOLVED',
            detail: 'Your existing payment session has an unresolved status. No duplicate session was created.',
            retryable: true,
          });
        }
      }
    }

    const idempotencyKey = !replaceStoredAttempt && storedCheckout?.idempotencyKey
      ? storedCheckout.idempotencyKey
      : crypto.randomUUID();
    const claim = await claimCheckoutCreation(db, checkoutDescriptor, now, idempotencyKey);
    if (!claim) {
      return res.status(409).json({
        code: 'PAYMONGO_CHECKOUT_IN_PROGRESS',
        detail: 'A payment session is already being created for this bill. Please wait a moment and try again.',
        retryable: true,
      });
    }
    claimHeld = true;

    // A successful claim is the only path to provider session creation.
    const description = bill.description || `Bill ${billingId}`;
    const referenceNumber = checkoutReferenceNumber(billingId, idempotencyKey);

    // Build redirect URLs from the permanent mobile backend origin.
    const backendUrl = resolveRedirectBaseUrl();
    const encodedBillingId = encodeURIComponent(billingId);

    // Build the PayMongo Checkout Session payload
    const payload = {
      data: {
        attributes: {
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          description: `LilyCrest Dormitory - ${description}`,
          line_items: [
            {
              currency: 'PHP',
              amount,
              name: description,
              quantity: 1,
            },
          ],
          payment_method_types: [
            'gcash',
            'grab_pay',
            'paymaya',
            'card',
          ],
          reference_number: referenceNumber,
          // Redirect to backend endpoints that bounce the user back to the app via deep link
          success_url: `${backendUrl}/api/m/paymongo/redirect/success?billing_id=${encodedBillingId}`,
          cancel_url: `${backendUrl}/api/m/paymongo/redirect/cancel?billing_id=${encodedBillingId}`,
          metadata: {
            billing_id: billingId,
            user_id: req.user.user_id,
            user_email: req.user.email || '',
          },
        },
      },
    };

    const response = await axios.post(`${PAYMONGO_BASE}/checkout_sessions`, payload, {
      headers: { ...paymongoHeaders(), 'Idempotency-Key': idempotencyKey },
    });

    const session = response.data?.data;
    const checkoutUrl = session?.attributes?.checkout_url;
    const checkoutId = session?.id;

    if (!checkoutUrl || !checkoutId) {
      const error = new Error('PayMongo returned an incomplete checkout session.');
      error.code = 'PAYMONGO_INCOMPLETE_RESPONSE';
      throw error;
    }

    // Save checkout reference to the correct collection (legacy or real).
    // This also clears the claim lock set above.
    await saveCheckoutRef(db, checkoutDescriptor, checkoutId, referenceNumber, checkoutUrl);
    claimHeld = false;

    res.json({
      checkout_url: checkoutUrl,
      checkout_id: checkoutId,
      reference: referenceNumber,
    });
  } catch (error) {
    if (claimHeld && checkoutDescriptor) {
      const providerStatus = Number(error?.response?.status || 0);
      const definitelyRejected = providerStatus >= 400 && providerStatus < 500 && providerStatus !== 409;
      try { await releaseCheckoutClaim(db, checkoutDescriptor, { clearIdempotencyKey: definitelyRejected }); } catch (_) {}
    }
    console.error('PayMongo checkout error:', error?.response?.data || error.message);
    const paymongoError = error?.response?.data?.errors?.[0]?.detail;
    const providerStatus = Number(error?.response?.status || 0);
    const retryable = !providerStatus || providerStatus >= 500 || providerStatus === 409
      || error.code === 'PAYMONGO_CHECKOUT_BIND_FAILED'
      || error.code === 'PAYMONGO_INCOMPLETE_RESPONSE';
    res.status(retryable ? 503 : 502).json({
      code: retryable ? 'PAYMONGO_TEMPORARILY_UNAVAILABLE' : 'PAYMONGO_REQUEST_REJECTED',
      detail: paymongoError || 'Failed to create payment session. Please try again.',
      retryable,
    });
  }
}

// Retrieve checkout session status (for polling from frontend)
async function getCheckoutStatus(req, res) {
  try {
    const { checkoutId } = req.params;
    if (!checkoutId) {
      return res.status(400).json({ detail: 'checkoutId is required' });
    }

    const db = getDb();
    const located = await findBillByCheckoutId(db, checkoutId);
    if (!located) return res.status(404).json({ detail: BILL_UNAVAILABLE_MESSAGE });
    if (!userOwnsCheckoutBill(req.user, located)) {
      return res.status(403).json({ detail: 'You do not have access to this checkout session.' });
    }
    const reconciliation = await reconcileCheckoutSessionPayment(db, checkoutId);

    const session = reconciliation.session;
    // payment_intent is null for e-wallet (GCash/Maya/GrabPay) payments — fall back to session status
    const paymentStatus = reconciliation.paymentStatus;
    const payments = reconciliation.payments;

    const paymentConfirmed = reconciliation.paymentConfirmed;
    const sessionStatus = reconciliation.sessionStatus;
    const normalizedStatus = normalizeCheckoutStatusForClient({ paymentConfirmed, paymentStatus, sessionStatus });

    res.json({
      // Normalized enum the client should branch its UI on: paid | pending | failed | cancelled | unknown.
      status: normalizedStatus,
      // Raw PayMongo status, kept for diagnostics only — not for UI branching.
      raw_status: paymentStatus,
      paid: paymentConfirmed,
      payments_count: payments.length,
      checkout_url: session?.attributes?.checkout_url,
    });
  } catch (error) {
    console.error('PayMongo status check error:', error?.response?.data || error.message);
    const providerStatus = Number(error?.response?.status || 0);
    const retryable = !providerStatus || providerStatus === 429 || providerStatus >= 500;
    res.status(retryable ? 503 : 502).json({
      code: retryable ? 'PAYMONGO_STATUS_UNAVAILABLE' : 'PAYMONGO_STATUS_REJECTED',
      detail: 'Payment status could not be checked. Your payment record has been kept; please retry shortly.',
      retryable,
    });
  }
}

/**
 * Verify a PayMongo webhook request using HMAC-SHA256.
 * Header format: "t=TIMESTAMP,te=TEST_SIG" (test) or "t=TIMESTAMP,li=LIVE_SIG" (live).
 * Signed payload: "<timestamp>.<rawBody>"
 */
function verifyWebhookSignature(req) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  // SECURITY: fail CLOSED, not open, when the secret is unavailable. This
  // previously auto-passed (`return true`) whenever NODE_ENV wasn't exactly
  // 'production' AND the secret was unset — meaning a deployed environment
  // that simply never had NODE_ENV set would silently accept any
  // unauthenticated "payment succeeded" event as genuine.
  if (!secret) {
    console.warn('[PayMongo] PAYMONGO_WEBHOOK_SECRET not set — rejecting webhook (fail closed)');
    return false;
  }

  const sigHeader = req.headers['paymongo-signature'];
  if (!sigHeader) return false;

  const parts = {};
  sigHeader.split(',').forEach((part) => {
    const [k, v] = part.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  });

  const timestamp = parts.t;
  const signature = parts.te || parts.li; // te = test, li = live
  if (!timestamp || !signature) return false;

  const timestampSeconds = Number(timestamp);
  const configuredTolerance = Number(process.env.PAYMONGO_WEBHOOK_TOLERANCE_SECONDS || 300);
  const toleranceSeconds = Number.isFinite(configuredTolerance) && configuredTolerance > 0
    ? Math.max(30, configuredTolerance)
    : 300;
  if (!Number.isFinite(timestampSeconds)
      || Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > toleranceSeconds) {
    return false;
  }

  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(signature, 'hex');
  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

const PAYMONGO_WEBHOOK_EVENTS_COLLECTION = 'paymongo_webhook_events';
const PAYMONGO_WEBHOOK_LEASE_MS = 60 * 1000;

function webhookError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function paymongoLivemodeMatches(event) {
  const eventLivemode = event?.attributes?.livemode
    ?? event?.attributes?.data?.attributes?.livemode;
  if (typeof eventLivemode !== 'boolean') return true;

  const key = getSecretKey();
  if (key.startsWith('sk_live_')) return eventLivemode === true;
  if (key.startsWith('sk_test_')) return eventLivemode === false;
  return true;
}

function hashWebhookPayload(event) {
  return crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
}

async function recordPaymongoWebhookEvent(db, event) {
  const eventId = String(event?.id || '').trim();
  const eventType = String(event?.attributes?.type || '').trim();
  const checkoutData = event?.attributes?.data;
  const checkoutId = String(checkoutData?.id || '').trim();

  if (!eventId || !eventType || !checkoutData || !checkoutId) {
    throw webhookError('Malformed PayMongo webhook event');
  }
  if (!paymongoLivemodeMatches(event)) {
    throw webhookError('PayMongo webhook environment mismatch');
  }

  const collection = db.collection(PAYMONGO_WEBHOOK_EVENTS_COLLECTION);
  const now = new Date();
  const payloadHash = hashWebhookPayload(event);
  await collection.updateOne(
    { eventId },
    {
      $setOnInsert: {
        eventId,
        eventType,
        checkoutId,
        livemode: event?.attributes?.livemode
          ?? checkoutData?.attributes?.livemode
          ?? null,
        payloadHash,
        checkoutData,
        status: 'pending',
        attemptCount: 0,
        createdAt: now,
      },
      $set: { lastReceivedAt: now },
    },
    { upsert: true },
  );

  const record = await collection.findOne({ eventId });
  if (!record) throw new Error(`Webhook event ${eventId} was not durably recorded`);
  if (record.payloadHash !== payloadHash) {
    throw webhookError(`Webhook event ${eventId} was replayed with a different payload`, 409);
  }
  return record;
}

async function processPaymongoWebhookEvent(db, event) {
  const eventId = String(event.id);
  const eventType = String(event.attributes.type);
  const checkoutData = event.attributes.data;
  const checkoutId = String(checkoutData.id);
  const events = db.collection(PAYMONGO_WEBHOOK_EVENTS_COLLECTION);
  const now = new Date();

  const claim = unwrapMongoDocument(await events.findOneAndUpdate(
    {
      eventId,
      $or: [
        { status: { $in: ['pending', 'failed'] } },
        { status: 'processing', leaseExpiresAt: { $lt: now } },
      ],
    },
    {
      $set: {
        status: 'processing',
        processingStartedAt: now,
        leaseExpiresAt: new Date(now.getTime() + PAYMONGO_WEBHOOK_LEASE_MS),
        updatedAt: now,
      },
      $inc: { attemptCount: 1 },
      $unset: { lastError: '' },
    },
    { returnDocument: 'after' },
  ));

  if (!claim) {
    const current = await events.findOne({ eventId });
    return {
      duplicate: true,
      status: current?.status || 'processing',
      reconciled: current?.status === 'processed',
    };
  }

  try {
    const result = await reconcileCheckoutSessionPayment(db, checkoutId, {
      session: checkoutData,
      eventType,
    });
    const needsReview = Boolean(result.underpaid || result.conflict || !result.reconciled);
    const finalStatus = needsReview ? 'needs_review' : 'processed';
    const resolution = result.underpaid
      ? 'underpaid'
      : result.conflict
        ? 'ambiguous_checkout_binding'
        : result.reconciled
          ? 'settled'
          : 'bill_not_found';
    const completedAt = new Date();
    const updateResult = await events.updateOne(
      { eventId, status: 'processing' },
      {
        $set: {
          status: finalStatus,
          resolution,
          reconciled: Boolean(result.reconciled && !result.underpaid),
          completedAt,
          updatedAt: completedAt,
        },
        $unset: { leaseExpiresAt: '', lastError: '' },
      },
    );
    if (updateResult.matchedCount !== 1) {
      throw new Error(`Webhook event ${eventId} lost its processing lease`);
    }
    return { ...result, status: finalStatus, resolution, duplicate: false };
  } catch (error) {
    const failedAt = new Date();
    await events.updateOne(
      { eventId },
      {
        $set: {
          status: 'failed',
          lastError: String(error?.message || error).slice(0, 500),
          failedAt,
          updatedAt: failedAt,
        },
        $unset: { leaseExpiresAt: '' },
      },
    );
    throw error;
  }
}

// PayMongo webhook handler: verify, durably deduplicate, then reconcile.
async function handleWebhook(req, res) {
  try {
    if (!verifyWebhookSignature(req)) {
      console.warn('[PayMongo Webhook] Signature verification failed — request rejected');
      return res.status(400).json({ detail: 'Invalid webhook signature' });
    }

    const event = req.body?.data;
    const eventType = event?.attributes?.type;

    if (eventType !== 'checkout_session.payment.paid') {
      return res.status(200).json({ received: true, ignored: true });
    }

    const db = getDb();
    await recordPaymongoWebhookEvent(db, event);
    const result = await processPaymongoWebhookEvent(db, event);
    if (result.status === 'processing') {
      return res.status(503).json({
        received: true,
        duplicate: true,
        status: 'processing',
        retryable: true,
        detail: 'The event is still being processed; retry is required until it reaches a durable terminal state.',
      });
    }
    if (result.duplicate) {
      console.log(`[PayMongo Webhook] Event ${event.id} already recorded with status ${result.status}`);
    } else if (result.status === 'processed') {
      console.log(`[PayMongo Webhook] Event ${event.id} reconciled successfully`);
    } else if (result.status === 'needs_review') {
      console.warn(`[PayMongo Webhook] Event ${event.id} retained for review: ${result.resolution}`);
    }
    return res.status(200).json({
      received: true,
      duplicate: Boolean(result.duplicate),
      status: result.status,
    });
  } catch (error) {
    console.error('PayMongo webhook error:', error);
    const statusCode = Number(error?.statusCode) || 503;
    return res.status(statusCode).json({
      received: false,
      retryable: statusCode >= 500,
      detail: statusCode >= 500
        ? 'Webhook processing failed; retry is required'
        : error.message,
    });
  }
}

// Auto-register PayMongo webhook on server startup
async function registerWebhook() {
  const key = getSecretKey();
  if (!key) {
    console.log('[PayMongo] No secret key configured — skipping webhook registration');
    return;
  }

  const backendUrl = normalizeBaseUrl(process.env.BACKEND_URL) || DEFAULT_BACKEND_URL;
  if (!backendUrl) {
    console.log('[PayMongo] BACKEND_URL not set — webhook registration skipped.');
    console.log('[PayMongo] Set BACKEND_URL to https://api.lilycrest.space to auto-register.');
    return;
  }

  const webhookUrl = `${backendUrl}/api/paymongo/webhook`;

  try {
    // Check for existing webhooks to avoid duplicates
    const existingResp = await axios.get(`${PAYMONGO_BASE}/webhooks`, {
      headers: paymongoHeaders(),
    });
    const existingWebhooks = existingResp.data?.data || [];
    const alreadyRegistered = existingWebhooks.find(
      (wh) => wh.attributes?.url === webhookUrl && wh.attributes?.status === 'enabled'
    );

    if (alreadyRegistered) {
      console.log(`[PayMongo] Webhook already registered: ${webhookUrl} (ID: ${alreadyRegistered.id})`);
      return;
    }

    // Disable any stale webhooks for the same URL
    for (const wh of existingWebhooks) {
      if (wh.attributes?.url === webhookUrl && wh.attributes?.status === 'enabled') {
        try {
          await axios.post(`${PAYMONGO_BASE}/webhooks/${wh.id}/disable`, {}, { headers: paymongoHeaders() });
          console.log(`[PayMongo] Disabled stale webhook: ${wh.id}`);
        } catch (_) {}
      }
    }

    // Register a new webhook
    const resp = await axios.post(
      `${PAYMONGO_BASE}/webhooks`,
      {
        data: {
          attributes: {
            url: webhookUrl,
            events: [
              'checkout_session.payment.paid',
              'payment.paid',
              'payment.failed',
            ],
          },
        },
      },
      { headers: paymongoHeaders() }
    );

    const webhookId = resp.data?.data?.id;
    const webhookSecret = resp.data?.data?.attributes?.secret_key;
    console.log(`[PayMongo] ✓ Webhook registered successfully!`);
    console.log(`[PayMongo]   URL: ${webhookUrl}`);
    console.log(`[PayMongo]   ID: ${webhookId}`);
    if (webhookSecret && !process.env.PAYMONGO_WEBHOOK_SECRET) {
      console.log('[PayMongo]   ACTION REQUIRED: Add the webhook signing secret to PAYMONGO_WEBHOOK_SECRET.');
      console.log('[PayMongo]   Retrieve the secret from the PayMongo dashboard; it is not printed in logs.');
    }
  } catch (error) {
    console.error('[PayMongo] Webhook registration failed:', error?.response?.data?.errors?.[0]?.detail || error.message);
    console.log('[PayMongo] You can manually register at: https://dashboard.paymongo.com/developers/webhooks');
  }
}

// ── Redirect handlers ──
// PayMongo redirects the browser here after payment. We serve an HTML page
// that auto-redirects to the app's deep link (frontend:// scheme). These
// public endpoints never mutate billing state; verified webhook delivery or
// an authenticated checkout-status poll performs settlement.

async function redirectSuccess(req, res) {
  const billingId = req.query.billing_id || '';
  const prodLink = `frontend://payment-success?billing_id=${encodeURIComponent(billingId)}&status=success`;
  const devLink = `exp+frontend://payment-success?billing_id=${encodeURIComponent(billingId)}&status=success`;
  console.log(`[PayMongo] Payment success redirect for bill ${billingId}`);

  // Immediately redirect to the app scheme. Chrome Custom Tabs (openAuthSessionAsync)
  // intercepts this and closes the browser, returning control to the app.
  // The fallback HTML is shown only if the browser doesn't support the scheme.
  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Successful</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; flex-direction: column;
         align-items: center; justify-content: center; min-height: 100vh; margin: 0;
         background: #f0fdf4; color: #15803d; text-align: center; padding: 20px; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  p { color: #4B5563; margin-bottom: 24px; }
  a { display: inline-block; padding: 14px 32px; background: #D4682A; color: #fff;
      text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 16px; }
  .retry { margin-top: 12px; font-size: 14px; color: #6B7280; }
</style>
</head><body>
<h1>&#10003; Payment Successful!</h1>
<p>Redirecting you back to LilyCrest...</p>
<a href="${prodLink}">Return to App</a>
<p class="retry">If the app doesn't open, <a href="${devLink}" style="background:none;padding:0;color:#D4682A;font-size:14px;">tap here (dev build)</a></p>
<script>
  // Immediate redirect — no timer so the browser can intercept it as a navigation event
  window.location.replace("${prodLink}");
</script>
</body></html>`);
}

async function redirectCancel(req, res) {
  const billingId = req.query.billing_id || '';
  const prodLink = `frontend://payment-cancel?billing_id=${encodeURIComponent(billingId)}&status=cancelled`;
  const devLink = `exp+frontend://payment-cancel?billing_id=${encodeURIComponent(billingId)}&status=cancelled`;
  console.log(`[PayMongo] Payment cancelled redirect for bill ${billingId}`);

  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Cancelled</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; flex-direction: column;
         align-items: center; justify-content: center; min-height: 100vh; margin: 0;
         background: #fef2f2; color: #b91c1c; text-align: center; padding: 20px; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  p { color: #4B5563; margin-bottom: 24px; }
  a { display: inline-block; padding: 14px 32px; background: #1E3A5F; color: #fff;
      text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 16px; }
  .retry { margin-top: 12px; font-size: 14px; color: #6B7280; }
</style>
</head><body>
<h1>Payment Cancelled</h1>
<p>No charges were made. Redirecting back...</p>
<a href="${prodLink}">Return to App</a>
<p class="retry">If the app doesn't open, <a href="${devLink}" style="background:none;padding:0;color:#1E3A5F;font-size:14px;">tap here (dev build)</a></p>
<script>
  window.location.replace("${prodLink}");
</script>
</body></html>`);
}

module.exports = {
  createCheckoutSession,
  fetchCheckoutSessionRecord,
  getCheckoutSessionPaymentDate,
  getCheckoutSessionPaymentState,
  normalizeCheckoutStatusForClient,
  getCheckoutStatus,
  handleWebhook,
  verifyWebhookSignature,
  recordPaymongoWebhookEvent,
  processPaymongoWebhookEvent,
  registerWebhook,
  reconcileCheckoutSessionPayment,
  redirectSuccess,
  redirectCancel,
};
