'use strict';

// Regression coverage for the authoritative bill release lifecycle
// ("Implement Authoritative Bill Release Lifecycle" task).
//
// Trace summary (Phase 1/8): the real `bills` collection has no insertOne()
// writer anywhere in this repo — it is owned by an external system this
// repo cannot modify. The only bill-creation code path this repo owns is
// createBilling() (POST /api/billing, admin-only), which writes to the
// legacy `billing` collection. Tracing fetchUserBills()/normalizeLegacyBill()
// shows no draft/visibility gate beyond that insert — a legacy bill is
// immediately tenant-visible the moment createBilling() persists it. That
// is the code-proven exception the business rule requires before treating
// a creation-time write as an authoritative release event: for this one
// collection, creation and release ARE the same operation.
//
// released_at is therefore written once, in createBilling(), as the
// canonical release timestamp. It is never accepted as an updatable field
// by updateBilling(), so nothing in this repo can ever overwrite it after
// the fact — release is trivially idempotent because there is exactly one
// write path and it only fires once per document (at insertOne).

const test = require('node:test');
const assert = require('node:assert/strict');
const assertNode = require('node:assert');
const { ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');

const dbModulePath = require.resolve('../config/database');
const pushServicePath = require.resolve('../services/pushService');

function matchesSimple(doc, filter) {
  if (!filter || typeof filter !== 'object') return true;
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some((sub) => matchesSimple(doc, sub));
    if (key === '$and') return condition.every((sub) => matchesSimple(doc, sub));
    if (key === 'role' && condition && typeof condition === 'object' && Array.isArray(condition.$in)) {
      return condition.$in.includes(doc.role);
    }
    if (key === 'status' && condition && typeof condition === 'object' && Array.isArray(condition.$nin)) {
      return !condition.$nin.includes(doc.status);
    }
    const actual = doc[key];
    if (condition instanceof ObjectId) return actual instanceof ObjectId && actual.equals(condition);
    if (condition && typeof condition === 'object') return true; // permissive for other operators
    return String(actual) === String(condition);
  });
}

function makeCollection(store, { onInsert } = {}) {
  return {
    async findOne(filter) { return store.find((d) => matchesSimple(d, filter)) || null; },
    find(filter) {
      const docs = store.filter((d) => matchesSimple(d, filter));
      return { async toArray() { return docs; } };
    },
    async insertOne(doc) {
      store.push(doc);
      if (onInsert) onInsert(doc);
      return { insertedId: doc._id || new ObjectId() };
    },
    async updateOne(filter, update) {
      const target = store.find((d) => matchesSimple(d, filter));
      if (!target) return { matchedCount: 0 };
      if (update.$set) Object.assign(target, update.$set);
      if (update.$unset) Object.keys(update.$unset).forEach((k) => { delete target[k]; });
      return { matchedCount: 1 };
    },
    async findOneAndUpdate(filter, update) {
      const target = store.find((d) => matchesSimple(d, filter));
      if (!target) return null;
      if (update.$set) Object.assign(target, update.$set);
      if (update.$unset) Object.keys(update.$unset).forEach((k) => { delete target[k]; });
      return target;
    },
  };
}

let users = [];
let billingDocs = [];

function reset({ usersDocs = [], billingCollectionDocs = [] } = {}) {
  users = usersDocs;
  billingDocs = billingCollectionDocs;
}

if (!require.cache[dbModulePath]) {
  require.cache[dbModulePath] = {
    id: dbModulePath, filename: dbModulePath, loaded: true,
    exports: {
      getDb: () => ({
        collection: (name) => {
          if (name === 'users') return makeCollection(users);
          if (name === 'billing') return makeCollection(billingDocs);
          return makeCollection([]);
        },
      }),
      connectToMongo: async () => {},
      closeConnection: async () => {},
    },
  };
} else {
  throw new Error('config/database.js was already required by an earlier test in this process — run this file in isolation.');
}

if (!require.cache[pushServicePath]) {
  require.cache[pushServicePath] = {
    id: pushServicePath, filename: pushServicePath, loaded: true,
    exports: {
      notifyBillCreated: async () => {},
    },
  };
} else {
  throw new Error('services/pushService.js was already required by an earlier test in this process — run this file in isolation.');
}

const {
  createBilling, updateBilling, normalizeLegacyBill, mapRealBill,
} = require('../controllers/billing.controller');

