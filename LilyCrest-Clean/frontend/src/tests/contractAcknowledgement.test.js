/* global test, __dirname */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { apiService } from '../services/api';
import { useContractAcknowledgement } from '../hooks/useContractAcknowledgement';
import { publishCanonicalNotification, resetCanonicalEventDedupeForTests } from '../services/canonicalEvents';

jest.mock('../services/api', () => ({
  apiService: {
    getContractAcknowledgement: jest.fn(),
    acknowledgeContract: jest.fn(),
  },
}));

const CONTRACT_ID = '507f1f77bcf86cd799439011';

describe('useContractAcknowledgement — backend is the sole authority', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetCanonicalEventDedupeForTests();
  });

  test('reads acknowledgement state from the backend', async () => {
    apiService.getContractAcknowledgement.mockResolvedValueOnce({
      data: { acknowledged: false, requiresAcknowledgement: true, documentVersion: 1 },
    });
    const { result } = renderHook(() => useContractAcknowledgement(CONTRACT_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.needsAcknowledgement).toBe(true);
    expect(result.current.isAcknowledged).toBe(false);
    expect(apiService.getContractAcknowledgement).toHaveBeenCalledWith(CONTRACT_ID);
  });

  test('acknowledge() POSTs then re-reads authoritative state', async () => {
    apiService.getContractAcknowledgement
      .mockResolvedValueOnce({ data: { acknowledged: false, requiresAcknowledgement: true, documentVersion: 1 } })
      .mockResolvedValueOnce({ data: { acknowledged: true, requiresAcknowledgement: false, documentVersion: 1, acknowledgedAt: '2026-08-27T00:00:00.000Z' } });
    apiService.acknowledgeContract.mockResolvedValueOnce({ data: { acknowledged: true, documentVersion: 1 } });

    const { result } = renderHook(() => useContractAcknowledgement(CONTRACT_ID));
    await waitFor(() => expect(result.current.needsAcknowledgement).toBe(true));

    await act(async () => { await result.current.acknowledge(); });

    expect(apiService.acknowledgeContract).toHaveBeenCalledWith(CONTRACT_ID);
    expect(result.current.isAcknowledged).toBe(true);
    expect(result.current.needsAcknowledgement).toBe(false);
  });

  test('re-acknowledgement after a replacement: an old acknowledgement does not suppress the new prompt', async () => {
    // v1 acknowledged, then a replacement creates v2 which requires ack again.
    apiService.getContractAcknowledgement
      .mockResolvedValueOnce({ data: { acknowledged: true, requiresAcknowledgement: false, documentVersion: 1 } })
      .mockResolvedValueOnce({ data: { acknowledged: false, requiresAcknowledgement: true, documentVersion: 2 } });

    const { result } = renderHook(() => useContractAcknowledgement(CONTRACT_ID));
    await waitFor(() => expect(result.current.isAcknowledged).toBe(true));

    act(() => publishCanonicalNotification({ type: 'contract_replaced', data: { type: 'contract_replaced', contract_id: CONTRACT_ID } }));

    await waitFor(() => expect(result.current.needsAcknowledgement).toBe(true));
    expect(result.current.isAcknowledged).toBe(false);
    expect(result.current.status.documentVersion).toBe(2);
  });

  test('a 409 on acknowledge re-reads instead of falsely showing "done"', async () => {
    apiService.getContractAcknowledgement
      .mockResolvedValueOnce({ data: { acknowledged: false, requiresAcknowledgement: true, documentVersion: 2 } })
      .mockResolvedValueOnce({ data: { acknowledged: false, requiresAcknowledgement: true, documentVersion: 3 } });
    apiService.acknowledgeContract.mockRejectedValueOnce({ response: { status: 409 } });

    const { result } = renderHook(() => useContractAcknowledgement(CONTRACT_ID));
    await waitFor(() => expect(result.current.needsAcknowledgement).toBe(true));

    await act(async () => { await result.current.acknowledge(); });

    expect(result.current.needsAcknowledgement).toBe(true);
    expect(result.current.status.documentVersion).toBe(3);
  });

  test('older payload with only `acknowledged` still prompts when false', async () => {
    apiService.getContractAcknowledgement.mockResolvedValueOnce({ data: { acknowledged: false } });
    const { result } = renderHook(() => useContractAcknowledgement(CONTRACT_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.needsAcknowledgement).toBe(true);
  });

  test('no contract id => no request, no status', async () => {
    const { result } = renderHook(() => useContractAcknowledgement(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBeNull();
    expect(apiService.getContractAcknowledgement).not.toHaveBeenCalled();
  });
});

// Guard: the Contract Viewer must never label acknowledgement as a signature.
test('contract-viewer acknowledgement copy never uses signature terminology', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'contract-viewer.jsx'), 'utf8');
  // Isolate the acknowledgement card region for the check.
  const start = src.indexOf('Document Acknowledgement');
  expect(start).toBeGreaterThan(-1);
  const region = src.slice(start, start + 1600);
  // The explicit "it is not a signature" disclaimers are allowed — they
  // reassure the tenant. What must never appear is copy that *labels* the
  // action as signing.
  const withoutDisclaimer = region.replace(/it is not a signature/gi, '');
  expect(/signed by (the )?tenant/i.test(withoutDisclaimer)).toBe(false);
  expect(/your signature/i.test(withoutDisclaimer)).toBe(false);
  expect(/e-signature/i.test(withoutDisclaimer)).toBe(false);
  expect(/\bsign (this|the) (contract|document)\b/i.test(withoutDisclaimer)).toBe(false);
  // And it does say "acknowledge".
  expect(/acknowledge/i.test(region)).toBe(true);
});

// Layout regression: the Document Acknowledgement card uses its own dedicated
// style (with marginTop 12 / marginBottom 28) so it is visually separated from
// the Current Document card above and the Renewal / support content below —
// not the shared `card` spacing.
test('contract-viewer acknowledgement card has its own dedicated spacing style', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'contract-viewer.jsx'), 'utf8');
  // The acknowledgement SurfaceCard is styled with acknowledgementCard, not card.
  expect(/title="Document Acknowledgement"/.test(src)).toBe(true);
  const ackRegion = src.slice(src.indexOf('acknowledgement.status ?'), src.indexOf('acknowledgement.status ?') + 200);
  expect(/style=\{styles\.acknowledgementCard\}/.test(ackRegion)).toBe(true);
  expect(/acknowledgementCard:\s*\{[^}]*marginTop:\s*12[^}]*marginBottom:\s*28/.test(src)).toBe(true);
});

// Removal regression: the collapsible "Document Information" block was removed
// from the Contract Viewer (its content duplicated the PDF one tap away).
test('contract-viewer no longer renders a "Document Information" block', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'contract-viewer.jsx'), 'utf8');
  expect(src.includes('Document Information')).toBe(false);
  expect(src.includes('showDocumentInfo')).toBe(false);
  expect(/summary\.documentInfo/.test(src)).toBe(false);
  // The "Lease & Payment Details" collapsible (a different section) stays.
  expect(src.includes('Lease &amp; Payment Details')).toBe(true);
});
