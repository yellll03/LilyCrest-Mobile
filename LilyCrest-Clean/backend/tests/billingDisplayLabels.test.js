'use strict';

// Phase 3: billing status / payment-method display compatibility.
// Verifies the friendly-label helpers used by the downloadable bill PDF
// (backend/controllers/billing.controller.js:downloadBillPdf) so a tenant
// never sees a raw internal status keyword or the payment gateway's name
// presented as if it were their chosen payment method.

const test = require('node:test');
const assert = require('node:assert/strict');
const { billStatusLabel, billPaymentMethodLabel } = require('../controllers/billing.controller');

test('billStatusLabel maps every canonical status to the same friendly label used in the mobile app', () => {
  assert.equal(billStatusLabel('unpaid'), 'Unpaid');
  assert.equal(billStatusLabel('overdue'), 'Overdue');
  assert.equal(billStatusLabel('pending_verification'), 'Payment Under Review');
  assert.equal(billStatusLabel('partially_paid'), 'Partially Paid');
  assert.equal(billStatusLabel('paid'), 'Paid');
  assert.equal(billStatusLabel('rejected'), 'Payment Rejected');
  assert.equal(billStatusLabel('cancelled'), 'Cancelled');
});

test('billStatusLabel maps legacy aliases to the same label as their canonical status', () => {
  assert.equal(billStatusLabel('pending'), 'Unpaid');
  assert.equal(billStatusLabel('settled'), 'Paid');
  assert.equal(billStatusLabel('verification'), 'Payment Under Review');
});

test('billStatusLabel has defensive labels for statuses not yet written by any code path', () => {
  assert.equal(billStatusLabel('duplicate'), 'Duplicate');
  assert.equal(billStatusLabel('refunded'), 'Refunded');
});

test('billStatusLabel is case-insensitive and never returns a raw uppercased keyword', () => {
  assert.equal(billStatusLabel('PENDING_VERIFICATION'), 'Payment Under Review');
  assert.equal(billStatusLabel('Rejected'), 'Payment Rejected');
});

test('billStatusLabel falls back to a humanized (not raw) label for an unrecognized status rather than crashing', () => {
  assert.equal(billStatusLabel('some_future_status'), 'Some Future Status');
  assert.equal(billStatusLabel(''), 'Unpaid');
  assert.equal(billStatusLabel(null), 'Unpaid');
});

test('billPaymentMethodLabel never presents the payment gateway name as the tenant\'s chosen method', () => {
  assert.equal(billPaymentMethodLabel('paymongo'), 'Online Payment');
  assert.equal(billPaymentMethodLabel('PayMongo'), 'Online Payment');
});

test('billPaymentMethodLabel passes through an actual known method unchanged (no fabrication)', () => {
  assert.equal(billPaymentMethodLabel('gcash'), 'gcash');
  assert.equal(billPaymentMethodLabel('Cash'), 'Cash');
});

test('billPaymentMethodLabel handles empty/missing input safely', () => {
  assert.equal(billPaymentMethodLabel(''), '');
  assert.equal(billPaymentMethodLabel(null), '');
  assert.equal(billPaymentMethodLabel(undefined), '');
});

// Phase 6: billPaymentMethodLabel(rawMethod, channel) prefers the actual
// PayMongo-reported settlement channel (captured at reconciliation time)
// over the generic processor name, without fabricating a channel for older
// records that never captured one.
test('billPaymentMethodLabel shows the real settled channel when known', () => {
  assert.equal(billPaymentMethodLabel('paymongo', 'gcash'), 'GCash');
  assert.equal(billPaymentMethodLabel('paymongo', 'card'), 'Card');
  assert.equal(billPaymentMethodLabel('paymongo', 'grab_pay'), 'GrabPay');
  assert.equal(billPaymentMethodLabel('paymongo', 'paymaya'), 'Maya');
  assert.equal(billPaymentMethodLabel('paymongo', 'GCASH'), 'GCash');
});

test('billPaymentMethodLabel falls back to the generic label when the channel is unknown or missing', () => {
  assert.equal(billPaymentMethodLabel('paymongo', null), 'Online Payment');
  assert.equal(billPaymentMethodLabel('paymongo', ''), 'Online Payment');
  assert.equal(billPaymentMethodLabel('paymongo', 'some_future_channel'), 'Online Payment');
});
