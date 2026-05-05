const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require('mongodb');
const { getDb } = require('../config/database');
const { buildBrandedPdf, esc } = require('../utils/pdfBuilder');
const { notifyBillCreated } = require('../services/pushService');

// ── Presentation-mode mock bills ─────────────────────────────────────────────
// Used as PDF fallback when a bill ID is not found in the database.
// These match the mock data already shown in the mobile billing screens.
const PRESENTATION_BILLS = {
  'BILL-2026-004': {
    billing_id: 'BILL-2026-004',
    description: 'April 2026 Billing Statement',
    billing_period: 'April 2026',
    billing_type: 'consolidated',
    release_date: new Date('2026-04-18'),
    due_date: new Date('2026-04-28'),
    status: 'pending',
    rent: 5400, electricity: 353.89, water: 450, penalties: 0,
    total: 6203.89, amount: 6203.89,
    electricity_breakdown: [
      { occupants: 4, reading_date_from: '2026-03-15', reading_date_to: '2026-03-24', reading_from: 1091.91, reading_to: 1127.69, consumption: 35.78, rate: 16, segment_total: 572.48, share_per_tenant: 143.12 },
      { occupants: 3, reading_date_from: '2026-03-24', reading_date_to: '2026-04-15', reading_from: 1127.69, reading_to: 1167.21, consumption: 39.52, rate: 16, segment_total: 632.32, share_per_tenant: 210.77 },
    ],
    water_breakdown: { reading_from: 22, reading_to: 31, consumption: 9, rate: 50, total: 450, sharing_policy: 'Equal division among active tenants' },
  },
  'BILL-2026-003': {
    billing_id: 'BILL-2026-003',
    description: 'Electricity Bill - March 2026',
    billing_period: 'March 2026',
    billing_type: 'electricity',
    release_date: new Date('2026-03-18'),
    due_date: new Date('2026-03-25'),
    status: 'pending',
    electricity: 353.89, total: 353.89, amount: 353.89,
    electricity_breakdown: [
      { occupants: 4, reading_date_from: '2026-02-15', reading_date_to: '2026-02-24', reading_from: 1016.61, reading_to: 1052.39, consumption: 35.78, rate: 16, segment_total: 572.48, share_per_tenant: 143.12 },
      { occupants: 3, reading_date_from: '2026-02-24', reading_date_to: '2026-03-15', reading_from: 1052.39, reading_to: 1091.91, consumption: 39.52, rate: 16, segment_total: 632.32, share_per_tenant: 210.77 },
    ],
  },
  'BILL-2026-002': {
    billing_id: 'BILL-2026-002',
    description: 'Electricity Bill - February 2026',
    billing_period: 'February 2026',
    billing_type: 'electricity',
    release_date: new Date('2026-02-18'),
    due_date: new Date('2026-02-25'),
    status: 'paid',
    electricity: 280, total: 280, amount: 280,
    payment_method: 'paymongo',
    payment_date: new Date('2026-02-20T10:30:00Z'),
    paymongo_reference: 'LC-BILL-2026-002-1709500000',
    electricity_breakdown: [
      { occupants: 4, reading_date_from: '2026-01-15', reading_date_to: '2026-02-15', reading_from: 946.61, reading_to: 1016.61, consumption: 70, rate: 16, segment_total: 1120, share_per_tenant: 280 },
    ],
  },
  'BILL-2026-001': {
    billing_id: 'BILL-2026-001',
    description: 'Electricity Bill - January 2026',
    billing_period: 'January 2026',
    billing_type: 'electricity',
    release_date: new Date('2026-01-18'),
    due_date: new Date('2026-01-25'),
    status: 'paid',
    electricity: 195.50, total: 195.50, amount: 195.50,
    payment_method: 'paymongo',
    payment_date: new Date('2026-01-22T14:20:00Z'),
    paymongo_reference: 'LC-BILL-2026-001-1706900000',
    electricity_breakdown: [
      { occupants: 3, reading_date_from: '2025-12-15', reading_date_to: '2026-01-15', reading_from: 905.98, reading_to: 946.61, consumption: 40.63, rate: 16, segment_total: 650.08, share_per_tenant: 195.50 },
    ],
  },
};

const BILL_UNAVAILABLE_MESSAGE = 'This billing record is no longer available.';
const NON_VISIBLE_BILL_STATUSES = new Set([
  'archived',
  'cancelled',
  'canceled',
  'deleted',
  'hidden',
  'invalid',
  'void',
  'voided',
]);
const PAID_BILL_STATUSES = new Set(['paid', 'settled']);
const NON_PAYABLE_BILL_STATUSES = new Set([
  ...NON_VISIBLE_BILL_STATUSES,
  ...PAID_BILL_STATUSES,
  'duplicate',
  'refunded',
  'rejected',
  'verification',
]);

