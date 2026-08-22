export const BILLING_SCREEN_STATES = Object.freeze({
  LOADING: 'LOADING',
  CURRENT_BILL: 'CURRENT_BILL',
  NO_CURRENT_BILL: 'NO_CURRENT_BILL',
  HISTORY_ONLY: 'HISTORY_ONLY',
  UTILITY_PENDING: 'UTILITY_PENDING',
  PARTIAL_FAILURE: 'PARTIAL_FAILURE',
  TOTAL_FAILURE: 'TOTAL_FAILURE',
  UNAUTHORIZED: 'UNAUTHORIZED',
});

export function resolveBillingScreenState({ loading, latest, historyAvailable, historyCount = 0 }) {
  if (loading) return BILLING_SCREEN_STATES.LOADING;
  if (latest === 'unauthorized') return BILLING_SCREEN_STATES.UNAUTHORIZED;
  const latestFailed = latest === 'failed' || latest === 'invalid';
  if (latestFailed && !historyAvailable) return BILLING_SCREEN_STATES.TOTAL_FAILURE;
  if (latestFailed) return BILLING_SCREEN_STATES.PARTIAL_FAILURE;
  if (!historyAvailable) return BILLING_SCREEN_STATES.PARTIAL_FAILURE;
  if (latest === 'utility_pending') return BILLING_SCREEN_STATES.UTILITY_PENDING;
  if (latest === 'current') return BILLING_SCREEN_STATES.CURRENT_BILL;
  if (latest === 'no_current' && historyAvailable && historyCount > 0) return BILLING_SCREEN_STATES.HISTORY_ONLY;
  if (latest === 'no_current') return BILLING_SCREEN_STATES.NO_CURRENT_BILL;
  return historyAvailable ? BILLING_SCREEN_STATES.PARTIAL_FAILURE : BILLING_SCREEN_STATES.TOTAL_FAILURE;
}

export function normalizeLatestBillingResponse(response) {
  const payload = response?.data;
  const isObject = payload && typeof payload === 'object' && !Array.isArray(payload);
  if (!isObject) return { outcome: 'invalid', bill: null, payload: {} };

  const billId = (bill) => bill?.billing_id || bill?.bill_id || bill?.id
    || bill?.billingId || bill?.billId || bill?._id;
  const isBill = (bill) => Boolean(bill && typeof bill === 'object' && !Array.isArray(bill) && billId(bill));
  const state = String(payload.state || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
  const wrappedBill = payload.bill;

  // Canonical and transitional wrappers are checked for a real bill before
  // empty-state handling. This is the production mismatch that previously
  // turned `{ bill: {...} }` into `no_current`.
  if (isBill(wrappedBill)) {
    return {
      outcome: state === 'UTILITY_PENDING' ? 'utility_pending' : 'current',
      bill: wrappedBill,
      payload,
    };
  }

  if (isBill(payload)) {
    return { outcome: 'current', bill: payload, payload: { bill: payload } };
  }

  if (state === 'NO_CURRENT_BILL' && (wrappedBill === null || wrappedBill === undefined)) {
    return { outcome: 'no_current', bill: null, payload };
  }

  // Compatibility with the deployed wrapper before `state` was added. A
  // deliberate `bill: null` is a successful empty response; an absent or
  // malformed bill is a contract failure, never evidence of an empty account.
  if (!state && Object.prototype.hasOwnProperty.call(payload, 'bill') && wrappedBill === null) {
    return { outcome: 'no_current', bill: null, payload };
  }

  return { outcome: 'invalid', bill: null, payload };
}
