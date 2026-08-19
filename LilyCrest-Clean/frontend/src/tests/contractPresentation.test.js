/* global test */
import {
  buildContractSummary,
  contractLifecycleState,
  contractStatusLabel,
} from '../utils/contractPresentation';

// These fixtures mirror the shape returned by GET /api/m/contracts/current,
// which is server/services/tenantContractViewService.js's toTenantContractView
// on the Web backend — the single authoritative Contract record, not a local
// mobile-only guess.

describe('controlled contract presentation', () => {
  test.each([
    ['Final Signed and Notarized Contract Available'],
    ['Prepared Contract Available'],
    ['Contract is being prepared.'],
    [undefined],
  ])('renders the server-computed displayStatus verbatim (%s)', (displayStatus) => {
    expect(contractStatusLabel({ displayStatus })).toBe(displayStatus || 'Contract Status Unavailable');
  });

  test('returns null when no contract record exists', () => {
    expect(buildContractSummary(null)).toBeNull();
  });

  test('summary omits missing values and groups incomplete metadata', () => {
    const summary = buildContractSummary({
      displayStatus: 'Prepared Contract Available',
      leaseStartDate: '2026-07-20',
      leaseEndDate: '2027-01-20',
      tenantDocument: { available: false, type: null },
    });
    expect(summary.status).toBe('Prepared Contract Available');
    expect(summary.fields).toHaveLength(1);
    expect(summary.fields[0].key).toBe('period');
    expect(summary.hasMissingDetails).toBe(true);
    expect(summary.canOpenPdf).toBe(false);
  });

  test('PDF availability is driven entirely by the canonical tenantDocument resolver output', () => {
    expect(buildContractSummary({ tenantDocument: { available: true, type: 'generated_draft', version: 1 } }).canOpenPdf).toBe(true);
    expect(buildContractSummary({ tenantDocument: { available: true, type: 'final_notarized', version: 1 } }).canOpenPdf).toBe(true);
    expect(buildContractSummary({ tenantDocument: { available: false, type: null } }).canOpenPdf).toBe(false);
    expect(buildContractSummary({ tenantDocument: { available: true, type: 'unknown' } }).canOpenPdf).toBe(false);
  });

  test('summary prefers the final document over the prepared one once both exist', () => {
    const summary = buildContractSummary({
      displayStatus: 'Final Signed and Notarized Contract Available',
      tenantDocument: { available: true, type: 'final_notarized', isFinal: true, version: 2, publishedAt: '2026-07-01' },
    });
    expect(summary.canOpenPdf).toBe(true);
    expect(summary.documentVariant).toBe('final');
  });

  test('a draft Contract still renders a visible summary — draft is not "no contract"', () => {
    const summary = buildContractSummary({
      status: 'draft',
      displayStatus: 'Contract is being prepared.',
      tenantDocument: { available: false, type: null },
    });
    expect(summary).not.toBeNull();
    expect(summary.status).toBe('Contract is being prepared.');
    expect(summary.canOpenPdf).toBe(false);
  });

  test('a draft Contract with a prepared PDF already generated can be opened', () => {
    const summary = buildContractSummary({
      status: 'draft',
      displayStatus: 'Prepared Contract Available',
      tenantDocument: { available: true, type: 'generated_draft', version: 1, generatedAt: '2026-08-01' },
    });
    expect(summary.canOpenPdf).toBe(true);
    expect(summary.documentVariant).toBe('prepared');
  });

  test('missing final document never fabricates final availability from status alone', () => {
    const signedContract = {
      status: 'signed',
      displayStatus: 'Physical signing and in-person notarization are in progress.',
      tenantDocument: { available: true, type: 'generated_draft', version: 1 },
    };
    const summary = buildContractSummary(signedContract);
    expect(summary.documentVariant).toBe('prepared');
    expect(summary.canOpenPdf).toBe(true);
  });

  test('contract summary displays the server-computed pricing snapshot', () => {
    const summary = buildContractSummary({
      displayStatus: 'Prepared Contract Available',
      approvedMonthlyRate: 7200,
      advanceRentAmount: 7200,
      securityDepositAmount: 7200,
      reservationFeeAmount: 2000,
    });
    expect(summary.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'monthlyRate', value: '₱7,200.00' }),
      expect.objectContaining({ key: 'advanceRent', value: '₱7,200.00' }),
      expect.objectContaining({ key: 'securityDeposit', value: '₱7,200.00' }),
      expect.objectContaining({ key: 'reservationFee', value: '₱2,000.00' }),
    ]));
  });
});

