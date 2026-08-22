'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const {
  buildCanonicalBill,
  planBillingMigration,
  publicMigrationReport,
} = require('../domain/billing/canonicalBillingMigration');
const { applyMigrationPlan, parseArgs } = require('../scripts/migrateBillingToBills');

function legacyBill(overrides = {}) {
  return {
    _id: new ObjectId(),
    billing_id: 'bill-2026-08',
    user_id: 'tenant-a',
    billing_period: 'August 2026',
    billing_type: 'consolidated',
    status: 'unpaid',
    rent: 5000,
    electricity: 900,
    water: 100,
    penalties: 0,
    total: 6000,
    remaining_amount: 6000,
    due_date: new Date('2026-08-28T00:00:00.000Z'),
    paymongo_checkout_id: 'cs_bill_august',
    created_at: new Date('2026-08-18T00:00:00.000Z'),
    ...overrides,
  };
}

function tenant(overrides = {}) {
  return { _id: new ObjectId(), user_id: 'tenant-a', ...overrides };
}

test('dry-run plans a canonical insert with an exact financial fingerprint and no invented dates', () => {
  const user = tenant();
  const legacy = legacyBill();
  const first = planBillingMigration({
    legacyDocs: [legacy], canonicalDocs: [], users: [user], now: new Date('2026-08-22T00:00:00Z'),
  });
  const second = planBillingMigration({
    legacyDocs: [legacy], canonicalDocs: [], users: [user], now: new Date('2026-08-23T00:00:00Z'),
  });

  assert.equal(first.counts.inserts, 1);
  assert.equal(first.counts.conflicts, 0);
  assert.equal(first.planId, second.planId, 'reviewed plan ID must describe source data, not wall-clock time');
  assert.equal(first.actions[0].canonicalDocument.totalAmount, 6000);
  assert.equal(first.actions[0].canonicalDocument.remainingAmount, 6000);
  assert.equal(first.actions[0].canonicalDocument.billingCycleStart, null);
  assert.equal(first.actions[0].canonicalDocument.paymentDate, null);
  assert.equal(first.actions[0].canonicalDocument.paidAt, null);
  assert.match(first.actions[0].sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(publicMigrationReport(first).apply_allowed, true);
});

test('an exact existing canonical record is linked without rewriting financial fields', () => {
  const user = tenant();
  const legacy = legacyBill();
  const canonical = buildCanonicalBill(legacy, user, new Date('2026-08-20T00:00:00Z'));
  delete canonical.migration;
  delete canonical.legacyCollectionId;
  canonical._id = new ObjectId();

  const plan = planBillingMigration({ legacyDocs: [legacy], canonicalDocs: [canonical], users: [user] });
  assert.equal(plan.counts.links, 1);
  assert.equal(plan.counts.conflicts, 0);
  assert.equal(plan.actions[0].canonicalId, String(canonical._id));
});

test('a financial mismatch is a blocking conflict, never a heuristic winner or merge', () => {
  const user = tenant();
  const legacy = legacyBill();
  const canonical = buildCanonicalBill(legacy, user);
  canonical._id = new ObjectId();
  canonical.totalAmount = 6500;
  canonical.grossAmount = 6500;
  canonical.remainingAmount = 6500;

  const plan = planBillingMigration({ legacyDocs: [legacy], canonicalDocs: [canonical], users: [user] });
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.counts.conflicts, 1);
  assert.equal(plan.conflicts[0].code, 'CANONICAL_FINANCIAL_CONFLICT');
  assert.ok(plan.conflicts[0].differences.some((difference) => difference.field === 'grossCentavos'));
  assert.equal(publicMigrationReport(plan).apply_allowed, false);
});

test('duplicate PayMongo session bindings and ambiguous owners block apply', () => {
  const duplicateUserA = tenant();
  const duplicateUserB = tenant();
  const legacyA = legacyBill();
  const legacyB = legacyBill({
    _id: new ObjectId(), billing_id: 'bill-2026-09', paymongo_checkout_id: 'cs_bill_august',
  });
  const plan = planBillingMigration({
    legacyDocs: [legacyA, legacyB], canonicalDocs: [], users: [duplicateUserA, duplicateUserB],
  });

  assert.ok(plan.conflicts.some((conflict) => conflict.code === 'DUPLICATE_PAYMONGO_SESSION_ID'));
  assert.ok(plan.conflicts.some((conflict) => (
    conflict.code === 'LEGACY_INVARIANT_FAILED'
      && conflict.invariants.includes('AMBIGUOUS_OWNER_USER_ID')
  )));
});

