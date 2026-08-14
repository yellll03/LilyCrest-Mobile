'use strict';

// Post-Phase 3 follow-up: Lily Assistant's billing replies must use the same
// tenant-friendly status wording as billing history, bill details, and the
// downloadable bill PDF (billing.controller.js billStatusLabel), instead of
// a generic underscore-to-space formatter that leaked raw internal keywords
// like "pending verification" into tenant-facing chat.

const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../controllers/chatbot.controller');

const { formatBillStatus, summarizeBillForContext, buildBillingResponse } = __test;

test('formatBillStatus maps canonical/legacy statuses to the same friendly label used elsewhere in billing', () => {
  assert.equal(formatBillStatus({ status: 'pending_verification' }), 'Payment Under Review');
  assert.equal(formatBillStatus({ status: 'verification' }), 'Payment Under Review');
  assert.equal(formatBillStatus({ status: 'rejected' }), 'Payment Rejected');
  assert.equal(formatBillStatus({ status: 'partially_paid' }), 'Partially Paid');
  assert.equal(formatBillStatus({ status: 'paid' }), 'Paid');
  assert.equal(formatBillStatus({ status: 'settled' }), 'Paid');
  assert.equal(formatBillStatus({ status: 'unpaid' }), 'Unpaid');
  assert.equal(formatBillStatus({ status: 'overdue' }), 'Overdue');
});

test('formatBillStatus never leaks the raw underscored keyword', () => {
  const label = formatBillStatus({ status: 'pending_verification' });
  assert.doesNotMatch(label, /pending_verification/);
  assert.doesNotMatch(label, /^pending verification$/);
});

test('summarizeBillForContext (fed into the Lily Assistant prompt) uses the friendly label too', () => {
  const summary = summarizeBillForContext({
    description: 'August 2026 Billing Statement',
    total: 6203.89,
    status: 'pending_verification',
    due_date: '2026-08-28',
  });
  assert.match(summary, /Payment Under Review/);
  assert.doesNotMatch(summary, /pending_verification/);
  assert.doesNotMatch(summary, /pending verification/);
});

function fakeDbWithBill(billOverrides = {}) {
  const bill = {
    billing_id: 'BILL-TEST-1',
    user_id: 'tenant-1',
    description: 'This month Billing Statement',
    billing_type: 'consolidated',
    due_date: new Date(),
    total: 6203.89,
    amount: 6203.89,
    ...billOverrides,
  };
  return {
    collection(name) {
      if (name === 'billing') return { find: () => ({ toArray: async () => [bill] }) };
      if (name === 'bills') return { find: () => ({ toArray: async () => [] }) };
      if (name === 'reservations') return { findOne: () => Promise.resolve(null) };
      return { find: () => ({ toArray: async () => [] }) };
    },
  };
}

test('Lily Assistant billing reply shows "Payment Under Review" for a pending_verification bill, not the raw keyword', async () => {
  const db = fakeDbWithBill({ status: 'pending_verification' });
  const result = await buildBillingResponse(db, { user_id: 'tenant-1' }, 'How much is my bill?');
  assert.match(result.message, /Payment Under Review/);
  assert.doesNotMatch(result.message, /pending_verification/);
  assert.doesNotMatch(result.message, /pending verification/);
});

test('Lily Assistant billing reply shows "Payment Rejected" for a rejected bill', async () => {
  const db = fakeDbWithBill({ status: 'rejected' });
  const result = await buildBillingResponse(db, { user_id: 'tenant-1' }, 'What is my bill status?');
  assert.match(result.message, /Payment Rejected/);
  assert.doesNotMatch(result.message, /\brejected\b/);
});

test('Lily Assistant billing reply shows "Paid" via effective status even when the stored status is stale "unpaid"', async () => {
  const db = fakeDbWithBill({
    status: 'unpaid',
    payment_date: new Date(),
    reference_no: 'REF-12345',
  });
  const result = await buildBillingResponse(db, { user_id: 'tenant-1' }, 'What is my bill status?');
  assert.match(result.message, /Status: Paid\b/);
  assert.doesNotMatch(result.message, /Status: Unpaid/);
});
