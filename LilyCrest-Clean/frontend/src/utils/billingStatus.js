// Single source of truth for bill lifecycle derivation across Home, Billing
// History, and Bill Details — these screens previously kept separate copies
// of this logic that had drifted (e.g. 'verification' was only excluded on
// Home; Bill Details' own release-schedule check didn't match Billing
// History's), so the same bill could show contradictory status/release
// wording depending on which screen rendered it.
const NON_PAYABLE_STATUSES = new Set([
  'paid', 'settled', 'cancelled', 'rejected', 'void',
  'refunded', 'duplicate', 'archived', 'verification',
]);

const PAID_STATUSES = new Set(['paid', 'settled']);

function getBillStatus(bill) {
  return String(bill?.status || '').toLowerCase();
}

function isBillOutstanding(bill) {
  return !NON_PAYABLE_STATUSES.has(getBillStatus(bill));
}

function isPaidBillStatus(bill) {
  return PAID_STATUSES.has(getBillStatus(bill));
}

function getBillOwedAmount(bill) {
  const candidates = [bill?.remaining_amount, bill?.total, bill?.amount];
  for (const value of candidates) {
    const amount = Number(value);
    if (Number.isFinite(amount)) return amount;
  }
  return 0;
}

function getBillPaymentDate(bill) {
  return bill?.payment_date || bill?.paymentDate || bill?.paidAt || bill?.paid_at || null;
}

const PAYMENT_CHANNEL_LABELS = Object.freeze({
  gcash: 'GCash',
  card: 'Card',
  grab_pay: 'GrabPay',
  paymaya: 'Maya',
  billease: 'BillEase',
  dob: 'Online Banking',
  dob_ubp: 'Online Banking',
});

function getBillPaymentMethodLabel(bill) {
  const serialized = String(bill?.payment_method_label || bill?.paymentMethodLabel || '').trim();
  if (serialized) return serialized;
  const channel = String(bill?.payment_channel || bill?.paymentChannel || '').trim().toLowerCase();
  if (PAYMENT_CHANNEL_LABELS[channel]) return PAYMENT_CHANNEL_LABELS[channel];
  const method = String(bill?.payment_method || bill?.paymentMethod || '').trim();
  if (!method) return '';
  return method.toLowerCase() === 'paymongo' ? 'Online Payment' : method;
}

function getBillPaymentReference(bill) {
  return bill?.payment_reference
    || bill?.paymongo_reference
    || bill?.paymongoReference
    || bill?.reference_no
    || bill?.reference
    || bill?.transaction_id
    || bill?.transactionId
    || bill?.txn_id
    || null;
}

function getBillRemainingAmount(bill) {
  if (isPaidBillStatus(bill)) return 0;
  const value = Number(bill?.remaining_amount ?? bill?.remainingAmount);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

// bill.created_at/createdAt is when the database record was written, not
// when the bill was released/sent to the tenant (see canonical
// mobileBillingBridge.js toMobileBill(): release_date is the immutable
// Bill.releasedAt lifecycle timestamp). Falling back to created_at would
// show a release date that was never actually recorded — if the bill
// carries no real release timestamp, the honest answer is null.
function getBillReleaseDate(bill) {
  return bill?.release_date || bill?.releaseDate || null;
}

// Resolves a single "release/due" schedule for a bill from its authoritative
// bill.utility_deadlines (populated server-side from the bill's own
// billingCycleStart/dueDate — see backend mapRealBill()) with a rent-only
// fallback. This is the one place that decides whether a bill's utility
// charge should be presented as released or not — do not reimplement this
// check separately in a screen.
function getUtilityReleaseSchedule(bill) {
  const explicitSchedules = Object.values(bill?.utility_schedules || {});
  if (explicitSchedules.length > 0) {
    const applicable = explicitSchedules.filter((schedule) => schedule?.state !== 'not_applicable');
    const available = applicable
      .filter((schedule) => schedule?.state === 'available')
      .sort((left, right) => new Date(left.due_date) - new Date(right.due_date));
    if (available.length > 0) {
      return {
        state: 'available',
        releaseDate: available[0].release_date,
        dueDate: available[0].due_date,
        unreleasedUtility: false,
      };
    }
    if (applicable.some((schedule) => schedule?.state === 'unavailable')) {
      return { state: 'unavailable', releaseDate: null, dueDate: null, unreleasedUtility: false };
    }
    if (applicable.some((schedule) => schedule?.state === 'pending')) {
      return { state: 'pending', releaseDate: null, dueDate: null, unreleasedUtility: true };
    }
  }
  const utilitySchedules = Object.values(bill?.utility_deadlines || {});
  const hasUtilityCharge = Number(bill?.electricity || 0) > 0 || Number(bill?.water || 0) > 0 || utilitySchedules.length > 0;
  const releasedUtilities = utilitySchedules
    .filter((schedule) => schedule?.billReleaseDate && schedule?.finalDueDate)
    .sort((left, right) => new Date(left.finalDueDate) - new Date(right.finalDueDate));
  const hasRent = Number(bill?.rent || 0) > 0;
  const candidates = [
    ...releasedUtilities.map((schedule) => ({ releaseDate: schedule.billReleaseDate, dueDate: schedule.finalDueDate })),
    ...(hasRent && (bill?.due_date || bill?.dueDate) ? [{ releaseDate: getBillReleaseDate(bill), dueDate: bill.due_date || bill.dueDate }] : []),
  ].sort((left, right) => new Date(left.dueDate) - new Date(right.dueDate));
  if (candidates.length) return { state: 'available', ...candidates[0], unreleasedUtility: false };
  if (hasUtilityCharge) return { state: 'pending', releaseDate: null, dueDate: null, unreleasedUtility: true };
  return { state: 'not_applicable', releaseDate: getBillReleaseDate(bill), dueDate: bill?.due_date || bill?.dueDate || null, unreleasedUtility: false };
}

export {
  NON_PAYABLE_STATUSES,
  PAID_STATUSES,
  getBillStatus,
  isBillOutstanding,
  isPaidBillStatus,
  getBillOwedAmount,
  getBillPaymentDate,
  getBillPaymentMethodLabel,
  getBillPaymentReference,
  getBillRemainingAmount,
  getBillReleaseDate,
  getUtilityReleaseSchedule,
};
