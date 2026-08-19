/* global test */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { apiService } from '../services/api';
import { useTenantContract } from '../hooks/useTenantContract';
import { buildContractSummary } from '../utils/contractPresentation';
import { publishCanonicalNotification, resetCanonicalEventDedupeForTests } from '../services/canonicalEvents';

// The canonical API (GET /api/m/contracts/current on Capstone-Website) does
// include contract.tenantDocument — the backend's own resolved answer to
// "which document should the tenant see right now" (see
// contractPresentation.js's preferredContractDocument(), which reads it as
// the primary source of truth). This hook itself does no document-selection
// logic — it only fetches and passes the raw contract object through — so
// these fixtures deliberately use the older preparedDocument/finalDocument
// shape to keep this file's tests focused on refresh/race/stale/auth-clearing
// behavior, which is agnostic to which document-shape variant is fetched.
// See "full pipeline" below for a fixture that includes tenantDocument and
// proves the shape survives this hook unmodified into the presentation layer.

const mockAppStateListeners = new Set();

jest.mock('expo-router', () => ({
  useFocusEffect: (effect) => {
    const React = require('react');
    React.useEffect(() => effect(), [effect]);
  },
}));

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((_event, listener) => {
      mockAppStateListeners.add(listener);
      return { remove: () => mockAppStateListeners.delete(listener) };
    }),
  },
}));

jest.mock('../services/api', () => ({
  apiService: { getCurrentContract: jest.fn() },
}));

function draftResponse() {
  return {
    data: {
      contract: {
        id: '507f1f77bcf86cd799439011',
        status: 'generated',
        preparedDocument: { available: true, currentVersion: 1, generatedAt: '2026-08-01' },
        finalDocument: { available: false },
      },
      state: 'CONTRACT_AVAILABLE',
    },
  };
}

function finalResponse() {
  return {
    data: {
      contract: {
        id: '507f1f77bcf86cd799439011',
        status: 'active',
        preparedDocument: { available: true, currentVersion: 1, generatedAt: '2026-08-01' },
        finalDocument: { available: true, publishedAt: '2026-08-10' },
      },
      state: 'CONTRACT_AVAILABLE',
    },
  };
}

function emitAppState(nextState) {
  mockAppStateListeners.forEach((listener) => listener(nextState));
}