function normalizeBillId(bill = {}) {
  const candidates = [
    bill.billing_id,
    bill.id,
    bill.billingId,
    bill.billId,
    bill.reference_id,
    bill._id,
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const normalized = String(candidate).trim();
    if (normalized) return normalized;
  }

  return '';
}

function normalizeBillStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function getBillPaymentDate(bill = {}) {
  return bill.payment_date
    || bill.paymentDate
    || bill.paidAt
    || bill.paid_at
    || null;
}

function hasTrueFlag(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function hasConfirmedPaymentEvidence(bill = {}) {
  if (
    hasMeaningfulValue(bill.paymongo_payment_id)
    || hasMeaningfulValue(bill.paymongoPaymentId)
    || hasMeaningfulValue(bill.transaction_id)
    || hasMeaningfulValue(bill.transactionId)
    || hasMeaningfulValue(bill.txn_id)
  ) {
    return true;
  }

  const paymentDate = getBillPaymentDate(bill);
  const hasReference = hasMeaningfulValue(bill.paymongo_reference)
    || hasMeaningfulValue(bill.paymongoReference)
    || hasMeaningfulValue(bill.reference_no)
    || hasMeaningfulValue(bill.reference);
  const paymentMethod = String(bill.payment_method || bill.paymentMethod || '').trim().toLowerCase();

  return Boolean(paymentDate) && (hasReference || Boolean(paymentMethod));
}

function getEffectiveBillStatus(bill = {}) {
  const status = normalizeBillStatus(bill.status);
  if (PAID_BILL_STATUSES.has(status)) return status;
  if (hasConfirmedPaymentEvidence(bill)) return 'paid';
  return status;
}

function toComparableDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).trim();
  return parsed.toISOString();
}

