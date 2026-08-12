// Presents the Contract shape returned by GET /api/m/contracts/current, which
// mirrors server/services/tenantContractViewService.js's toTenantContractView
// on the Web (Capstone-Website) backend — the same authoritative Contract
// record the Web admin manages, not a local guess.

const BRANCH_LABELS = Object.freeze({
  'gil-puyat': 'Gil Puyat',
  guadalupe: 'Guadalupe',
});

function branchLabel(value) {
  const key = String(value || '').trim().toLowerCase();
  return BRANCH_LABELS[key] || (key ? key.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null);
}

export function contractStatusLabel(contract) {
  return contract?.displayStatus || 'Contract Status Unavailable';
}

export function hasPreparedContractPdf(contract) {
  return Boolean(contract?.preparedDocument?.available);
}

export function hasFinalContractPdf(contract) {
  return Boolean(contract?.finalDocument?.available);
}

export function hasAuthorizedContractPdf(contract) {
  return hasPreparedContractPdf(contract) || hasFinalContractPdf(contract);
}

export function formatContractDate(value, locale) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function contractPeriod(contract, locale) {
  const start = formatContractDate(contract?.leaseStartDate, locale);
  const end = formatContractDate(contract?.leaseEndDate, locale);
  return start && end ? `${start} – ${end}` : null;
}

export function leaseTypeLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'long_term') return 'Long-Term Lease';
  if (normalized === 'short_term') return 'Short-Term Lease';
  return null;
}

function formatPeso(value, locale) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return `₱${amount.toLocaleString(locale || 'en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// The prepared document is a system-generated overlay of the current
// contract terms; the final document is the notarized scan and, once
// published, supersedes it in relevance for the tenant (both stay linked to
// the same Contract record — see hasFinalContractPdf/hasPreparedContractPdf).
export function preferredContractDocument(contract) {
  if (hasFinalContractPdf(contract)) return { variant: 'final', document: contract.finalDocument };
  if (hasPreparedContractPdf(contract)) return { variant: 'prepared', document: contract.preparedDocument };
  return null;
}

export function buildContractSummary(contract, locale) {
  if (!contract) return null;
  const room = String(contract.roomNumber || '').trim();
  const fields = [
    { key: 'period', label: 'Contract Period', value: contractPeriod(contract, locale) },
    { key: 'room', label: 'Room Assignment', value: room ? `Room ${room}${contract.bedLabel ? ` (${contract.bedLabel})` : ''}` : null },
    { key: 'branch', label: 'Branch', value: branchLabel(contract.branch) },
    { key: 'leaseType', label: 'Lease Type', value: leaseTypeLabel(contract.leaseType) },
    { key: 'monthlyRate', label: 'Monthly Rate', value: formatPeso(contract.approvedMonthlyRate, locale) },
    { key: 'advanceRent', label: 'One Month Advance Rent', value: formatPeso(contract.advanceRentAmount, locale) },
    { key: 'securityDeposit', label: 'Security Deposit', value: formatPeso(contract.securityDepositAmount, locale) },
    { key: 'reservationFee', label: 'Reservation Fee', value: formatPeso(contract.reservationFeeAmount, locale) },
  ];
  const preferred = preferredContractDocument(contract);
  return {
    status: contractStatusLabel(contract),
    fields: fields.filter((field) => field.value),
    hasMissingDetails: fields.some((field) => !field.value),
    canOpenPdf: Boolean(preferred),
    documentVariant: preferred?.variant || null,
    documentInfo: preferred ? [
      { label: 'Document Version', value: preferred.document.currentVersion ? String(preferred.document.currentVersion) : null },
      {
        label: preferred.variant === 'final' ? 'Published Date' : 'Generated Date',
        value: formatContractDate(preferred.variant === 'final' ? preferred.document.publishedAt : preferred.document.generatedAt, locale),
      },
    ].filter((field) => field.value) : [],
  };
}
