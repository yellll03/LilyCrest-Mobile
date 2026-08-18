export function normalizeStatementVersion(bill) {
  const value = bill?.statement_version;
  if (value === null || value === undefined || String(value).trim() === '') return 'legacy';
  return String(value).trim();
}

export function normalizeReceiptVersion(bill) {
  const value = bill?.receipt_version;
  if (value === null || value === undefined || String(value).trim() === '') return 'legacy';
  return String(value).trim();
}

export function billingDocumentCacheKey(billId, bill, kind = 'statement') {
  const id = String(billId || '').trim() || 'unknown-bill';
  const documentType = kind === 'receipt' ? 'receipt' : 'statement';
  const version = documentType === 'receipt'
    ? normalizeReceiptVersion(bill)
    : normalizeStatementVersion(bill);
  return `${id}_${documentType}_v${version}`;
}
