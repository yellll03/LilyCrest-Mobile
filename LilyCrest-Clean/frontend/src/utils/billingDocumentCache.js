export function normalizeStatementVersion(bill) {
  const value = bill?.statement_version;
  if (value === null || value === undefined || String(value).trim() === '') return 'legacy';
  return String(value).trim();
}

export function billingDocumentCacheKey(billId, bill, kind = 'statement') {
  const id = String(billId || '').trim() || 'unknown-bill';
  const version = normalizeStatementVersion(bill);
  const documentType = kind === 'receipt' ? 'receipt' : 'statement';
  return `${id}_${documentType}_v${version}`;
}