// The real canonical API (Capstone-Website) returns contract.tenantDocument
// — server/services/tenantContractDocumentResolver.js's resolved answer to
// "which document should the tenant see right now", the same field its own
// Web tenant page reads (web/src/features/tenant/utils/tenantContractUi.mjs).
// These tests lock mobile's presentation rule to that field so mobile can
// never disagree with Web about which document is current for the same
// contract. Mobile does not reconstruct document priority from legacy fields.
describe('canonical tenantDocument-driven presentation rule', () => {
  test('tenantDocument final selects final regardless of prepared availability', () => {
    const contract = {
      preparedDocument: { available: true, currentVersion: 3 },
      finalDocument: { available: true, publishedAt: '2026-08-01' },
      tenantDocument: { available: true, type: 'final_notarized', isFinal: true, version: 3, publishedAt: '2026-08-01' },
    };
    expect(contractLifecycleState(contract)).toBe('final');
  });

  test('tenantDocument draft selects prepared even if it disagrees with the legacy final flag', () => {
    // Regression: tenantDocument's own final-availability check is looser
    // than finalDocument.available (no status/tenantVisible/notarization
    // gate) — the two CAN disagree. Mobile must follow tenantDocument, the
    // same field Web follows, not re-derive its own answer from the flags.
    const contract = {
      preparedDocument: { available: true, currentVersion: 1 },
      finalDocument: { available: true, publishedAt: '2026-08-01' },
      tenantDocument: { available: true, type: 'generated_draft', isFinal: false, version: 1 },
    };
    expect(contractLifecycleState(contract)).toBe('draft');
  });

  test('tenantDocument unavailable resolves to preparing even with legacy flags present', () => {
    const contract = {
      preparedDocument: { available: true, currentVersion: 1 },
      finalDocument: { available: false },
      tenantDocument: { available: false, type: null },
    };
    expect(contractLifecycleState(contract)).toBe('preparing');
  });

  test('does not fall back to obsolete preparedDocument/finalDocument flags', () => {
    const contract = {
      preparedDocument: { available: true, currentVersion: 1 },
      finalDocument: { available: true, publishedAt: '2026-08-01' },
    };
    expect(contractLifecycleState(contract)).toBe('preparing');
  });

  test('neither tenantDocument nor legacy flags available resolves to preparing', () => {
    const contract = {
      preparedDocument: { available: false },
      finalDocument: { available: false },
    };
    expect(contractLifecycleState(contract)).toBe('preparing');
  });

  test('signedDocuments[] present in the response never affects selection', () => {
    const withSigned = {
      tenantDocument: { available: true, type: 'generated_draft', isFinal: false, version: 1 },
      signedDocuments: [{ version: 1, fileName: 'signed.pdf', viewUrl: '/x' }],
    };
    const withoutSigned = {
      tenantDocument: { available: true, type: 'generated_draft', isFinal: false, version: 1 },
    };
    expect(contractLifecycleState(withSigned)).toBe(contractLifecycleState(withoutSigned));
    expect(contractLifecycleState(withSigned)).toBe('draft');
  });

  test('unrelated contradictory fields (e.g. status still "signed") do not override tenantDocument', () => {
    const contract = {
      status: 'signed',
      displayStatus: 'Physical signing and in-person notarization are in progress.',
      tenantDocument: { available: true, type: 'final_notarized', isFinal: true, version: 1, publishedAt: '2026-08-01' },
    };
    expect(contractLifecycleState(contract)).toBe('final');
  });

  test('lifecycle label and message reflect the resolved state, not raw contract.status', () => {
    const finalSummary = buildContractSummary({
      tenantDocument: { available: true, type: 'final_notarized', isFinal: true, version: 1, publishedAt: '2026-08-01' },
    });
    expect(finalSummary.lifecycleLabel).toBe('Final Notarized Contract');

    const draftSummary = buildContractSummary({
      tenantDocument: { available: true, type: 'generated_draft', isFinal: false, version: 1 },
    });
    expect(draftSummary.lifecycleLabel).toBe('Generated Draft — For Signing');

    const preparingSummary = buildContractSummary({
      tenantDocument: { available: false, type: null },
    });
    expect(preparingSummary.lifecycleLabel).toBe('Preparing Contract');
  });

  test('preparing keeps canonical status separate from the next-action message', () => {
    const awaitingSignature = buildContractSummary({
      displayStatus: 'Physical signing and in-person notarization are in progress.',
      tenantDocument: { available: false, type: null },
    });
    expect(awaitingSignature.status).toBe('Physical signing and in-person notarization are in progress.');
    expect(awaitingSignature.lifecycleBadgeLabel).toBe('Preparing');
    expect(awaitingSignature.message).toBe("You'll be notified when the current document is ready.");
  });

  test('preparing message falls back to the generic copy when displayStatus is absent (older deployment)', () => {
    const noDisplayStatus = buildContractSummary({
      tenantDocument: { available: false, type: null },
    });
    expect(noDisplayStatus.message).toBe("You'll be notified when the current document is ready.");
  });

  test('draft and final messages are unaffected by displayStatus (only the preparing bucket is enriched)', () => {
    const draft = buildContractSummary({
      displayStatus: 'Prepared Contract Available',
      tenantDocument: { available: true, type: 'generated_draft', version: 1, generatedAt: '2026-08-01' },
    });
    expect(draft.message).toBe('Review the prepared contract below. The final notarized copy will appear when it is published.');
    expect(draft.documentActionLabel).toBe('View Draft Contract');
  });
});

