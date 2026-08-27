/* global __dirname, test */
import fs from 'fs';
import path from 'path';

// payment-success.jsx pulls in expo-router / native modules, so this is a
// source-inspection test (same pattern as documentManager.test.js /
// homeTruthfulState.test.js). The behavioural contract:
//   - on a backend-confirmed 'paid' result, publish a canonical refresh
//     signal so the Contract screen re-reads /contracts/current
//   - never call a "generate contract" endpoint
//   - never assume the Contract exists synchronously

const source = fs.readFileSync(
  path.resolve(__dirname, '../../app/payment-success.jsx'),
  'utf8',
);

describe('payment-success triggers an authoritative Contract refetch, not local generation', () => {
  test('publishes a payment_completed canonical event', () => {
    expect(source).toContain('publishCanonicalNotification');
    expect(source).toMatch(/type:\s*'payment_completed'/);
  });

  test('the nudge fires on the backend-confirmed paid branch', () => {
    const paidIndex = source.indexOf("if (status === 'paid')");
    const nudgeIndex = source.indexOf('nudgeContractRefreshAfterPayment()', paidIndex);
    expect(paidIndex).toBeGreaterThan(-1);
    expect(nudgeIndex).toBeGreaterThan(paidIndex);
    // and before the redirect that leaves the screen
    const redirectIndex = source.indexOf("router.replace('/(tabs)/billing')", paidIndex);
    expect(nudgeIndex).toBeLessThan(redirectIndex);
  });

  test('does not call any manual contract-generation endpoint', () => {
    // Strip comments so the "never calls a generate Contract endpoint" note in
    // the source doesn't trip this — we're checking executable code only.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/contracts\/[^'"`]*\/generate/);
    expect(code).not.toMatch(/apiService\.\w*[Gg]enerate\w*[Cc]ontract/);
    expect(code).not.toMatch(/generateContract|generatePreparedContract/);
  });

  test('the "paid" outcome is still gated on the backend status, not assumed', () => {
    // outcome only becomes 'paid' inside the status === 'paid' branch
    const occurrences = source.match(/setOutcome\('paid'\)/g) || [];
    expect(occurrences.length).toBe(1);
    expect(source).toMatch(/const status = String\(payload\.status \|\| ''\)\.toLowerCase\(\)/);
  });
});
