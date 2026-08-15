// Phase 3.1 closure: payment failure and slow verification previously
// collapsed into the same tenant experience ("still processing"), even
// though PayMongo already distinguishes them. This tests the normalized
// status enum (paymongo.controller.js normalizeCheckoutStatusForClient)
// that getCheckoutStatus now returns, so the mobile UI can branch on
// paid | pending | failed | cancelled | unknown instead of interpreting
// raw provider strings itself.
const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeCheckoutStatusForClient } = require('../controllers/paymongo.controller');

test('a confirmed payment always normalizes to "paid", regardless of raw status text', () => {
  assert.equal(normalizeCheckoutStatusForClient({ paymentConfirmed: true, paymentStatus: 'succeeded', sessionStatus: 'active' }), 'paid');
  assert.equal(normalizeCheckoutStatusForClient({ paymentConfirmed: true, paymentStatus: 'paid', sessionStatus: 'inactive' }), 'paid');
  // paymentConfirmed can be true via hasConfirmedPayments/sessionClosedWithPayment
  // even when paymentStatus itself is something else — paid must still win.
  assert.equal(normalizeCheckoutStatusForClient({ paymentConfirmed: true, paymentStatus: 'pending', sessionStatus: 'inactive' }), 'paid');
});

test('declined/failed payment intents normalize to "failed"', () => {
  assert.equal(normalizeCheckoutStatusForClient({ paymentConfirmed: false, paymentStatus: 'failed', sessionStatus: 'active' }), 'failed');
  assert.equal(normalizeCheckoutStatusForClient({ paymentConfirmed: false, paymentStatus: 'declined', sessionStatus: 'active' }), 'failed');
});

test('cancelled/voided payments and an expired checkout session normalize to "cancelled"', () => {
  assert.equal(normalizeCheckoutStatusForClient({ paymentConfirmed: false, paymentStatus: 'cancelled', sessionStatus: 'active' }), 'cancelled');
  assert.equal(normalizeCheckoutStatusForClient({ paymentConfirmed: false, paymentStatus: 'voided', sessionStatus: 'active' }), 'cancelled');
  assert.equal(normalizeCheckoutStatusForClient({ paymentConfirmed: false, paymentStatus: 'pending', sessionStatus: 'expired' }), 'cancelled');
});

test('in-flight statuses normalize to "pending"', () => {
  for (const paymentStatus of ['pending', 'awaiting_payment_method', 'awaiting_next_action', 'processing']) {
    assert.equal(normalizeCheckoutStatusForClient({ paymentConfirmed: false, paymentStatus, sessionStatus: 'active' }), 'pending', `expected ${paymentStatus} -> pending`);
  }
  // An active session with no recognizable intent status yet is still "pending", not "unknown".
  assert.equal(normalizeCheckoutStatusForClient({ paymentConfirmed: false, paymentStatus: '', sessionStatus: 'active' }), 'pending');
});

test('unrecognized raw status combinations fall back to "unknown" rather than a false paid/failed', () => {
  assert.equal(normalizeCheckoutStatusForClient({ paymentConfirmed: false, paymentStatus: 'some_new_paymongo_status', sessionStatus: 'closed' }), 'unknown');
});

test('failed takes priority over a stale "active" session status', () => {
  assert.equal(normalizeCheckoutStatusForClient({ paymentConfirmed: false, paymentStatus: 'failed', sessionStatus: 'active' }), 'failed');
});
