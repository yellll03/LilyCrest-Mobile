/* global test, __dirname */
const fs = require('fs');
const path = require('path');
const {
  getBillPaymentDate,
  getBillPaymentMethodLabel,
  getBillPaymentReference,
  getBillRemainingAmount,
  isPaidBillStatus,
  getUtilityReleaseSchedule,
} = require('../utils/billingStatus');

// Regression coverage for the reported "Paid" + "Your utility bill has not
// been released yet." contradiction. billing-history.jsx and bill-details.jsx
// previously each carried their own independent copy of the utility-release
// check and the outstanding/paid check, and could disagree for the same
// bill. Both screens must now derive these from ../src/utils/billingStatus.js.

describe('billingStatus.getUtilityReleaseSchedule', () => {
  test('uses the explicit canonical schedule state when supplied', () => {
    const schedule = getUtilityReleaseSchedule({
      electricity: 500,
      utility_schedules: { electricity: { state: 'unavailable' } },
    });
    expect(schedule.state).toBe('unavailable');
    expect(schedule.unreleasedUtility).toBe(false);
  });
  test('a paid bill whose utility_deadlines are populated is never reported as unreleased', () => {
    const bill = {
      status: 'paid',
      electricity: 9088,
      utility_deadlines: {
        electricity: {
          billReleaseDate: '2026-10-12T16:00:00.000Z',
          finalDueDate: '2026-11-08T16:00:00.000Z',
        },
      },
    };
    const schedule = getUtilityReleaseSchedule(bill);
    expect(schedule.unreleasedUtility).toBe(false);
    expect(schedule.dueDate).toBe('2026-11-08T16:00:00.000Z');
  });

  test('a bill with an electricity charge but no populated utility_deadlines is reported as unreleased', () => {
    const bill = { status: 'unpaid', electricity: 9088, utility_deadlines: {} };
    expect(getUtilityReleaseSchedule(bill).unreleasedUtility).toBe(true);
  });

  test('paid status and release status are independent axes — a paid+unreleased bill is representable without contradiction in the data model', () => {
    // This must remain possible (utility genuinely not released yet on a
    // prepaid bill), but the UI copy for it must not claim the utility
    // portion was released — callers are responsible for that wording.
    const bill = { status: 'paid', electricity: 9088, utility_deadlines: {} };
    expect(isPaidBillStatus(bill)).toBe(true);
    expect(getUtilityReleaseSchedule(bill).unreleasedUtility).toBe(true);
  });
});

describe('billing-history.jsx and bill-details.jsx use the shared billingStatus module', () => {
  const history = fs.readFileSync(path.resolve(__dirname, '../../app/billing-history.jsx'), 'utf8');
  const details = fs.readFileSync(path.resolve(__dirname, '../../app/bill-details.jsx'), 'utf8');

  test('both screens import getUtilityReleaseSchedule/isBillOutstanding from the shared util instead of a local copy', () => {
    expect(history).toContain("from '../src/utils/billingStatus'");
    expect(details).toContain("from '../src/utils/billingStatus'");
    expect(history).not.toContain('function getDisplaySchedule');
    expect(details).not.toContain('function isBillOutstanding');
  });

  test('paid transaction metadata and remaining-balance invariant render from canonical helpers', () => {
    const paid = {
      status: 'paid',
      remaining_amount: 999,
      payment_date: '2026-08-15T13:03:36.257Z',
      payment_channel: 'gcash',
      payment_reference: 'PM-REFERENCE-123',
    };
    expect(getBillPaymentDate(paid)).toBe('2026-08-15T13:03:36.257Z');
    expect(getBillPaymentMethodLabel(paid)).toBe('GCash');
    expect(getBillPaymentReference(paid)).toBe('PM-REFERENCE-123');
    expect(getBillRemainingAmount(paid)).toBe(0);
    for (const label of ['Payment date', 'Payment method', 'Reference', 'Remaining balance']) {
      expect(history).toContain(`>${label}<`);
    }
  });

  test('payment.jsx (the post-failure "Try Again" screen) imports isBillOutstanding from the shared util instead of a local copy', () => {
    // Phase 3: payment.jsx had its own weaker local isBillOutstanding
    // (only excluded 'paid'/'settled', missing cancelled/rejected/void/
    // refunded/duplicate/archived/verification) that the existing guard
    // above never covered, because it only read billing-history.jsx and
    // bill-details.jsx. payment.jsx is a live route — payment-success.jsx's
    // "Try Again" button on a failed/cancelled payment routes here.
    const payment = fs.readFileSync(path.resolve(__dirname, '../../app/payment.jsx'), 'utf8');
    expect(payment).toContain("from '../src/utils/billingStatus'");
    expect(payment).not.toContain('function isBillOutstanding');
  });

  test('no screen under app/ redefines its own isBillOutstanding instead of importing the shared one', () => {
    const appDir = path.resolve(__dirname, '../../app');
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && /\.jsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (/function\s+isBillOutstanding\s*\(/.test(text)) offenders.push(full);
        }
      }
    };
    walk(appDir);
    expect(offenders).toEqual([]);
  });

  test('the "Payment Receipt" title is only ever wired to the distinct bill-receipt document kind, never to the statement (kind: bill)', () => {
    // Phase 2: a real, separate receipt endpoint now exists
    // (GET /api/billing/:id/receipt) — the statement viewer (kind: 'bill')
    // must keep the honest 'Billing Statement' title, and 'Payment Receipt'
    // must only ever be paired with the distinct 'bill-receipt' kind.
    for (const source of [history, details]) {
      expect(source).toContain("kind: 'bill-receipt'");
      const statementCalls = [...source.matchAll(/kind:\s*'bill',[^}]*title:\s*'([^']*)'/g)];
      expect(statementCalls.length).toBeGreaterThan(0);
      statementCalls.forEach((match) => expect(match[1]).toBe('Billing Statement'));
    }
  });
});
