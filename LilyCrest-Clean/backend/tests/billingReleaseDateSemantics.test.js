'use strict';

// Regression coverage for Release Date semantics on the Electricity Billing
// Schedule (and the shared top-level release_date field the Bill Details
// header card and PDF statement also read).
//
// Business rule: Release Date means the actual date a bill was officially
// released/published/sent to the tenant — a bill LIFECYCLE event. It must
// never be inferred from utility-period boundaries, meter-reading dates, or
// bill/record creation time (createdAt), since those are different events
// that happen to often be close together but are not the same thing.
//
// Trace (Task 1): this backend has no dedicated release/publish workflow
// for the `bills` collection — no draft->released status value, no
// releasedAt/publishedAt/sentAt writer anywhere in this repo, and
// notifyBillCreated() (services/pushService.js) fires at bill *creation*
// only, for the legacy 'billing' collection path — nothing in this repo
// ever creates real 'bills' collection documents at all (they come from an
// external system), so creation-time and release-time are NOT proven to be
// the same event for real bills. billingCycleStart was previously used as
// a release-date fallback purely because it reliably existed, even though
// its name says "billing cycle" (a period concept), not "released". That
// conflation is what this file guards against — see
// resolveAuthoritativeReleaseDate() in billing.controller.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapRealBill } = require('../controllers/billing.controller');

function baseRealBill(overrides = {}) {
  return {
    _id: { toString: () => 'bill-release-123' },
    billingMonth: '2026-06-01T00:00:00.000Z',
    billingCycleStart: '2026-05-26T00:00:00.000Z',
    billingCycleEnd: '2026-06-15T00:00:00.000Z',
    dueDate: '2026-06-23T00:00:00.000Z',
    status: 'unpaid',
    charges: { rent: 0, electricity: 1760, water: 0 },
    totalAmount: 1760,
    remainingAmount: 1760,
    createdAt: '2026-06-16T09:00:00.000Z', // "bill generated internally"
    ...overrides,
  };
}

function electricitySegment(overrides = {}) {
  return {
    occupants: 1,
    reading_date_from: '2026-05-26T00:00:00.000Z',
    reading_date_to: '2026-06-15T00:00:00.000Z',
    reading_from: 1340,
    reading_to: 1450,
    consumption: 110,
    rate: 16,
    share_per_tenant: 1760,
    ...overrides,
  };
}

// 1. Utility period exists + real Release Date exists.
test('utility period + genuine release field: period dates come from utilityperiods, release date comes from the release field', () => {
  const mapped = mapRealBill(baseRealBill({
    electricity_breakdown: [electricitySegment()],
    releasedAt: '2026-06-17T10:00:00.000Z', // "bill officially released/sent"
  }), 'user1');

  const deadline = mapped.utility_deadlines.electricity;
  assert.equal(new Date(deadline.billingPeriodStart).toISOString(), new Date('2026-05-26T00:00:00.000Z').toISOString());
  assert.equal(new Date(deadline.billingPeriodEnd).toISOString(), new Date('2026-06-15T00:00:00.000Z').toISOString());
  assert.equal(new Date(deadline.billReleaseDate).toISOString(), new Date('2026-06-17T10:00:00.000Z').toISOString());
  assert.equal(new Date(deadline.finalDueDate).toISOString(), new Date('2026-06-23T00:00:00.000Z').toISOString());
  // Matches the worked example in the spec: period end (Jun 15) must not equal release date (Jun 17).
  assert.notEqual(
    new Date(deadline.billingPeriodEnd).toISOString(),
    new Date(deadline.billReleaseDate).toISOString(),
  );
});

