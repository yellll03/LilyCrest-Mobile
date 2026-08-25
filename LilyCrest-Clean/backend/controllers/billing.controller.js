const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require('mongodb');
const { getDb } = require('../config/database');
const { buildBrandedPdf, esc } = require('../utils/pdfBuilder');
const { notifyBillCreated } = require('../services/pushService');
const { calculateLatePenalty } = require('../domain/billing/billingPolicy');
const { extractMoveInFinancials } = require('../domain/billing/moveInFinancials');
const { resolveUtilityDeadline } = require('../domain/billing/utilityBillingPolicy');

const MAX_BILL_AMOUNT = 500000;
const ALLOWED_BILL_STATUSES = new Set([
  'unpaid', 'overdue', 'pending_verification', 'partially_paid', 'paid', 'rejected', 'cancelled',
]);
const LEGACY_BILL_STATUS_MAP = {
  pending: 'unpaid',
  pending_payment: 'unpaid',
  processing: 'pending_verification',
  verification: 'pending_verification',
  settled: 'paid',
  canceled: 'cancelled',
};

// Tenant-facing labels for canonical bill statuses — mirrors the label set
// already used in the mobile app's own status badges (frontend
// app/billing-history.jsx, app/bill-details.jsx STATUS_CONFIG) so a
// downloaded bill PDF reads the same way the app does, instead of showing an
// internal status keyword like "PENDING_VERIFICATION" verbatim.
const BILL_STATUS_LABELS = {
  paid: 'Paid',
  settled: 'Paid',
  unpaid: 'Unpaid',
  pending: 'Unpaid',
  overdue: 'Overdue',
  pending_verification: 'Payment Under Review',
  verification: 'Payment Under Review',
  partially_paid: 'Partially Paid',
  rejected: 'Payment Rejected',
  cancelled: 'Cancelled',
  // Defensive/future-proofing only: these two are part of
  // NON_PAYABLE_BILL_STATUSES but no code path currently writes them to a
  // bill. Mapped here so that if one is ever introduced, it renders a
  // proper label instead of silently falling through.
  duplicate: 'Duplicate',
  refunded: 'Refunded',
};

function billStatusLabel(status) {
  const key = String(status || '').trim().toLowerCase();
  return BILL_STATUS_LABELS[key] || (key ? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unpaid');
}

// PayMongo is the payment gateway, not the payment method the tenant actually
// selected (GCash/Card/Maya/Online Banking) — the backend doesn't currently
// capture which specific channel was used, so showing the gateway's own name
// as if it were "the method" would overstate what's known. A neutral, honest
// label is used instead until the gateway's actual channel is captured.
// PAYMENT_CHANNEL_LABELS maps PayMongo's actual settled-payment source type
// (captured at reconciliation time — see paymongo.controller.js's
// reconcileCheckoutSessionPayment) to the tenant-facing method name. If the
// channel isn't known (older records, or a payment that never made it
// through reconciliation with that detail), fall back to the raw stored
// method/processor name so nothing is fabricated.
const PAYMENT_CHANNEL_LABELS = {
  gcash: 'GCash',
  card: 'Card',
  grab_pay: 'GrabPay',
  paymaya: 'Maya',
  billease: 'BillEase',
  dob: 'Online Banking',
  dob_ubp: 'Online Banking',
};

function billPaymentMethodLabel(rawMethod, channel) {
  const channelLabel = PAYMENT_CHANNEL_LABELS[String(channel || '').trim().toLowerCase()];
  if (channelLabel) return channelLabel;
  const value = String(rawMethod || '').trim();
  if (!value) return '';
  return value.toLowerCase() === 'paymongo' ? 'Online Payment' : value;
}

// ── Presentation-mode mock bills ─────────────────────────────────────────────
// Used as PDF fallback when a bill ID is not found in the database.
// These match the mock data already shown in the mobile billing screens.
const DEMO_BILLS = process.env.ENABLE_DEMO_DATA === 'true' ? {
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
} : {};

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
    bill.legacyBillingId,
    bill.legacy_billing_id,
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

function getBillLookupIds(bill = {}) {
  return [
    bill.billing_id,
    bill.bill_id,
    bill.legacyBillingId,
    bill.legacy_billing_id,
    bill.id,
    bill.billingId,
    bill.billId,
    bill.reference_id,
    bill._id,
  ]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function normalizeBillStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return LEGACY_BILL_STATUS_MAP[normalized] || normalized;
}

function parseMoney(value, field, { optional = true } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return { value: 0, supplied: false };
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_BILL_AMOUNT) {
    return { error: `${field} must be a finite amount between 0 and ${MAX_BILL_AMOUNT}.` };
  }
  return { value: Math.round(amount * 100) / 100, supplied: true };
}

function parseDateField(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    return required ? { error: `${field} is required.` } : { value: null, supplied: false };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { error: `${field} must be a valid date.` };
  return { value: parsed, supplied: true };
}

