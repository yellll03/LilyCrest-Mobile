'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dedupeTenantBills } = require('../controllers/billing.controller');

function bill(overrides = {}) {
  return {
    billing_id: 'bill-august',
    billing_period: 'August 2026',
    billing_type: 'consolidated',
    status: 'unpaid',
    total: 6000,
    remaining_amount: 6000,
    due_date: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

test('an exact-ID canonical bill wins intact without merging legacy financial fields', () => {
  const result = dedupeTenantBills([
    bill({ __source: 'legacy', total: 9000, remaining_amount: 9000, paymongo_reference: 'legacy-only' }),
    bill({ __source: 'real', total: 6000, remaining_amount: 6000 }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].total, 6000);
  assert.equal(result[0].remaining_amount, 6000);
  assert.equal(result[0].paymongo_reference, undefined, 'legacy fields must not leak into the canonical record');
  assert.equal(result[0].__source, undefined);
});

test('similar-looking bills with different IDs are never collapsed by a heuristic signature', () => {
  const result = dedupeTenantBills([
    bill({ billing_id: 'legacy-august', __source: 'legacy' }),
    bill({ billing_id: 'canonical-august', __source: 'real' }),
  ]);
  assert.deepEqual(result.map((entry) => entry.billing_id).sort(), ['canonical-august', 'legacy-august']);
});

test('multiple canonical records with one stable ID fail closed instead of choosing by freshness or payment state', () => {
  assert.throws(() => dedupeTenantBills([
    bill({ __source: 'real', status: 'paid', remaining_amount: 0 }),
    bill({ __source: 'real', status: 'unpaid', updated_at: '2026-08-22T00:00:00Z' }),
  ]), (error) => error.code === 'BILLING_SOURCE_CONFLICT' && error.billingId === 'bill-august');
});