// 2. Utility period exists + Release Date missing.
test('utility period exists but no release field: schedule stays visible with period/due data, release date is honestly null', () => {
  const mapped = mapRealBill(baseRealBill({
    electricity_breakdown: [electricitySegment()],
    billingCycleStart: undefined,
    billingCycleEnd: undefined,
  }), 'user1');

  const deadline = mapped.utility_deadlines.electricity;
  assert.equal(deadline.billReleaseDate, null, 'must render as "—", never fabricated');
  assert.ok(deadline.billingPeriodStart, 'period start must still be available from the breakdown');
  assert.ok(deadline.billingPeriodEnd, 'period end must still be available from the breakdown');
  assert.ok(deadline.finalDueDate, 'due date must still be available');
  // The entry itself must exist (schedule card renders), not be entirely absent.
  assert.ok(mapped.utility_deadlines.electricity);
});

// 3. Meter reading end date differs from Release Date — both preserved independently.
test('meter reading end date and release date are preserved independently, never collapsed into one value', () => {
  const mapped = mapRealBill(baseRealBill({
    electricity_breakdown: [electricitySegment({
      reading_date_from: '2026-05-26T00:00:00.000Z',
      reading_date_to: '2026-06-15T00:00:00.000Z',
    })],
    releasedAt: '2026-06-17T00:00:00.000Z',
  }), 'user1');

  const deadline = mapped.utility_deadlines.electricity;
  assert.equal(new Date(deadline.meterReadingDate).toISOString(), new Date('2026-06-15T00:00:00.000Z').toISOString());
  assert.equal(new Date(deadline.billReleaseDate).toISOString(), new Date('2026-06-17T00:00:00.000Z').toISOString());
  assert.notEqual(deadline.meterReadingDate, deadline.billReleaseDate);
});

// 4. Bill createdAt differs from Release Date — release date must use the authoritative release event, not createdAt.
test('createdAt is never used as the release date, even when a genuine release field is absent and createdAt is present', () => {
  const mapped = mapRealBill(baseRealBill({
    createdAt: '2026-06-16T09:00:00.000Z',
    // No releasedAt/releaseDate/billReleaseDate/publishedAt/sentAt/issuedAt.
  }), 'user1');

  assert.equal(mapped.utility_deadlines.electricity.billReleaseDate, null);
  assert.equal(mapped.release_date, null, 'the shared top-level release_date field must also not fall back to createdAt');
});

test('createdAt does not leak into release date even when a genuine release field IS present and they differ', () => {
  const mapped = mapRealBill(baseRealBill({
    createdAt: '2026-06-16T09:00:00.000Z', // generated internally
    releasedAt: '2026-06-17T10:00:00.000Z', // actually sent to tenant
  }), 'user1');

  const deadline = mapped.utility_deadlines.electricity;
  assert.equal(new Date(deadline.billReleaseDate).toISOString(), new Date('2026-06-17T10:00:00.000Z').toISOString());
  assert.notEqual(
    new Date(deadline.billReleaseDate).toISOString(),
    new Date(mapped.created_at).toISOString(),
  );
});

// 5. Paid bill — original Release Date remains available.
test('a paid bill retains its original release date, unaffected by settlement', () => {
  const mapped = mapRealBill(baseRealBill({
    status: 'paid',
    remainingAmount: 0,
    paymentDate: '2026-06-20T00:00:00.000Z',
    paymentMethod: 'gcash',
    releasedAt: '2026-06-17T10:00:00.000Z',
  }), 'user1');

  assert.equal(mapped.status, 'paid');
  assert.equal(
    new Date(mapped.utility_deadlines.electricity.billReleaseDate).toISOString(),
    new Date('2026-06-17T10:00:00.000Z').toISOString(),
  );
});

