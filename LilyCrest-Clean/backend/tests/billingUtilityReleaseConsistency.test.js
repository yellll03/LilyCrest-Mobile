'use strict';

// Regression coverage for the "Paid" + "Your utility bill has not been
// released yet." contradiction reported against a real production bill
// (canonical `bills` collection _id 6a805ef1cb5e42a251502972, October 2026
// billing period, status "paid", electricity 9088).
//
// Original root cause: mapRealBill() fed resolveUtilityDeadline() with
// b.billReleaseDate / b.releaseDate only, fields no bill-creation code path
// on the `bills` collection ever writes, so resolveUtilityDeadline() always
// received null inputs and utility_deadlines was permanently empty for
// every bill with an electricity/water charge — independent of paid status.
//
// UPDATE (release-date semantics correction): the first fix used
// billingCycleStart as a billReleaseDate fallback, which stopped the card
// from being empty but was itself semantically wrong — billingCycleStart
// names a *billing period* boundary, not a release/publish/send event, and
// reusing it as both meanings is exactly the "one generic date reused
// everywhere" anti-pattern this file now guards against. billReleaseDate
// must come from a genuine release-marker field (see
// resolveAuthoritativeReleaseDate() in billing.controller.js) or be null —
// while billingPeriodStart/End may still legitimately use billingCycleStart,
// since that is a period boundary. A null billReleaseDate must NOT re-empty
// the schedule card: it stays visible via whichever other fields are real.

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

test('a paid bill with an electricity charge reports a resolved utility schedule, not an empty one, even with no genuine release timestamp', () => {
  const mapped = mapRealBill(baseRealBill(), 'user123');

  assert.equal(mapped.status, 'paid');
  assert.ok(mapped.utility_deadlines.electricity, 'expected an electricity deadline entry');
  // billingCycleStart is a period boundary, not a release event, so it must
  // NOT populate billReleaseDate — the fixture has no genuine release field.
  assert.equal(mapped.utility_deadlines.electricity.billReleaseDate, null, 'billReleaseDate must not be fabricated from billingCycleStart');
  assert.ok(mapped.utility_deadlines.electricity.billingPeriodStart, 'billingPeriodStart may still use billingCycleStart — it is a period boundary');
  assert.ok(mapped.utility_deadlines.electricity.finalDueDate, 'finalDueDate must not be null for a bill with a real dueDate');
});

test('a genuine release-marker field (releasedAt) populates billReleaseDate, distinct from billingPeriodStart/meterReadingDate', () => {
  const mapped = mapRealBill(baseRealBill({
    releasedAt: '2026-10-18T00:00:00.000Z',
  }), 'user123');

  const deadline = mapped.utility_deadlines.electricity;
  assert.equal(new Date(deadline.billReleaseDate).toISOString(), new Date('2026-10-18T00:00:00.000Z').toISOString());
  // Must remain independent of the period/reading dates derived from billingCycleStart.
  assert.notEqual(
    new Date(deadline.billReleaseDate).toISOString(),
    new Date(deadline.billingPeriodStart).toISOString(),
  );
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