function validateLineItems(rawItems) {
  if (rawItems === undefined) return { value: [], supplied: false };
  if (!Array.isArray(rawItems) || rawItems.length > 50) return { error: 'items must be an array with at most 50 entries.' };
  const value = [];
  for (let index = 0; index < rawItems.length; index += 1) {
    const item = rawItems[index];
    const label = typeof item?.label === 'string' ? item.label.trim() : '';
    if (!label || label.length > 120) return { error: `items[${index}].label is required and must be 120 characters or fewer.` };
    const amount = parseMoney(item.amount, `items[${index}].amount`, { optional: false });
    if (amount.error) return amount;
    value.push({ ...item, label, amount: amount.value });
  }
  return { value, supplied: true };
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
  const fallbackId = normalizeBillId(bill) || (bill._id ? String(bill._id) : '');
  const normalized = { ...bill };
  if (!normalized.billing_id && fallbackId) normalized.billing_id = fallbackId;
  if (!normalized.bill_id && bill._id) normalized.bill_id = String(bill._id);
  if (!normalized.legacy_billing_id && fallbackId) normalized.legacy_billing_id = fallbackId;
  normalized._id = undefined;
  normalized.statement_version = resolveStatementVersion(normalized.updated_at, normalized.created_at);
  const moveInFinancials = extractMoveInFinancials(normalized);
  const effectiveStatus = getEffectiveBillStatus(normalized);
  if (moveInFinancials) {
    // Mirrors applyMoveInFinancials()/mapRealBill(): remainingBalance is the
    // right headline once paid, except when it computes to 0 (reservation
    // fee alone covered advance rent + deposit) — fall back to the
    // pre-credit total so a genuinely paid bill never shows ₱0.00.
    const headlineAmount = (effectiveStatus === 'paid' && moveInFinancials.remainingBalance === 0)
      ? moveInFinancials.totalDueBeforeMoveIn
      : moveInFinancials.remainingBalance;
    normalized.move_in_financials = moveInFinancials;
    normalized.advance_rent = moveInFinancials.advanceRent;
    normalized.security_deposit = moveInFinancials.securityDeposit;
    normalized.reservation_fee_already_paid = moveInFinancials.reservationFeeAlreadyPaid;
    normalized.total = headlineAmount;
    normalized.amount = headlineAmount;
    normalized.remaining_amount = moveInFinancials.remainingBalance;
  }

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

function sortBillsNewestFirst(bills = []) {
  return [...bills].sort((left, right) => {
    const timeDiff = getBillTimestamp(right) - getBillTimestamp(left);
    if (timeDiff !== 0) return timeDiff;
    return normalizeBillId(right).localeCompare(normalizeBillId(left));
  });
}

function dedupeTenantBills(bills = []) {
  const groupedById = new Map();
  bills.forEach((bill) => {
    const id = normalizeBillId(bill);
    if (!id || !isTenantVisibleBill(bill)) return;
    if (!groupedById.has(id)) groupedById.set(id, []);
    groupedById.get(id).push(bill);
  });

  const selected = [];
  groupedById.forEach((records, billingId) => {
    const canonical = records.filter((record) => record.__source === 'real');
    const legacy = records.filter((record) => record.__source === 'legacy');
    if (canonical.length > 1 || (canonical.length === 0 && legacy.length > 1)) {
      const error = new Error(`Billing source conflict for ${billingId}`);
      error.code = 'BILLING_SOURCE_CONFLICT';
      error.billingId = billingId;
      throw error;
    }

    // `bills` is canonical. A legacy row is only a temporary fallback when
    // no canonical row exists with the same stable ID. Financial fields are
    // never scored, merged, or filled from the other collection.
    selected.push(canonical[0] || legacy[0]);
  });

  return sortBillsNewestFirst(selected).map(({ __source, ...bill }) => bill);
}

function applyBillFilters(bills, { billingId = null, paidOnly = false, unpaidOnly = false, limit = 100 } = {}) {
  const targetId = String(billingId || '').trim().toLowerCase();
  let results = Array.isArray(bills) ? [...bills] : [];

  if (targetId) {
    results = results.filter((bill) => getBillLookupIds(bill)
      .some((id) => id.toLowerCase() === targetId));
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

function normalizeUtilityType(value) {
  return String(value || '').trim().toLowerCase();
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

function isMoveInFinancialBill(bill = {}) {
  const descriptor = [
    bill.billing_type, bill.billingType, bill.type, bill.category,
    bill.description, bill.billing_period,
    ...(Array.isArray(bill.items) ? bill.items.flatMap((item) => [item?.label, item?.description, item?.type]) : []),
  ].filter(Boolean).join(' ').toLowerCase();
  return /\bmove[\s-]?in\b|advance rent|security deposit|deposits? and advances?/.test(descriptor);
}

function applyMoveInFinancials(bill, financials) {
  if (!financials || !isMoveInFinancialBill(bill)) return bill;
  const settled = isPaidBill(bill);
  // remainingBalance (advanceRent + securityDeposit - reservationFee) is the
  // right headline for a settled bill in the normal case — it's exactly what
  // the tenant paid at move-in on top of their earlier reservation fee. It
  // only misleads when the reservation fee alone fully covered advance rent
  // + deposit, making remainingBalance compute to 0: a settled bill would
  // then display "Paid: ₱0.00" even though real money changed hands (via the
  // reservation fee). Only that degenerate case falls back to the full
  // pre-credit total so the tenant isn't shown a bill that looks unpaid.
  const headlineAmount = (settled && financials.remainingBalance === 0)
    ? financials.totalDueBeforeMoveIn
    : financials.remainingBalance;
  return {
    ...bill,
    move_in_financials: financials,
    advance_rent: financials.advanceRent,
    security_deposit: financials.securityDeposit,
    reservation_fee_already_paid: financials.reservationFeeAlreadyPaid,
    amount: headlineAmount,
    total: headlineAmount,
    original_total: financials.totalDueBeforeMoveIn,
    remaining_amount: settled ? 0 : financials.remainingBalance,
  };
}

async function findLatestOwnedReservation(db, ownerFilters) {
  const collection = db.collection('reservations');
  if (!collection || typeof collection.findOne !== 'function') return null;
  return collection.findOne(
    { $or: ownerFilters },
    { sort: { approvedAt: -1, updatedAt: -1, createdAt: -1 } },
  ).catch(() => null);
}

function billingMonthKey(value) {
  if (!value) return '';
  const text = String(value).trim();
  const namedPeriod = /^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}$/i.test(text);
  const parsed = namedPeriod ? new Date(`1 ${text} UTC`) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}`;
}

function billPeriodKey(bill = {}) {
  return billingMonthKey(bill.billing_period)
    || billingMonthKey(bill.billingMonth)
    || billingMonthKey(bill.due_date || bill.dueDate);
}

function resolveCurrentBill(bills = [], asOf = new Date()) {
  const currentKey = billingMonthKey(asOf);
  if (!currentKey) return null;
  const matches = bills.filter((bill) => billPeriodKey(bill) === currentKey);
  if (!matches.length) return null;
  return matches.sort((left, right) => {
    const consolidated = (bill) => String(bill.billing_type || '').toLowerCase() === 'consolidated' ? 1 : 0;
    const typeDifference = consolidated(right) - consolidated(left);
    return typeDifference || getBillPreferenceScore(right) - getBillPreferenceScore(left)
      || getBillFreshnessTimestamp(right) - getBillFreshnessTimestamp(left);
  })[0];
}

function currentBillTiming(bill, asOf = new Date()) {
  const dueDate = bill?.due_date || bill?.dueDate;
  if (!dueDate) return { state: 'unknown', days: 0, label: 'Due date unavailable' };
  const late = calculateLatePenalty(dueDate, asOf);
  if (late.daysAfterDue === 0) {
    const milliseconds = new Date(dueDate).getTime() - new Date(asOf).getTime();
    const days = Math.max(0, Math.ceil(milliseconds / 86400000));
    return { state: days === 0 ? 'due_today' : 'due', days, label: days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}` };
  }
  if (late.daysAfterDue === 1) return { state: 'grace', days: 1, label: 'Grace period ends today' };
  return { state: 'overdue', days: late.penaltyDays, label: `Overdue by ${late.penaltyDays} day${late.penaltyDays === 1 ? '' : 's'}` };
}

