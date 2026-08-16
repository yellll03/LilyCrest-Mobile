'use strict';

// Regression coverage for the empty "Electricity Billing Schedule" card on
// the mobile Bill Details screen.
//
// Root cause (two independent bugs, both in the real 'bills' collection
// path — legacy/seeded bills that carry electricity_breakdown/schedule
// fields directly were never affected):
//
// 1. mapRealBill() built ONE shared `utilityDeadline` object for both
//    electricity and water, and fed resolveUtilityDeadline() only from
//    bill-level fields (billingCycleStart, dueDate, etc.) — never from the
//    already-fetched, authoritative `utilityperiods` data that
//    enrichRealBillsWithUtilityBreakdowns() uses to build the Electricity
//    Breakdown table. When a real bill genuinely lacked those bill-level
//    fields (a very plausible gap, since nothing in this backend ever
//    writes them — see billingUtilityReleaseConsistency.test.js), the
//    schedule stayed null even though the exact same request already had
//    real reading dates sitting in bill.electricity_breakdown.
//
// 2. bill-details.jsx (and the equivalent gate in billing.controller.js)
//    only showed a utility's schedule card when BOTH billReleaseDate AND
//    finalDueDate were present. One legitimately missing field (e.g. no
//    tracked release date) hid the entire card instead of rendering the
//    fields that were available with a "—" fallback for the rest.
//
// Fix: mapRealBill() now derives electricity's schedule fallback from the
// same electricity_breakdown segments already computed for the breakdown
// table (min reading_date_from / max reading_date_to), and the "show this
// card" gate now only requires ANY one schedule field to be present.

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');
const { mapRealBill, fetchUserBills } = require('../controllers/billing.controller');

function baseRealBill(overrides = {}) {
  return {
    _id: { toString: () => 'bill123' },
    billingMonth: '2026-10-12T16:00:00.000Z',
    dueDate: '2026-11-08T16:00:00.000Z',
    status: 'unpaid',
    charges: { rent: 0, electricity: 9088, water: 0 },
    totalAmount: 9088,
    remainingAmount: 9088,
    createdAt: '2026-08-15T12:43:29.913Z',
    ...overrides,
  };
}

function electricitySegment(overrides = {}) {
  return {
    occupants: 2,
    reading_date_from: '2026-10-12T00:00:00.000Z',
    reading_date_to: '2026-11-11T00:00:00.000Z',
    reading_from: 1091.91,
    reading_to: 1127.69,
    consumption: 35.78,
    rate: 12,
    share_per_tenant: 214.68,
    ...overrides,
  };
}

test('a real bill with no bill-level schedule fields still gets a schedule from its electricity_breakdown reading dates', () => {
  const mapped = mapRealBill(baseRealBill({
    // No billingCycleStart, billReleaseDate, meterReadingDate anywhere on
    // the bill document itself — only the breakdown carries dates, exactly
    // as an externally-managed `utilityperiods` record would supply it.
    electricity_breakdown: [electricitySegment()],
  }), 'user123');

  assert.ok(mapped.utility_deadlines.electricity, 'expected an electricity schedule entry');
  assert.equal(
    new Date(mapped.utility_deadlines.electricity.billingPeriodStart).toISOString(),
    new Date('2026-10-12T00:00:00.000Z').toISOString(),
  );
  assert.equal(
    new Date(mapped.utility_deadlines.electricity.billingPeriodEnd).toISOString(),
    new Date('2026-11-11T00:00:00.000Z').toISOString(),
  );
  assert.equal(
    new Date(mapped.utility_deadlines.electricity.meterReadingDate).toISOString(),
    new Date('2026-11-11T00:00:00.000Z').toISOString(),
    'meter reading date should be the latest segment end (the actual reading date)',
  );
});

test('a PAID real bill retains its electricity schedule (payment status never clears schedule data)', () => {
  const mapped = mapRealBill(baseRealBill({
    status: 'paid',
    remainingAmount: 0,
    paymentDate: '2026-11-05T00:00:00.000Z',
    paymentMethod: 'gcash',
    electricity_breakdown: [electricitySegment()],
  }), 'user123');

  assert.equal(mapped.status, 'paid');
  assert.ok(mapped.utility_deadlines.electricity, 'a paid bill must still carry its schedule');
  assert.ok(mapped.utility_deadlines.electricity.billingPeriodStart);
  assert.ok(mapped.utility_deadlines.electricity.billingPeriodEnd);
});

test('an unpaid/current bill with only a due date and no release date still exposes the due date (no all-or-nothing collapse)', () => {
  const mapped = mapRealBill(baseRealBill({
    status: 'unpaid',
    dueDate: '2026-11-08T16:00:00.000Z',
    // No billingCycleStart, no billReleaseDate, and no breakdown at all —
    // the schedule for a bill this incomplete legitimately has nothing to
    // show for release/reading, but the due date IS known and authoritative
    // (it comes straight off the bill) and must not be discarded because
    // its sibling fields are missing.
  }), 'user123');

  const deadline = mapped.utility_deadlines.electricity;
  assert.ok(deadline, 'expected an electricity schedule entry to exist even with sparse data');
  assert.equal(deadline.billReleaseDate, null, 'must not fabricate a release date that was never recorded');
  assert.ok(deadline.finalDueDate, 'the one real, known field (due date) must still be exposed');
});