describe('version-aware document cache key', () => {
  test('regenerating a prepared document changes the cache key', () => {
    const v1 = buildContractSummary({
      id: 'contract-1',
      tenantDocument: { available: true, type: 'generated_draft', isFinal: false, version: 1 },
    });
    const v2 = buildContractSummary({
      id: 'contract-1',
      tenantDocument: { available: true, type: 'generated_draft', isFinal: false, version: 2 },
    });
    expect(v1.documentCacheKey).not.toBe(v2.documentCacheKey);
  });

  test('final replacing a draft changes the cache key even on the same contract id', () => {
    const draft = buildContractSummary({
      id: 'contract-1',
      tenantDocument: { available: true, type: 'generated_draft', isFinal: false, version: 3 },
    });
    const final = buildContractSummary({
      id: 'contract-1',
      tenantDocument: { available: true, type: 'final_notarized', isFinal: true, version: 3, publishedAt: '2026-08-01' },
    });
    expect(draft.documentCacheKey).not.toBe(final.documentCacheKey);
    expect(draft.documentKind).toBe('contract-prepared');
    expect(final.documentKind).toBe('contract-final');
    expect(draft.documentActionLabel).toBe('View Draft Contract');
    expect(final.documentActionLabel).toBe('View Final Contract');
  });

  test('an unchanged prepared version keeps a stable cache key', () => {
    const first = buildContractSummary({
      id: 'contract-1',
      tenantDocument: { available: true, type: 'generated_draft', isFinal: false, version: 1 },
    });
    const second = buildContractSummary({
      id: 'contract-1',
      tenantDocument: { available: true, type: 'generated_draft', isFinal: false, version: 1 },
    });
    expect(first.documentCacheKey).toBe(second.documentCacheKey);
  });
});
