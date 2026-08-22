'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');

process.env.PAYMONGO_SECRET_KEY = 'sk_test_webhook_reliability';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsec_webhook_reliability';

const databasePath = require.resolve('../config/database');
const billingControllerPath = require.resolve('../controllers/billing.controller');
const pushPath = require.resolve('../services/pushService');
const emailPath = require.resolve('../services/emailService');

const tenantObjectId = new ObjectId();
const stores = {
  bills: [],
  billing: [],
  users: [],
  paymongo_webhook_events: [],
};
let failBillWriteOnce = false;

function valuesEqual(left, right) {
  if (left instanceof ObjectId || right instanceof ObjectId) {
    return String(left) === String(right);
  }
  return left === right || String(left) === String(right);
}

function matches(doc, filter) {
  if (!filter || typeof filter !== 'object') return true;
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') return condition.every((part) => matches(doc, part));
    if (key === '$or') return condition.some((part) => matches(doc, part));
    const actual = doc[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date) && !(condition instanceof ObjectId)) {
      if ('$in' in condition && !condition.$in.some((value) => valuesEqual(actual, value))) return false;
      if ('$nin' in condition && condition.$nin.some((value) => valuesEqual(actual, value))) return false;
      if ('$exists' in condition) {
        const exists = Object.prototype.hasOwnProperty.call(doc, key) && actual !== undefined;
        if (exists !== condition.$exists) return false;
      }
      if ('$lt' in condition && !(actual instanceof Date && actual < condition.$lt)) return false;
      return true;
    }
    return valuesEqual(actual, condition);
  });
}

function applyUpdate(doc, update, inserting = false) {
  if (inserting && update.$setOnInsert) Object.assign(doc, update.$setOnInsert);
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$inc) {
    for (const [key, amount] of Object.entries(update.$inc)) {
      doc[key] = Number(doc[key] || 0) + Number(amount);
    }
  }
  if (update.$unset) {
    for (const key of Object.keys(update.$unset)) delete doc[key];
  }
}

function project(doc, projection) {
  if (!projection) return { ...doc };
  const included = Object.entries(projection).filter(([, include]) => include).map(([key]) => key);
  if (!included.length) return { ...doc };
  return Object.fromEntries(included.filter((key) => key in doc).map((key) => [key, doc[key]]));
}

function collection(name) {
  const store = stores[name] || (stores[name] = []);
  return {
    async findOne(filter, options = {}) {
      const found = store.find((doc) => matches(doc, filter));
      return found ? project(found, options.projection) : null;
    },
    find(filter) {
      const found = store.filter((doc) => matches(doc, filter));
      return {
        limit(limit) {
          return { async toArray() { return found.slice(0, limit).map((doc) => ({ ...doc })); } };
        },
        async toArray() { return found.map((doc) => ({ ...doc })); },
      };
    },
    async updateOne(filter, update, options = {}) {
      let found = store.find((doc) => matches(doc, filter));
      if (!found && options.upsert) {
        found = {};
        for (const [key, value] of Object.entries(filter)) {
          if (!key.startsWith('$') && (typeof value !== 'object' || value instanceof ObjectId)) found[key] = value;
        }
        applyUpdate(found, update, true);
        store.push(found);
        return { matchedCount: 0, upsertedCount: 1 };
      }
      if (!found) return { matchedCount: 0, upsertedCount: 0 };
      applyUpdate(found, update, false);
      return { matchedCount: 1, upsertedCount: 0 };
    },
    async findOneAndUpdate(filter, update) {
      if (name === 'bills' && failBillWriteOnce) {
        failBillWriteOnce = false;
        throw new Error('simulated settlement database failure');
      }
      const found = store.find((doc) => matches(doc, filter));
      if (!found) return null;
      applyUpdate(found, update, false);
      return { ...found };
    },
  };
}

const db = { collection };
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: { getDb: () => db, connectToMongo: async () => {}, closeConnection: async () => {} },
};
require.cache[billingControllerPath] = {
  id: billingControllerPath,
  filename: billingControllerPath,
  loaded: true,
  exports: {
    BILL_UNAVAILABLE_MESSAGE: 'Bill not available',
    fetchUserBills: async () => [],
    isPayableBill: () => true,
    mapRealBill: (doc) => ({ ...doc, total: doc.totalAmount, remaining_amount: doc.remainingAmount }),
  },
};
require.cache[pushPath] = {
  id: pushPath,
  filename: pushPath,
  loaded: true,
  exports: { notifyPaymentConfirmed: async () => true },
};
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: { sendPaymentReceiptEmail: async () => true },
};

const { handleWebhook, redirectSuccess } = require('../controllers/paymongo.controller');

function reset({ includeBill = true } = {}) {
  stores.bills.splice(0, stores.bills.length);
  stores.billing.splice(0, stores.billing.length);
  stores.users.splice(0, stores.users.length, { _id: tenantObjectId, user_id: 'tenant-a' });
  stores.paymongo_webhook_events.splice(0, stores.paymongo_webhook_events.length);
  failBillWriteOnce = false;
  if (includeBill) {
    stores.bills.push({
      _id: new ObjectId(),
      billing_id: 'bill-A',
      userId: tenantObjectId,
      status: 'unpaid',
      totalAmount: 9088,
      remainingAmount: 9088,
      paymongoSessionId: 'cs_webhook_1',
    });
  }
}

