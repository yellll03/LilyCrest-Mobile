/* global __dirname, test */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  BILLING_SCREEN_STATES,
  normalizeLatestBillingResponse,
  resolveBillingScreenState,
} from '../utils/billingScreenState';

const SERVER_TIME = new Date('2026-08-22T00:00:00.000Z');
const backendRoot = path.resolve(__dirname, '../../../backend');
const billingControllerPath = path.join(backendRoot, 'controllers/billing.controller.js');

function controllerOutput(input) {
  const script = `
    const { serializeLatestBillingResponse } = require(${JSON.stringify(billingControllerPath)});
    const input = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(serializeLatestBillingResponse(input)));
  `;
  return JSON.parse(execFileSync(
    process.execPath,
    ['-e', script, JSON.stringify({ serverTime: SERVER_TIME.toISOString(), ...input })],
    { cwd: backendRoot, encoding: 'utf8' },
  ));
}

const normalizeControllerOutput = (input) => normalizeLatestBillingResponse({ data: controllerOutput(input) });

describe('backend latest-billing serializer -> mobile normalizer integration', () => {
  test.each([
    ['current rent bill', {
      billing_id: 'rent-2026-08', billing_period: 'August 2026', rent: 5000, total: 5000, status: 'unpaid', due_date: '2026-08-28',
    }],
    ['current utility bill', {
      billing_id: 'utility-2026-08', billing_period: 'August 2026', electricity: 9088, total: 9088, status: 'unpaid', due_date: '2026-08-28',
    }],
    ['paid current-period bill', {
      billing_id: 'paid-2026-08', billing_period: 'August 2026', total: 5000, remaining_amount: 0, status: 'paid', due_date: '2026-08-15',
    }],
  ])('actual controller DTO keeps %s visible', (_label, bill) => {
    const normalized = normalizeControllerOutput({ bill });
    expect(normalized).toMatchObject({ outcome: 'current', bill });
    expect(resolveBillingScreenState({ latest: normalized.outcome, historyAvailable: true, historyCount: 1 }))
      .toBe(BILLING_SCREEN_STATES.CURRENT_BILL);
  });

  test('actual controller DTO retains previous-balance metadata', () => {
    const bill = { billing_id: 'rent-2026-08', total: 5000, due_date: '2026-08-28' };
    const normalized = normalizeControllerOutput({
      bill,
      previousOutstanding: 321.45,
      previousBill: { billing_id: 'rent-2026-07' },
    });
    expect(normalized.payload).toMatchObject({
      previous_balance: 321.45,
      previous_bill_id: 'rent-2026-07',
    });
  });

  test('actual controller no-bill DTO becomes the successful no-current state', () => {
    const normalized = normalizeControllerOutput({ bill: null });
    expect(normalized).toMatchObject({ outcome: 'no_current', bill: null });
    expect(resolveBillingScreenState({ latest: normalized.outcome, historyAvailable: true, historyCount: 0 }))
      .toBe(BILLING_SCREEN_STATES.NO_CURRENT_BILL);
  });

  test('server failure remains distinct from both current and empty states', () => {
    expect(resolveBillingScreenState({ latest: 'failed', historyAvailable: false }))
      .toBe(BILLING_SCREEN_STATES.TOTAL_FAILURE);
    expect(resolveBillingScreenState({ latest: 'failed', historyAvailable: true, historyCount: 2 }))
      .toBe(BILLING_SCREEN_STATES.PARTIAL_FAILURE);
  });

  test('deployed wrapper and raw legacy bill remain visible during rolling deployment', () => {
    const bill = { billing_id: 'legacy-1', total: 1000 };
    expect(normalizeLatestBillingResponse({ data: { bill } })).toMatchObject({ outcome: 'current', bill });
    expect(normalizeLatestBillingResponse({ data: bill })).toMatchObject({ outcome: 'current', bill });
  });

  test('malformed transitional response is a contract failure, never a false empty account', () => {
    expect(normalizeLatestBillingResponse({ data: { bill: {} } }))
      .toMatchObject({ outcome: 'invalid', bill: null });
  });
});
