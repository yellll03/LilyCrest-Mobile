/* global test, __dirname */
const fs = require('fs');
const path = require('path');
const { getBillingInsightPanel } = require('../utils/billingInsights');

const source = fs.readFileSync(path.resolve(__dirname, '../../app/billing-history.jsx'), 'utf8');

describe('tenant billing UI polish', () => {
  test('uses exactly one authoritative billing summary', () => {
    expect(source.match(/<Text style=\{styles\.heroLabel\}>Outstanding Balance<\/Text>/g)).toHaveLength(1);
    expect(source).not.toContain('This Month');
    expect(source).not.toContain('Current Billing');
    expect(source).not.toContain('renderCurrentBill');
    expect(source).not.toContain('currentBilling');
  });

  test('adapts the hero without adding a duplicate payment entry point', () => {
    expect(source).toContain('No Outstanding Balance');
    expect(source).toContain('Payment Under Review');
    expect(source).toContain('Waiting for admin verification.');
    expect(source).toContain('Bill Paid');
    expect(source).toContain('Overdue by');
    expect(source).toContain("<Text style={styles.heroPayText}>Pay Now</Text>");
    expect(source).not.toContain("<Text style={styles.payBtnText}>Pay</Text>");
    expect(source).toContain("pathname: '/bill-details'");
    expect(source).not.toContain("pathname: '/payment'");
  });

  test('keeps breakdowns off the landing page and preserves the empty state', () => {
    expect(source).toContain('No bills available.');
    expect(source).toContain('Your future bills will appear here once generated.');
    expect(source).not.toContain('normalizeBreakdown');
    expect(source).not.toContain('breakdownList');
  });

  test('keeps itemized charges in Bill Details only', () => {
    const details = fs.readFileSync(path.resolve(__dirname, '../../app/bill-details.jsx'), 'utf8');
    expect(details).toContain('Billing Summary');
    expect(details).toContain('charges.map');
    expect(source).not.toContain('charges.map');
  });

  test('uses visible surface colors for utility schedule labels and values', () => {
    const details = fs.readFileSync(path.resolve(__dirname, '../../app/bill-details.jsx'), 'utf8');
    expect(details).toContain('styles.utilityScheduleLabel');
    expect(details).toContain('styles.utilityScheduleValue');
    expect(details).toContain('utilityScheduleLabel: { color: c.textSecondary }');
    expect(details).toContain('utilityScheduleValue: { color: c.text }');
  });

  test('reserves safe space for the assistant and bottom navigation', () => {
    expect(source).toContain('useSafeAreaInsets');
    expect(source).toContain('Math.max(insets.bottom + 76, 92)');
    expect(source).toContain('paddingBottom: 176');
  });

  test('billing and payment details display the shared move-in computation', () => {
    const details = fs.readFileSync(path.resolve(__dirname, '../../app/bill-details.jsx'), 'utf8');
    const payment = fs.readFileSync(path.resolve(__dirname, '../../app/payment.jsx'), 'utf8');
    for (const screen of [details, payment]) {
      expect(screen).toContain('move_in_financials');
      expect(screen).toContain('One Month Advance Rent');
      expect(screen).toContain('Security Deposit');
      expect(screen).toContain('Reservation Fee Already Paid');
    }
    expect(details).toContain("'REMAINING BALANCE'");
    expect(payment).toContain("'Remaining Balance'");
  });
});

test('utility deadline is independent from a later rent-cycle date', () => {
  const panel = getBillingInsightPanel([{
    status: 'unpaid',
    amount: 528,
    rent: 0,
    electricity: 528,
    due_date: '2026-08-24T00:00:00.000Z',
    utility_deadlines: {
      electricity: {
        billReleaseDate: '2026-07-18T00:00:00.000Z',
        finalDueDate: '2026-07-28T00:00:00.000Z',
      },
    },
  }]);
  expect(panel.stats.find((stat) => stat.id === 'next-due')).toEqual(expect.objectContaining({
    value: expect.stringContaining('Jul'),
    helper: expect.stringContaining('Electricity'),
  }));
});

test('same-day water and electricity obligations are combined', () => {
  const deadline = { billReleaseDate: '2026-08-18T00:00:00.000Z', finalDueDate: '2026-08-28T00:00:00.000Z' };
  const panel = getBillingInsightPanel([{
    status: 'unpaid', amount: 700, rent: 0, electricity: 500, water: 200,
    utility_deadlines: { electricity: deadline, water: deadline },
  }]);
  expect(panel.stats.find((stat) => stat.id === 'next-due').helper).toContain('Electricity and Water');
});

test('unreleased utility does not reuse a rent-cycle due date', () => {
  const panel = getBillingInsightPanel([{
    status: 'unpaid', amount: 528, rent: 0, electricity: 528,
    due_date: '2026-08-24T00:00:00.000Z',
    utility_deadlines: { electricity: { billReleaseDate: null, finalDueDate: null } },
  }]);
  expect(panel.stats.find((stat) => stat.id === 'next-due')).toBeUndefined();
});
