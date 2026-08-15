'use strict';

// Phase 2: regression coverage for the new distinct payment-receipt PDF
// endpoint (GET /api/billing/:billingId/receipt, downloadBillReceiptPdf in
// billing.controller.js). Verifies the receipt/statement separation rules:
// only a bill with confirmed payment evidence returns a receipt, ownership
// is enforced the same way as the existing statement endpoint, and
// malformed IDs never 500.

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { PDFDocument } = require('pdf-lib');

const dbModulePath = require.resolve('../config/database');

function makeCollection(store) {
  return {
    async findOne(filter) {
      return store.find((d) => matchesSimple(d, filter)) || null;
    },
    find(filter) {
      const docs = store.filter((d) => matchesSimple(d, filter));
      return { async toArray() { return docs; } };
    },
  };
}

function matchesSimple(doc, filter) {
  if (!filter || typeof filter !== 'object') return true;
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some((sub) => matchesSimple(doc, sub));
    const actual = doc[key];
    if (condition instanceof ObjectId) return actual instanceof ObjectId && actual.equals(condition);
    if (condition && typeof condition === 'object') return true; // permissive for $ne/$in used by unrelated collections
    return String(actual) === String(condition);
  });
}

const TENANT_A_MONGO_ID = new ObjectId();
const TENANT_A = { user_id: 'tenant-a', _id: TENANT_A_MONGO_ID, name: 'Tenant A' };

let bills = [];

function reset(billsDocs) {
  bills = billsDocs;
}

if (!require.cache[dbModulePath]) {
  require.cache[dbModulePath] = {
    id: dbModulePath, filename: dbModulePath, loaded: true,
    exports: {
      getDb: () => ({
        collection: (name) => {
          if (name === 'bills') return makeCollection(bills);
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

const { downloadBillReceiptPdf } = require('../controllers/billing.controller');

function makeRealBill(overrides = {}) {
  return {
    _id: new ObjectId(),
    billing_id: 'bill-A',
    userId: TENANT_A_MONGO_ID,
    status: 'paid',
    billingMonth: '2026-10-12T16:00:00.000Z',
    totalAmount: 9088,
    remainingAmount: 0,
    charges: { electricity: 9088 },
    paymentDate: new Date('2026-08-15T13:03:36.257Z'),
    paymentMethod: 'gcash',
    paymongoPaymentId: 'pay_kEaaRGzY88fJpkCDq5N3H29D',
    paymongoReference: 'LC-bill-A-1',
    ...overrides,
  };
}

function fakeRes() {
  const chunks = [];
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    json(payload) { this.body = payload; return this; },
    end(buf) { this.buffer = buf; },
  };
}

function fakeReq(billingId, user = TENANT_A) {
  return { params: { billingId }, user };
}

test('a paid bill returns a valid, non-empty PDF receipt', async () => {
  reset([makeRealBill()]);
  const res = fakeRes();
  await downloadBillReceiptPdf(fakeReq('bill-A'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.ok(res.buffer && res.buffer.length > 0);
  const doc = await PDFDocument.load(res.buffer);
  assert.equal(doc.getPageCount(), 1);
});

test('an unpaid bill returns 404, not a fabricated receipt', async () => {
  reset([makeRealBill({ status: 'unpaid', remainingAmount: 9088, paymentDate: null, paymongoPaymentId: null, paymongoReference: null, paymentMethod: null })]);
  const res = fakeRes();
  await downloadBillReceiptPdf(fakeReq('bill-A'), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.buffer, undefined);
});

test('a nonexistent bill ID returns 404, not a receipt for the wrong bill', async () => {
  reset([makeRealBill()]);
  const res = fakeRes();
  await downloadBillReceiptPdf(fakeReq('does-not-exist'), res);
  assert.equal(res.statusCode, 404);
});

test('a malformed / non-ObjectId billing ID is handled safely (no 500 CastError)', async () => {
  reset([makeRealBill()]);
  const res = fakeRes();
  await downloadBillReceiptPdf(fakeReq('not-a-valid-id; DROP TABLE bills'), res);
  assert.equal(res.statusCode, 404);
  assert.ok(res.body?.detail);
});

test('Tenant B cannot retrieve Tenant A\'s receipt (IDOR)', async () => {
  reset([makeRealBill()]);
  const tenantB = { user_id: 'tenant-b', _id: new ObjectId(), name: 'Tenant B' };
  const res = fakeRes();
  await downloadBillReceiptPdf(fakeReq('bill-A', tenantB), res);
  assert.equal(res.statusCode, 404, 'must look identical to "bill not found", not reveal it exists for another tenant');
});

test('the receipt PDF text does not contain statement-only wording (no re-invoicing a settled bill)', async () => {
  reset([makeRealBill()]);
  const res = fakeRes();
  await downloadBillReceiptPdf(fakeReq('bill-A'), res);
  const text = res.buffer.toString('latin1');
  assert.ok(!text.includes('TOTAL AMOUNT DUE'));
  assert.ok(!/Please pay/i.test(text));
});
