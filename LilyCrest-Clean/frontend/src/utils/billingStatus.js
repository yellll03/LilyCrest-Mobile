// Single source of truth for "is this bill still owed" across Home and
// Billing History — these two screens previously kept separate copies of
// this status set that had drifted ('verification' was only excluded on
// Home), so a bill under verification could show as outstanding on one
// screen and cleared on the other.
const NON_PAYABLE_STATUSES = new Set([
  'paid', 'settled', 'cancelled', 'rejected', 'void',
  'refunded', 'duplicate', 'archived', 'verification',
]);

function getBillStatus(bill) {
  return String(bill?.status || '').toLowerCase();
}

function isBillOutstanding(bill) {
  return !NON_PAYABLE_STATUSES.has(getBillStatus(bill));
}

function getBillOwedAmount(bill) {
  const candidates = [bill?.remaining_amount, bill?.total, bill?.amount];
  for (const value of candidates) {
    const amount = Number(value);
    if (Number.isFinite(amount)) return amount;
  }
  return 0;
}

export {
  NON_PAYABLE_STATUSES,
  getBillStatus,
  isBillOutstanding,
  getBillOwedAmount,
};
