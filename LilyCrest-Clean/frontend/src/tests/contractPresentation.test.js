/* global test */
import {
  buildContractSummary,
  contractStatusLabel,
  hasAuthorizedContractPdf,
} from '../utils/contractPresentation';

describe('controlled contract presentation', () => {
  test.each([
    ['moveIn', 'Active Contract'],
    ['active', 'Active Contract'],
    ['approved', 'Approved'],
    ['pending', 'Pending Contract'],
    ['expired', 'Expired'],
    ['renewal_pending', 'Renewal Pending'],
    ['terminated', 'Terminated'],
    ['cancelled', 'Cancelled'],
    ['INTERNAL_WORKFLOW_CODE', 'Status unavailable'],
  ])('%s maps to a tenant-safe label', (value, expected) => {
    expect(contractStatusLabel(value)).toBe(expected);
  });

  test('summary omits missing values and groups incomplete metadata', () => {
    const summary = buildContractSummary({
      status: 'moveIn',
      startDate: '2026-07-20',
      endDate: '2027-01-20',
      fileAvailable: false,
    }, {});
    expect(summary.status).toBe('Active Contract');
    expect(summary.fields).toHaveLength(1);
    expect(summary.fields[0].key).toBe('period');
    expect(summary.hasMissingDetails).toBe(true);
    expect(summary.canOpenPdf).toBe(false);
  });

  test('PDF availability requires approved status, server availability, and a document ID', () => {
    expect(hasAuthorizedContractPdf({ status: 'moveIn', fileAvailable: true, documentId: 'contract-1' })).toBe(true);
    expect(hasAuthorizedContractPdf({ status: 'moveIn', fileAvailable: false, documentId: 'contract-1' })).toBe(false);
    expect(hasAuthorizedContractPdf({ status: 'pending', fileAvailable: true, documentId: 'contract-1' })).toBe(false);
    expect(hasAuthorizedContractPdf({ status: 'approved', fileAvailable: true })).toBe(false);
  });
});
