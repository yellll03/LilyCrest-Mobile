/* global test, __dirname */
const fs = require('fs');
const path = require('path');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');

describe('retired mobile payment-proof UI', () => {
  test('removes the proof picker, action, API call, and helper copy from Bill Details', () => {
    const source = read('../../app/bill-details.jsx');
    expect(source).not.toMatch(/Upload Payment Proof|Retry Payment Proof|Payment Proof Under Review/);
    expect(source).not.toMatch(/handleUploadProof|submitPaymentProof|payment-proofs/);
    expect(source).not.toMatch(/expo-image-picker|firebaseStorageUpload/);
  });

  test('does not advertise payment-proof uploads in tenant-facing policy screens', () => {
    for (const relative of ['../../app/house-rules.jsx', '../../app/my-documents.jsx']) {
      expect(read(relative)).not.toMatch(/upload proof of payment|payment proof uploaded/i);
    }
  });

  test('uses the aggregate checkout route and an actual aggregate details destination', () => {
    const api = read('../services/api.js');
    const home = read('../../app/(tabs)/home.jsx');
    const billing = read('../../app/billing-history.jsx');
    const details = read('../../app/outstanding-balance.jsx');
    expect(api).toContain("api.post('/paymongo/checkout-batch', { billIds })");
    expect(api).not.toContain('submitPaymentProof');
    expect(home).toContain("'/outstanding-balance'");
    expect(billing).toContain("router.push('/outstanding-balance')");
    expect(details).toContain('getOutstandingBreakdown');
    expect(details).toContain('createPaymongoBatchCheckout(latest.billIds)');
  });
});