const LATEST_BILLING_STATES = Object.freeze({
  CURRENT_BILL: 'CURRENT_BILL',
  NO_CURRENT_BILL: 'NO_CURRENT_BILL',
});

function serializeLatestBillingResponse({
  bill = null,
  serverTime = new Date(),
  previousOutstanding = 0,
  previousBill = null,
} = {}) {
  const timestamp = serverTime instanceof Date ? serverTime : new Date(serverTime);
  if (Number.isNaN(timestamp.getTime())) {
    throw new TypeError('serverTime must be a valid date');
  }

  const previousBalance = Number(previousOutstanding);
  return {
    state: bill ? LATEST_BILLING_STATES.CURRENT_BILL : LATEST_BILLING_STATES.NO_CURRENT_BILL,
    bill: bill || null,
    server_time: timestamp.toISOString(),
    timing: bill ? currentBillTiming(bill, timestamp) : null,
    previous_balance: Number.isFinite(previousBalance)
      ? Math.round(Math.max(0, previousBalance) * 100) / 100
      : 0,
    previous_bill_id: normalizeBillId(previousBill || {}) || null,
  };
}

function pushUniqueFilter(filters, filter) {
  if (!filter || typeof filter !== 'object') return;
  const key = JSON.stringify(filter, (_name, value) => (
    value instanceof ObjectId ? value.toHexString() : value
  ));
  if (filters.some((existing) => JSON.stringify(existing, (_name, value) => (
    value instanceof ObjectId ? value.toHexString() : value
  )) === key)) {
    return;
  }
  filters.push(filter);
}

function buildBillingOwnerFilters(user = {}) {
  const filters = [];
  const userId = typeof user.user_id === 'string' ? user.user_id.trim() : '';
  const mongoId = toObjectIdIfValid(user._id);
  const mongoIdString = mongoId ? mongoId.toHexString() : '';

  if (userId) {
    pushUniqueFilter(filters, { user_id: userId });
    pushUniqueFilter(filters, { tenantUserId: userId });
    pushUniqueFilter(filters, { tenant_user_id: userId });
  }

  if (mongoId) {
    pushUniqueFilter(filters, { userId: mongoId });
    pushUniqueFilter(filters, { tenantId: mongoId });
    pushUniqueFilter(filters, { user_id: mongoId });
  }

  if (mongoIdString) {
    pushUniqueFilter(filters, { userId: mongoIdString });
    pushUniqueFilter(filters, { tenantId: mongoIdString });
    pushUniqueFilter(filters, { user_id: mongoIdString });
  }

  return filters;
}

function buildCanonicalBillLookupFilter(billingId, ownerFilters = []) {
  const id = String(billingId || '').trim();
  if (!id) return null;
  const idFilters = [{ billing_id: id }, { legacyBillingId: id }];
  const objectId = toObjectIdIfValid(id);
  if (objectId) idFilters.unshift({ _id: objectId });
  const filter = { $or: idFilters };
  return ownerFilters.length ? { $and: [filter, { $or: ownerFilters }] } : filter;
}

