'use strict';

// Behavioral tests for PayMongo checkout idempotency: rapid repeated taps,
// two-device-style concurrency, and provider failure must never result in
// two independent live checkout sessions for the same bill. No real
// PayMongo call is made — axios.get/post are monkey-patched (same
// technique as security-hardening.test.js).
//
// billing.controller.js is stubbed via require.cache seeding (same
// technique as config/database.js in sessionTeardown.test.js) so this test
// exercises paymongo.controller.js's own claim/reuse logic in isolation
// from billing.controller.js's unrelated bill-fetching complexity.

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

process.env.PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || 'sk_test_dummy_for_tests';

const billingModulePath = require.resolve('../controllers/billing.controller');
const dbModulePath = require.resolve('../config/database');

const BILL_ID = 'bill-1';
const USER_MONGO_ID = new ObjectId();
const USER = { _id: USER_MONGO_ID, user_id: 'tenant-a', role: 'tenant' };

function makeBillDoc(overrides = {}) {
  return {
    _id: new ObjectId(),
    billing_id: BILL_ID,
    userId: USER_MONGO_ID,
    status: 'pending',
    remaining_amount: 1500,
    ...overrides,
  };
}

// Minimal Mongo-query matcher covering exactly the operators
// paymongo.controller.js's filters use ($and/$or/$exists/$lt/equality,
// including ObjectId comparison) — enough to exercise real atomicity
// semantics without a real database.
function matches(doc, filter) {
  if (!filter || typeof filter !== 'object') return true;
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') return condition.every((sub) => matches(doc, sub));
    if (key === '$or') return condition.some((sub) => matches(doc, sub));
    const actual = doc[key];
    if (condition && typeof condition === 'object' && !(condition instanceof ObjectId)) {
      if ('$exists' in condition) {
        const has = Object.prototype.hasOwnProperty.call(doc, key) && actual !== undefined;
        if (has !== condition.$exists) return false;
      }
      if ('$lt' in condition) {
        if (!(actual instanceof Date) || !(actual < condition.$lt)) return false;
      }
      return true;
    }
    if (condition instanceof ObjectId) return actual instanceof ObjectId && actual.equals(condition);
    return String(actual) === String(condition);
  });
}

function makeFakeBillsCollection(store) {
  return {
    async findOne(filter, options = {}) {
      const doc = store.find((d) => matches(d, filter));
      if (!doc) return null;
      if (!options.projection) return { ...doc };
      const projected = {};
      for (const key of Object.keys(options.projection)) projected[key] = doc[key];
      return projected;
    },
    // Simulates MongoDB's atomic findOneAndUpdate: exactly one caller can
    // "win" a matching document even when called back-to-back synchronously,
    // because the match-and-mutate happens in one non-interleaved step.
    async findOneAndUpdate(filter, update) {
      const doc = store.find((d) => matches(d, filter));
      if (!doc) return null;
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$unset) for (const key of Object.keys(update.$unset)) delete doc[key];
      return { ...doc };
    },
    async updateOne(filter, update) {
      const doc = store.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$unset) for (const key of Object.keys(update.$unset)) delete doc[key];
      return { matchedCount: 1 };
    },
  };
}

// A single mutable store, seeded into the mocked modules exactly once.
// Each test resets its *contents* in place (splice) rather than reseeding
// the require.cache, since node:test runs this file's tests in one process.
let store = [];

function resetStore(docs) {
  store.splice(0, store.length, ...docs);
}

if (!require.cache[dbModulePath]) {
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
      getDb: () => ({
        collection: (name) => {
          if (name === 'bills') return makeFakeBillsCollection(store);
          return { async findOne() { return null; }, async updateOne() { return { matchedCount: 0 }; } };
        },
      }),
      connectToMongo: async () => {},
      closeConnection: async () => {},
    },
  };
} else {
  throw new Error('config/database.js was already required by an earlier test in this process — run this file in isolation.');
}

if (!require.cache[billingModulePath]) {
  require.cache[billingModulePath] = {
    id: billingModulePath,
    filename: billingModulePath,
    loaded: true,
    exports: {
      BILL_UNAVAILABLE_MESSAGE: 'Bill not available',
      fetchUserBills: async () => store.filter((d) => d.billing_id === BILL_ID),
      isPayableBill: () => true,
      mapRealBill: (doc) => doc,
    },
  };
} else {
  throw new Error('billing.controller.js was already required by an earlier test in this process — run this file in isolation.');
}

const { createCheckoutSession } = require('../controllers/paymongo.controller');
const axios = require('axios');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.statusCode = this.statusCode === 200 ? 200 : this.statusCode; return this; },
  };
}

function fakeReq(overrides = {}) {
  return { body: { billingId: BILL_ID }, user: USER, headers: {}, protocol: 'https', get: () => 'mobile-api.lilycrest.space', ...overrides };
}

