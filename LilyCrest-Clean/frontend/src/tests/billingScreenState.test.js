/* global test */
import {
  BILLING_SCREEN_STATES,
  normalizeLatestBillingResponse,
  resolveBillingScreenState,
} from '../utils/billingScreenState';

describe('canonical billing screen states', () => {
  test('no current bill is a successful empty state, not a transport failure', () => {
    const normalized = normalizeLatestBillingResponse({ data: { state: 'NO_CURRENT_BILL', bill: null } });
    expect(normalized.outcome).toBe('no_current');
    expect(resolveBillingScreenState({ latest: normalized.outcome, historyAvailable: true, historyCount: 0 }))
      .toBe(BILLING_SCREEN_STATES.NO_CURRENT_BILL);
  });

  test('latest failure preserves successful history without claiming a zero balance', () => {
    expect(resolveBillingScreenState({ latest: 'failed', historyAvailable: true, historyCount: 3 }))
      .toBe(BILLING_SCREEN_STATES.PARTIAL_FAILURE);
  });

  test('historical bills remain visible when there is no current bill', () => {
    expect(resolveBillingScreenState({ latest: 'no_current', historyAvailable: true, historyCount: 2 }))
      .toBe(BILLING_SCREEN_STATES.HISTORY_ONLY);
  });

  test('raw legacy latest response is normalized during rolling deployment', () => {
    const bill = { billing_id: 'bill-1', total: 1000 };
    expect(normalizeLatestBillingResponse({ data: bill })).toMatchObject({ outcome: 'current', bill });
  });
});
