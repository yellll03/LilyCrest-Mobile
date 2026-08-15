/* global test, __dirname */
const fs = require('fs');
const path = require('path');

// Phase 2: Billing Statement vs Payment Receipt document actions.
// A paid bill must offer both [View Statement] and [View Receipt]; an
// unpaid/released bill must offer [View Statement] only — receipt
// availability is gated on the same paid/outstanding check the rest of the
// screen already uses (no separate, possibly-drifting condition).

describe('billing-history.jsx document actions', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app/billing-history.jsx'), 'utf8');

  test('the receipt button is gated on the same `paid` flag as the rest of the card, not a separate check', () => {
    const receiptBlock = source.slice(source.indexOf("kind: 'bill-receipt'") - 400, source.indexOf("kind: 'bill-receipt'"));
    expect(receiptBlock).toMatch(/\{paid\s*&&/);
  });

  test('the statement button (kind: bill) is always available, independent of paid status', () => {
    const statementIndex = source.indexOf("kind: 'bill',");
    expect(statementIndex).toBeGreaterThan(-1);
  });
});

describe('bill-details.jsx document actions', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app/bill-details.jsx'), 'utf8');

  test('the receipt button only renders when the bill is not outstanding (i.e. paid)', () => {
    expect(source).toMatch(/\{!isOutstanding\s*&&\s*\(\s*<Pressable[\s\S]*?bill-receipt/);
  });

  test('the statement button renders unconditionally (not gated on paid status)', () => {
    const statementButtonIndex = source.indexOf("kind: 'bill',");
    const receiptButtonIndex = source.indexOf("kind: 'bill-receipt'");
    expect(statementButtonIndex).toBeGreaterThan(-1);
    expect(statementButtonIndex).toBeLessThan(receiptButtonIndex);
  });
});

describe('documentManager.js resolves distinct URLs for statement vs receipt', () => {
  // documentManager.js imports expo-sharing (a native module), so this is
  // asserted via source inspection rather than require() — same pattern as
  // documentViewerActions.test.js in this suite.
  const source = fs.readFileSync(path.resolve(__dirname, '../services/documentManager.js'), 'utf8');

  test('kind "bill" resolves to the /pdf statement endpoint', () => {
    expect(source).toMatch(/kind === 'bill'\)\s*return\s*`\$\{MOBILE_API_BASE_URL\}\/billing\/\$\{encodeURIComponent\(id\)\}\/pdf`/);
  });

  test('kind "bill-receipt" resolves to a distinct /receipt endpoint', () => {
    expect(source).toMatch(/kind === 'bill-receipt'\)\s*return\s*`\$\{MOBILE_API_BASE_URL\}\/billing\/\$\{encodeURIComponent\(id\)\}\/receipt`/);
  });
});