async function withMockedAxios({ get, post }, fn) {
  const originalGet = axios.get;
  const originalPost = axios.post;
  if (get) axios.get = get;
  if (post) axios.post = post;
  try {
    await fn();
  } finally {
    axios.get = originalGet;
    axios.post = originalPost;
  }
}

function mockPaymongoCreate(checkoutId = 'cs_test_1') {
  return async () => ({
    data: {
      data: {
        id: checkoutId,
        attributes: { checkout_url: `https://checkout.paymongo.com/${checkoutId}` },
      },
    },
  });
}

test('first checkout for a bill creates exactly one live session', async () => {
  resetStore([makeBillDoc()]);
  await withMockedAxios({ post: mockPaymongoCreate('cs_first') }, async () => {
    const res = fakeRes();
    await createCheckoutSession(fakeReq(), res);
    assert.equal(res.body.checkout_id, 'cs_first');
    assert.equal(store[0].paymongoSessionId, 'cs_first');
    assert.equal(store[0].checkoutClaimedAt, undefined); // claim cleared after success
  });
});

test('rapid repeated taps (sequential calls before the first session is saved) only let one claim win', async () => {
  resetStore([makeBillDoc()]);
  // Simulate a slow PayMongo create: the claim is taken synchronously by
  // findOneAndUpdate before either call reaches PayMongo, so the second call
  // must see the still-held claim and be rejected with 409 — exactly the
  // "two devices" / "rapid repeated taps" scenario.
  let created = 0;
  await withMockedAxios({
    post: async () => {
      created += 1;
      return { data: { data: { id: `cs_${created}`, attributes: { checkout_url: `https://x/${created}` } } } };
    },
  }, async () => {
    // First request claims the bill but does not yet clear the claim
    // (simulated by inspecting state directly instead of awaiting save).
    const bill = store[0];
    const now = new Date();
    bill.checkoutClaimedAt = now; // manually hold the claim, as call #1 would mid-flight

    const res = fakeRes();
    await createCheckoutSession(fakeReq(), res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.detail, /already being created/);
    assert.equal(created, 0, 'PayMongo must never be called for the losing request');
  });
});

test('an existing valid checkout session is reused instead of creating a second one', async () => {
  const recentSessionId = 'cs_existing';
  resetStore([makeBillDoc({
    paymongoSessionId: recentSessionId,
    paymongoCheckoutUrl: 'https://checkout.paymongo.com/cs_existing',
    paymongoSessionCreatedAt: new Date(),
  })]);

  let createCalled = false;
  await withMockedAxios({
    get: async () => ({ data: { data: { attributes: { status: 'active', payments: [] } } } }),
    post: async () => { createCalled = true; return { data: { data: { id: 'cs_new', attributes: { checkout_url: 'x' } } } }; },
  }, async () => {
    const res = fakeRes();
    await createCheckoutSession(fakeReq(), res);
    assert.equal(res.body.reused, true);
    assert.equal(res.body.checkout_id, recentSessionId);
    assert.equal(createCalled, false);
  });
});

test('an expired existing checkout session is not reused — a fresh one is created', async () => {
  resetStore([makeBillDoc({
    paymongoSessionId: 'cs_old',
    paymongoCheckoutUrl: 'https://checkout.paymongo.com/cs_old',
    paymongoSessionCreatedAt: new Date(),
  })]);

  await withMockedAxios({
    get: async () => ({ data: { data: { attributes: { status: 'expired', payments: [] } } } }),
    post: mockPaymongoCreate('cs_fresh'),
  }, async () => {
    const res = fakeRes();
    await createCheckoutSession(fakeReq(), res);
    assert.equal(res.body.checkout_id, 'cs_fresh');
  });
});

test('a PayMongo create failure releases the claim so a retry is not permanently blocked', async () => {
  resetStore([makeBillDoc()]);
  await withMockedAxios({ post: async () => { throw new Error('PayMongo unreachable'); } }, async () => {
    const res = fakeRes();
    await createCheckoutSession(fakeReq(), res);
    assert.equal(res.statusCode, 500);
    assert.equal(store[0].checkoutClaimedAt, undefined, 'claim must be released on failure, not left dangling');
  });
});

test('a stale claim past the TTL does not block a fresh checkout attempt', async () => {
  resetStore([makeBillDoc({
    checkoutClaimedAt: new Date(Date.now() - 10 * 60 * 1000), // far past any reasonable TTL
  })]);
  await withMockedAxios({ post: mockPaymongoCreate('cs_after_stale_claim') }, async () => {
    const res = fakeRes();
    await createCheckoutSession(fakeReq(), res);
    assert.equal(res.body.checkout_id, 'cs_after_stale_claim');
  });
});

test('an already-paid bill is rejected before any PayMongo call', async () => {
  resetStore([makeBillDoc({ status: 'paid' })]);
  let called = false;
  await withMockedAxios({ post: async () => { called = true; return {}; } }, async () => {
    const res = fakeRes();
    await createCheckoutSession(fakeReq(), res);
    assert.equal(res.statusCode, 400);
    assert.equal(called, false);
  });
});