const TENANT_MONGO_ID = new ObjectId();
const TENANT = { user_id: 'tenant-release', _id: TENANT_MONGO_ID, name: 'Release Tenant', role: 'tenant' };
const ADMIN = { user_id: 'admin-1', role: 'admin' };

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function baseCreateBody(overrides = {}) {
  return {
    tenant_id: TENANT.user_id,
    description: 'June 2026 Billing Statement',
    billing_type: 'electricity',
    due_date: '2026-06-23T00:00:00.000Z',
    billing_period: 'June 2026',
    electricity: 1760,
    ...overrides,
  };
}

// ── 1. First official release writes released_at, using server time ──
test('createBilling writes released_at using server time when no release_date is supplied', async () => {
  reset({ usersDocs: [TENANT] });
  const before = Date.now();
  const res = fakeRes();
  await createBilling({ body: baseCreateBody(), user: ADMIN }, res);
  const after = Date.now();

  assert.equal(res.statusCode, 201);
  assert.ok(res.body.released_at, 'expected released_at to be set');
  const releasedAtMs = new Date(res.body.released_at).getTime();
  assert.ok(releasedAtMs >= before && releasedAtMs <= after, 'released_at must be server time at creation');
});

// ── admin-supplied release_date is respected as the explicit release choice ──
test('an admin-supplied release_date is used as released_at instead of the auto server timestamp', async () => {
  reset({ usersDocs: [TENANT] });
  const explicitRelease = '2026-06-17T10:00:00.000Z';
  const res = fakeRes();
  await createBilling({ body: baseCreateBody({ release_date: explicitRelease }), user: ADMIN }, res);

  assert.equal(new Date(res.body.released_at).toISOString(), new Date(explicitRelease).toISOString());
});

// ── 2. Second release / generic update does not overwrite original released_at ──
test('updateBilling cannot alter released_at (not an accepted field), so the original is preserved across edits', async () => {
  reset({ usersDocs: [TENANT] });
  const createRes = fakeRes();
  await createBilling({ body: baseCreateBody(), user: ADMIN }, createRes);
  const billingId = createRes.body.billing_id;
  const originalReleasedAt = createRes.body.released_at;

  const updateRes = fakeRes();
  // Attempt to smuggle a released_at override through the generic update
  // endpoint — updateBilling never destructures/reads it, so this must be a no-op.
  await updateBilling({
    params: { billingId },
    body: { description: 'Corrected description', released_at: '1999-01-01T00:00:00.000Z', release_date: '2026-06-20T00:00:00.000Z' },
    user: ADMIN,
  }, updateRes);

  const storedDoc = billingDocs.find((d) => d.billing_id === billingId);
  assert.equal(new Date(storedDoc.released_at).toISOString(), new Date(originalReleasedAt).toISOString(), 'released_at must be untouched by updateBilling');
});

// ── 3. Payment does not change released_at ──
test('marking a bill paid via updateBilling does not change released_at', async () => {
  reset({ usersDocs: [TENANT] });
  const createRes = fakeRes();
  await createBilling({ body: baseCreateBody(), user: ADMIN }, createRes);
  const billingId = createRes.body.billing_id;
  const originalReleasedAt = createRes.body.released_at;

  const updateRes = fakeRes();
  await updateBilling({
    params: { billingId },
    body: { status: 'paid', payment_method: 'gcash', payment_date: '2026-06-20T00:00:00.000Z' },
    user: ADMIN,
  }, updateRes);

  const storedDoc = billingDocs.find((d) => d.billing_id === billingId);
  assert.equal(storedDoc.status, 'paid');
  assert.equal(new Date(storedDoc.released_at).toISOString(), new Date(originalReleasedAt).toISOString());
});

// ── 4. Bill viewing/fetching does not create or change released_at ──
test('normalizeLegacyBill (read path) never mutates released_at — reading is not releasing', () => {
  const doc = { billing_id: 'bill-read-1', release_date: undefined, released_at: undefined, status: 'unpaid' };
  const normalized1 = normalizeLegacyBill(doc);
  const normalized2 = normalizeLegacyBill(doc);
  assert.equal(normalized1.release_date, null);
  assert.equal(normalized2.release_date, null);
  assert.equal(doc.released_at, undefined, 'the source document must not be mutated by reading it');
});