function humanizeUtilityLabel(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function deriveElectricityBreakdownFromUtilityRecords(records = []) {
  const segments = [];

  records.forEach(({ period, summary }) => {
    if (!period || typeof period !== 'object') return;

    const sourceSegments = Array.isArray(period.segments) && period.segments.length
      ? period.segments
      : [{
          startDate: period.startDate,
          endDate: period.endDate,
          readingFrom: period.startReading,
          readingTo: period.endReading,
          unitsConsumed: period.computedTotalUsage,
          totalCost: period.computedTotalCost,
          activeTenantCount: Array.isArray(period.tenantSummaries) ? period.tenantSummaries.length : null,
          activeTenantIds: Array.isArray(summary?.activeTenantIds) ? summary.activeTenantIds : [],
          sharePerTenantCost: summary?.billAmount,
        }];

    sourceSegments.forEach((segment) => {
      const occupants = Number(segment?.activeTenantCount)
        || (Array.isArray(segment?.activeTenantIds) ? segment.activeTenantIds.length : 0)
        || (Array.isArray(period?.tenantSummaries) ? period.tenantSummaries.length : 0)
        || 1;
      const readingFrom = Number(segment?.readingFrom ?? period?.startReading ?? 0);
      const readingTo = Number(segment?.readingTo ?? period?.endReading ?? 0);
      const consumption = Number(
        segment?.unitsConsumed
          ?? segment?.consumption
          ?? period?.computedTotalUsage
          ?? (readingTo - readingFrom)
      );
      const segmentTotal = Number(segment?.totalCost ?? period?.computedTotalCost ?? 0);
      const fallbackShare = occupants > 0 && Number.isFinite(segmentTotal)
        ? segmentTotal / occupants
        : 0;
      const sharePerTenant = Number(
        segment?.sharePerTenantCost
          ?? segment?.share_per_tenant
          ?? summary?.billAmount
          ?? fallbackShare
      );
      const rate = Number(
        segment?.rate
          ?? period?.ratePerUnit
          ?? ((Number.isFinite(consumption) && consumption > 0 && Number.isFinite(segmentTotal))
            ? segmentTotal / consumption
            : 0)
      );

      segments.push({
        occupants,
        reading_date_from: segment?.startDate || period?.startDate || null,
        reading_date_to: segment?.endDate || period?.endDate || null,
        period_start: segment?.startDate || period?.startDate || null,
        period_end: segment?.endDate || period?.endDate || null,
        reading_from: Number.isFinite(readingFrom) ? readingFrom : 0,
        reading_to: Number.isFinite(readingTo) ? readingTo : 0,
        consumption: Number.isFinite(consumption) ? consumption : 0,
        rate: Number.isFinite(rate) ? rate : 0,
        segment_total: Number.isFinite(segmentTotal) ? segmentTotal : 0,
        share_per_tenant: Number.isFinite(sharePerTenant) ? sharePerTenant : 0,
        active_tenants: Array.isArray(segment?.activeTenantIds) ? segment.activeTenantIds : [],
      });
    });
  });

  return segments.length ? segments : undefined;
}

function deriveWaterBreakdownFromUtilityRecords(records = [], bill = {}) {
  const selected = records[records.length - 1];
  if (!selected?.period) return undefined;

  const { period, summary } = selected;
  const total = Number(
    summary?.billAmount
      ?? bill?.charges?.water
      ?? bill?.water
      ?? period?.computedTotalCost
      ?? 0
  );
  const rate = Number(period?.ratePerUnit ?? 0);
  const consumption = Number(period?.computedTotalUsage ?? 0);
  const sharingPolicy = summary?.allocationRule || summary?.billingBasis
    ? [
        humanizeUtilityLabel(summary?.allocationRule),
        humanizeUtilityLabel(summary?.billingBasis),
      ].filter(Boolean).join(' • ')
    : (Array.isArray(period?.tenantSummaries) && period.tenantSummaries.length > 1
      ? 'Shared among active tenants for the billing period'
      : 'Assigned to this tenant for the billing period');

  return {
    reading_from: Number(period?.startReading ?? 0),
    reading_to: Number(period?.endReading ?? 0),
    consumption: Number.isFinite(consumption) ? consumption : 0,
    rate: Number.isFinite(rate) ? rate : 0,
    total: Number.isFinite(total) ? total : 0,
    sharing_policy: sharingPolicy,
  };
}

async function enrichRealBillsWithUtilityBreakdowns(db, bills = []) {
  if (!Array.isArray(bills) || bills.length === 0) return bills;

  const rawBillIds = bills
    .map((bill) => toObjectIdIfValid(bill?._id))
    .filter(Boolean);

  if (!rawBillIds.length) return bills;

  const utilityPeriods = await db.collection('utilityperiods')
    .find({
      isArchived: { $ne: true },
      'tenantSummaries.billId': { $in: rawBillIds },
    })
    .toArray()
    .catch(() => []);

  if (!utilityPeriods.length) return bills;

  const groupedByBillId = new Map();

  utilityPeriods.forEach((period) => {
    const utilityType = normalizeUtilityType(period?.utilityType);
    if (!['electricity', 'water'].includes(utilityType)) return;

    (Array.isArray(period?.tenantSummaries) ? period.tenantSummaries : []).forEach((summary) => {
      const summaryBillId = String(summary?.billId || '').trim();
      if (!summaryBillId) return;

      const nextGroup = groupedByBillId.get(summaryBillId) || { electricity: [], water: [] };
      nextGroup[utilityType].push({ period, summary });
      groupedByBillId.set(summaryBillId, nextGroup);
    });
  });

  return bills.map((bill) => {
    const billId = String(bill?._id || '').trim();
    const utilityGroup = groupedByBillId.get(billId);
    if (!utilityGroup) return bill;

    const nextBill = { ...bill };

    const existingElectricityBreakdown = Array.isArray(nextBill.electricity_breakdown)
      ? nextBill.electricity_breakdown
      : (Array.isArray(nextBill.electricityBreakdown) ? nextBill.electricityBreakdown : []);
    if (!existingElectricityBreakdown.length) {
      const derivedElectricityBreakdown = deriveElectricityBreakdownFromUtilityRecords(utilityGroup.electricity || []);
      if (Array.isArray(derivedElectricityBreakdown) && derivedElectricityBreakdown.length) {
        nextBill.electricityBreakdown = derivedElectricityBreakdown;
      }
    }

    const existingWaterBreakdown = nextBill.water_breakdown && typeof nextBill.water_breakdown === 'object'
      ? nextBill.water_breakdown
      : (nextBill.waterBreakdown && typeof nextBill.waterBreakdown === 'object' ? nextBill.waterBreakdown : null);
    if (!existingWaterBreakdown) {
      const derivedWaterBreakdown = deriveWaterBreakdownFromUtilityRecords(utilityGroup.water || [], nextBill);
      if (derivedWaterBreakdown) {
        nextBill.waterBreakdown = derivedWaterBreakdown;
      }
    }

    return nextBill;
  });
}

// A monotonically increasing cache-busting token for the statement PDF —
// the client keys its on-disk PDF cache on this (see
// frontend/src/services/documentManager.js's cacheKey param) instead of just
// billing_id, so a regenerated statement (e.g. a utility charge posting
// after the tenant already opened this bill) is never served stale from
// disk. updated_at/updatedAt is bumped on every write to the bill record
// (see updateBilling below), so it's already a correct version signal —
// falls back to the creation timestamp for a bill that was never updated.
function resolveStatementVersion(updatedAt, createdAt) {
  const value = updatedAt || createdAt;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || 'v1') : date.getTime();
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
  // NOTE: billReleaseDate/releaseDate are not written by any current bill-creation
  // path on the `bills` collection — every real bill does carry billingCycleStart
  // (set at creation) and dueDate, so those are the authoritative fallbacks. Without
  // this fallback, resolveUtilityDeadline() always receives null dates and every
  // electricity/water bill permanently displays as "not released" regardless of
  // its actual payment/status.
  const utilityDeadline = resolveUtilityDeadline({
    billingPeriodStart: b.billingPeriodStart ?? b.periodStart ?? b.billingCycleStart,
    billingPeriodEnd: b.billingPeriodEnd ?? b.periodEnd ?? b.billingCycleEnd,
    meterReadingDate: b.meterReadingDate ?? b.readingDate ?? b.utilityReadingDate,
    billReleaseDate: b.billReleaseDate ?? b.releaseDate ?? b.billingCycleStart,
    providerDueDate: b.providerDueDate ?? b.utilityProviderDueDate ?? b.dueDate,
  });

  // Format billing period from billingMonth ISO string → "April 2026"
  const billingPeriod = normalizeBillingPeriod(b.billingMonth ?? b.description, '');

  const mapped = {
    billing_id: b.billing_id || b.legacyBillingId || b._id?.toString(),
    bill_id: b._id?.toString(),
    legacy_billing_id: b.legacyBillingId || b.billing_id || '',
    user_id: userId,
    description: b.description || (billingPeriod ? `${billingPeriod} Billing Statement` : 'Billing Statement'),
    billing_period: billingPeriod,
    billing_type: b.billingType || b.billing_type || 'consolidated',
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
    payment_channel: b.paymentChannel || null,
    payment_date: paymentDate,
    paymongo_reference: b.paymongoReference,
    paymongo_checkout_id: b.paymongoSessionId,
    paymongo_payment_id: b.paymongoPaymentId,
    proof_status: b.paymentProof?.status,
    rejection_reason: b.rejectionReason,
    additional_charges: b.additionalCharges || b.items,
    electricity_breakdown: electricityBreakdown,
    water_breakdown: waterBreakdown,
    utility_deadlines: {
      ...(Number(c.electricity ?? b.electricity ?? 0) > 0 ? { electricity: utilityDeadline } : {}),
      ...(Number(c.water ?? b.water ?? 0) > 0 ? { water: utilityDeadline } : {}),
    },
    created_at: b.createdAt,
    updated_at: b.updatedAt,
    statement_version: resolveStatementVersion(b.updatedAt, b.createdAt),
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
  const moveInFinancials = extractMoveInFinancials(b);
  if (!moveInFinancials) return mapped;
  // Same rule as applyMoveInFinancials(): remainingBalance is the right
  // settled-bill headline except in the degenerate case where the
  // reservation fee alone fully covered advance rent + deposit, making it
  // compute to 0 — fall back to the pre-credit total so a genuinely paid
  // bill never displays as ₱0.00.
  const moveInHeadlineAmount = (isSettled && moveInFinancials.remainingBalance === 0)
    ? moveInFinancials.totalDueBeforeMoveIn
    : moveInFinancials.remainingBalance;
  return {
    ...mapped,
    move_in_financials: moveInFinancials,
    advance_rent: moveInFinancials.advanceRent,
    security_deposit: moveInFinancials.securityDeposit,
    reservation_fee_already_paid: moveInFinancials.reservationFeeAlreadyPaid,
    amount: moveInHeadlineAmount,
    total: moveInHeadlineAmount,
    original_total: moveInFinancials.totalDueBeforeMoveIn,
    remaining_amount: isSettled ? 0 : moveInFinancials.remainingBalance,
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

// Fetch bills during the migration window. Canonical `bills` rows win only
// on an exact stable-ID match; legacy rows remain visible only when no exact
// canonical counterpart exists. No financial fields are merged or scored.
async function fetchUserBills(db, user, {
  billingId = null,
  paidOnly = false,
  unpaidOnly = false,
  limit = 100,
} = {}) {
  const userId = user.user_id;
  const ownerFilters = buildBillingOwnerFilters(user);

  if (!ownerFilters.length) {
    return [];
  }

  const [legacyBills, rawRealBills, reservation] = await Promise.all([
    db.collection('billing')
      .find({ $or: ownerFilters })
      .toArray()
      .then((docs) => docs.map((bill) => ({ ...normalizeLegacyBill(bill), __source: 'legacy' }))),
    db.collection('bills')
      .find({ $or: ownerFilters })
      .toArray(),
    findLatestOwnedReservation(db, ownerFilters),
  ]);

  const enrichedRealBills = await enrichRealBillsWithUtilityBreakdowns(db, rawRealBills);
  const realBills = enrichedRealBills.map((bill) => ({ ...mapRealBill(bill, userId), __source: 'real' }));

  const reservationFinancials = reservation ? extractMoveInFinancials(reservation) : null;
  const visibleBills = dedupeTenantBills([...legacyBills, ...realBills])
    .map((bill) => applyMoveInFinancials(bill, reservationFinancials));
  return applyBillFilters(visibleBills, { billingId, paidOnly, unpaidOnly, limit });
}

// Get the most recent bill for the user (by due date, fallback to created_at)
async function getLatestBilling(req, res) {
  try {
    const db = getDb();
    const serverTime = new Date();
    const bills = await fetchUserBills(db, req.user);
    const bill = resolveCurrentBill(bills, serverTime);
    const previousBills = bills.filter((entry) => entry !== bill && billPeriodKey(entry) < billingMonthKey(serverTime));
    const previousOutstanding = previousBills
      .filter(isPayableBill)
      .reduce((sum, entry) => sum + Math.max(0, getComparableBillAmount(entry)), 0);
    res.json(serializeLatestBillingResponse({
      bill,
      serverTime,
      previousOutstanding,
      previousBill: previousBills.find(isPayableBill) || null,
    }));
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

async function submitPaymentProof(req, res) {
  try {
    const billingId = String(req.params.billingId || '').trim();
    const proof = req.body?.proof || {};
    const storagePath = String(proof.storagePath || '').trim();
    const downloadUrl = String(proof.downloadUrl || '').trim();
    const mimeType = String(proof.mimeType || '').toLowerCase();
    const size = Number(proof.size || 0);
    const tenantPrefix = `payment-proofs/${req.user.user_id}/`;
    if (!billingId) return res.status(400).json({ detail: 'A valid bill is required.' });
    if (!storagePath.startsWith(tenantPrefix)
      || !/^https:\/\/firebasestorage(?:\.googleapis\.com|\.app)\//i.test(downloadUrl)
      || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mimeType)
      || !Number.isFinite(size) || size <= 0 || size > 5 * 1024 * 1024) {
      return res.status(400).json({ detail: 'Payment proof is invalid.' });
    }
    const db = getDb();
    const ownedBill = (await fetchUserBills(db, req.user, { billingId, limit: 1 }))[0];
    if (!ownedBill) return res.status(404).json({ detail: BILL_UNAVAILABLE_MESSAGE });
    if (isPaidBill(ownedBill)) return res.status(409).json({ detail: 'This bill is already paid.' });
    if (normalizeBillStatus(ownedBill.status) === 'pending_verification') {
      return res.status(409).json({ detail: 'A payment proof is already under review.' });
    }
    const submittedProof = {
      downloadUrl, storagePath, mimeType, size,
      originalName: String(proof.originalName || 'Payment proof').slice(0, 120),
      submittedAt: new Date(),
      status: 'under_review',
    };
    const legacyResult = await db.collection('billing').updateOne(
      { billing_id: billingId, $or: buildBillingOwnerFilters(req.user) },
      { $set: { proof: submittedProof, status: 'pending_verification', updated_at: new Date() }, $unset: { rejection_reason: '' } },
    );
    if (!legacyResult.matchedCount) {
      const canonicalFilter = buildCanonicalBillLookupFilter(billingId, buildBillingOwnerFilters(req.user));
      const result = canonicalFilter ? await db.collection('bills').updateOne(
        canonicalFilter,
        { $set: { paymentProof: submittedProof, status: 'pending_verification', updatedAt: new Date() }, $unset: { rejectionReason: '' } },
      ) : { matchedCount: 0 };
      if (!result.matchedCount) return res.status(404).json({ detail: BILL_UNAVAILABLE_MESSAGE });
    }
    return res.status(201).json({ status: 'pending_verification', proof_status: 'under_review' });
  } catch (error) {
    console.error('Submit payment proof error:', error);
    return res.status(500).json({ detail: 'Unable to submit payment proof.' });
  }
}

// Create billing (supports both simple and consolidated/itemized bills)
async function createBilling(req, res) {
  try {
    const {
      tenant_id, description, billing_type, due_date,
      billing_period, release_date,
      rent, electricity, water, penalties,
      items,                    // [{label, amount, type}]
      electricity_breakdown,    // [{period_start, period_end, reading_from, reading_to, consumption, rate, segment_total, active_tenants, share_per_tenant}]
      water_breakdown,          // {reading_from, reading_to, consumption, rate, total, sharing_policy}
    } = req.body;

    const targetTenantId = String(tenant_id || '').trim();
    if (!targetTenantId) return res.status(400).json({ detail: 'tenant_id is required.' });

    const db = getDb();
    const tenantObjectId = ObjectId.isValid(targetTenantId) ? new ObjectId(targetTenantId) : null;
    const tenant = await db.collection('users').findOne({
      $and: [
        { $or: [{ user_id: targetTenantId }, ...(tenantObjectId ? [{ _id: tenantObjectId }] : [])] },
        { role: { $in: ['tenant', 'resident'] } },
      ],
    });
    if (!tenant) return res.status(400).json({ detail: 'A valid tenant_id is required.' });

    const parsedMoney = {};
    for (const [field, raw] of Object.entries({ rent, electricity, water, penalties })) {
      const parsed = parseMoney(raw, field);
      if (parsed.error) return res.status(400).json({ detail: parsed.error, errors: { [field]: parsed.error } });
      parsedMoney[field] = parsed.value;
    }
    const parsedItems = validateLineItems(items);
    if (parsedItems.error) return res.status(400).json({ detail: parsedItems.error, errors: { items: parsedItems.error } });
    const dueDate = parseDateField(due_date, 'due_date', { required: true });
    const releaseDate = parseDateField(release_date, 'release_date');
    if (dueDate.error || releaseDate.error) return res.status(400).json({ detail: dueDate.error || releaseDate.error });

    const total = Object.values(parsedMoney).reduce((sum, value) => sum + value, 0)
      + parsedItems.value.reduce((sum, item) => sum + item.amount, 0);

    if (total <= 0) {
      return res.status(400).json({ detail: 'Bill total must be greater than zero.' });
    }
    if (total > MAX_BILL_AMOUNT) {
      return res.status(400).json({ detail: 'Bill total exceeds the maximum allowed amount (₱500,000).' });
    }
    const normalizedType = String(billing_type || (parsedMoney.rent ? 'consolidated' : 'rent')).trim().toLowerCase();
    const normalizedPeriod = String(billing_period || '').trim();
    if (normalizedPeriod) {
      const ownerFilters = buildBillingOwnerFilters({ user_id: tenant.user_id, _id: tenant._id });
      const [canonicalDuplicate, legacyDuplicate] = await Promise.all([
        db.collection('bills').findOne({
          $and: [
            { $or: ownerFilters },
            { billingMonth: normalizedPeriod },
            { billingType: normalizedType },
            { status: { $nin: ['cancelled', 'canceled', 'deleted', 'void', 'voided'] } },
          ],
        }),
        db.collection('billing').findOne({
          user_id: tenant.user_id,
          billing_period: normalizedPeriod,
          billing_type: normalizedType,
          status: { $nin: ['cancelled', 'canceled', 'deleted', 'void', 'voided'] },
        }),
      ]);
      if (canonicalDuplicate || legacyDuplicate) {
        return res.status(409).json({ detail: 'A bill already exists for this tenant, billing period, and bill type.' });
      }
    }

    const now = new Date();
    const newCanonicalBill = {
      billing_id: `bill_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
      userId: tenant._id,
      tenantUserId: tenant.user_id,
      createdBy: req.user.user_id,
      schemaVersion: 1,
      description: description || (normalizedPeriod ? `${normalizedPeriod} Billing Statement` : 'Billing Statement'),
      billingMonth: normalizedPeriod || null,
      billingType: normalizedType,
      billingCycleStart: releaseDate.supplied ? releaseDate.value : null,
      dueDate: dueDate.value,
      status: 'unpaid',
      charges: {
        rent: parsedMoney.rent,
        electricity: parsedMoney.electricity,
        water: parsedMoney.water,
        penalty: parsedMoney.penalties,
        applianceFees: 0,
        corkageFees: 0,
      },
      additionalCharges: parsedItems.value,
      items: parsedItems.value,
      totalAmount: total,
      grossAmount: total,
      remainingAmount: total,
      paymentMethod: null,
      paymentDate: null,
      paymentProof: null,
      electricity_breakdown: Array.isArray(electricity_breakdown) ? electricity_breakdown : [],
      water_breakdown: water_breakdown && typeof water_breakdown === 'object' ? water_breakdown : null,
      createdAt: now,
      updatedAt: now,
    };

    const inserted = await db.collection('bills').insertOne(newCanonicalBill);
    if (inserted?.insertedId) newCanonicalBill._id = inserted.insertedId;
    const mobileBill = mapRealBill(newCanonicalBill, tenant.user_id);

    // Push notification (non-blocking)
    const billOwnerUserId = String(tenant.user_id || '').trim();
    if (billOwnerUserId) {
      notifyBillCreated(billOwnerUserId, mobileBill).catch((pushError) => {
        console.warn('[Billing] Bill-created push failed:', pushError?.message || pushError);
      });
    } else {
      console.warn('[Billing] Skipped bill-created push because bill owner user_id was not resolved');
    }

    res.status(201).json(mobileBill);
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
      amount, total, paid_amount, remaining_amount,
    } = req.body || {};

    const isAdmin = ['admin', 'superadmin'].includes(req.user?.role);
    const db = getDb();

    const updates = {};
    if (status !== undefined) {
      const normalizedStatus = normalizeBillStatus(status);
      if (!ALLOWED_BILL_STATUSES.has(normalizedStatus)) {
        return res.status(400).json({ detail: `status must be one of: ${Array.from(ALLOWED_BILL_STATUSES).join(', ')}` });
      }
      updates.status = normalizedStatus;
    }
    if (payment_method) updates.payment_method = payment_method;
    if (payment_date !== undefined) {
      const parsed = parseDateField(payment_date, 'payment_date');
      if (parsed.error) return res.status(400).json({ detail: parsed.error });
      updates.payment_date = parsed.value;
    }
    if (notes) updates.notes = notes;
    if (description) updates.description = description;
    if (billing_period) updates.billing_period = billing_period;
    if (release_date !== undefined) {
      const parsed = parseDateField(release_date, 'release_date');
      if (parsed.error) return res.status(400).json({ detail: parsed.error });
      updates.release_date = parsed.value;
    }

    // Itemized charges
    for (const [field, raw] of Object.entries({ rent, electricity, water, penalties })) {
      if (raw === undefined) continue;
      const parsed = parseMoney(raw, field, { optional: false });
      if (parsed.error) return res.status(400).json({ detail: parsed.error, errors: { [field]: parsed.error } });
      updates[field] = parsed.value;
    }
    if (items !== undefined) {
      const parsedItems = validateLineItems(items);
      if (parsedItems.error) return res.status(400).json({ detail: parsedItems.error, errors: { items: parsedItems.error } });
      updates.items = parsedItems.value;
    }
    if (Array.isArray(electricity_breakdown)) updates.electricity_breakdown = electricity_breakdown;
    if (water_breakdown && typeof water_breakdown === 'object') updates.water_breakdown = water_breakdown;

    // Recompute total if itemized fields were updated. Bills live in either
    // the legacy `billing` collection or the real `bills` collection (see
    // fetchUserBills/mapRealBill) — this used to look up `existing` only in
    // `billing`, so a charge edit on a bill that lives exclusively in
    // `bills` 404'd immediately here, before ever reaching the `bills`
    // fallback further down. Look up whichever collection actually has it.
    let existingForRecompute = null;
    if (rent !== undefined || electricity !== undefined || water !== undefined || penalties !== undefined || items !== undefined) {
      const legacyFilter = isAdmin
        ? { billing_id: billingId }
        : { billing_id: billingId, user_id: req.user.user_id };
      existingForRecompute = await db.collection('billing').findOne(legacyFilter);
      if (!existingForRecompute) {
        const realFilter = buildCanonicalBillLookupFilter(
          billingId,
          isAdmin ? [] : buildBillingOwnerFilters(req.user),
        );
        if (realFilter) {
          const realDoc = await db.collection('bills').findOne(realFilter);
          if (realDoc) {
            const charges = realDoc.charges || {};
            existingForRecompute = {
              rent: charges.rent ?? realDoc.rent,
              electricity: charges.electricity ?? realDoc.electricity,
              water: charges.water ?? realDoc.water,
              penalties: charges.penalty ?? realDoc.penalties,
              items: realDoc.items,
            };
          }
        }
      }
      if (!existingForRecompute) return res.status(404).json({ detail: 'Bill not found' });
      const r = updates.rent ?? existingForRecompute.rent ?? 0;
      const e = updates.electricity ?? existingForRecompute.electricity ?? 0;
      const w = updates.water ?? existingForRecompute.water ?? 0;
      const p = updates.penalties ?? existingForRecompute.penalties ?? 0;
      const extraItems = updates.items ?? existingForRecompute.items ?? [];
      const itemsTotal = Array.isArray(extraItems) ? extraItems.reduce((s, i) => s + (Number(i.amount) || 0), 0) : 0;
      const computed = Number(r) + Number(e) + Number(w) + Number(p) + itemsTotal;
      updates.total = computed;
      updates.amount = computed;
      if (!Number.isFinite(computed) || computed <= 0 || computed > MAX_BILL_AMOUNT) {
        return res.status(400).json({ detail: `Computed total must be between 0.01 and ${MAX_BILL_AMOUNT}.` });
      }
    } else if (amount !== undefined || total !== undefined) {
      return res.status(400).json({ detail: 'total and amount are calculated by the server and cannot be set directly.' });
    }

    if (paid_amount !== undefined || remaining_amount !== undefined) {
      const paid = parseMoney(paid_amount ?? 0, 'paid_amount', { optional: false });
      const remaining = parseMoney(remaining_amount ?? 0, 'remaining_amount', { optional: false });
      if (paid.error || remaining.error) return res.status(400).json({ detail: paid.error || remaining.error });
      const expectedTotal = updates.total;
      if (expectedTotal !== undefined && Math.abs((paid.value + remaining.value) - expectedTotal) > 0.01) {
        return res.status(400).json({ detail: 'paid_amount plus remaining_amount must equal the total.' });
      }
      updates.paid_amount = paid.value;
      updates.remaining_amount = remaining.value;
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
      if (requestedStatus !== 'paid' && isPaidBill(existingLegacyBill)) {
        return res.status(409).json({ detail: 'A paid bill cannot be changed without an authorized reversal workflow.' });
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

    const canonicalFilter = buildCanonicalBillLookupFilter(billingId);
    const existingReal = canonicalFilter
      ? await db.collection('bills').findOne(canonicalFilter)
      : null;
    if (!existingReal) {
      return res.status(404).json({ detail: 'Bill not found' });
    }

    const existingRealBill = mapRealBill(existingReal, existingReal.userId?.toString() || '');
    if (updates.status) {
      const requestedStatus = normalizeBillStatus(updates.status);
      if (requestedStatus !== 'paid' && isPaidBill(existingRealBill)) {
        return res.status(409).json({ detail: 'A paid bill cannot be changed without an authorized reversal workflow.' });
      }
    }

    // Map snake_case fields to the camelCase schema used by the 'bills' collection.
    // Must mirror every PDF-visible field `updates` can carry — a field
    // written here only for `billing` (legacy) but silently dropped for
    // `bills` (real) means a real bill's admin edit both fails to change
    // what the tenant sees AND, moot as it is once actually blocked, would
    // never have bumped updatedAt for cache-invalidation purposes either.
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
    if (updates.description) billsUpdates.description = updates.description;
    if (updates.billing_period) billsUpdates.billingMonth = updates.billing_period;
    if (updates.release_date) billsUpdates.billingCycleStart = updates.release_date;
    for (const field of ['rent', 'electricity', 'water', 'penalties']) {
      if (updates[field] === undefined) continue;
      billsUpdates[`charges.${field === 'penalties' ? 'penalty' : field}`] = updates[field];
    }
    if (updates.items !== undefined) {
      billsUpdates.items = updates.items;
      billsUpdates.additionalCharges = updates.items;
    }
    if (updates.electricity_breakdown !== undefined) billsUpdates.electricity_breakdown = updates.electricity_breakdown;
    if (updates.water_breakdown !== undefined) billsUpdates.water_breakdown = updates.water_breakdown;
    if (updates.total !== undefined) {
      billsUpdates.totalAmount = updates.total;
      billsUpdates.grossAmount = updates.total;
      billsUpdates.remainingAmount = updates.status === 'paid' ? 0 : updates.total;
    }
    if (updates.paid_amount !== undefined) billsUpdates.paidAmount = updates.paid_amount;
    if (updates.remaining_amount !== undefined) billsUpdates.remainingAmount = updates.remaining_amount;

    const billsResult = await db.collection('bills').findOneAndUpdate(
      { _id: existingReal._id },
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
      { label: 'Status', value: billStatusLabel(bill.status) },
    ];
    if (bill.billing_period) {
      infoRows.push({ label: 'Billing Period', value: normalizeLine(bill.billing_period) });
    }
    if (bill.release_date) {
      infoRows.push({ label: 'Release Date', value: formatDate(bill.release_date) });
    }
    infoRows.push({ label: 'Due Date', value: formatDate(bill.due_date) });

    // Payment info (only for paid bills)
    if (isPaidBill(bill)) {
      if (bill.payment_method) {
        infoRows.push({ label: 'Payment Method', value: normalizeLine(billPaymentMethodLabel(bill.payment_method, bill.payment_channel)) });
      }
      if (bill.payment_date) {
        infoRows.push({ label: 'Payment Date', value: formatDate(bill.payment_date) });
      }
      if (bill.paymongo_reference) {
        infoRows.push({ label: 'Reference No.', value: normalizeLine(bill.paymongo_reference) });
      }
      infoRows.push({ label: 'Remaining Balance', value: formatMoney(bill.remaining_amount || 0) });
    }

    // Charge breakdown table
    const tableRows = [];
    const moveInFinancials = bill.move_in_financials || null;
    if (moveInFinancials) {
      tableRows.push(
        { label: 'One Month Advance Rent', value: formatMoney(moveInFinancials.advanceRent) },
        { label: 'Security Deposit', value: formatMoney(moveInFinancials.securityDeposit) },
        { label: 'Reservation Fee Already Paid', value: `- ${formatMoney(moveInFinancials.reservationFeeAlreadyPaid)}` },
      );
    } else {
      if (bill.rent) tableRows.push({ label: 'Monthly Rent', value: formatMoney(bill.rent) });
      if (bill.electricity) tableRows.push({ label: 'Electricity', value: formatMoney(bill.electricity) });
      if (bill.water) tableRows.push({ label: 'Water', value: formatMoney(bill.water) });
      if (bill.penalties) tableRows.push({ label: 'Penalties / Late Fees', value: formatMoney(bill.penalties) });
    }
    if (!moveInFinancials && bill.items?.length) {
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

    const billIsPaid = isPaidBill(bill);
    const pdfBuffer = buildBrandedPdf({
      title: normalizeLine(bill.description || 'Billing Statement'),
      subtitle: billingPeriod,
      docType: billIsPaid ? 'BILLING STATEMENT - PAID' : 'BILLING STATEMENT',
      refNumber: refId,
      date: `Released: ${formatDate(bill.release_date || bill.created_at)}`,
      infoRows,
      tableRows,
      totalRow: {
        label: moveInFinancials
          ? 'REMAINING MOVE-IN BALANCE'
          : (billIsPaid ? 'TOTAL PAID' : 'TOTAL AMOUNT DUE'),
        value: formatMoney(bill.total || bill.amount || 0),
      },
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

// Payment receipt PDF — a distinct document from the billing statement.
// Only ever returned for a bill with authoritative confirmed-payment
// evidence (see isPaidBill/getEffectiveBillStatus); an unpaid bill gets a
// 404, never a fabricated receipt. Content is deliberately narrower than
// the statement: payment evidence only (date/method/reference/amount),
// no charge table, no utility breakdown, no "TOTAL DUE"/payment
// instructions — see downloadBillPdf for the statement.
async function downloadBillReceiptPdf(req, res) {
  try {
    const { billingId } = req.params;
    const db = getDb();
    const bill = (await fetchUserBills(db, req.user, { billingId, limit: 1 }))[0];

    if (!bill) {
      return res.status(404).json({ detail: BILL_UNAVAILABLE_MESSAGE });
    }

    if (!isPaidBill(bill)) {
      return res.status(404).json({ detail: 'No payment receipt is available for this bill yet.' });
    }

    const formatMoney = (value) => `PHP ${(Number(value || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const formatDate = (value) => {
      if (!value) return '---';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '---';
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const amountPaid = bill.total || bill.amount || 0;
    const refId = normalizeLine(bill.reference_no || bill.reference || bill.paymongo_reference || bill.txn_id || bill.transaction_id || billingId);
    const billingPeriod = bill.billing_period ? `Billing Period: ${bill.billing_period}` : '';

    const infoRows = [
      { label: 'Receipt No.', value: normalizeLine(`RCPT-${bill.billing_id || billingId}`) },
      { label: 'Bill ID', value: normalizeLine(bill.billing_id || billingId) },
      { label: 'Tenant', value: normalizeLine(req.user?.name || 'Tenant') },
      { label: 'Billing Period', value: normalizeLine(bill.billing_period || '---') },
      { label: 'Payment Date', value: formatDate(bill.payment_date) },
    ];
    if (bill.payment_method) {
      infoRows.push({ label: 'Payment Method', value: normalizeLine(billPaymentMethodLabel(bill.payment_method, bill.payment_channel)) });
    }
    if (bill.paymongo_reference) {
      infoRows.push({ label: 'Reference No.', value: normalizeLine(bill.paymongo_reference) });
    }
    infoRows.push(
      { label: 'Amount Paid', value: formatMoney(amountPaid) },
      { label: 'Applied to Bill', value: formatMoney(amountPaid) },
      { label: 'Remaining Balance', value: formatMoney(bill.remaining_amount || 0) },
      { label: 'Status', value: 'PAID' },
    );

    const pdfBuffer = buildBrandedPdf({
      title: normalizeLine(bill.billing_period ? `${bill.billing_period} Payment Receipt` : 'Payment Receipt'),
      subtitle: billingPeriod,
      docType: 'PAYMENT RECEIPT',
      refNumber: refId,
      date: `Paid: ${formatDate(bill.payment_date)}`,
      infoRows,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${billingId}-receipt.pdf"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.end(pdfBuffer);
  } catch (error) {
    console.error('Download bill receipt PDF error:', error);
    res.status(500).json({ detail: 'Failed to generate payment receipt' });
  }
}

module.exports = {
  fetchUserBills,
  getLatestBilling,
  getMyBilling,
  getBillingHistory,
  getBillingById,
  submitPaymentProof,
  getPaymentHistory,
  createBilling,
  updateBilling,
  downloadBillPdf,
  downloadBillReceiptPdf,
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
  buildBillingOwnerFilters,
  buildCanonicalBillLookupFilter,
  dedupeTenantBills,
  DEMO_BILLS,
  mapRealBill,
  normalizeLegacyBill,
  applyMoveInFinancials,
  isMoveInFinancialBill,
  resolveCurrentBill,
  currentBillTiming,
  LATEST_BILLING_STATES,
  serializeLatestBillingResponse,
  billPeriodKey,
  billStatusLabel,
  billPaymentMethodLabel,
};
