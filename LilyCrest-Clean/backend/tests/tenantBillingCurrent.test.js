'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCurrentBill, currentBillTiming, billPeriodKey } = require('../controllers/billing.controller');

test('current bill resolves by billing period instead of newest or unpaid order', () => {
  const bills = [
    { billing_id: 'future', billing_period: 'August 2026', status: 'unpaid', total: 5000 },
    { billing_id: 'current', billing_period: 'July 2026', status: 'paid', total: 5400, payment_date: '2026-07-10' },
    { billing_id: 'old', billing_period: 'June 2026', status: 'overdue', total: 2000 },
  ];
  assert.equal(resolveCurrentBill(bills, '2026-07-24').billing_id, 'current');
});

test('no current-period bill resolves to the safe empty state', () => {
  assert.equal(resolveCurrentBill([{ billing_id: 'old', billing_period: 'June 2026' }], '2026-07-24'), null);
});

test('due timing uses one grace day and becomes overdue on day two', () => {
  const bill = { due_date: '2026-07-10T00:00:00.000Z' };
  assert.equal(currentBillTiming(bill, '2026-07-11T00:00:00.000Z').state, 'grace');
  assert.deepEqual(currentBillTiming(bill, '2026-07-12T00:00:00.000Z'), {
    state: 'overdue', days: 1, label: 'Overdue by 1 day',
  });
});

test('billing period parser accepts named periods and due-date fallback', () => {
  assert.equal(billPeriodKey({ billing_period: 'July 2026' }), '2026-07');
  assert.equal(billPeriodKey({ due_date: '2026-07-10T00:00:00.000Z' }), '2026-07');
});