function getBillTimestamp(bill = {}) {
  const candidates = [
    bill.due_date,
    bill.dueDate,
    bill.release_date,
    bill.releaseDate,
    bill.created_at,
    bill.createdAt,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = new Date(candidate).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

function getComparableBillAmount(bill = {}) {
  if (isPaidBill(bill)) return 0;
  const amount = Number(bill.remaining_amount ?? bill.total ?? bill.amount ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function getStableBillAmount(bill = {}) {
  const directCandidates = [
    bill.original_total,
    bill.gross_amount,
    bill.grossAmount,
  ];

  for (const candidate of directCandidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const baseCharges = ['rent', 'electricity', 'water', 'penalties']
    .reduce((sum, key) => {
      const parsed = Number(bill[key] ?? 0);
      return Number.isFinite(parsed) ? sum + parsed : sum;
    }, 0);
  if (baseCharges > 0) return baseCharges;

  if (Array.isArray(bill.items) && bill.items.length > 0) {
    const itemizedTotal = bill.items.reduce((sum, item) => {
      const parsed = Number(item?.amount ?? 0);
      return Number.isFinite(parsed) ? sum + parsed : sum;
    }, 0);
    if (itemizedTotal > 0) return itemizedTotal;
  }

  const fallbackCandidates = [bill.total, bill.amount, bill.remaining_amount];
  for (const candidate of fallbackCandidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }

  return 0;
}

function buildBillChargeFingerprint(bill = {}) {
  const baseParts = ['rent', 'electricity', 'water', 'penalties']
    .map((key) => {
      const parsed = Number(bill[key] ?? 0);
      return `${key}:${Number.isFinite(parsed) ? parsed : 0}`;
    });

  const itemParts = Array.isArray(bill.items)
    ? [...bill.items]
      .map((item) => ({
        label: String(item?.label || item?.description || '').trim().toLowerCase(),
        type: String(item?.type || '').trim().toLowerCase(),
        amount: Number(item?.amount ?? 0),
      }))
      .sort((left, right) => {
        const labelDiff = left.label.localeCompare(right.label);
        if (labelDiff !== 0) return labelDiff;
        return left.type.localeCompare(right.type);
      })
      .map((item) => `${item.label}:${item.type}:${Number.isFinite(item.amount) ? item.amount : 0}`)
    : [];

  return [...baseParts, ...itemParts].join('|');
}

function getBillFreshnessTimestamp(bill = {}) {
  const candidates = [
    bill.updated_at,
    bill.updatedAt,
    getBillPaymentDate(bill),
    bill.created_at,
    bill.createdAt,
    bill.due_date,
    bill.dueDate,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = new Date(candidate).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

function getBillPreferenceScore(bill = {}) {
  let score = 0;

  if (isPaidBill(bill)) score += 1000;
  if (hasMeaningfulValue(getBillPaymentDate(bill))) score += 300;
  if (
    hasConfirmedPaymentEvidence(bill)
  ) {
    score += 250;
  }
  if ((bill.__source || '') === 'real') score += 150;
  if (isPayableBill(bill)) score += 25;

  return score;
}

function mergeBillRecords(preferred = {}, fallback = {}) {
  const merged = { ...fallback };

  Object.entries(preferred).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) merged[key] = value;
      return;
    }

    if (value instanceof Date) {
      merged[key] = value;
      return;
    }

    if (value && typeof value === 'object') {
      if (Object.keys(value).length > 0) merged[key] = value;
      return;
    }

    if (hasMeaningfulValue(value)) {
      merged[key] = value;
    }
  });

  merged.__source = preferred.__source || fallback.__source;
  return merged;
}

function choosePreferredBillRecord(existing, candidate) {
  if (!existing) return candidate;
  if (!candidate) return existing;

  const existingScore = getBillPreferenceScore(existing);
  const candidateScore = getBillPreferenceScore(candidate);
  if (candidateScore !== existingScore) {
    return candidateScore > existingScore
      ? mergeBillRecords(candidate, existing)
      : mergeBillRecords(existing, candidate);
  }

  const existingFreshness = getBillFreshnessTimestamp(existing);
  const candidateFreshness = getBillFreshnessTimestamp(candidate);
  if (candidateFreshness !== existingFreshness) {
    return candidateFreshness > existingFreshness
      ? mergeBillRecords(candidate, existing)
      : mergeBillRecords(existing, candidate);
  }

  if ((existing.__source || '') !== (candidate.__source || '')) {
    return (candidate.__source || '') === 'real'
      ? mergeBillRecords(candidate, existing)
      : mergeBillRecords(existing, candidate);
  }

  return getBillTimestamp(candidate) >= getBillTimestamp(existing)
    ? mergeBillRecords(candidate, existing)
    : mergeBillRecords(existing, candidate);
}

function isBillHiddenOrDeleted(bill = {}) {
  return hasTrueFlag(bill.isArchived)
    || hasTrueFlag(bill.archived)
    || hasTrueFlag(bill.hidden)
    || hasTrueFlag(bill.isHidden)
    || hasTrueFlag(bill.deleted)
    || hasTrueFlag(bill.isDeleted)
    || hasTrueFlag(bill.invalid)
    || hasTrueFlag(bill.isInvalid)
    || hasMeaningfulValue(bill.archivedAt)
    || hasMeaningfulValue(bill.archived_at)
    || hasMeaningfulValue(bill.deletedAt)
    || hasMeaningfulValue(bill.deleted_at)
    || hasMeaningfulValue(bill.hiddenAt)
    || hasMeaningfulValue(bill.hidden_at)
    || hasMeaningfulValue(bill.cancelledAt)
    || hasMeaningfulValue(bill.cancelled_at)
    || hasMeaningfulValue(bill.canceledAt)
    || hasMeaningfulValue(bill.canceled_at)
    || hasMeaningfulValue(bill.invalidatedAt)
    || hasMeaningfulValue(bill.invalidated_at)
    || hasMeaningfulValue(bill.voidedAt)
    || hasMeaningfulValue(bill.voided_at);
}

function isTenantVisibleBill(bill = {}) {
  const status = normalizeBillStatus(bill.status);
  if (!normalizeBillId(bill)) return false;
  if (isBillHiddenOrDeleted(bill)) return false;
  return !NON_VISIBLE_BILL_STATUSES.has(status);
}

function isPaidBill(bill = {}) {
  return PAID_BILL_STATUSES.has(getEffectiveBillStatus(bill));
}

function isPayableBill(bill = {}) {
  const status = getEffectiveBillStatus(bill);
  if (!isTenantVisibleBill(bill)) return false;
  if (NON_PAYABLE_BILL_STATUSES.has(status)) return false;
  return getComparableBillAmount(bill) > 0;
}

function normalizeLegacyBill(bill = {}) {
  const normalized = { ...bill, _id: undefined };
  const effectiveStatus = getEffectiveBillStatus(normalized);

  normalized.status = effectiveStatus || normalized.status;
  if (effectiveStatus === 'paid') {
    if (normalized.remaining_amount !== undefined) {
      normalized.remaining_amount = 0;
    }
    const paymentDate = getBillPaymentDate(normalized);
    if (paymentDate && !normalized.payment_date) {
      normalized.payment_date = paymentDate;
    }
  }

  return normalized;
}

function buildBillVisibilitySignature(bill = {}) {
  return [
    String(bill.billing_period || '').trim().toLowerCase(),
    String(bill.description || '').trim().toLowerCase(),
    toComparableDate(bill.due_date || bill.dueDate),
    toComparableDate(bill.release_date || bill.releaseDate),
    getStableBillAmount(bill),
    String(bill.billing_type || '').trim().toLowerCase(),
    buildBillChargeFingerprint(bill),
  ].join('|');
}

function sortBillsNewestFirst(bills = []) {
  return [...bills].sort((left, right) => {
    const timeDiff = getBillTimestamp(right) - getBillTimestamp(left);
    if (timeDiff !== 0) return timeDiff;
    return normalizeBillId(right).localeCompare(normalizeBillId(left));
  });
}

function dedupeTenantBills(bills = []) {
  const uniqueById = new Map();

  bills.forEach((bill) => {
    const id = normalizeBillId(bill);
    if (!id || !isTenantVisibleBill(bill)) return;
    uniqueById.set(id, choosePreferredBillRecord(uniqueById.get(id), bill));
  });

  const uniqueBySignature = new Map();
  Array.from(uniqueById.values()).forEach((bill) => {
    const signature = buildBillVisibilitySignature(bill);
    uniqueBySignature.set(signature, choosePreferredBillRecord(uniqueBySignature.get(signature), bill));
  });

  return sortBillsNewestFirst(Array.from(uniqueBySignature.values())).map(({ __source, ...bill }) => bill);
}

function applyBillFilters(bills, { billingId = null, paidOnly = false, unpaidOnly = false, limit = 100 } = {}) {
  const targetId = String(billingId || '').trim().toLowerCase();
  let results = Array.isArray(bills) ? [...bills] : [];

  if (targetId) {
    results = results.filter((bill) => normalizeBillId(bill).trim().toLowerCase() === targetId);
  }

  if (paidOnly) {
    results = results.filter(isPaidBill);
  } else if (unpaidOnly) {
    results = results.filter(isPayableBill);
  }

  results = sortBillsNewestFirst(results);

  if (Number.isFinite(limit) && limit > 0) {
    return results.slice(0, limit);
  }

  return results;
}

function normalizeBillingPeriod(value, fallback = 'N/A') {
  if (value == null) return fallback;

  const raw = String(value).trim();
  if (!raw) return fallback;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  if (/^[A-Za-z]+\s+\d{4}$/.test(raw)) {
    return raw;
  }

  return fallback;
}

function hasUsableElectricityBreakdown(bill) {
  if (!Array.isArray(bill?.electricity_breakdown) || bill.electricity_breakdown.length === 0) return false;

  return bill.electricity_breakdown.every((seg) => {
    const hasOccupants = Number.isFinite(Number(seg?.occupants))
      || (Array.isArray(seg?.active_tenants) && seg.active_tenants.length > 0);
    const hasDates = Boolean(seg?.reading_date_from || seg?.period_start)
      && Boolean(seg?.reading_date_to || seg?.period_end);
    const hasReadings = Number.isFinite(Number(seg?.reading_from))
      && Number.isFinite(Number(seg?.reading_to));
    const hasRate = Number.isFinite(Number(seg?.rate));
    const hasShare = Number.isFinite(Number(seg?.share_per_tenant));

    return hasOccupants && hasDates && hasReadings && hasRate && hasShare;
  });
}

// Map a document from the real 'bills' collection to the legacy billing shape
function mapRealBill(b, userId) {
  const c = b.charges || {};
  const effectiveStatus = getEffectiveBillStatus(b);
  const isSettled = PAID_BILL_STATUSES.has(effectiveStatus);
  const originalTotal = b.totalAmount ?? b.grossAmount ?? b.remainingAmount ?? 0;
  // Use remainingAmount as the payable total (accounts for credits/discounts)
  const payableAmount = isSettled ? 0 : (b.remainingAmount ?? b.totalAmount ?? 0);
  const visibleAmount = isSettled ? originalTotal : payableAmount;
  const paymentDate = getBillPaymentDate(b);
  const electricityBreakdown = Array.isArray(b.electricity_breakdown)
    ? b.electricity_breakdown
    : (Array.isArray(b.electricityBreakdown) ? b.electricityBreakdown : undefined);
  const waterBreakdown = b.water_breakdown && typeof b.water_breakdown === 'object'
    ? b.water_breakdown
    : (b.waterBreakdown && typeof b.waterBreakdown === 'object' ? b.waterBreakdown : undefined);

  // Format billing period from billingMonth ISO string → "April 2026"
  const billingPeriod = normalizeBillingPeriod(b.billingMonth ?? b.description, '');

  return {
    billing_id: b._id?.toString(),
    user_id: userId,
    description: billingPeriod ? `${billingPeriod} Billing Statement` : 'Billing Statement',
    billing_period: billingPeriod,
    billing_type: 'consolidated',
    due_date: b.dueDate,
    release_date: b.billingCycleStart,
    status: effectiveStatus || b.status,
    // Individual charge fields so breakdown chips render correctly
    rent: c.rent ?? b.rent ?? 0,
    electricity: c.electricity ?? b.electricity ?? 0,
    water: c.water ?? b.water ?? 0,
    penalties: (c.penalty ?? 0) + (c.applianceFees ?? 0) + (c.corkageFees ?? 0) + (b.penalties ?? 0),
    // Totals
    amount: visibleAmount,
    total: visibleAmount,
    gross_amount: b.grossAmount ?? originalTotal,
    original_total: originalTotal,
    remaining_amount: isSettled ? 0 : b.remainingAmount,
    payment_method: b.paymentMethod,
    payment_date: paymentDate,
    paymongo_reference: b.paymongoReference,
    paymongo_checkout_id: b.paymongoSessionId,
    paymongo_payment_id: b.paymongoPaymentId,
    additional_charges: b.additionalCharges,
    electricity_breakdown: electricityBreakdown,
    water_breakdown: waterBreakdown,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
    isArchived: b.isArchived ?? false,
    isHidden: b.isHidden ?? b.hidden ?? false,
    isDeleted: b.isDeleted ?? false,
    invalid: b.invalid ?? b.isInvalid ?? false,
    archivedAt: b.archivedAt,
    deletedAt: b.deletedAt,
    hiddenAt: b.hiddenAt,
    cancelledAt: b.cancelledAt ?? b.canceledAt,
    invalidatedAt: b.invalidatedAt,
    voidedAt: b.voidedAt,
  };
}

function normalizeLine(line) {
  if (!line) return '';
  return String(line)
    .replace(/•/g, '-')
    .replace(/₱/g, 'PHP ')
    .replace(/✓/g, 'Yes')
    .replace(/[\u2013\u2014]/g, '-')
    .trimEnd();
}

// Fetch bills for a user — tries the legacy 'billing' collection first,
// then falls back to the real 'bills' collection (keyed by MongoDB ObjectId).
async function fetchUserBills(db, user, {
  billingId = null,
  paidOnly = false,
  unpaidOnly = false,
  limit = 100,
} = {}) {
  const userId = user.user_id;
  const mongoId = user._id;

  const [legacyBills, realBills] = await Promise.all([
    db.collection('billing')
      .find({ user_id: userId })
      .toArray()
      .then((docs) => docs.map((bill) => ({ ...normalizeLegacyBill(bill), __source: 'legacy' }))),
    mongoId
      ? db.collection('bills')
        .find({ userId: mongoId })
        .toArray()
        .then((docs) => docs.map((bill) => ({ ...mapRealBill(bill, userId), __source: 'real' })))
      : Promise.resolve([]),
  ]);

  const visibleBills = dedupeTenantBills([...legacyBills, ...realBills]);
  return applyBillFilters(visibleBills, { billingId, paidOnly, unpaidOnly, limit });
}

// Get the most recent bill for the user (by due date, fallback to created_at)
async function getLatestBilling(req, res) {
  try {
    const db = getDb();
    const bills = await fetchUserBills(db, req.user, { limit: 1 });
    if (!bills.length) {
      return res.status(404).json({ detail: 'No billing found' });
    }
    res.json(bills[0]);
  } catch (error) {
    console.error('Get latest billing error:', error);
    res.status(500).json({ detail: 'Failed to fetch latest billing' });
  }
}

// Get user's billing
async function getMyBilling(req, res) {
  try {
    const db = getDb();
    const bills = await fetchUserBills(db, req.user);
    res.json(bills);
  } catch (error) {
    console.error('Get billing error:', error);
    res.status(500).json({ detail: 'Failed to fetch billing' });
  }
}

// Get tenant-visible billing history
async function getBillingHistory(req, res) {
  try {
    const db = getDb();
    const bills = await fetchUserBills(db, req.user);
    res.json(bills);
  } catch (error) {
    res.status(500).json({ detail: 'Failed to fetch billing history' });
  }
}

// Get paid history
async function getPaymentHistory(req, res) {
  try {
    const db = getDb();
    const bills = await fetchUserBills(db, req.user, { paidOnly: true });
    res.json(bills);
  } catch (error) {
    res.status(500).json({ detail: 'Failed to fetch payment history' });
  }
}

async function getBillingById(req, res) {
  try {
    const { billingId } = req.params;
    const db = getDb();
    const bill = (await fetchUserBills(db, req.user, { billingId, limit: 1 }))[0];

    if (!bill) {
      return res.status(404).json({ detail: BILL_UNAVAILABLE_MESSAGE });
    }

    return res.json(bill);
  } catch (error) {
    console.error('Get billing by id error:', error);
    return res.status(500).json({ detail: 'Failed to fetch billing record' });
  }
}

// Create billing (supports both simple and consolidated/itemized bills)
async function createBilling(req, res) {
  try {
    const {
      amount, description, billing_type, due_date,
      billing_period, release_date,
      rent, electricity, water, penalties,
      items,                    // [{label, amount, type}]
      electricity_breakdown,    // [{period_start, period_end, reading_from, reading_to, consumption, rate, segment_total, active_tenants, share_per_tenant}]
      water_breakdown,          // {reading_from, reading_to, consumption, rate, total, sharing_policy}
    } = req.body;

    // Auto-compute total from itemized fields if not given
    const computedTotal = (Number(rent) || 0) + (Number(electricity) || 0)
      + (Number(water) || 0) + (Number(penalties) || 0)
      + (Array.isArray(items) ? items.reduce((s, i) => s + (Number(i.amount) || 0), 0) : 0);
    const total = Number(amount) || computedTotal || 0;

    const newBill = {
      billing_id: `bill_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
      user_id: req.user.user_id,
      amount: total,
      total,
      description,
      billing_type: billing_type || (rent ? 'consolidated' : 'rent'),
      due_date: new Date(due_date),
      status: 'pending',
      payment_method: null,
      payment_date: null,
      proof: null,
      created_at: new Date(),
    };

    // Optional consolidated fields
    if (billing_period) newBill.billing_period = billing_period;
    if (release_date) newBill.release_date = new Date(release_date);
    if (rent != null) newBill.rent = Number(rent);
    if (electricity != null) newBill.electricity = Number(electricity);
    if (water != null) newBill.water = Number(water);
    if (penalties != null) newBill.penalties = Number(penalties);
    if (Array.isArray(items) && items.length) newBill.items = items;
    if (Array.isArray(electricity_breakdown) && electricity_breakdown.length) newBill.electricity_breakdown = electricity_breakdown;
    if (water_breakdown && typeof water_breakdown === 'object') newBill.water_breakdown = water_breakdown;

    const db = getDb();
    await db.collection('billing').insertOne(newBill);

    // Push notification (non-blocking)
    const billOwnerUserId = typeof newBill.user_id === 'string' ? newBill.user_id.trim() : '';
    if (billOwnerUserId) {
      notifyBillCreated(billOwnerUserId, newBill).catch((pushError) => {
        console.warn('[Billing] Bill-created push failed:', pushError?.message || pushError);
      });
    } else {
      console.warn('[Billing] Skipped bill-created push because bill owner user_id was not resolved');
    }

    res.status(201).json({ ...newBill, _id: undefined });
  } catch (error) {
    console.error('Create billing error:', error);
    res.status(500).json({ detail: 'Failed to create bill' });
  }
}

// Update billing (e.g., mark paid, set payment details, add itemized charges)
async function updateBilling(req, res) {
  try {
    const { billingId } = req.params;
    const {
      status,
      payment_method,
      payment_date,
      notes,
      // Itemized charge fields
      billing_period, release_date, description,
      rent, electricity, water, penalties,
      items, electricity_breakdown, water_breakdown,
      amount, total,
    } = req.body || {};

    const isAdmin = ['admin', 'superadmin'].includes(req.user?.role);
    const db = getDb();

    const updates = {};
    if (status) updates.status = status;
    if (payment_method) updates.payment_method = payment_method;
    if (payment_date) updates.payment_date = new Date(payment_date);
    if (notes) updates.notes = notes;
    if (description) updates.description = description;
    if (billing_period) updates.billing_period = billing_period;
    if (release_date) updates.release_date = new Date(release_date);

    // Itemized charges
    if (rent != null) updates.rent = Number(rent);
    if (electricity != null) updates.electricity = Number(electricity);
    if (water != null) updates.water = Number(water);
    if (penalties != null) updates.penalties = Number(penalties);
    if (Array.isArray(items)) updates.items = items;
    if (Array.isArray(electricity_breakdown)) updates.electricity_breakdown = electricity_breakdown;
    if (water_breakdown && typeof water_breakdown === 'object') updates.water_breakdown = water_breakdown;

    // Recompute total if itemized fields were updated
    if (rent != null || electricity != null || water != null || penalties != null) {
      const legacyFilter = isAdmin
        ? { billing_id: billingId }
        : { billing_id: billingId, user_id: req.user.user_id };
      const existing = await db.collection('billing').findOne(legacyFilter);
      if (!existing) return res.status(404).json({ detail: 'Bill not found' });
      const r = updates.rent ?? existing.rent ?? 0;
      const e = updates.electricity ?? existing.electricity ?? 0;
      const w = updates.water ?? existing.water ?? 0;
      const p = updates.penalties ?? existing.penalties ?? 0;
      const extraItems = updates.items ?? existing.items ?? [];
      const itemsTotal = Array.isArray(extraItems) ? extraItems.reduce((s, i) => s + (Number(i.amount) || 0), 0) : 0;
      const computed = Number(r) + Number(e) + Number(w) + Number(p) + itemsTotal;
      updates.total = computed;
      updates.amount = computed;
    } else if (amount != null || total != null) {
      if (total != null) { updates.total = Number(total); updates.amount = Number(total); }
      else if (amount != null) { updates.amount = Number(amount); updates.total = Number(amount); }
    }

    updates.updated_at = new Date();

    // 1. Try legacy 'billing' collection.
    // Admins can update any tenant's bill; tenants only their own.
    const legacyFilter = isAdmin
      ? { billing_id: billingId }
      : { billing_id: billingId, user_id: req.user.user_id };
    const existingLegacy = await db.collection('billing').findOne(legacyFilter);
    if (existingLegacy && updates.status) {
      const existingLegacyBill = normalizeLegacyBill(existingLegacy);
      const requestedStatus = normalizeBillStatus(updates.status);
      if (!PAID_BILL_STATUSES.has(requestedStatus) && isPaidBill(existingLegacyBill)) {
        delete updates.status;
      }
    }

    const legacyResult = await db.collection('billing').findOneAndUpdate(
      legacyFilter,
      { $set: updates },
      { returnDocument: 'after' }
    );
    const legacyUpdated = legacyResult?.value ?? legacyResult;
    if (legacyUpdated?.billing_id) {
      return res.json({ ...legacyUpdated, _id: undefined });
    }

    // 2. Fallback: 'bills' collection (admin-created bills, keyed by ObjectId).
    // Only admins can update bills from this collection.
    if (!isAdmin) {
      return res.status(404).json({ detail: 'Bill not found' });
    }

    let objId;
    try { objId = new ObjectId(billingId); } catch (_) { objId = null; }
    if (!objId) {
      return res.status(404).json({ detail: 'Bill not found' });
    }

    const existingReal = await db.collection('bills').findOne({ _id: objId });
    if (!existingReal) {
      return res.status(404).json({ detail: 'Bill not found' });
    }

    const existingRealBill = mapRealBill(existingReal, existingReal.userId?.toString() || '');
    if (updates.status) {
      const requestedStatus = normalizeBillStatus(updates.status);
      if (!PAID_BILL_STATUSES.has(requestedStatus) && isPaidBill(existingRealBill)) {
        delete updates.status;
      }
    }

    // Map snake_case fields to the camelCase schema used by the 'bills' collection.
    const billsUpdates = { updatedAt: new Date() };
    if (updates.status) {
      billsUpdates.status = updates.status;
      if (updates.status === 'paid') {
        billsUpdates.remainingAmount = 0;
        billsUpdates.paidAt = updates.payment_date || new Date();
      }
    }
    if (updates.payment_method) billsUpdates.paymentMethod = updates.payment_method;
    if (updates.payment_date) billsUpdates.paymentDate = new Date(updates.payment_date);
    if (updates.notes) billsUpdates.notes = updates.notes;

    const billsResult = await db.collection('bills').findOneAndUpdate(
      { _id: objId },
      { $set: billsUpdates },
      { returnDocument: 'after' }
    );
    const billsUpdated = billsResult?.value ?? billsResult;
    if (!billsUpdated) {
      return res.status(404).json({ detail: 'Bill not found' });
    }

    return res.json(mapRealBill(billsUpdated, billsUpdated.userId?.toString() || ''));
  } catch (error) {
    console.error('Update billing error:', error);
    res.status(500).json({ detail: 'Failed to update bill' });
  }
}

// Branded PDF download for a bill
async function downloadBillPdf(req, res) {
  try {
    const { billingId } = req.params;
    const db = getDb();
    const bill = (await fetchUserBills(db, req.user, { billingId, limit: 1 }))[0];

    if (!bill) {
      return res.status(404).json({ detail: BILL_UNAVAILABLE_MESSAGE });
    }

    const formatMoney = (value) => `PHP ${(Number(value || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const formatDate = (value) => {
      if (!value) return '---';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '---';
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const shortDate = (value) => {
      if (!value) return '---';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '---';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    // Info rows
    const infoRows = [
      { label: 'Tenant', value: normalizeLine(req.user?.name || 'Tenant') },
      { label: 'Email', value: normalizeLine(req.user?.email || '---') },
      { label: 'Status', value: (bill.status || 'pending').toUpperCase() },
    ];
    if (bill.billing_period) {
      infoRows.push({ label: 'Billing Period', value: normalizeLine(bill.billing_period) });
    }
    if (bill.release_date) {
      infoRows.push({ label: 'Release Date', value: formatDate(bill.release_date) });
    }
    infoRows.push({ label: 'Due Date', value: formatDate(bill.due_date) });

    // Payment info (only for paid bills)
    if (bill.status === 'paid') {
      if (bill.payment_method) {
        infoRows.push({ label: 'Payment Method', value: bill.payment_method === 'paymongo' ? 'PayMongo' : normalizeLine(bill.payment_method) });
      }
      if (bill.payment_date) {
        infoRows.push({ label: 'Payment Date', value: formatDate(bill.payment_date) });
      }
      if (bill.paymongo_reference) {
        infoRows.push({ label: 'Reference No.', value: normalizeLine(bill.paymongo_reference) });
      }
    }

    // Charge breakdown table
    const tableRows = [];
    if (bill.rent) tableRows.push({ label: 'Monthly Rent', value: formatMoney(bill.rent) });
    if (bill.electricity) tableRows.push({ label: 'Electricity', value: formatMoney(bill.electricity) });
    if (bill.water) tableRows.push({ label: 'Water', value: formatMoney(bill.water) });
    if (bill.penalties) tableRows.push({ label: 'Penalties / Late Fees', value: formatMoney(bill.penalties) });
    if (bill.items?.length) {
      bill.items.forEach((item) => {
        tableRows.push({ label: normalizeLine(item.label || item.description || 'Charge'), value: formatMoney(item.amount) });
      });
    }
    if (tableRows.length === 0) {
      tableRows.push({ label: 'Total Charges', value: formatMoney(bill.total || bill.amount || 0) });
    }

    // Computation breakdown sections
    const breakdownSections = [];
    const expectsElectricityBreakdown =
      Number(bill.electricity || 0) > 0 || (bill.billing_type || '').toLowerCase() === 'electricity';
    const usableElectricityBreakdown = hasUsableElectricityBreakdown(bill);
    if (usableElectricityBreakdown) {
      breakdownSections.push({
        heading: 'Electricity Breakdown',
        type: 'electricity',
        segments: bill.electricity_breakdown.map((seg) => {
          const occupants = seg.occupants || seg.active_tenants?.length || 1;
          const consumption = seg.consumption ?? ((seg.reading_to || 0) - (seg.reading_from || 0));
          return {
            occupants,
            reading_date_from: shortDate(seg.reading_date_from || seg.period_start),
            reading_date_to: shortDate(seg.reading_date_to || seg.period_end),
            reading_from: seg.reading_from || 0,
            reading_to: seg.reading_to || 0,
            consumption: consumption.toFixed(2),
            rate: seg.rate || 0,
            share_per_tenant: formatMoney(seg.share_per_tenant || 0),
          };
        }),
      });
    } else if (expectsElectricityBreakdown) {
      breakdownSections.push({
        heading: 'Electricity Breakdown',
        type: 'generic',
        segments: [{
          rows: [{ label: 'Status', value: 'Breakdown unavailable.' }],
        }],
      });
    }
    const expectsWaterBreakdown =
      Number(bill.water || 0) > 0 || (bill.billing_type || '').toLowerCase() === 'water';
    if (bill.water_breakdown) {
      const wb = bill.water_breakdown;
      const waterRows = [
        { label: 'Meter Reading', value: `${wb.reading_from || 0} -> ${wb.reading_to || 0}` },
        { label: 'Consumption', value: `${wb.consumption || 0} cu.m` },
        { label: 'Rate', value: `PHP ${wb.rate || 0}/cu.m` },
        { label: 'Total', value: formatMoney(wb.total || 0) },
      ];
      if (wb.sharing_policy) {
        waterRows.push({ label: 'Policy', value: normalizeLine(wb.sharing_policy) });
      }
      breakdownSections.push({
        heading: 'Water Computation Breakdown',
        type: 'water',
        segments: [{ rows: waterRows }],
      });
    } else if (expectsWaterBreakdown) {
      breakdownSections.push({
        heading: 'Water Breakdown',
        type: 'generic',
        segments: [{
          rows: [{ label: 'Status', value: 'Breakdown unavailable.' }],
        }],
      });
    }

    const refId = normalizeLine(bill.reference_no || bill.reference || bill.paymongo_reference || bill.txn_id || bill.transaction_id || billingId);
    const billingPeriod = bill.billing_period
      ? `Billing Period: ${bill.billing_period}`
      : `Billing Period: ${formatDate(bill.created_at)} - ${formatDate(bill.due_date)}`;

    const pdfBuffer = buildBrandedPdf({
      title: normalizeLine(bill.description || 'Billing Statement'),
      subtitle: billingPeriod,
      docType: 'BILLING STATEMENT',
      refNumber: refId,
      date: `Released: ${formatDate(bill.release_date || bill.created_at)}`,
      infoRows,
      tableRows,
      totalRow: { label: 'TOTAL AMOUNT DUE', value: formatMoney(bill.total || bill.amount || 0) },
      breakdownSections,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${billingId}.pdf"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.end(pdfBuffer);
  } catch (error) {
    console.error('Download bill PDF error:', error);
    res.status(500).json({ detail: 'Failed to generate bill PDF' });
  }
}


module.exports = {
  fetchUserBills,
  getLatestBilling,
  getMyBilling,
  getBillingHistory,
  getBillingById,
  getPaymentHistory,
  createBilling,
  updateBilling,
  downloadBillPdf,
  // Shared utilities used by paymongo controller
  BILL_UNAVAILABLE_MESSAGE,
  getBillPaymentDate,
  hasConfirmedPaymentEvidence,
  getEffectiveBillStatus,
  isPayableBill,
  isPaidBill,
  isTenantVisibleBill,
  normalizeBillId,
  getBillTimestamp,
  getBillFreshnessTimestamp,
  getBillPreferenceScore,
  buildBillVisibilitySignature,
  PRESENTATION_BILLS,
  mapRealBill,
};