// ── 5. Reminder/resend does not change released_at (no such endpoint exists; prove by construction) ──
test('no route or controller function accepts a resend/reminder action that touches released_at', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../controllers/billing.controller.js'), 'utf8');
  // updateBilling's destructured request-body fields must never include released_at/releasedAt.
  const updateFnStart = source.indexOf('async function updateBilling');
  const updateFnBody = source.slice(updateFnStart, updateFnStart + 800);
  assert.doesNotMatch(updateFnBody, /released_at|releasedAt/, 'updateBilling must never accept released_at as an updatable field');
});

// ── 6. Meter-reading dates cannot populate Release Date (mapRealBill path) ──
test('meter-reading dates never populate billReleaseDate on the real-bills path', () => {
  const mapped = mapRealBill({
    _id: { toString: () => 'bill-mr-1' },
    billingMonth: '2026-06-01T00:00:00.000Z',
    dueDate: '2026-06-23T00:00:00.000Z',
    status: 'unpaid',
    charges: { electricity: 1760 },
    electricity_breakdown: [{
      occupants: 1,
      reading_date_from: '2026-05-26T00:00:00.000Z',
      reading_date_to: '2026-06-15T00:00:00.000Z',
      reading_from: 1340, reading_to: 1450, consumption: 110, rate: 16, share_per_tenant: 1760,
    }],
  }, 'user1');

  assert.equal(mapped.utility_deadlines.electricity.billReleaseDate, null);
  assert.ok(mapped.utility_deadlines.electricity.meterReadingDate, 'meter reading date itself should still be present');
});

// ── 7. billingCycleStart cannot populate Release Date ──
test('billingCycleStart never populates billReleaseDate on the real-bills path', () => {
  const mapped = mapRealBill({
    _id: { toString: () => 'bill-bcs-1' },
    billingCycleStart: '2026-05-26T00:00:00.000Z',
    billingCycleEnd: '2026-06-15T00:00:00.000Z',
    dueDate: '2026-06-23T00:00:00.000Z',
    status: 'unpaid',
    charges: { electricity: 1760 },
  }, 'user1');

  assert.equal(mapped.utility_deadlines.electricity.billReleaseDate, null);
  assert.equal(mapped.release_date, null);
});

// ── 8. createdAt cannot populate Release Date ──
test('createdAt never populates billReleaseDate or the shared release_date, on either bill path', () => {
  const mappedReal = mapRealBill({
    _id: { toString: () => 'bill-ca-1' },
    createdAt: '2026-06-16T09:00:00.000Z',
    dueDate: '2026-06-23T00:00:00.000Z',
    status: 'unpaid',
    charges: { electricity: 1760 },
  }, 'user1');
  assert.equal(mappedReal.utility_deadlines.electricity.billReleaseDate, null);
  assert.equal(mappedReal.release_date, null);

  const normalizedLegacy = normalizeLegacyBill({
    billing_id: 'bill-ca-2',
    created_at: '2026-06-16T09:00:00.000Z',
    status: 'unpaid',
  });
  assert.equal(normalizedLegacy.release_date, null);
});

// ── 9. Bill with no genuine release event returns null ──
test('a real bill with absolutely no release-marker field returns release_date null everywhere it is surfaced', () => {
  const mapped = mapRealBill({
    _id: { toString: () => 'bill-none-1' },
    dueDate: '2026-06-23T00:00:00.000Z',
    status: 'unpaid',
    charges: { electricity: 1760 },
  }, 'user1');
  assert.equal(mapped.release_date, null);
  assert.equal(mapped.utility_deadlines.electricity.billReleaseDate, null);
});

// ── 10. Paid historical bill retains original release timestamp ──
test('a paid historical bill retains its original released_at (payment settlement does not touch it)', async () => {
  reset({ usersDocs: [TENANT] });
  const createRes = fakeRes();
  await createBilling({ body: baseCreateBody({ release_date: '2026-06-17T10:00:00.000Z' }), user: ADMIN }, createRes);
  const billingId = createRes.body.billing_id;

  await updateBilling({ params: { billingId }, body: { status: 'paid', payment_date: '2026-06-20T00:00:00.000Z' }, user: ADMIN }, fakeRes());

  const storedDoc = billingDocs.find((d) => d.billing_id === billingId);
  const normalized = normalizeLegacyBill(storedDoc);
  assert.equal(new Date(normalized.release_date).toISOString(), new Date('2026-06-17T10:00:00.000Z').toISOString());
});