test('stable billing IDs are globally unique across tenants and canonical aliases', () => {
  const tenantA = tenant();
  const tenantB = tenant({ user_id: 'tenant-b' });
  const canonicalA = buildCanonicalBill(legacyBill(), tenantA);
  canonicalA._id = new ObjectId();
  const canonicalB = buildCanonicalBill(
    legacyBill({
      _id: new ObjectId(),
      user_id: 'tenant-b',
      billing_id: 'different-primary-id',
      paymongo_checkout_id: 'cs_tenant_b',
    }),
    tenantB,
  );
  canonicalB._id = new ObjectId();
  canonicalB.legacyBillingId = canonicalA.billing_id;

  const plan = planBillingMigration({
    legacyDocs: [],
    canonicalDocs: [canonicalA, canonicalB],
    users: [tenantA, tenantB],
  });
  assert.ok(plan.conflicts.some((conflict) => (
    conflict.code === 'DUPLICATE_CANONICAL_BILLING_ID'
      && conflict.key === canonicalA.billing_id
  )));
  assert.equal(plan.counts.conflicts, 1);
});

test('paid legacy records with a remaining balance fail closed instead of being silently normalized', () => {
  const plan = planBillingMigration({
    legacyDocs: [legacyBill({ status: 'paid', remaining_amount: 100 })],
    canonicalDocs: [],
    users: [tenant()],
  });
  assert.equal(plan.actions.length, 0);
  assert.ok(plan.conflicts[0].invariants.includes('PAID_BILL_HAS_REMAINING_BALANCE'));
});

test('apply flags require a reviewed plan ID and archive is never an implicit dry-run action', () => {
  assert.deepEqual(parseArgs([]), {
    apply: false, archiveLegacy: false, confirm: '', help: false, reportPath: '', userId: '',
  });
  assert.throws(() => parseArgs(['--archive-legacy']), /only with --apply/);
  assert.deepEqual(parseArgs(['--apply', '--confirm', 'abc', '--archive-legacy']), {
    apply: true, archiveLegacy: true, confirm: 'abc', help: false, reportPath: '', userId: '',
  });
  assert.throws(
    () => parseArgs(['--apply', '--confirm', 'abc', '--user=tenant-a']),
    /full-system plan/,
  );
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

function getPath(object, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value?.[key], object);
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = getPath(doc, key);
    if (expected && typeof expected === 'object' && '$ne' in expected) return actual !== expected.$ne;
    return String(actual) === String(expected);
  });
}

function fakeCollection(docs) {
  return {
    async createIndex() { return 'index'; },
    async findOne(filter) { return docs.find((doc) => matches(doc, filter)) || null; },
    async updateOne(filter, update, options = {}) {
      let doc = docs.find((candidate) => matches(candidate, filter));
      if (!doc && options.upsert && update.$setOnInsert) {
        doc = { _id: new ObjectId(), ...update.$setOnInsert };
        docs.push(doc);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: doc._id };
      }
      if (!doc) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      if (update.$setOnInsert) return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    },
  };
}

test('the reviewed migration plan is idempotent and archives only after canonical verification', async () => {
  const user = tenant();
  const legacy = legacyBill();
  const plan = planBillingMigration({ legacyDocs: [legacy], canonicalDocs: [], users: [user] });
  const canonicalDocs = [];
  const legacyDocs = [legacy];
  const db = {
    collection(name) {
      return name === 'bills' ? fakeCollection(canonicalDocs) : fakeCollection(legacyDocs);
    },
  };

  const first = await applyMigrationPlan(db, plan, { archiveLegacy: true });
  const second = await applyMigrationPlan(db, plan, { archiveLegacy: true });
  assert.deepEqual(first, { inserted: 1, linked: 0, unchanged: 0, archivedLegacy: 1 });
  assert.deepEqual(second, { inserted: 0, linked: 0, unchanged: 1, archivedLegacy: 0 });
  assert.equal(canonicalDocs.length, 1);
  assert.equal(legacyDocs[0].isArchived, true);
  assert.equal(String(legacyDocs[0].migratedCanonicalId), String(canonicalDocs[0]._id));
});
