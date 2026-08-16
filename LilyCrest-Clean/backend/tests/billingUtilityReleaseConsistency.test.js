'use strict';

// Regression coverage for the "Paid" + "Your utility bill has not been
// released yet." contradiction reported against a real production bill
// (canonical `bills` collection _id 6a805ef1cb5e42a251502972, October 2026
// billing period, status "paid", electricity 9088).
//
// Root cause: mapRealBill() fed resolveUtilityDeadline() with
// b.billReleaseDate / b.releaseDate, fields no bill-creation code path on
// the `bills` collection ever writes. billingCycleStart (always set at
// creation) and dueDate (always set) are the fields that actually carry
// this information, so resolveUtilityDeadline() always received null
// inputs and utility_deadlines was permanently empty for every bill with
// an electricity/water charge — independent of paid status.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapRealBill } = require('../controllers/billing.controller');

function baseRealBill(overrides = {}) {
  return {
    _id: { toString: () => 'bill123' },
    billingMonth: '2026-10-12T16:00:00.000Z',
    billingCycleStart: '2026-10-12T16:00:00.000Z',
    billingCycleEnd: '2026-11-12T16:00:00.000Z',
    dueDate: '2026-11-08T16:00:00.000Z',
    status: 'paid',
    charges: { rent: 0, electricity: 9088, water: 0 },
    totalAmount: 9088,
    remainingAmount: 0,
    paymentDate: '2026-08-15T13:03:36.257Z',
    paymentMethod: 'gcash',
    paymongoReference: 'pay_kEaaRGzY88fJpkCDq5N3H29D',
    createdAt: '2026-08-15T12:43:29.913Z',
    updatedAt: '2026-08-15T13:10:23.217Z',
    ...overrides,
  };
}

test('a paid bill with an electricity charge reports a resolved utility release schedule, not an empty one', () => {
  const mapped = mapRealBill(baseRealBill(), 'user123');

  assert.equal(mapped.status, 'paid');
  assert.ok(mapped.utility_deadlines.electricity, 'expected an electricity deadline entry');
  assert.ok(mapped.utility_deadlines.electricity.billReleaseDate, 'billReleaseDate must not be null for a bill with a real billingCycleStart');
  assert.ok(mapped.utility_deadlines.electricity.finalDueDate, 'finalDueDate must not be null for a bill with a real dueDate');
});

test('the resolved utility due date matches the bill\'s own dueDate field (single source of truth, no fabrication)', () => {
  const mapped = mapRealBill(baseRealBill(), 'user123');
  assert.equal(
    new Date(mapped.utility_deadlines.electricity.finalDueDate).toISOString(),
    new Date('2026-11-08T16:00:00.000Z').toISOString(),
  );
});

test('a bill with genuinely no billingCycleStart/dueDate still reports as unreleased (no fabricated dates)', () => {
  const mapped = mapRealBill(baseRealBill({ billingCycleStart: undefined, dueDate: undefined, status: 'unpaid' }), 'user123');
  assert.equal(mapped.utility_deadlines.electricity.billReleaseDate, null);
  assert.equal(mapped.utility_deadlines.electricity.finalDueDate, null);
});

test('a bill with no electricity/water charge carries no utility_deadlines entries', () => {
  const mapped = mapRealBill(baseRealBill({ charges: { rent: 5000, electricity: 0, water: 0 } }), 'user123');
  assert.deepEqual(mapped.utility_deadlines, {});
});
