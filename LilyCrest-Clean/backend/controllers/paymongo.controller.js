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

function resolveRedirectBaseUrl(req) {
  const configured = normalizeBaseUrl(process.env.BACKEND_URL);
  if (configured) {
    return configured;
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = typeof forwardedProto === 'string' && forwardedProto
    ? forwardedProto.split(',')[0].trim()
    : (req.protocol || 'http');
  const host = req.get('host');

  if (host) {
    return `${protocol}://${host}`;
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
async function saveCheckoutRef(db, billingId, userId, mongoId, checkoutId, referenceNumber, checkoutUrl) {
  const realFilter = buildRealBillLookupFilter(billingId, mongoId, {}, userId);
  if (realFilter) {
    const realResult = await db.collection('bills').updateOne(
      realFilter,
      {
        $set: {
          paymongoSessionId: checkoutId,
          paymongoCheckoutUrl: checkoutUrl || null,
          paymongoSessionCreatedAt: new Date(),
          paymongoReference: referenceNumber,
          paymentMethod: 'paymongo',
          updatedAt: new Date(),
        },
        $unset: { checkoutClaimedAt: '' },
      }
    );
    if (realResult.matchedCount > 0) return;
  }

  const legacyResult = await db.collection('billing').updateOne(
    { billing_id: billingId, user_id: userId },
    {
      $set: {
        paymongo_checkout_id: checkoutId,
        paymongo_reference: referenceNumber,
        payment_method: 'paymongo',
        updated_at: new Date(),
      },
    }
  );
  if (legacyResult.matchedCount > 0) return;
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

async function markLegacyBillPaidAtomic(db, filter, {
  paymentId,
  eventType,
  checkoutId,
  paymentDate,
  referenceNumber,
  paymentChannel,
} = {}) {
  const resolvedPaymentDate = paymentDate instanceof Date ? paymentDate : new Date();
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
} = {}) {
  const resolvedPaymentDate = paymentDate instanceof Date ? paymentDate : new Date();
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

  try {
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
  } catch (err) {
    console.error(`[markBillPaid] DB error for bill ${billingId}:`, err.message);
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
  // This ensures payment is persisted even if the billing_id/user_id in the
  // PayMongo metadata didn't exactly match the stored record.
  if (checkoutId) {
    try {
      const bySession = await db.collection('bills').findOne(
        { paymongoSessionId: checkoutId },
        { projection: { userId: 1, tenantId: 1, user_id: 1, tenantUserId: 1, tenant_user_id: 1 } }
      );
      if (bySession) {
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
    } catch (err) {
      console.error(`[markBillPaid] bills checkout-ID fallback error:`, err.message);
    }

    try {
      const legacyCheckoutResult = await markLegacyBillPaidAtomic(
        db,
        { paymongo_checkout_id: checkoutId },
        options
      );
      if (legacyCheckoutResult.matched) {
        console.log(`[markBillPaid] Bill found by checkout_id ${checkoutId}`);
        return legacyCheckoutResult;
      }
    } catch (err) {
      console.error(`[markBillPaid] Checkout-ID fallback error:`, err.message);
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

async function resolveCheckoutIdForBill(db, billingId) {
  if (!billingId) return '';

  const realFilter = buildRealBillLookupFilter(billingId, null);
  if (realFilter) {
    const realBill = await db.collection('bills').findOne(
      realFilter,
      { projection: { _id: 0, paymongoSessionId: 1 } },
    );
    if (realBill?.paymongoSessionId) return String(realBill.paymongoSessionId);
  }

  const legacy = await db.collection('billing').findOne(
    { billing_id: billingId },
    { projection: { _id: 0, paymongo_checkout_id: 1 } },
  );
  if (legacy?.paymongo_checkout_id) return String(legacy.paymongo_checkout_id);

  return '';
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
  const { existing, alreadyPaid, resolvedUserId } = await markBillPaid(db, billingId, userId, {
    paymentId,
    eventType,
    checkoutId,
    paymentDate,
    referenceNumber,
    paymentChannel,
  });
  const paymentUserId = resolvedUserId || userId;

  if (sendSideEffects && !alreadyPaid && existing && paymentUserId) {
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

  return {
    session: resolvedSession,
    ...state,
    existing,
    alreadyPaid,
    resolvedUserId: paymentUserId,
    referenceNumber,
    paymentId,
    reconciled: Boolean(existing),
  };
}

// Create a PayMongo Checkout Session for a specific bill
// A tenant re-opening the same unpaid bill, a double tap, or a client retry
// must not each mint a brand-new PayMongo checkout session. REUSE_WINDOW_MS
// bounds how long a just-created session is offered back to the tenant
// instead of creating another one; CLAIM_TTL_MS is a short atomic lock so two
// near-simultaneous requests for the same bill can't both pass the "no
// existing session" check and both call PayMongo. Both are enforced on the
// bill document itself via an atomic MongoDB update — no separate lock
// collection needed, and no bill is ever marked paid by any of this; that
// remains solely the webhook/poll reconciliation's job.
const CHECKOUT_REUSE_WINDOW_MS = 20 * 60 * 1000;
const CHECKOUT_CLAIM_TTL_MS = 20 * 1000;

async function createCheckoutSession(req, res) {
  const db = getDb();
  let claimedFilter = null;
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

    const realFilter = source === 'real'
      ? buildRealBillLookupFilter(billingId, req.user?._id, {}, req.user?.user_id)
      : null;
    const now = new Date();

    if (realFilter) {
      const existing = await db.collection('bills').findOne(realFilter, {
        projection: { paymongoSessionId: 1, paymongoSessionCreatedAt: 1, paymongoCheckoutUrl: 1 },
      });
      const createdAt = existing?.paymongoSessionCreatedAt ? new Date(existing.paymongoSessionCreatedAt) : null;
      if (existing?.paymongoSessionId && existing?.paymongoCheckoutUrl && createdAt && (now - createdAt) < CHECKOUT_REUSE_WINDOW_MS) {
        try {
          const statusResponse = await axios.get(`${PAYMONGO_BASE}/checkout_sessions/${existing.paymongoSessionId}`, {
            headers: paymongoHeaders(),
          });
          const sessionStatus = statusResponse.data?.data?.attributes?.status;
          const alreadyPaid = Array.isArray(statusResponse.data?.data?.attributes?.payments)
            && statusResponse.data.data.attributes.payments.some((p) => p?.attributes?.status === 'paid');
          if (!alreadyPaid && sessionStatus !== 'expired') {
            return res.json({
              checkout_url: existing.paymongoCheckoutUrl,
              checkout_id: existing.paymongoSessionId,
              reused: true,
            });
          }
        } catch (_lookupError) {
          // PayMongo lookup failed (network/expired/unknown id) — fall through
          // and create a fresh session rather than blocking payment entirely.
        }
      }

      // Atomically claim the right to create a session for this exact bill so
      // two requests racing past the reuse check above can't both call
      // PayMongo. The loser gets a clear, actionable message instead of a
      // second live checkout.
      const claim = await db.collection('bills').findOneAndUpdate(
        {
          ...realFilter,
          $or: [
            { checkoutClaimedAt: { $exists: false } },
            { checkoutClaimedAt: { $lt: new Date(now.getTime() - CHECKOUT_CLAIM_TTL_MS) } },
          ],
        },
        { $set: { checkoutClaimedAt: now } },
      );
      if (!claim) {
        return res.status(409).json({ detail: 'A payment session is already being created for this bill. Please wait a moment and try again.' });
      }
      claimedFilter = realFilter;
    }

    const description = bill.description || `Bill ${billingId}`;
    const referenceNumber = `LC-${billingId}-${Date.now()}`;

    // Build redirect URLs from the permanent mobile backend origin.
    const backendUrl = resolveRedirectBaseUrl(req);

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
          success_url: `${backendUrl}/api/m/paymongo/redirect/success?billing_id=${billingId}`,
          cancel_url: `${backendUrl}/api/m/paymongo/redirect/cancel?billing_id=${billingId}`,
          metadata: {
            billing_id: billingId,
            user_id: req.user.user_id,
            user_email: req.user.email || '',
          },
        },
      },
    };

    const response = await axios.post(`${PAYMONGO_BASE}/checkout_sessions`, payload, {
      headers: paymongoHeaders(),
    });

    const session = response.data?.data;
    const checkoutUrl = session?.attributes?.checkout_url;
    const checkoutId = session?.id;

    if (!checkoutUrl) {
      if (claimedFilter) await db.collection('bills').updateOne(claimedFilter, { $unset: { checkoutClaimedAt: '' } });
      return res.status(500).json({ detail: 'Failed to create checkout session' });
    }

    // Save checkout reference to the correct collection (legacy or real).
    // This also clears the claim lock set above.
    await saveCheckoutRef(db, billingId, req.user.user_id, req.user._id, checkoutId, referenceNumber, checkoutUrl);

    res.json({
      checkout_url: checkoutUrl,
      checkout_id: checkoutId,
      reference: referenceNumber,
    });
  } catch (error) {
    if (claimedFilter) {
      try { await db.collection('bills').updateOne(claimedFilter, { $unset: { checkoutClaimedAt: '' } }); } catch (_) {}
    }
    console.error('PayMongo checkout error:', error?.response?.data || error.message);
    const paymongoError = error?.response?.data?.errors?.[0]?.detail;
    res.status(500).json({
      detail: paymongoError || 'Failed to create payment session. Please try again.',
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
    res.status(500).json({ detail: 'Failed to check payment status' });
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

// PayMongo webhook handler — receives events from PayMongo
async function handleWebhook(req, res) {
  try {
    if (!verifyWebhookSignature(req)) {
      console.warn('[PayMongo Webhook] Signature verification failed — request rejected');
      return res.status(400).json({ detail: 'Invalid webhook signature' });
    }

    const event = req.body?.data;
    const eventType = event?.attributes?.type;

    if (eventType === 'checkout_session.payment.paid') {
      const checkoutData = event?.attributes?.data;
      const billingId = checkoutData?.attributes?.metadata?.billing_id;
      const userId = checkoutData?.attributes?.metadata?.user_id;

      if (billingId && userId) {
        const db = getDb();
        const webhookCheckoutId = checkoutData?.id || '';
        await reconcileCheckoutSessionPayment(db, webhookCheckoutId, {
          session: checkoutData,
          eventType,
        });
        console.log(`[PayMongo Webhook] Bill ${billingId} marked as paid`);
      }
    }

    // Always respond 200 to acknowledge the webhook
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('PayMongo webhook error:', error);
    res.status(200).json({ received: true }); // Still 200 to prevent retries
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
// that auto-redirects to the app's deep link (frontend:// scheme).

async function redirectSuccess(req, res) {
  const billingId = req.query.billing_id || '';
  let checkoutId = '';
  try {
    const db = getDb();
    checkoutId = await resolveCheckoutIdForBill(db, billingId);
    if (checkoutId) {
      await reconcileCheckoutSessionPayment(db, checkoutId, { eventType: 'redirect_success' });
    }
  } catch (_) {}

  const checkoutParam = checkoutId ? `&checkout_id=${encodeURIComponent(checkoutId)}` : '';
  const prodLink = `frontend://payment-success?billing_id=${encodeURIComponent(billingId)}&status=success${checkoutParam}`;
  const devLink = `exp+frontend://payment-success?billing_id=${encodeURIComponent(billingId)}&status=success${checkoutParam}`;
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
  let checkoutId = '';
  try {
    const db = getDb();
    checkoutId = await resolveCheckoutIdForBill(db, billingId);
  } catch (_) {}

  const checkoutParam = checkoutId ? `&checkout_id=${encodeURIComponent(checkoutId)}` : '';
  const prodLink = `frontend://payment-cancel?billing_id=${encodeURIComponent(billingId)}&status=cancelled${checkoutParam}`;
  const devLink = `exp+frontend://payment-cancel?billing_id=${encodeURIComponent(billingId)}&status=cancelled${checkoutParam}`;
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
  registerWebhook,
  reconcileCheckoutSessionPayment,
  redirectSuccess,
  redirectCancel,
};
