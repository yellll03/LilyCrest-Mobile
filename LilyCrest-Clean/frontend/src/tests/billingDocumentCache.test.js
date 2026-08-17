import { billingDocumentCacheKey, normalizeReceiptVersion, normalizeStatementVersion } from '../utils/billingDocumentCache';

describe('billing statement_version cache lifecycle', () => {
  it('keeps the same bill and statement_version on the same cache key', () => {
    const bill = { bill_id: 'bill-1', statement_version: 'abc123' };
    expect(billingDocumentCacheKey('bill-1', bill)).toBe(billingDocumentCacheKey('bill-1', { ...bill }));
  });

  it('changes the cache key when the backend statement_version changes', () => {
    const oldKey = billingDocumentCacheKey('bill-1', { statement_version: 'v1' });
    const newKey = billingDocumentCacheKey('bill-1', { statement_version: 'v2' });
    expect(newKey).not.toBe(oldKey);
  });

  it('uses stable, distinct statement and receipt cache keys', () => {
    const bill = { statement_version: 7, receipt_version: 9 };
    expect(billingDocumentCacheKey('bill-1', bill)).toBe('bill-1_statement_v7');
    expect(billingDocumentCacheKey('bill-1', bill, 'receipt')).toBe('bill-1_receipt_v9');
  });

  it('handles a legacy bill without a version without fabricating a random value', () => {
    expect(normalizeStatementVersion({})).toBe('legacy');
    expect(billingDocumentCacheKey('bill-1', {})).toBe('bill-1_statement_vlegacy');
    expect(billingDocumentCacheKey('bill-1', {})).toBe(billingDocumentCacheKey('bill-1', {}));
  });

  it('invalidates old receipt bytes independently from the Statement', () => {
    const statement = { statement_version: 's1', receipt_version: 'r1' };
    const changedReceipt = { statement_version: 's1', receipt_version: 'r2' };
    expect(billingDocumentCacheKey('bill-1', statement)).toBe(billingDocumentCacheKey('bill-1', changedReceipt));
    expect(billingDocumentCacheKey('bill-1', statement, 'receipt'))
      .not.toBe(billingDocumentCacheKey('bill-1', changedReceipt, 'receipt'));
    expect(normalizeReceiptVersion({})).toBe('legacy');
  });
});
