'use strict';

// Phase 3 end-to-end billing audit: proves the guarantees that make "a
// fully settled bill can never simultaneously appear paid on one screen and
// unpaid/overdue on another" actually hold, rather than merely asserting
// they should. Every tenant-facing surface (Billing History, Bill Details,
// Dashboard) reads through fetchUserBills() -> mapRealBill(), which is what
// makes single-source-of-truth possible; this file proves the specific
// scenarios that could break that guarantee.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapRealBill } = require('../controllers/billing.controller');
const dashboardSource = require('fs').readFileSync(
  require.resolve('../controllers/dashboard.controller.js'), 'utf8',
);

function baseRealBill(overrides = {}) {
  return {
    _id: { toString: () => 'bill123' },
    billingMonth: '2026-10-12T16:00:00.000Z',
    billingCycleStart: '2026-10-12T16:00:00.000Z',
    dueDate: '2026-11-08T16:00:00.000Z',
    status: 'unpaid',
    charges: { rent: 5000, electricity: 9088, water: 0 },
    totalAmount: 14088,
    remainingAmount: 14088,
    ...overrides,
  };
}

test('a bill whose raw status is still "overdue" but has confirmed payment evidence reports effective status "paid" everywhere', () => {
  // Simulates the exact class of bug this phase is auditing: a settlement
  // write race or partial update that flips payment fields but leaves the
  // literal `status` string stale at 'overdue'. getEffectiveBillStatus()
  // inside mapRealBill() must still report 'paid' from the payment
  // evidence, not the stale literal field, since every tenant-facing route
  // (history, details, dashboard, PDF, receipt) reads through mapRealBill.
  const staleOverdueButPaid = baseRealBill({
    status: 'overdue',
    remainingAmount: 0,
    paymentDate: new Date('2026-08-15T13:03:36.257Z'),
    paymentMethod: 'gcash',
    paymongoPaymentId: 'pay_kEaaRGzY88fJpkCDq5N3H29D',
  });

  const mapped = mapRealBill(staleOverdueButPaid, 'user123');
  assert.equal(mapped.status, 'paid', 'effective status must override the stale raw "overdue" field');
  assert.equal(mapped.remaining_amount, 0);
});

test('a genuinely overdue, unpaid bill is never misreported as paid', () => {
  const genuinelyOverdue = baseRealBill({ status: 'overdue' });
  const mapped = mapRealBill(genuinelyOverdue, 'user123');
  assert.equal(mapped.status, 'overdue');
  assert.equal(mapped.remaining_amount, 14088);
});

test('a fully settled bill reports remaining_amount 0 and the full original total as the visible amount (not a fabricated partial figure)', () => {
  const settled = baseRealBill({
    status: 'paid',
    remainingAmount: 0,
    paymentDate: new Date('2026-08-15T13:03:36.257Z'),
  });
  const mapped = mapRealBill(settled, 'user123');
  assert.equal(mapped.remaining_amount, 0);
  assert.equal(mapped.amount, 14088);
  assert.equal(mapped.total, 14088);
});

test('Dashboard and Billing History are structurally guaranteed to agree because both delegate to the same fetchUserBills()/mapRealBill() pipeline', () => {
  // Source-level proof (matches this repo's existing convention for
  // single-source-of-truth claims, e.g. billingUiPolish.test.js): dashboard
  // does not define any independent bill-status derivation of its own.
  assert.match(dashboardSource, /require\(['"]\.\/billing\.controller['"]\)/);
  assert.match(dashboardSource, /fetchUserBills\(/);
  assert.doesNotMatch(dashboardSource, /status\s*===\s*['"]paid['"]/);
  assert.doesNotMatch(dashboardSource, /isPaidBill\s*\(/, 'dashboard.controller.js must not reimplement paid-status logic — it must only consume fetchUserBills() output');
});
