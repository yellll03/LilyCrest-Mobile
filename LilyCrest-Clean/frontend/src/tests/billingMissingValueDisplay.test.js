/* global test, __dirname */
// Regression test: safeCurrency() in billing-history.jsx, bill-details.jsx,
// and payment.jsx used to coerce null/undefined amounts to 0 via Number(),
// rendering the exact same "₱0.00" a tenant would see for a real zero
// balance — including in the "Pay ₱0.00 via PayMongo" button label. Missing
// billing data must render as "Not available", never as a currency amount.

const fs = require('fs');
const path = require('path');

const files = ['app/billing-history.jsx', 'app/bill-details.jsx', 'app/payment.jsx'];

describe('billing missing-value display (regression)', () => {
  files.forEach((relativePath) => {
    test(`${relativePath}: safeCurrency treats null/undefined/'' as unavailable, distinct from a real zero`, () => {
      const source = fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
      const fnStart = source.indexOf('function safeCurrency');
      expect(fnStart).toBeGreaterThan(-1);
      const fnBody = source.slice(fnStart, source.indexOf('\n}', fnStart));

      // The null/undefined/'' check must happen BEFORE Number(amount) coercion —
      // Number(null) is 0 and Number(undefined) is NaN, so checking after
      // coercion can no longer tell "missing" apart from "zero".
      const guardIndex = fnBody.search(/amount === null[\s\S]*?amount === undefined/);
      const coerceIndex = fnBody.indexOf('Number(amount)');
      expect(guardIndex).toBeGreaterThan(-1);
      expect(coerceIndex).toBeGreaterThan(-1);
      expect(guardIndex).toBeLessThan(coerceIndex);

      expect(fnBody).toContain('Not available');
    });
  });
});
