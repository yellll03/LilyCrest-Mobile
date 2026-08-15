'use strict';

// Phase 2 billing hardening: payment-settlement identity, amount, ownership,
// and idempotency coverage for reconcileCheckoutSessionPayment() /
// markBillPaid() in paymongo.controller.js. Uses the same require.cache
// stubbing technique as paymongoCheckoutIdempotency.test.js so this runs
// against the real settlement logic without a live database or PayMongo.

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

process.env.PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || 'sk_test_dummy_for_tests';
process.env.PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || 'whsec_test_dummy';

const billingModulePath = require.resolve('../controllers/billing.controller');
const dbModulePath = require.resolve('../config/database');
const pushModulePath = require.resolve('../services/pushService');
const emailModulePath = require.resolve('../services/emailService');

const TENANT_A_MONGO_ID = new ObjectId();
const TENANT_B_MONGO_ID = new ObjectId();

function matches(doc, filter) {
  if (!filter || typeof filter !== 'object') return true;
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') return condition.every((sub) => matches(doc, sub));
    if (key === '$or') return condition.some((sub) => matches(doc, sub));
    const actual = doc[key];
    if (condition && typeof condition === 'object' && !(condition instanceof ObjectId)) {
      if ('$nin' in condition) return !condition.$nin.includes(actual);
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

function makeFakeCollection(store) {
  return {
    async findOne(filter, options = {}) {
      const doc = store.find((d) => matches(d, filter));
      if (!doc) return null;
      if (!options.projection) return { ...doc };
      const projected = {};
      for (const key of Object.keys(options.projection)) projected[key] = doc[key];
      return projected;
    },
    find(filter) {
      const docs = store.filter((d) => matches(d, filter));
      return {
        limit(n) {
          const limited = docs.slice(0, n);
          return { async toArray() { return limited.map((d) => ({ ...d })); } };
        },
        async toArray() { return docs.map((d) => ({ ...d })); },
      };
    },
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
      return { matchedCount: 1 };
    },
  };
}

let bills = [];
let billing = [];
let users = [];

function reset({ billsDocs = [], billingDocs = [], usersDocs = [] } = {}) {
  bills.splice(0, bills.length, ...billsDocs);
  billing.splice(0, billing.length, ...billingDocs);
  users.splice(0, users.length, ...usersDocs);
}

if (!require.cache[dbModulePath]) {
  require.cache[dbModulePath] = {
    id: dbModulePath, filename: dbModulePath, loaded: true,
    exports: {
      getDb: () => ({
        collection: (name) => {
          if (name === 'bills') return makeFakeCollection(bills);
          if (name === 'billing') return makeFakeCollection(billing);
          if (name === 'users') return makeFakeCollection(users);
          return makeFakeCollection([]);
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
    id: billingModulePath, filename: billingModulePath, loaded: true,
    exports: {
      BILL_UNAVAILABLE_MESSAGE: 'Bill not available',
      fetchUserBills: async () => [],
      isPayableBill: () => true,
      // Mirror the real mapRealBill's status/remaining_amount surface closely
      // enough for these tests (they assert on status/remaining_amount/total).
      mapRealBill: (doc) => ({
        ...doc,
        status: doc.status,
        total: doc.totalAmount,
        remaining_amount: doc.status === 'paid' ? 0 : doc.remainingAmount,
      }),
    },
  };
} else {
  throw new Error('billing.controller.js was already required by an earlier test in this process — run this file in isolation.');
}

if (!require.cache[pushModulePath]) {
  require.cache[pushModulePath] = {
    id: pushModulePath, filename: pushModulePath, loaded: true,
    exports: { notifyPaymentConfirmed: async () => true },
  };
} else {
  throw new Error('services/pushService.js was already required by an earlier test in this process — run this file in isolation.');
}

if (!require.cache[emailModulePath]) {
  require.cache[emailModulePath] = {
    id: emailModulePath, filename: emailModulePath, loaded: true,
    exports: { sendPaymentReceiptEmail: async () => true },
  };
} else {
  throw new Error('services/emailService.js was already required by an earlier test in this process — run this file in isolation.');
}

const { reconcileCheckoutSessionPayment } = require('../controllers/paymongo.controller');
const { getDb } = require('../config/database');
const db = getDb();

function makeRealBill(overrides = {}) {
  return {
    _id: new ObjectId(),
    billing_id: 'bill-A',
    userId: TENANT_A_MONGO_ID,
    status: 'unpaid',
    totalAmount: 9088,
    remainingAmount: 9088,
    ...overrides,
  };
}

function makeSession({ billingId = 'bill-A', userId = 'tenant-a', amountCentavos = 908800, checkoutId = 'cs_1', paymentId = 'pay_1' } = {}) {
  return {
    id: checkoutId,
    attributes: {
      status: 'inactive',
      metadata: { billing_id: billingId, user_id: userId, user_email: 'tenant@example.com' },
      reference_number: `LC-${billingId}-1`,
      payments: [
        { id: paymentId, attributes: { status: 'paid', amount: amountCentavos, source: { type: 'gcash' }, paid_at: Math.floor(Date.now() / 1000) } },
      ],
    },
  };
}

test('correct metadata settles exactly the correct bill', async () => {
  reset({ billsDocs: [makeRealBill()], usersDocs: [{ user_id: 'tenant-a', _id: TENANT_A_MONGO_ID }] });
  const result = await reconcileCheckoutSessionPayment(db, 'cs_1', { session: makeSession(), sendSideEffects: false });
  assert.equal(result.reconciled, true);
  assert.equal(bills[0].status, 'paid');
  assert.equal(bills[0].remainingAmount, 0);
});

test('a billing_id in metadata that matches no bill does not settle any bill', async () => {
  reset({ billsDocs: [makeRealBill()], usersDocs: [{ user_id: 'tenant-a', _id: TENANT_A_MONGO_ID }] });
  const result = await reconcileCheckoutSessionPayment(db, 'cs_unknown', {
    session: makeSession({ billingId: 'bill-does-not-exist', checkoutId: 'cs_unknown' }),
    sendSideEffects: false,
  });
  assert.equal(result.reconciled, false);
  assert.equal(bills[0].status, 'unpaid', 'the only real bill in the store must remain untouched');
});

test('a user_id in metadata belonging to a different tenant does not settle Tenant A\'s bill', async () => {
  reset({
    billsDocs: [makeRealBill()],
    usersDocs: [{ user_id: 'tenant-a', _id: TENANT_A_MONGO_ID }, { user_id: 'tenant-b', _id: TENANT_B_MONGO_ID }],
  });
  const result = await reconcileCheckoutSessionPayment(db, 'cs_1', {
    session: makeSession({ userId: 'tenant-b', checkoutId: 'cs_wrong_user' }),
    sendSideEffects: false,
  });
  assert.equal(result.reconciled, false);
  assert.equal(bills[0].status, 'unpaid', 'Tenant B\'s metadata must never settle Tenant A\'s bill');
});

test('checkout-ID fallback settles the bill that session was actually created for, even with mismatched metadata', async () => {
  reset({
    billsDocs: [makeRealBill({ paymongoSessionId: 'cs_real_session', billing_id: 'bill-A' })],
    usersDocs: [{ user_id: 'tenant-a', _id: TENANT_A_MONGO_ID }],
  });
  // Metadata claims a billing_id that doesn't exist, but the checkout session
  // ID on the bill document proves which bill this session was created for.
  const result = await reconcileCheckoutSessionPayment(db, 'cs_real_session', {
    session: makeSession({ billingId: 'garbled-metadata-id', checkoutId: 'cs_real_session' }),
    sendSideEffects: false,
  });
  assert.equal(result.reconciled, true);
  assert.equal(bills[0].status, 'paid');
});

test('a checkout ID that ambiguously matches more than one bill fails closed (settles nothing)', async () => {
  reset({
    billsDocs: [
      makeRealBill({ _id: new ObjectId(), billing_id: 'bill-A', paymongoSessionId: 'cs_dup' }),
      makeRealBill({ _id: new ObjectId(), billing_id: 'bill-B', paymongoSessionId: 'cs_dup' }),
    ],
    usersDocs: [{ user_id: 'tenant-a', _id: TENANT_A_MONGO_ID }],
  });
  const result = await reconcileCheckoutSessionPayment(db, 'cs_dup', {
    session: makeSession({ billingId: 'no-such-billing-id', checkoutId: 'cs_dup' }),
    sendSideEffects: false,
  });
  assert.equal(result.reconciled, false);
  assert.ok(bills.every((b) => b.status !== 'paid'), 'an ambiguous checkout ID must never settle any bill');
});

test('a settled amount lower than the bill\'s expected amount does not mark the bill fully paid', async () => {
  reset({ billsDocs: [makeRealBill({ totalAmount: 9088, remainingAmount: 9088 })], usersDocs: [{ user_id: 'tenant-a', _id: TENANT_A_MONGO_ID }] });
  const result = await reconcileCheckoutSessionPayment(db, 'cs_1', {
    session: makeSession({ amountCentavos: 500000 }), // PHP 5,000 vs a PHP 9,088 bill
    sendSideEffects: false,
  });
  assert.equal(result.underpaid, true);
  assert.equal(bills[0].status, 'unpaid', 'bill must not be flipped to paid for an underpaid settlement');
  assert.equal(bills[0].remainingAmount, 9088, 'remaining balance must not be silently zeroed');
  assert.equal(bills[0].paymongoUnderpaidAmount, 5000);
});

test('a settled amount that matches or exceeds the expected amount settles fully', async () => {
  reset({ billsDocs: [makeRealBill({ totalAmount: 9088, remainingAmount: 9088 })], usersDocs: [{ user_id: 'tenant-a', _id: TENANT_A_MONGO_ID }] });
  const result = await reconcileCheckoutSessionPayment(db, 'cs_1', {
    session: makeSession({ amountCentavos: 908800 }),
    sendSideEffects: false,
  });
  assert.equal(result.underpaid, false);
  assert.equal(bills[0].status, 'paid');
});

test('a duplicate webhook for an already-settled bill is idempotent (one settlement only)', async () => {
  reset({ billsDocs: [makeRealBill({ status: 'paid', remainingAmount: 0, paymongoPaymentId: 'pay_1', paymentDate: new Date('2026-08-15') })], usersDocs: [{ user_id: 'tenant-a', _id: TENANT_A_MONGO_ID }] });
  const before = { ...bills[0] };
  const result = await reconcileCheckoutSessionPayment(db, 'cs_1', { session: makeSession(), sendSideEffects: false });
  assert.equal(result.alreadyPaid, true);
  assert.equal(bills[0].paymentDate.getTime(), before.paymentDate.getTime(), 'paymentDate must not be overwritten by a duplicate event');
});

test('two concurrent settlement attempts for the same bill only settle it once', async () => {
  reset({ billsDocs: [makeRealBill()], usersDocs: [{ user_id: 'tenant-a', _id: TENANT_A_MONGO_ID }] });
  const [first, second] = await Promise.all([
    reconcileCheckoutSessionPayment(db, 'cs_1', { session: makeSession(), sendSideEffects: false }),
    reconcileCheckoutSessionPayment(db, 'cs_1', { session: makeSession(), sendSideEffects: false }),
  ]);
  const settledCount = [first, second].filter((r) => r.alreadyPaid === false).length;
  assert.equal(settledCount, 1, 'exactly one of the two concurrent calls should perform the actual settlement');
  assert.equal(bills[0].status, 'paid');
});

test('an unconfirmed (still-pending) session never settles a bill', async () => {
  reset({ billsDocs: [makeRealBill()], usersDocs: [{ user_id: 'tenant-a', _id: TENANT_A_MONGO_ID }] });
  const pendingSession = makeSession();
  pendingSession.attributes.status = 'active';
  pendingSession.attributes.payments = [];
  const result = await reconcileCheckoutSessionPayment(db, 'cs_1', { session: pendingSession, sendSideEffects: false });
  assert.equal(result.reconciled, false);
  assert.equal(bills[0].status, 'unpaid');
});