test('electricity and water schedules are derived independently and do not share the same object/dates', () => {
  const mapped = mapRealBill(baseRealBill({
    charges: { rent: 0, electricity: 9088, water: 450 },
    electricity_breakdown: [electricitySegment({
      reading_date_from: '2026-10-12T00:00:00.000Z',
      reading_date_to: '2026-11-11T00:00:00.000Z',
    })],
    // Water has its own, different bill-level release date.
    billReleaseDate: '2026-10-20T00:00:00.000Z',
  }), 'user123');

  assert.notStrictEqual(
    mapped.utility_deadlines.electricity,
    mapped.utility_deadlines.water,
    'electricity and water must not be the exact same deadline object',
  );
  // Electricity's period comes from its own breakdown segment, not the
  // unrelated bill-level billReleaseDate used as water's release date.
  assert.equal(
    new Date(mapped.utility_deadlines.electricity.billingPeriodStart).toISOString(),
    new Date('2026-10-12T00:00:00.000Z').toISOString(),
  );
});

test('multiple electricity_breakdown segments resolve to the true min start / max end regardless of array order or Date-vs-string type', () => {
  const mapped = mapRealBill(baseRealBill({
    electricity_breakdown: [
      // Deliberately out of chronological order, and mixing native Date
      // objects (as the Mongo driver would return) with ISO strings, to
      // guard against Array.sort()'s default string-coercion behavior
      // (which does not sort Date objects chronologically).
      electricitySegment({
        reading_date_from: new Date('2026-11-12T00:00:00.000Z'),
        reading_date_to: new Date('2026-12-12T00:00:00.000Z'),
      }),
      electricitySegment({
        reading_date_from: '2026-10-12T00:00:00.000Z',
        reading_date_to: '2026-11-12T00:00:00.000Z',
      }),
    ],
  }), 'user123');

  const deadline = mapped.utility_deadlines.electricity;
  assert.equal(new Date(deadline.billingPeriodStart).toISOString(), new Date('2026-10-12T00:00:00.000Z').toISOString());
  assert.equal(new Date(deadline.billingPeriodEnd).toISOString(), new Date('2026-12-12T00:00:00.000Z').toISOString());
});

test('a bill with no electricity charge still carries no electricity schedule entry (unchanged behavior)', () => {
  const mapped = mapRealBill(baseRealBill({ charges: { rent: 5000, electricity: 0, water: 0 } }), 'user123');
  assert.deepEqual(mapped.utility_deadlines, {});
});

test('a seeded/demo-style bill with bill-level period/due fields is unaffected for period + due date (no regression)', () => {
  const mapped = mapRealBill(baseRealBill({
    billingCycleStart: '2026-10-12T16:00:00.000Z',
    billingCycleEnd: '2026-11-12T16:00:00.000Z',
    dueDate: '2026-11-08T16:00:00.000Z',
    status: 'paid',
  }), 'user123');

  // billingCycleStart is a period boundary; without a genuine release-marker
  // field this bill has no known release event, and release date must stay
  // honestly null rather than fabricated from the period boundary.
  assert.equal(mapped.utility_deadlines.electricity.billReleaseDate, null);
  assert.ok(mapped.utility_deadlines.electricity.billingPeriodStart);
  assert.equal(
    new Date(mapped.utility_deadlines.electricity.finalDueDate).toISOString(),
    new Date('2026-11-08T16:00:00.000Z').toISOString(),
  );
});

test('a seeded/demo-style bill WITH a genuine release field reports release date correctly (no regression)', () => {
  const mapped = mapRealBill(baseRealBill({
    billingCycleStart: '2026-10-12T16:00:00.000Z',
    billingCycleEnd: '2026-11-12T16:00:00.000Z',
    dueDate: '2026-11-08T16:00:00.000Z',
    releaseDate: '2026-10-18T00:00:00.000Z',
    status: 'paid',
  }), 'user123');

  assert.equal(
    new Date(mapped.utility_deadlines.electricity.billReleaseDate).toISOString(),
    new Date('2026-10-18T00:00:00.000Z').toISOString(),
  );
});

// ── Full-pipeline coverage: utilityperiods -> enrichRealBillsWithUtilityBreakdowns -> mapRealBill ──
// Proves the schedule fix holds through the same ID-matching path already
// hardened for the Electricity Breakdown table, using both an ObjectId and
// a string tenantSummaries.billId — the two BSON shapes an externally
// managed `utilityperiods` collection could plausibly use.
test('fetchUserBills resolves an electricity schedule end-to-end when tenantSummaries.billId is a STRING (BSON type mismatch)', async () => {
  await runFetchUserBillsScenario({ billIdType: 'string' });
});

test('fetchUserBills resolves an electricity schedule end-to-end when tenantSummaries.billId is an ObjectId', async () => {
  await runFetchUserBillsScenario({ billIdType: 'objectid' });
});

