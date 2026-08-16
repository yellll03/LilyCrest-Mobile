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
  if (hasCanonicalTenantDocument(contract)) {
    const document = contract.tenantDocument;
    if (!document?.available) return document?.label || 'Preparing Contract';
    if (document.label) return document.label;
    if (document.type === 'generated_draft') return 'Generated Draft — For Signing';
    if (document.type === 'final_notarized') return 'Final Notarized Contract';
    return 'Contract Document Unavailable';
  }
  return contract?.displayStatus || 'Contract Status Unavailable';
}

function hasCanonicalTenantDocument(contract) {
  return Boolean(contract) && Object.prototype.hasOwnProperty.call(contract, 'tenantDocument');
}

// The canonical API may return tenantDocument beside contract (the preferred
// response shape) or nested inside it. Keep that transport detail out of every
// screen without deriving any document lifecycle state in the client.
export function currentContractFromResponse(payload) {
  const contract = payload?.contract;
  if (!contract) return null;
  if (hasCanonicalTenantDocument(contract)) return contract;
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'tenantDocument')) {
    return { ...contract, tenantDocument: payload.tenantDocument };
  }
  return contract;
}

export function hasPreparedContractPdf(contract) {
  if (hasCanonicalTenantDocument(contract)) {
    return Boolean(contract.tenantDocument?.available && contract.tenantDocument?.type === 'generated_draft');
  }
  return Boolean(contract?.preparedDocument?.available);
}

export function hasFinalContractPdf(contract) {
  if (hasCanonicalTenantDocument(contract)) {
    return Boolean(contract.tenantDocument?.available && contract.tenantDocument?.type === 'final_notarized');
  }
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
  if (hasCanonicalTenantDocument(contract)) {
    const document = contract.tenantDocument;
    if (!document?.available) return null;
    if (document.type === 'final_notarized') return { variant: 'final', source: 'canonical', document };
    if (document.type === 'generated_draft') return { variant: 'prepared', source: 'canonical', document };
    return null;
  }

  // Compatibility with the currently deployed canonical response. Once the
  // upstream supplies tenantDocument, the branch above is authoritative and
  // these legacy flags are no longer consulted.
  if (hasFinalContractPdf(contract)) return { variant: 'final', source: 'legacy', document: contract.finalDocument };
  if (hasPreparedContractPdf(contract)) return { variant: 'prepared', source: 'legacy', document: contract.preparedDocument };
  return null;
}

function contractDocumentCacheKey(contract, preferred) {
  if (!preferred) return null;
  const document = preferred.document || {};
  const version = document.version
    || document.currentVersion
    || document.publishedAt
    || document.generatedAt
    || 'current';
  return `${contract?.id || 'current'}:${preferred.variant}:${version}`;
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
  const lifecycleState = preferred?.variant === 'final'
    ? 'final'
    : preferred?.variant === 'prepared'
      ? 'draft'
      : 'preparing';
  return {
    status: contractStatusLabel(contract),
    lifecycleState,
    message: lifecycleState === 'final'
      ? 'This is the final notarized copy of your current contract.'
      : lifecycleState === 'draft'
        ? 'Your generated contract is ready for review and in-person signing. The final notarized copy will replace this document once uploaded by the admin.'
        : 'Your contract is being prepared.',
    fields: fields.filter((field) => field.value),
    hasMissingDetails: fields.some((field) => !field.value),
    canOpenPdf: Boolean(preferred && (preferred.source === 'canonical' || contract.id)),
    documentVariant: preferred?.variant || null,
    documentKind: preferred
      ? (preferred.source === 'canonical'
        ? 'contract-current'
        : preferred.variant === 'final' ? 'contract-final' : 'contract-prepared')
      : null,
    documentCacheKey: contractDocumentCacheKey(contract, preferred),
    documentTitle: preferred
      ? (preferred.document?.label
        || (preferred.variant === 'final' ? 'Final Notarized Contract' : 'Generated Draft — For Signing'))
      : null,
    documentInfo: preferred ? [
      { label: 'Document Version', value: (preferred.document.version || preferred.document.currentVersion) ? String(preferred.document.version || preferred.document.currentVersion) : null },
      {
        label: preferred.variant === 'final' ? 'Published Date' : 'Generated Date',
        value: formatContractDate(preferred.variant === 'final' ? preferred.document.publishedAt : preferred.document.generatedAt, locale),
      },
    ].filter((field) => field.value) : [],
  };
}
