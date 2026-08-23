'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LATEST_BILLING_STATES,
  serializeLatestBillingResponse,
} = require('../controllers/billing.controller');

const SERVER_TIME = new Date('2026-08-22T00:00:00.000Z');

test('latest billing serializer emits the explicit current-bill API contract', () => {
  const bill = {
    billing_id: 'rent-2026-08',
    billing_period: 'August 2026',
    rent: 5000,
    total: 5000,
    status: 'unpaid',
    due_date: '2026-08-28T00:00:00.000Z',
  };

  assert.deepEqual(serializeLatestBillingResponse({
    bill,
    serverTime: SERVER_TIME,
    previousOutstanding: 125.456,
    previousBill: { billing_id: 'rent-2026-07' },
  }), {
    state: LATEST_BILLING_STATES.CURRENT_BILL,
    bill,
    server_time: '2026-08-22T00:00:00.000Z',
    timing: { state: 'due', days: 6, label: 'Due in 6 days' },
    previous_balance: 125.46,
    previous_bill_id: 'rent-2026-07',
  });
});

test('latest billing serializer preserves utility and paid bills as current bills', () => {
  const utilityBill = {
    billing_id: 'utility-2026-08',
    billing_period: 'August 2026',
    electricity: 9088,
    status: 'unpaid',
    due_date: '2026-08-28T00:00:00.000Z',
  };
  const paidBill = {
    billing_id: 'paid-2026-08',
    billing_period: 'August 2026',
    total: 5000,
    remaining_amount: 0,
    status: 'paid',
    due_date: '2026-08-15T00:00:00.000Z',
  };

  assert.equal(serializeLatestBillingResponse({ bill: utilityBill, serverTime: SERVER_TIME }).state, 'CURRENT_BILL');
  assert.equal(serializeLatestBillingResponse({ bill: paidBill, serverTime: SERVER_TIME }).state, 'CURRENT_BILL');
});

test('latest billing serializer emits an intentional 200 empty contract with null identifiers', () => {
  assert.deepEqual(serializeLatestBillingResponse({ serverTime: SERVER_TIME }), {
    state: LATEST_BILLING_STATES.NO_CURRENT_BILL,
    bill: null,
    server_time: '2026-08-22T00:00:00.000Z',
    timing: null,
    previous_balance: 0,
    previous_bill_id: null,
  });
});