async function runFetchUserBillsScenario({ billIdType }) {
  // fetchUserBills(db, user, opts) takes `db` as a plain parameter (getDb()
  // is only called by the route handlers, not by fetchUserBills itself), so
  // a mock db object can be passed directly — no module-cache stubbing needed.
  const billObjectId = new ObjectId();
  const tenantMongoId = new ObjectId();
  const tenant = { user_id: 'tenant-sched', _id: tenantMongoId, name: 'Tenant Schedule' };

  const realBillDoc = {
    _id: billObjectId,
    billing_id: 'bill-sched',
    userId: tenantMongoId,
    status: 'unpaid',
    billingMonth: '2026-10-12T16:00:00.000Z',
    totalAmount: 1760,
    remainingAmount: 1760,
    charges: { electricity: 1760 },
    createdAt: new Date('2026-08-15T12:43:29.913Z'),
  };

  const utilityPeriodDoc = {
    _id: new ObjectId(),
    utilityType: 'electricity',
    isArchived: false,
    startDate: new Date('2026-05-26T00:00:00.000Z'),
    endDate: new Date('2026-06-15T00:00:00.000Z'),
    ratePerUnit: 16,
    computedTotalUsage: 110,
    computedTotalCost: 1760,
    tenantSummaries: [
      {
        billId: billIdType === 'string' ? billObjectId.toHexString() : billObjectId,
        billAmount: 1760,
        activeTenantIds: [tenantMongoId],
      },
    ],
  };

  const matches = (doc, filter) => {
    if (!filter || typeof filter !== 'object') return true;
    return Object.entries(filter).every(([key, condition]) => {
      if (key === '$or') return condition.some((sub) => matches(doc, sub));
      if (key === 'isArchived') return true; // permissive for $ne
      if (key === '_id' && condition && typeof condition === 'object' && !(condition instanceof ObjectId)) return true;
      if (key === 'tenantSummaries.billId' && condition && typeof condition === 'object' && Array.isArray(condition.$in)) {
        return (doc.tenantSummaries || []).some((summary) => condition.$in.some((candidate) => (
          candidate instanceof ObjectId
            ? (summary.billId instanceof ObjectId ? summary.billId.equals(candidate) : String(summary.billId) === candidate.toHexString())
            : String(summary.billId) === String(candidate)
        )));
      }
      const actual = doc[key];
      if (condition instanceof ObjectId) return actual instanceof ObjectId ? actual.equals(condition) : String(actual) === condition.toHexString();
      return true;
    });
  }

  const makeCollection = (store) => ({
    async findOne(filter) { return store.find((d) => matches(d, filter)) || null; },
    find(filter) {
      const docs = store.filter((d) => matches(d, filter));
      return { async toArray() { return docs; } };
    },
  });

  const mockDb = {
    collection: (name) => {
      if (name === 'bills') return makeCollection([realBillDoc]);
      if (name === 'billing') return makeCollection([]);
      if (name === 'utilityperiods') return makeCollection([utilityPeriodDoc]);
      if (name === 'reservations') return makeCollection([]);
      return makeCollection([]);
    },
  };

  const bills = await fetchUserBills(mockDb, tenant);
  const bill = bills.find((entry) => entry.billing_id === 'bill-sched');

  assert.ok(bill, 'expected the real bill to be returned');
  assert.ok(bill.utility_deadlines.electricity, 'expected an electricity schedule entry from the utilityperiods-derived breakdown');
  assert.equal(
    new Date(bill.utility_deadlines.electricity.billingPeriodStart).toISOString(),
    new Date('2026-05-26T00:00:00.000Z').toISOString(),
  );
  assert.equal(
    new Date(bill.utility_deadlines.electricity.billingPeriodEnd).toISOString(),
    new Date('2026-06-15T00:00:00.000Z').toISOString(),
  );
}

// ── Frontend gate coverage (source inspection, matching this repo's
// established pattern for RN screens with no rendering harness — see
// billingMissingValueDisplay.test.js) ──
test('bill-details.jsx no longer requires BOTH billReleaseDate AND finalDueDate to show a utility schedule card', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/app/bill-details.jsx'),
    'utf8',
  );

  // The old, overly strict gate must be gone.
  assert.doesNotMatch(
    source,
    /deadline\?\.billReleaseDate\s*&&\s*deadline\?\.finalDueDate/,
    'must not require both billReleaseDate and finalDueDate together — that hid a card with only one of them known',
  );

  // The new gate must accept the entry as soon as any one schedule field is present.
  const filterStart = source.indexOf('const utilityDeadlines = Object.entries');
  assert.ok(filterStart > -1, 'expected the utilityDeadlines filter to still exist');
  const filterBody = source.slice(filterStart, filterStart + 600);
  ['billingPeriodStart', 'billingPeriodEnd', 'meterReadingDate', 'billReleaseDate', 'finalDueDate'].forEach((field) => {
    assert.ok(filterBody.includes(field), `expected the relaxed filter to check ${field}`);
  });
});