describe('useTenantContract refresh/error lifecycle against the real canonical response', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppStateListeners.clear();
    resetCanonicalEventDedupeForTests();
  });

  test('loads the canonical preparedDocument/finalDocument shape on initial focus', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce(draftResponse());
    const { result } = renderHook(() => useTenantContract());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contract.preparedDocument.available).toBe(true);
    expect(result.current.contract.finalDocument.available).toBe(false);
    expect(result.current.state).toBe('CONTRACT_AVAILABLE');
  });

  test('no current contract uses the canonical NO_PUBLISHED_CONTRACT state verbatim', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce({ data: { contract: null, state: 'NO_PUBLISHED_CONTRACT' } });
    const { result } = renderHook(() => useTenantContract());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contract).toBeNull();
    expect(result.current.state).toBe('NO_PUBLISHED_CONTRACT');
  });

  test('re-fetches when the app returns to the foreground so final replaces draft', async () => {
    apiService.getCurrentContract
      .mockResolvedValueOnce(draftResponse())
      .mockResolvedValueOnce(finalResponse());
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.contract?.finalDocument.available).toBe(false));

    act(() => emitAppState('background'));
    act(() => emitAppState('active'));

    await waitFor(() => expect(result.current.contract?.finalDocument.available).toBe(true));
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(2);
  });

  test('contract_document_ready invalidates the open contract without logout or refocus', async () => {
    apiService.getCurrentContract
      .mockResolvedValueOnce(draftResponse())
      .mockResolvedValueOnce(finalResponse());
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.contract?.finalDocument.available).toBe(false));

    act(() => publishCanonicalNotification({
      type: 'contract_document_ready',
      data: { type: 'contract_document_ready', contract_id: '507f1f77bcf86cd799439011' },
    }));

    await waitFor(() => expect(result.current.contract?.finalDocument.available).toBe(true));
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(2);
  });

  test('pull-to-refresh sets refreshing without clearing the current presentation', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce(draftResponse());
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let refreshPromise;
    apiService.getCurrentContract.mockResolvedValueOnce(draftResponse());
    await act(async () => {
      refreshPromise = result.current.refresh();
      await refreshPromise;
    });

    expect(result.current.refreshing).toBe(false);
    expect(result.current.contract.preparedDocument.available).toBe(true);
  });

  test('a request that resolves after a newer one must not overwrite the newer result', async () => {
    let resolveFirst;
    apiService.getCurrentContract.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const { result } = renderHook(() => useTenantContract());

    apiService.getCurrentContract.mockResolvedValueOnce(finalResponse());
    await act(async () => { await result.current.reload(); });
    expect(result.current.contract.finalDocument.available).toBe(true);

    // The stale first request (started before the reload above) now resolves
    // with older draft-only data — it must be ignored.
    await act(async () => { resolveFirst(draftResponse()); });
    expect(result.current.contract.finalDocument.available).toBe(true);
  });

  test('transient network/upstream failure after a successful load preserves the last safe presentation', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce(draftResponse());
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.loading).toBe(false));

    apiService.getCurrentContract.mockRejectedValueOnce({ response: { status: 502 } });
    await act(async () => result.current.reload());

    expect(result.current.contract.preparedDocument.available).toBe(true);
    expect(result.current.state).toBe('STALE');
    expect(result.current.error).toBeTruthy();
  });

  test('HTTP 401 immediately clears previously displayed private contract data', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce(draftResponse());
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.loading).toBe(false));

    apiService.getCurrentContract.mockRejectedValueOnce({ response: { status: 401 } });
    await act(async () => result.current.reload());

    expect(result.current.contract).toBeNull();
    expect(result.current.state).toBe('ERROR');
    expect(result.current.error).toBe('Please sign in again to view your lease contract.');
  });

  test('HTTP 403 immediately clears previously displayed private contract data', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce(finalResponse());
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.loading).toBe(false));

    apiService.getCurrentContract.mockRejectedValueOnce({ response: { status: 403 } });
    await act(async () => result.current.reload());

    expect(result.current.contract).toBeNull();
    expect(result.current.state).toBe('ERROR');
  });
});

// Full-pipeline regression: a canonical API-shaped response (including
// tenantDocument, with the legacy preparedDocument/finalDocument flags
// deliberately disagreeing with it) flows through useTenantContract
// unmodified, and buildContractSummary() — the same function the contract
// viewer screen calls — resolves the canonical document, not the legacy
// flags. This exists to prevent a future regression where document-lifecycle
// derivation gets reintroduced into the hook or viewer layer instead of
// staying in preferredContractDocument()'s single resolution point.
describe('full pipeline: canonical API response -> useTenantContract -> buildContractSummary', () => {
  test('tenantDocument final resolves to the final document even though legacy flags say otherwise', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce({
      data: {
        contract: {
          id: '507f1f77bcf86cd799439099',
          status: 'signed',
          displayStatus: 'Physical signing and in-person notarization are in progress.',
          // Legacy flags disagree with tenantDocument on purpose: they say
          // "prepared only", while tenantDocument says "final" — the real
          // regression scenario the reconciliation fix was written for.
          preparedDocument: { available: true, currentVersion: 4 },
          finalDocument: { available: false },
          tenantDocument: {
            available: true,
            type: 'final_notarized',
            isFinal: true,
            version: 4,
            publishedAt: '2026-08-10',
          },
        },
        state: 'CONTRACT_AVAILABLE',
      },
    });

    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The hook must pass tenantDocument through unmodified.
    expect(result.current.contract.tenantDocument.type).toBe('final_notarized');

    // The presentation layer — what the viewer screen actually renders —
    // must resolve the canonical document, not the disagreeing legacy flags.
    const summary = buildContractSummary(result.current.contract);
    expect(summary.lifecycleState).toBe('final');
    expect(summary.documentVariant).toBe('final');
    expect(summary.canOpenPdf).toBe(true);
  });
});
