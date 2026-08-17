// Presents the Contract shape returned by GET /api/m/contracts/current, which
// mirrors server/services/tenantContractViewService.js's toTenantContractView
// on the Web (Capstone-Website) backend — the same authoritative Contract
// record the Web admin manages, not a local guess.
//
// contract.tenantDocument is that backend's canonical document-selection
// resolver output (server/services/tenantContractDocumentResolver.js — "Both
// Web and Mobile consume this single source of truth for document
// selection"). Capstone-Website's own tenant contract page
// (web/src/features/tenant/utils/tenantContractUi.mjs) selects its displayed
// document by tenantDocument.type, not by independently comparing
// preparedDocument/finalDocument availability — this file must do the same
// so mobile and web can never disagree about which document is current for
// the same tenant. preparedDocument/finalDocument are consulted only as a
// fallback for a response that omits tenantDocument entirely.

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

// Selects the single document the tenant should see right now. Reads the
// backend's own resolved answer (contract.tenantDocument) instead of
// re-deriving a "final overrides prepared" priority from the
// preparedDocument/finalDocument availability flags — those two flags use a
// different (stricter) final-availability test than the resolver does, so
// re-deriving locally can disagree with what tenantDocument — and therefore
// Web — actually shows for the same contract. Normalized to the same
// document field names (currentVersion/generatedAt/publishedAt) that the
// legacy fallback below produces, so downstream code needs no branching.
export function preferredContractDocument(contract) {
  const tenantDoc = contract?.tenantDocument;
  if (tenantDoc) {
    if (!tenantDoc.available) return null;
    return {
      variant: tenantDoc.isFinal || tenantDoc.type === 'final_notarized' ? 'final' : 'prepared',
      document: {
        currentVersion: tenantDoc.version,
        generatedAt: tenantDoc.generatedAt,
        publishedAt: tenantDoc.publishedAt,
        fileName: tenantDoc.fileName,
        fileSize: tenantDoc.fileSize,
        viewUrl: tenantDoc.viewUrl,
        downloadUrl: tenantDoc.downloadUrl,
      },
    };
  }
  // Legacy fallback for a response that omits tenantDocument entirely (older
  // deployment). Never blended with tenantDocument fields above — a response
  // that has tenantDocument always uses it exclusively.
  if (hasFinalContractPdf(contract)) return { variant: 'final', document: contract.finalDocument };
  if (hasPreparedContractPdf(contract)) return { variant: 'prepared', document: contract.preparedDocument };
  return null;
}

// Tenant-facing lifecycle derived from preferredContractDocument() above.
// Never inspects signedDocuments[] or contract.status directly, so a
// signed-but-not-yet-final intermediate copy can never surface as a third
// tenant-visible stage.
export function contractLifecycleState(contract) {
  const preferred = preferredContractDocument(contract);
  if (preferred?.variant === 'final') return 'final';
  if (preferred?.variant === 'prepared') return 'draft';
  return 'preparing';
}

const LIFECYCLE_LABELS = Object.freeze({
  final: 'Final Notarized Contract',
  draft: 'Generated Draft — For Signing',
  preparing: 'Preparing Contract',
});

const LIFECYCLE_MESSAGES = Object.freeze({
  final: 'This is the final notarized copy of your current contract.',
  draft: 'Your generated contract is ready for review and in-person signing. The final notarized copy will replace this document once uploaded by the admin.',
  preparing: 'Your contract is being prepared.',
});

// The generic bucket message above ("preparing") is the same for every
// pre-document status Capstone-Website has (draft/incomplete/ready_for_generation)
// — it doesn't name what's actually happening, which reads as indistinguishable
// from a broken app. contract.displayStatus (server/services/tenantContractViewService.js's
// STATUS_LABELS on Capstone-Website) is the canonical, more specific status
// text for the exact same lifecycle — reusing it here instead of writing new
// copy means this can never drift from what Web already tells the tenant for
// the same contract. Falls back to the generic message if the field is absent
// (older deployment) so this never regresses to a blank message.
function preparingStatusMessage(contract) {
  const canonical = String(contract?.displayStatus || '').trim();
  const base = canonical || LIFECYCLE_MESSAGES.preparing;
  return `${base} You'll be notified as soon as it's ready.`;
}

// Cache identity for the local PDF store. Must change whenever the canonical
// document a tenant is entitled to changes shape or version, so a stale
// cached PDF is never shown for a newer prepared version or after final
// publication. Only fields the canonical response already provides
// (currentVersion, publishedAt) are used — nothing is invented.
function contractDocumentCacheKey(contract, preferred) {
  if (!preferred) return null;
  const version = preferred.variant === 'final'
    ? (preferred.document.publishedAt || 'final')
    : (preferred.document.currentVersion || preferred.document.generatedAt || 'v1');
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
  const lifecycleState = contractLifecycleState(contract);
  return {
    status: contractStatusLabel(contract),
    lifecycleState,
    lifecycleLabel: LIFECYCLE_LABELS[lifecycleState],
    message: lifecycleState === 'preparing' ? preparingStatusMessage(contract) : LIFECYCLE_MESSAGES[lifecycleState],
    fields: fields.filter((field) => field.value),
    hasMissingDetails: fields.some((field) => !field.value),
    canOpenPdf: Boolean(preferred),
    documentVariant: preferred?.variant || null,
    documentKind: preferred ? (preferred.variant === 'final' ? 'contract-final' : 'contract-prepared') : null,
    documentCacheKey: contractDocumentCacheKey(contract, preferred),
    documentInfo: preferred ? [
      { label: 'Document Version', value: preferred.document.currentVersion ? String(preferred.document.currentVersion) : null },
      {
        label: preferred.variant === 'final' ? 'Published Date' : 'Generated Date',
        value: formatContractDate(preferred.variant === 'final' ? preferred.document.publishedAt : preferred.document.generatedAt, locale),
      },
    ].filter((field) => field.value) : [],
  };
}
