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
  if (latest === 'failed' && !historyAvailable) return BILLING_SCREEN_STATES.TOTAL_FAILURE;
  if (latest === 'failed') return BILLING_SCREEN_STATES.PARTIAL_FAILURE;
  if (!historyAvailable) return BILLING_SCREEN_STATES.PARTIAL_FAILURE;
  if (latest === 'utility_pending') return BILLING_SCREEN_STATES.UTILITY_PENDING;
  if (latest === 'current') return BILLING_SCREEN_STATES.CURRENT_BILL;
  if (latest === 'no_current' && historyAvailable && historyCount > 0) return BILLING_SCREEN_STATES.HISTORY_ONLY;
  if (latest === 'no_current') return BILLING_SCREEN_STATES.NO_CURRENT_BILL;
  return historyAvailable ? BILLING_SCREEN_STATES.PARTIAL_FAILURE : BILLING_SCREEN_STATES.TOTAL_FAILURE;
}

export function normalizeLatestBillingResponse(response) {
  const payload = response?.data || {};
  if (payload?.state === 'NO_CURRENT_BILL') return { outcome: 'no_current', bill: null, payload };
  if (payload?.state === 'UTILITY_PENDING') return { outcome: 'utility_pending', bill: payload.bill || null, payload };
  if (payload?.state === 'CURRENT_BILL') return { outcome: 'current', bill: payload.bill || null, payload };
  // Backward compatibility during rolling deployment: the former endpoint
  // returned the raw bill object, never a wrapper.
  if (payload?.billing_id || payload?._id) return { outcome: 'current', bill: payload, payload: { bill: payload } };
  return { outcome: 'no_current', bill: null, payload };
}
