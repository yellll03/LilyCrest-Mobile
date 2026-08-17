'use strict';

// Regression coverage for updateBilling()'s charge-edit path against the
// real `bills` collection.
//
// Root cause: the itemized-charge recompute step looked up the pre-edit
// bill ONLY in the legacy `billing` collection (`db.collection('billing').findOne(...)`).
// For a bill that lives exclusively in the real `bills` collection (created
// via the migration path, not createBilling's legacy insert), that lookup
// always returned null, so the handler 404'd immediately — before ever
// reaching the `bills` fallback further down the function. Charge edits on
// a real bill were therefore completely blocked, and even if they hadn't
// been, the `bills`-collection $set never mapped the charge/total/items
// fields at all, only status/payment_method/payment_date/notes — so
// `updatedAt` (and therefore the mobile `statement_version` cache key)
// would never have reflected a charge change on a real bill either.

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const dbModulePath = require.resolve('../config/database');

function matchesSimple(doc, filter) {
  if (!filter || typeof filter !== 'object') return true;
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some((sub) => matchesSimple(doc, sub));
    if (key === '$nin') return true;
    const actual = doc[key];
    if (condition instanceof ObjectId) return actual instanceof ObjectId && actual.equals(condition);
    if (condition && typeof condition === 'object' && !(condition instanceof ObjectId)) return true;
    return String(actual) === String(condition);
  });
}

function makeCollection(store) {
  return {
    async findOne(filter) {
      return store.find((d) => matchesSimple(d, filter)) || null;
    },
    find(filter) {
      const docs = store.filter((d) => matchesSimple(d, filter));
      return { async toArray() { return docs; } };
    },
    async findOneAndUpdate(filter, update) {
      const doc = store.find((d) => matchesSimple(d, filter));
      if (!doc) return { value: null };
      if (update.$set) {
        Object.entries(update.$set).forEach(([path, value]) => {
          // Real MongoDB supports dot-notation paths in $set to update a
          // nested field without replacing the whole subdocument.
          const segments = path.split('.');
          let target = doc;
          while (segments.length > 1) {
            const segment = segments.shift();
            if (typeof target[segment] !== 'object' || target[segment] === null) target[segment] = {};
            target = target[segment];
          }
          target[segments[0]] = value;
        });
      }
      if (update.$unset) Object.keys(update.$unset).forEach((k) => delete doc[k]);
      return { value: doc };
    },
  };
}

let billingDocs = [];
let billsDocs = [];

if (!require.cache[dbModulePath]) {
  require.cache[dbModulePath] = {
    id: dbModulePath, filename: dbModulePath, loaded: true,
    exports: {
      getDb: () => ({
        collection: (name) => {
          if (name === 'billing') return makeCollection(billingDocs);
          if (name === 'bills') return makeCollection(billsDocs);
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

const { updateBilling } = require('../controllers/billing.controller');

const TENANT_MONGO_ID = new ObjectId();
const TENANT = { user_id: 'tenant-a', _id: TENANT_MONGO_ID, name: 'Tenant A', role: 'tenant' };
const ADMIN = { user_id: 'admin-1', role: 'admin' };

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function reset({ billing = [], bills = [] } = {}) {
  billingDocs = billing;
  billsDocs = bills;
}

test('admin can add an electricity charge to a bill that lives only in the real `bills` collection (no legacy doc)', async () => {
  const billId = new ObjectId();
  const before = new Date('2026-08-01T00:00:00.000Z');
  reset({
    bills: [{
      _id: billId,
      userId: TENANT_MONGO_ID,
      status: 'unpaid',
      charges: { rent: 5400, electricity: 0, water: 0 },
      totalAmount: 5400,
      remainingAmount: 5400,
      updatedAt: before,
      createdAt: before,
    }],
  });

  const res = fakeRes();
  await updateBilling(
    { params: { billingId: String(billId) }, user: ADMIN, body: { electricity: 1200 } },
    res,
  );

  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.electricity, 1200, 'the new electricity charge must be reflected in the response');
  assert.equal(res.body.total, 6600, 'total must be recomputed (5400 rent + 1200 electricity)');

  const updatedDoc = billsDocs.find((d) => String(d._id) === String(billId));
  assert.equal(updatedDoc.charges.electricity, 1200, 'the real bills document must actually store the new charge');
  assert.ok(updatedDoc.updatedAt.getTime() > before.getTime(), 'updatedAt must be bumped so statement_version reflects the change');
});

test('a tenant cannot edit charges on another tenant\'s real-collection-only bill', async () => {
  const billId = new ObjectId();
  reset({
    bills: [{
      _id: billId,
      userId: new ObjectId(), // different tenant
      status: 'unpaid',
      charges: { rent: 5400, electricity: 0, water: 0 },
      totalAmount: 5400,
      remainingAmount: 5400,
      updatedAt: new Date(),
      createdAt: new Date(),
    }],
  });

  const res = fakeRes();
  await updateBilling(
    { params: { billingId: String(billId) }, user: TENANT, body: { electricity: 1200 } },
    res,
  );
  assert.equal(res.statusCode, 404);
});
