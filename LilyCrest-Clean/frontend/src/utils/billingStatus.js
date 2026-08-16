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
  if (candidates.length) return { ...candidates[0], unreleasedUtility: false };
  if (hasUtilityCharge) return { releaseDate: null, dueDate: null, unreleasedUtility: true };
  return { releaseDate: getBillReleaseDate(bill), dueDate: bill?.due_date || bill?.dueDate || null, unreleasedUtility: false };
}

export {
  NON_PAYABLE_STATUSES,
  PAID_STATUSES,
  getBillStatus,
  isBillOutstanding,
  isPaidBillStatus,
  getBillOwedAmount,
  getBillPaymentDate,
  getBillReleaseDate,
  getUtilityReleaseSchedule,
};
