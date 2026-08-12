/* global test */
import {
  buildContractSummary,
  contractStatusLabel,
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
      displayStatus: 'Final Signed and Notarized Contract Available',
      preparedDocument: { available: true, currentVersion: 2, generatedAt: '2026-06-01' },
      finalDocument: { available: true, publishedAt: '2026-07-01' },
    });
    expect(summary.canOpenPdf).toBe(true);
    expect(summary.documentVariant).toBe('final');
  });

  test('a draft Contract still renders a visible summary — draft is not "no contract"', () => {
    const summary = buildContractSummary({
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
