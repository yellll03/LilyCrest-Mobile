const STATUS_LABELS = Object.freeze({
  movein: 'Active Contract',
  active: 'Active Contract',
  approved: 'Approved',
  pending: 'Pending Contract',
  expired: 'Expired',
  renewal_pending: 'Renewal Pending',
  terminated: 'Terminated',
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
});

const APPROVED_CONTRACT_STATUSES = new Set(['movein', 'active', 'approved', 'expired', 'renewal_pending']);

function normalizeStatus(value) {
  return String(value || '').trim().replace(/[\s-]+/g, '_').toLowerCase();
}

export function contractStatusLabel(value) {
  return STATUS_LABELS[normalizeStatus(value)] || 'Status unavailable';
}

export function isApprovedContract(contract) {
  return Boolean(contract && APPROVED_CONTRACT_STATUSES.has(normalizeStatus(contract.status)));
}

export function hasAuthorizedContractPdf(contract) {
  return Boolean(
    isApprovedContract(contract)
    && contract.fileAvailable === true
    && String(contract.documentId || '').trim(),
  );
}

export function formatContractDate(value, locale) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function contractPeriod(contract, locale) {
  const start = formatContractDate(contract?.startDate, locale);
  const end = formatContractDate(contract?.endDate, locale);
  return start && end ? `${start} – ${end}` : null;
}

export function leaseTypeLabel(value) {
  const normalized = normalizeStatus(value);
  if (normalized === 'long_term' || normalized === 'longterm') return 'Long-Term Lease';
  if (normalized === 'short_term' || normalized === 'shortterm') return 'Short-Term Lease';
  return null;
}

export function buildContractSummary(contract, branch, locale) {
  if (!isApprovedContract(contract)) return null;
  const room = String(contract?.roomNumber || '').trim();
  const branchName = String(branch?.branchName || '').trim();
  const fields = [
    { key: 'period', label: 'Contract Period', value: contractPeriod(contract, locale) },
    { key: 'room', label: 'Room Assignment', value: room ? `Room ${room.replace(/^room\s+/i, '')}` : null },
    { key: 'branch', label: 'Branch', value: branchName || null },
    { key: 'leaseType', label: 'Lease Type', value: leaseTypeLabel(contract?.leaseType) },
  ];
  return {
    status: contractStatusLabel(contract.status),
    fields: fields.filter((field) => field.value),
    hasMissingDetails: fields.some((field) => !field.value),
    canOpenPdf: hasAuthorizedContractPdf(contract),
    documentInfo: [
      { label: 'Document Version', value: String(contract?.documentVersion || contract?.version || '').trim() || null },
      { label: 'Generated Date', value: formatContractDate(contract?.generatedDate || contract?.createdAt, locale) },
    ].filter((field) => field.value),
  };
}

export { STATUS_LABELS };