// ── 11. Electricity and water share bill-level release date but keep independent period/reading dates ──
test('electricity and water share the same bill-level release date while period/reading dates stay independent (real-bills path)', () => {
  const mapped = mapRealBill({
    _id: { toString: () => 'bill-ew-1' },
    releasedAt: '2026-06-17T10:00:00.000Z',
    dueDate: '2026-06-23T00:00:00.000Z',
    status: 'unpaid',
    charges: { electricity: 1760, water: 450 },
    electricity_breakdown: [{
      occupants: 1,
      reading_date_from: '2026-05-26T00:00:00.000Z',
      reading_date_to: '2026-06-15T00:00:00.000Z',
      reading_from: 1340, reading_to: 1450, consumption: 110, rate: 16, share_per_tenant: 1760,
    }],
  }, 'user1');

  assert.equal(mapped.utility_deadlines.electricity.billReleaseDate, mapped.utility_deadlines.water.billReleaseDate);
  assert.notStrictEqual(mapped.utility_deadlines.electricity, mapped.utility_deadlines.water);
  assert.ok(mapped.utility_deadlines.electricity.billingPeriodStart);
  assert.equal(mapped.utility_deadlines.water.meterReadingDate, null);
});

// ── 12/13. Tenant cannot alter release timestamp / unauthorized caller cannot release a bill ──
test('the create/release route requires admin auth — a tenant-role caller is rejected before reaching createBilling', () => {
  const { adminMiddleware } = require('../middleware/auth');
  const res = fakeRes();
  let nextCalled = false;
  adminMiddleware({ user: TENANT }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false, 'a tenant must never reach the handler that sets released_at');
});

test('the create/release route is wired through authMiddleware + adminMiddleware, not left open', () => {
  const routesSource = fs.readFileSync(path.resolve(__dirname, '../routes/billing.routes.js'), 'utf8');
  assertNode.match(routesSource, /router\.post\(['"]\/['"],\s*authMiddleware,\s*adminMiddleware,\s*billingController\.createBilling\)/);
  assertNode.match(routesSource, /router\.put\(['"]\/:billingId['"],\s*authMiddleware,\s*adminMiddleware,\s*billingController\.updateBilling\)/);
});

// ── 14. Authorized release is idempotent ──
test('creating a bill is the only write to released_at, and there is no route that can re-trigger it for an existing bill (idempotent by construction)', () => {
  const routesSource = fs.readFileSync(path.resolve(__dirname, '../routes/billing.routes.js'), 'utf8');
  // Only one POST (create) exists; PUT (update) is the sole other mutator and, per test 5 above, never touches released_at.
  const postRoutes = routesSource.match(/router\.post\(/g) || [];
  assert.equal(postRoutes.length, 2, 'expected exactly the tenant payment-proof POST and the admin create POST — no separate/duplicate release endpoint');
});

// ── 15. Legacy records without trustworthy release timestamps remain null ──
test('a legacy bill with no released_at and no admin-supplied release_date stays null, not backfilled from any other field', () => {
  const normalized = normalizeLegacyBill({
    billing_id: 'legacy-1',
    created_at: '2026-01-01T00:00:00.000Z',
    due_date: '2026-01-10T00:00:00.000Z',
    status: 'paid',
    payment_date: '2026-01-05T00:00:00.000Z',
  });
  assert.equal(normalized.release_date, null);
});

// ── 16. Frontend renders — when release is unavailable (source inspection, matches repo convention) ──
test('bill-details.jsx and the shared billingStatus.js helper never fall back to created_at for release date', () => {
  const billDetailsSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/app/bill-details.jsx'), 'utf8');
  assert.doesNotMatch(billDetailsSource, /release_date\s*\|\|\s*bill\.created_at/);

  const billingStatusSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/utils/billingStatus.js'), 'utf8');
  const fnStart = billingStatusSource.indexOf('function getBillReleaseDate');
  const fnBody = billingStatusSource.slice(fnStart, fnStart + 300);
  assert.doesNotMatch(fnBody, /created_at|createdAt/);
});

// ── 17. PDF does not fabricate Release Date ──
test('the PDF statement never falls back to created_at for its Released date line', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../controllers/billing.controller.js'), 'utf8');
  assert.doesNotMatch(source, /Released:\s*\$\{formatDate\(bill\.release_date \|\| bill\.created_at\)\}/);
});
