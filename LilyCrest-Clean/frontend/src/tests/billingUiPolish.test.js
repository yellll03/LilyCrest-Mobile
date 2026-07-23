/* global test, __dirname */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '../../app/billing-history.jsx'), 'utf8');

describe('tenant billing UI polish', () => {
  test('uses exactly one authoritative billing summary', () => {
    expect(source).toContain('Outstanding Balance');
    expect(source).not.toContain('Total Outstanding');
    expect(source).not.toContain('This Month');
    expect(source).not.toContain('Current Billing');
    expect(source).not.toContain('renderCurrentBill');
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

  test('reserves safe space for the assistant and bottom navigation', () => {
    expect(source).toContain('useSafeAreaInsets');
    expect(source).toContain('Math.max(insets.bottom + 76, 92)');
    expect(source).toContain('paddingBottom: 176');
  });
});
