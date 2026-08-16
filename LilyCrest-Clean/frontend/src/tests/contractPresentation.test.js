/* global test */
import {
  buildContractSummary,
  contractStatusLabel,
  currentContractFromResponse,
  hasAuthorizedContractPdf,
  hasFinalContractPdf,
  hasPreparedContractPdf,
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
      preparedDocument: { available: false },
      finalDocument: { available: false },
    });
    expect(summary.status).toBe('Prepared Contract Available');
    expect(summary.fields).toHaveLength(1);
    expect(summary.fields[0].key).toBe('period');
    expect(summary.hasMissingDetails).toBe(true);
    expect(summary.canOpenPdf).toBe(false);
  });

  test('PDF availability is driven entirely by the server-reported document flags', () => {
    expect(hasPreparedContractPdf({ preparedDocument: { available: true } })).toBe(true);
    expect(hasPreparedContractPdf({ preparedDocument: { available: false } })).toBe(false);
    expect(hasFinalContractPdf({ finalDocument: { available: true } })).toBe(true);
    expect(hasAuthorizedContractPdf({ preparedDocument: { available: false }, finalDocument: { available: true } })).toBe(true);
    expect(hasAuthorizedContractPdf({ preparedDocument: { available: false }, finalDocument: { available: false } })).toBe(false);
  });

  test('summary prefers the final document over the prepared one once both exist', () => {
    const summary = buildContractSummary({
      id: '507f1f77bcf86cd799439011',
      displayStatus: 'Final Signed and Notarized Contract Available',
      preparedDocument: { available: true, currentVersion: 2, generatedAt: '2026-06-01' },
      finalDocument: { available: true, publishedAt: '2026-07-01' },
    });
    expect(summary.canOpenPdf).toBe(true);
    expect(summary.documentVariant).toBe('final');
  });

  test('a draft Contract still renders a visible summary — draft is not "no contract"', () => {
    const summary = buildContractSummary({
      id: '507f1f77bcf86cd799439011',
      status: 'draft',
      displayStatus: 'Contract is being prepared.',
      preparedDocument: { available: false },
      finalDocument: { available: false },
    });
    expect(summary).not.toBeNull();
    expect(summary.status).toBe('Contract is being prepared.');
    expect(summary.canOpenPdf).toBe(false);
  });

  test('a draft Contract with a prepared PDF already generated can be opened', () => {
    const summary = buildContractSummary({
      id: '507f1f77bcf86cd799439011',
      status: 'draft',
      displayStatus: 'Prepared Contract Available',
      preparedDocument: { available: true, currentVersion: 1, generatedAt: '2026-08-01' },
      finalDocument: { available: false },
    });
    expect(summary.canOpenPdf).toBe(true);
    expect(summary.documentVariant).toBe('prepared');
  });

  test('missing final document never fabricates final availability from status alone', () => {
    const signedContract = {
      id: '507f1f77bcf86cd799439011',
      status: 'signed',
      displayStatus: 'Physical signing and in-person notarization are in progress.',
      preparedDocument: { available: true, currentVersion: 1 },
      finalDocument: { available: false },
    };
    expect(hasFinalContractPdf(signedContract)).toBe(false);
    const summary = buildContractSummary(signedContract);
    expect(summary.documentVariant).toBe('prepared');
    expect(summary.canOpenPdf).toBe(true);
  });

  test('normalizes a top-level canonical tenantDocument without inventing lifecycle rules', () => {
    const tenantDocument = {
      available: true,
      type: 'generated_draft',
      label: 'Generated Draft — For Signing',
      isFinal: false,
      version: 3,
      generatedAt: '2026-08-16T08:00:00.000Z',
    };
    const contract = currentContractFromResponse({
      contract: { id: '507f1f77bcf86cd799439011', status: 'awaiting_signatures' },
      tenantDocument,
    });

    expect(contract.tenantDocument).toBe(tenantDocument);
    expect(buildContractSummary(contract)).toEqual(expect.objectContaining({
      status: 'Generated Draft — For Signing',
      lifecycleState: 'draft',
      canOpenPdf: true,
      documentKind: 'contract-current',
      documentCacheKey: '507f1f77bcf86cd799439011:prepared:3',
    }));
  });

  test('canonical final document replaces the draft without consulting legacy flags', () => {
    const summary = buildContractSummary({
      id: '507f1f77bcf86cd799439011',
      tenantDocument: {
        available: true,
        type: 'final_notarized',
        label: 'Final Notarized Contract',
        isFinal: true,
        publishedAt: '2026-08-16T09:00:00.000Z',
      },
      preparedDocument: { available: true, currentVersion: 9 },
      finalDocument: { available: false },
    });

    expect(summary).toEqual(expect.objectContaining({
      status: 'Final Notarized Contract',
      lifecycleState: 'final',
      documentVariant: 'final',
      documentKind: 'contract-current',
    }));
    expect(summary.documentCacheKey).toContain(':final:');
  });

  test('canonical preparing state does not fall back to an internal signed document or legacy PDF', () => {
    const summary = buildContractSummary({
      id: '507f1f77bcf86cd799439011',
      tenantDocument: { available: false, type: null, label: null, isFinal: false },
      preparedDocument: { available: true },
      signedDocument: { available: true },
    });

    expect(summary.status).toBe('Preparing Contract');
    expect(summary.lifecycleState).toBe('preparing');
    expect(summary.canOpenPdf).toBe(false);
    expect(summary.documentKind).toBeNull();
  });

  test('regenerated legacy prepared documents get a new cache key', () => {
    const versionOne = buildContractSummary({
      id: '507f1f77bcf86cd799439011',
      preparedDocument: { available: true, currentVersion: 1 },
      finalDocument: { available: false },
    });
    const versionTwo = buildContractSummary({
      id: '507f1f77bcf86cd799439011',
      preparedDocument: { available: true, currentVersion: 2 },
      finalDocument: { available: false },
    });

    expect(versionOne.documentCacheKey).not.toBe(versionTwo.documentCacheKey);
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