function event(overrides = {}) {
  return {
    id: overrides.eventId || 'evt_webhook_1',
    attributes: {
      type: 'checkout_session.payment.paid',
      livemode: overrides.livemode ?? false,
      data: {
        id: overrides.checkoutId || 'cs_webhook_1',
        attributes: {
          livemode: overrides.livemode ?? false,
          status: 'inactive',
          metadata: { billing_id: overrides.billingId || 'bill-A', user_id: 'tenant-a' },
          reference_number: 'LC-bill-A-webhook',
          payments: [{
            id: overrides.paymentId || 'pay_webhook_1',
            attributes: {
              status: 'paid',
              amount: overrides.amount ?? 908800,
              paid_at: Math.floor(Date.now() / 1000),
              source: { type: 'gcash' },
            },
          }],
        },
      },
    },
  };
}

function signedRequest(paymongoEvent) {
  const body = { data: paymongoEvent };
  const rawBody = Buffer.from(JSON.stringify(body));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', process.env.PAYMONGO_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');
  return {
    headers: { 'paymongo-signature': `t=${timestamp},te=${signature}` },
    body,
    rawBody,
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('a paid event is durably recorded and settled exactly once', async () => {
  reset();
  const paymongoEvent = event();
  const firstResponse = response();
  await handleWebhook(signedRequest(paymongoEvent), firstResponse);

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(stores.bills[0].status, 'paid');
  assert.equal(stores.paymongo_webhook_events[0].status, 'processed');
  assert.equal(stores.paymongo_webhook_events[0].attemptCount, 1);

  const duplicateResponse = response();
  await handleWebhook(signedRequest(paymongoEvent), duplicateResponse);
  assert.equal(duplicateResponse.statusCode, 200);
  assert.equal(duplicateResponse.body.duplicate, true);
  assert.equal(stores.paymongo_webhook_events[0].attemptCount, 1);
});

test('a settlement database failure returns 503 and the same event retries safely', async () => {
  reset();
  failBillWriteOnce = true;
  const paymongoEvent = event();
  const failedResponse = response();
  await handleWebhook(signedRequest(paymongoEvent), failedResponse);

  assert.equal(failedResponse.statusCode, 503);
  assert.equal(failedResponse.body.retryable, true);
  assert.equal(stores.bills[0].status, 'unpaid');
  assert.equal(stores.paymongo_webhook_events[0].status, 'failed');

  const retryResponse = response();
  await handleWebhook(signedRequest(paymongoEvent), retryResponse);
  assert.equal(retryResponse.statusCode, 200);
  assert.equal(stores.bills[0].status, 'paid');
  assert.equal(stores.paymongo_webhook_events[0].status, 'processed');
  assert.equal(stores.paymongo_webhook_events[0].attemptCount, 2);
});

test('an unmatched payment is retained as needs_review instead of falsely logged as paid', async () => {
  reset({ includeBill: false });
  const paymongoEvent = event({ billingId: 'missing-bill', checkoutId: 'cs_missing' });
  const res = response();
  await handleWebhook(signedRequest(paymongoEvent), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'needs_review');
  assert.equal(stores.paymongo_webhook_events[0].resolution, 'bill_not_found');
  assert.equal(stores.paymongo_webhook_events[0].reconciled, false);
});

test('an in-flight event returns non-2xx so a crashed worker cannot suppress provider retries', async () => {
  reset();
  const paymongoEvent = event();
  stores.paymongo_webhook_events.push({
    eventId: paymongoEvent.id,
    eventType: paymongoEvent.attributes.type,
    checkoutId: paymongoEvent.attributes.data.id,
    payloadHash: crypto.createHash('sha256').update(JSON.stringify(paymongoEvent)).digest('hex'),
    checkoutData: paymongoEvent.attributes.data,
    status: 'processing',
    attemptCount: 1,
    leaseExpiresAt: new Date(Date.now() + 30_000),
  });

  const res = response();
  await handleWebhook(signedRequest(paymongoEvent), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.retryable, true);
  assert.equal(stores.bills[0].status, 'unpaid');
});

test('a signed live-mode event is rejected by a test-mode backend', async () => {
  reset();
  const res = response();
  await handleWebhook(signedRequest(event({ livemode: true })), res);

  assert.equal(res.statusCode, 400);
  assert.equal(stores.bills[0].status, 'unpaid');
  assert.equal(stores.paymongo_webhook_events.length, 0);
});

test('an event ID replayed with different financial payload is rejected', async () => {
  reset();
  const first = event({ amount: 100 });
  const firstResponse = response();
  await handleWebhook(signedRequest(first), firstResponse);
  assert.equal(firstResponse.statusCode, 200);

  const altered = event({ amount: 200 });
  const alteredResponse = response();
  await handleWebhook(signedRequest(altered), alteredResponse);
  assert.equal(alteredResponse.statusCode, 409);
  assert.equal(stores.paymongo_webhook_events.length, 1);
});

test('the public success redirect is presentation-only and cannot settle a guessed bill ID', async () => {
  reset();
  const res = { html: '', send(html) { this.html = html; return this; } };
  await redirectSuccess({ query: { billing_id: 'bill-A' } }, res);

  assert.equal(stores.bills[0].status, 'unpaid');
  assert.match(res.html, /frontend:\/\/payment-success/);
  assert.doesNotMatch(res.html, /checkout_id=/);
});