// 6. Resent bill — original Release Date is not overwritten.
// This backend has no resend/reissue endpoint or field for the `bills`
// collection (traced in Task 1 — no send/notify-tenant/resend action exists
// beyond notifyBillCreated() firing once at legacy-bill creation). This
// proves the *derivation* is resend-safe by construction: resolveAuthoritativeReleaseDate()
// never reads any resend/notification-adjacent field, so attaching one to a
// bill document cannot change the resolved release date.
test('adding resend/notification metadata alongside an existing release date does not change the resolved release date', () => {
  const original = mapRealBill(baseRealBill({ releasedAt: '2026-06-17T10:00:00.000Z' }), 'user1');

  const afterResend = mapRealBill(baseRealBill({
    releasedAt: '2026-06-17T10:00:00.000Z', // unchanged original release event
    lastSentAt: '2026-06-20T08:00:00.000Z', // hypothetical resend metadata
    resentAt: '2026-06-20T08:00:00.000Z',
    notificationSentAt: '2026-06-20T08:00:00.000Z',
  }), 'user1');

  assert.equal(
    original.utility_deadlines.electricity.billReleaseDate,
    afterResend.utility_deadlines.electricity.billReleaseDate,
    'resend-adjacent fields must never overwrite the original release date',
  );
});

// 7. Electricity and water schedules remain independent for release date resolution too.
test('electricity and water both resolve release date from the same bill-level lifecycle event (a bill is released once, not per utility), while period/reading dates stay independent', () => {
  const mapped = mapRealBill(baseRealBill({
    charges: { rent: 0, electricity: 1760, water: 450 },
    electricity_breakdown: [electricitySegment()],
    releasedAt: '2026-06-17T10:00:00.000Z',
  }), 'user1');

  // Release is correctly shared (one bill, one release event) — this is NOT
  // the "shared object" bug from the prior fix, which was about period and
  // meter-reading dates being wrongly shared across utilities.
  assert.equal(mapped.utility_deadlines.electricity.billReleaseDate, mapped.utility_deadlines.water.billReleaseDate);
  assert.notStrictEqual(mapped.utility_deadlines.electricity, mapped.utility_deadlines.water);
  // Electricity's period must still come from its own breakdown, not water's (absent) breakdown.
  assert.ok(mapped.utility_deadlines.electricity.billingPeriodStart);
  assert.equal(mapped.utility_deadlines.water.meterReadingDate, null);
});

// 8. Existing ObjectId/string compatibility remains intact — the release-date
// change touches only which field feeds billReleaseDate, not the ID-matching
// path already covered by electricityBillingScheduleRegression.test.js
// (tests 8 & 9). Spot-check here that mapRealBill itself is unaffected by
// how `_id` is shaped.
test('release date resolution is unaffected by _id shape (ObjectId-like vs plain string)', () => {
  const { ObjectId } = require('mongodb');
  const withObjectId = mapRealBill(baseRealBill({ _id: new ObjectId(), releasedAt: '2026-06-17T10:00:00.000Z' }), 'user1');
  const withPlainId = mapRealBill(baseRealBill({ _id: { toString: () => 'plain-id' }, releasedAt: '2026-06-17T10:00:00.000Z' }), 'user1');

  assert.equal(
    new Date(withObjectId.utility_deadlines.electricity.billReleaseDate).toISOString(),
    new Date(withPlainId.utility_deadlines.electricity.billReleaseDate).toISOString(),
  );
});

// Header-card / PDF consistency: the shared top-level release_date field
// (read by bill-details.jsx's header card and the PDF statement) must agree
// with the schedule card rather than presenting a second, conflicting value.
test('the shared top-level release_date matches the electricity schedule release date and never falls back to createdAt', () => {
  const mapped = mapRealBill(baseRealBill({
    createdAt: '2026-06-16T09:00:00.000Z',
    releasedAt: '2026-06-17T10:00:00.000Z',
  }), 'user1');

  assert.equal(
    new Date(mapped.release_date).toISOString(),
    new Date(mapped.utility_deadlines.electricity.billReleaseDate).toISOString(),
  );
  assert.notEqual(new Date(mapped.release_date).toISOString(), new Date(mapped.created_at).toISOString());
});

test('the shared top-level release_date is null (not createdAt) when no genuine release field exists', () => {
  const mapped = mapRealBill(baseRealBill(), 'user1');
  assert.equal(mapped.release_date, null);
});
