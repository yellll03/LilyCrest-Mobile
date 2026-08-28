/* global test */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { apiService } from '../services/api';
import {
  useTenantContract,
  shouldPollFor,
  pollIntervalFor,
  SMART_POLL_INTERVAL_MS,
  FINAL_REVALIDATE_INTERVAL_MS,
} from '../hooks/useTenantContract';
import { buildContractSummary } from '../utils/contractPresentation';
import { publishCanonicalNotification, resetCanonicalEventDedupeForTests } from '../services/canonicalEvents';

// The canonical API (GET /api/m/contracts/current on Capstone-Website) does
// include contract.tenantDocument — the backend's own resolved answer to
// "which document should the tenant see right now" (see
// contractPresentation.js's preferredContractDocument(), which reads it as
// the only source of truth). This hook does no document-selection logic; it
// fetches and passes the canonical contract object through.

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
        tenantDocument: { available: true, type: 'generated_draft', isFinal: false, version: 1, generatedAt: '2026-08-01' },
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
        tenantDocument: { available: true, type: 'final_notarized', isFinal: true, version: 1, publishedAt: '2026-08-10' },
      },
      state: 'CONTRACT_AVAILABLE',
    },
  };
}

// A contract that exists but whose document is still being prepared — no
// draft PDF and no final yet. contractLifecycleState() resolves this to
// 'preparing'.
function preparingResponse() {
  return {
    data: {
      contract: {
        id: '507f1f77bcf86cd799439011',
        status: 'reservation_approved',
        tenantDocument: { available: false, type: null },
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

  test('loads the canonical tenantDocument shape on initial focus', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce(draftResponse());
    const { result } = renderHook(() => useTenantContract());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contract.tenantDocument.type).toBe('generated_draft');
    expect(result.current.contract.tenantDocument.available).toBe(true);
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
    await waitFor(() => expect(result.current.contract?.tenantDocument.type).toBe('generated_draft'));

    act(() => emitAppState('background'));
    act(() => emitAppState('active'));

    await waitFor(() => expect(result.current.contract?.tenantDocument.type).toBe('final_notarized'));
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(2);
  });

  test('contract_document_ready invalidates the open contract without logout or refocus', async () => {
    apiService.getCurrentContract
      .mockResolvedValueOnce(draftResponse())
      .mockResolvedValueOnce(finalResponse());
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.contract?.tenantDocument.type).toBe('generated_draft'));

    act(() => publishCanonicalNotification({
      type: 'contract_document_ready',
      data: { type: 'contract_document_ready', contract_id: '507f1f77bcf86cd799439011' },
    }));

    await waitFor(() => expect(result.current.contract?.tenantDocument.type).toBe('final_notarized'));
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
    expect(result.current.contract.tenantDocument.type).toBe('generated_draft');
  });

  test('a request that resolves after a newer one must not overwrite the newer result', async () => {
    let resolveFirst;
    apiService.getCurrentContract.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const { result } = renderHook(() => useTenantContract());

    apiService.getCurrentContract.mockResolvedValueOnce(finalResponse());
    await act(async () => { await result.current.reload(); });
    expect(result.current.contract.tenantDocument.type).toBe('final_notarized');

    // The stale first request (started before the reload above) now resolves
    // with older draft-only data — it must be ignored.
    await act(async () => { resolveFirst(draftResponse()); });
    expect(result.current.contract.tenantDocument.type).toBe('final_notarized');
  });

  test('transient network/upstream failure after a successful load preserves the last safe presentation', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce(draftResponse());
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.loading).toBe(false));

    apiService.getCurrentContract.mockRejectedValueOnce({ response: { status: 502 } });
    await act(async () => result.current.reload());

    expect(result.current.contract.tenantDocument.type).toBe('generated_draft');
    expect(result.current.state).toBe('STALE');
    expect(result.current.error).toBeTruthy();
  });

  test('after a 500-induced STALE, a later successful contract:null clears the stale contract immediately', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce(draftResponse());
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.loading).toBe(false));

    apiService.getCurrentContract.mockRejectedValueOnce({ response: { status: 500 } });
    await act(async () => result.current.reload());
    expect(result.current.state).toBe('STALE');
    expect(result.current.contract).not.toBeNull();

    apiService.getCurrentContract.mockResolvedValueOnce({ data: { contract: null, upcoming: null, state: 'NO_PUBLISHED_CONTRACT' } });
    await act(async () => result.current.reload());
    expect(result.current.contract).toBeNull();
    expect(result.current.state).toBe('NO_PUBLISHED_CONTRACT');
  });

  test('a 500 with no prior successful load is ERROR, not STALE', async () => {
    apiService.getCurrentContract.mockRejectedValueOnce({ response: { status: 500 } });
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contract).toBeNull();
    expect(result.current.state).toBe('ERROR');
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

  test('HTTP 409 MULTIPLE_CANONICAL_CONTRACTS surfaces a distinct blocking state instead of guessing a contract', async () => {
    apiService.getCurrentContract.mockRejectedValueOnce({ response: { status: 409, data: { code: 'MULTIPLE_CANONICAL_CONTRACTS' } } });
    const { result } = renderHook(() => useTenantContract());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contract).toBeNull();
    expect(result.current.state).toBe('MULTIPLE_CONTRACTS');
    expect(result.current.error).toMatch(/multiple active contract records/i);
  });

  test('HTTP 409 after a previously loaded contract still clears it rather than keeping a stale one visible', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce(draftResponse());
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.loading).toBe(false));

    apiService.getCurrentContract.mockRejectedValueOnce({ response: { status: 409 } });
    await act(async () => result.current.reload());

    expect(result.current.contract).toBeNull();
    expect(result.current.state).toBe('MULTIPLE_CONTRACTS');
  });

  test('exposes upcoming separately from contract and never merges it in', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce({
      data: {
        contract: {
          id: 'predecessor',
          status: 'active',
          tenantDocument: { available: true, type: 'final_notarized', isFinal: true, version: 1, publishedAt: '2026-01-10' },
        },
        upcoming: {
          id: 'successor',
          status: 'published',
          leaseStartDate: '2027-01-01',
          tenantDocument: { available: false, type: null },
        },
        state: 'CONTRACT_AVAILABLE',
      },
    });
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.contract.id).toBe('predecessor');
    expect(result.current.upcoming.id).toBe('successor');
    // The current contract is untouched by the upcoming successor.
    expect(result.current.contract.status).toBe('active');
  });

  test('renewal_effective refetches; backend-selected successor becomes current and upcoming clears', async () => {
    apiService.getCurrentContract
      .mockResolvedValueOnce({
        data: {
          contract: { id: 'predecessor', status: 'expiring_soon', tenantDocument: { available: true, type: 'final_notarized', isFinal: true, version: 1, publishedAt: '2026-01-10' } },
          upcoming: { id: 'successor', status: 'published', leaseStartDate: '2027-01-01', tenantDocument: { available: false, type: null } },
          state: 'CONTRACT_AVAILABLE',
        },
      })
      .mockResolvedValueOnce({
        data: {
          contract: { id: 'successor', status: 'active', tenantDocument: { available: true, type: 'final_notarized', isFinal: true, version: 1, publishedAt: '2027-01-01' } },
          upcoming: null,
          state: 'CONTRACT_AVAILABLE',
        },
      });
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.upcoming?.id).toBe('successor'));

    act(() => publishCanonicalNotification({ type: 'renewal_effective', data: { type: 'renewal_effective', contract_id: 'successor' } }));

    await waitFor(() => expect(result.current.contract?.id).toBe('successor'));
    expect(result.current.upcoming).toBeNull();
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(2);
  });

  test('move_out event refetches and a subsequent contract:null clears the previously current contract', async () => {
    apiService.getCurrentContract
      .mockResolvedValueOnce(finalResponse())
      .mockResolvedValueOnce({ data: { contract: null, upcoming: null, state: 'NO_PUBLISHED_CONTRACT' } });
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.contract?.id).toBe('507f1f77bcf86cd799439011'));

    act(() => publishCanonicalNotification({ type: 'move_out', data: { type: 'move_out' } }));

    await waitFor(() => expect(result.current.contract).toBeNull());
    expect(result.current.state).toBe('NO_PUBLISHED_CONTRACT');
  });

  test('transfer_complete event triggers a refetch', async () => {
    apiService.getCurrentContract
      .mockResolvedValueOnce(finalResponse())
      .mockResolvedValueOnce(finalResponse());
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => publishCanonicalNotification({ type: 'transfer_complete', data: { type: 'transfer_complete' } }));

    await waitFor(() => expect(apiService.getCurrentContract).toHaveBeenCalledTimes(2));
  });

  test('payment_completed re-reads /contracts/current so an auto-generated draft can appear', async () => {
    apiService.getCurrentContract
      .mockResolvedValueOnce({ data: { contract: null, upcoming: null, state: 'NO_PUBLISHED_CONTRACT' } })
      .mockResolvedValueOnce(draftResponse());
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.contract).toBeNull());

    act(() => publishCanonicalNotification({ type: 'payment_completed', data: { type: 'payment_completed' } }));

    await waitFor(() => expect(result.current.contract?.tenantDocument.type).toBe('generated_draft'));
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(2);
  });
});

// Smart polling: while the tenant waits on the Contract screen for a
// preparing/draft document to become final, the hook polls the canonical
// GET /contracts/current every SMART_POLL_INTERVAL_MS. Focus / foreground /
// notification / pull-to-refresh behaviour above is unchanged; these tests
// only cover the added interval.
describe('useTenantContract — smart polling while a document is in flight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppStateListeners.clear();
    resetCanonicalEventDedupeForTests();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('a preparing contract starts polling and a later poll surfaces the Draft', async () => {
    apiService.getCurrentContract
      .mockResolvedValueOnce(preparingResponse())
      .mockResolvedValueOnce(draftResponse());
    const { result } = renderHook(() => useTenantContract());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isPolling).toBe(true);
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(SMART_POLL_INTERVAL_MS);
    });

    await waitFor(() => expect(result.current.contract?.tenantDocument.type).toBe('generated_draft'));
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(2);
  });

  test('a draft contract keeps polling while it waits for the final', async () => {
    apiService.getCurrentContract
      .mockResolvedValueOnce(draftResponse())
      .mockResolvedValueOnce(draftResponse())
      .mockResolvedValueOnce(finalResponse());
    const { result } = renderHook(() => useTenantContract());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isPolling).toBe(true);

    await act(async () => { jest.advanceTimersByTime(SMART_POLL_INTERVAL_MS); });
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(2);
    expect(result.current.isPolling).toBe(true);

    await act(async () => { jest.advanceTimersByTime(SMART_POLL_INTERVAL_MS); });
    await waitFor(() => expect(result.current.contract?.tenantDocument.type).toBe('final_notarized'));
  });

  test('the fast in-flight cadence stops once the contract reaches final', async () => {
    apiService.getCurrentContract
      .mockResolvedValueOnce(draftResponse())
      .mockResolvedValueOnce(finalResponse());
    const { result } = renderHook(() => useTenantContract());

    await waitFor(() => expect(result.current.isPolling).toBe(true));

    await act(async () => { jest.advanceTimersByTime(SMART_POLL_INTERVAL_MS); });
    await waitFor(() => expect(result.current.contract?.tenantDocument.type).toBe('final_notarized'));

    // Now final: the FAST cadence must no longer fire. Advancing by the
    // in-flight interval several times triggers no further reads (the slow
    // final-revalidation interval is much longer — covered by its own test).
    const callsAtFinal = apiService.getCurrentContract.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(SMART_POLL_INTERVAL_MS * 3); });
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(callsAtFinal);
  });

  test('a final document is slowly revalidated so an in-place Final v1 -> Final v2 replacement is picked up while the screen stays focused', async () => {
    const finalV1 = {
      data: {
        contract: {
          id: '507f1f77bcf86cd799439011',
          status: 'active',
          tenantDocument: {
            available: true, type: 'final_notarized', isFinal: true,
            version: 1, currentVersion: 1, fileHash: 'hash-v1', publishedAt: '2026-08-10',
          },
        },
        state: 'CONTRACT_AVAILABLE',
      },
    };
    const finalV2 = {
      data: {
        contract: {
          id: '507f1f77bcf86cd799439011',
          status: 'active',
          tenantDocument: {
            available: true, type: 'final_notarized', isFinal: true,
            // In-place replacement: an admin re-uploaded the notarized scan.
            // version/publishedAt may not move; fileHash always does.
            version: 1, currentVersion: 1, fileHash: 'hash-v2', publishedAt: '2026-08-10',
          },
        },
        state: 'CONTRACT_AVAILABLE',
      },
    };
    apiService.getCurrentContract
      .mockResolvedValueOnce(finalV1)
      .mockResolvedValueOnce(finalV2);
    const { result } = renderHook(() => useTenantContract());

    await waitFor(() => expect(result.current.contract?.tenantDocument.fileHash).toBe('hash-v1'));
    const keyV1 = buildContractSummary(result.current.contract).documentCacheKey;

    // The fast cadence must NOT fire for an already-final document.
    await act(async () => { jest.advanceTimersByTime(SMART_POLL_INTERVAL_MS * 3); });
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(1);

    // The slow revalidation cadence does — no notification, no blur/background.
    await act(async () => { jest.advanceTimersByTime(FINAL_REVALIDATE_INTERVAL_MS); });
    await waitFor(() => expect(result.current.contract?.tenantDocument.fileHash).toBe('hash-v2'));
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(2);

    // The cache identity moved, so the old cached PDF cannot keep displaying.
    const keyV2 = buildContractSummary(result.current.contract).documentCacheKey;
    expect(keyV2).not.toBe(keyV1);
    expect(keyV2).toContain('hash-v2');
  });

  test('final revalidation is torn down on blur / background / unmount just like the in-flight cadence', async () => {
    apiService.getCurrentContract.mockResolvedValue(finalResponse());
    const { result, unmount } = renderHook(() => useTenantContract());

    await waitFor(() => expect(result.current.isPolling).toBe(true));

    act(() => emitAppState('background'));
    await waitFor(() => expect(result.current.isPolling).toBe(false));
    const callsBackgrounded = apiService.getCurrentContract.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(FINAL_REVALIDATE_INTERVAL_MS * 3); });
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(callsBackgrounded);

    act(() => emitAppState('active'));
    await waitFor(() => expect(result.current.isPolling).toBe(true));
    const callsForegrounded = apiService.getCurrentContract.mock.calls.length;

    unmount();
    await act(async () => { jest.advanceTimersByTime(FINAL_REVALIDATE_INTERVAL_MS * 3); });
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(callsForegrounded);
  });

  test('NO_PUBLISHED_CONTRACT never polls', async () => {
    apiService.getCurrentContract.mockResolvedValue({ data: { contract: null, state: 'NO_PUBLISHED_CONTRACT' } });
    const { result } = renderHook(() => useTenantContract());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isPolling).toBe(false);

    await act(async () => { jest.advanceTimersByTime(SMART_POLL_INTERVAL_MS * 5); });
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(1);
  });

  test('an error state does not poll', async () => {
    apiService.getCurrentContract.mockRejectedValueOnce({ response: { status: 500 } });
    const { result } = renderHook(() => useTenantContract());

    await waitFor(() => expect(result.current.state).toBe('ERROR'));
    expect(result.current.isPolling).toBe(false);

    await act(async () => { jest.advanceTimersByTime(SMART_POLL_INTERVAL_MS * 5); });
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(1);
  });

  test('backgrounding the app stops polling; returning to foreground resumes it', async () => {
    apiService.getCurrentContract.mockResolvedValue(preparingResponse());
    const { result } = renderHook(() => useTenantContract());

    await waitFor(() => expect(result.current.isPolling).toBe(true));

    act(() => emitAppState('background'));
    await waitFor(() => expect(result.current.isPolling).toBe(false));

    const callsWhileBackgrounded = apiService.getCurrentContract.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(SMART_POLL_INTERVAL_MS * 3); });
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(callsWhileBackgrounded);

    act(() => emitAppState('active')); // foreground also triggers one immediate load()
    await waitFor(() => expect(result.current.isPolling).toBe(true));
  });

  test('unmounting clears the interval (no polling after unmount)', async () => {
    apiService.getCurrentContract.mockResolvedValue(preparingResponse());
    const { result, unmount } = renderHook(() => useTenantContract());

    await waitFor(() => expect(result.current.isPolling).toBe(true));
    const callsBeforeUnmount = apiService.getCurrentContract.mock.calls.length;

    unmount();
    await act(async () => { jest.advanceTimersByTime(SMART_POLL_INTERVAL_MS * 5); });
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(callsBeforeUnmount);
  });
});

describe('shouldPollFor / pollIntervalFor', () => {
  test('revalidates for preparing / draft / final with a live contract and a non-blocking state', () => {
    const preparing = preparingResponse().data.contract;
    const draft = draftResponse().data.contract;
    const final = finalResponse().data.contract;

    expect(shouldPollFor(preparing, 'CONTRACT_AVAILABLE')).toBe(true);
    expect(shouldPollFor(draft, 'CONTRACT_AVAILABLE')).toBe(true);
    // final is now revalidated too — slowly — to catch an in-place replacement
    // whose notification was delayed/dropped.
    expect(shouldPollFor(final, 'CONTRACT_AVAILABLE')).toBe(true);

    expect(shouldPollFor(null, 'NO_PUBLISHED_CONTRACT')).toBe(false);
    expect(shouldPollFor(draft, 'LOADING')).toBe(false);
    expect(shouldPollFor(draft, 'ERROR')).toBe(false);
    expect(shouldPollFor(draft, 'STALE')).toBe(false);
    expect(shouldPollFor(draft, 'MULTIPLE_CONTRACTS')).toBe(false);
    expect(shouldPollFor(final, 'STALE')).toBe(false);
  });

  test('the in-flight cadence is fast; the already-final revalidation is slow', () => {
    const preparing = preparingResponse().data.contract;
    const draft = draftResponse().data.contract;
    const final = finalResponse().data.contract;

    expect(pollIntervalFor(preparing)).toBe(SMART_POLL_INTERVAL_MS);
    expect(pollIntervalFor(draft)).toBe(SMART_POLL_INTERVAL_MS);
    expect(pollIntervalFor(final)).toBe(FINAL_REVALIDATE_INTERVAL_MS);
    expect(FINAL_REVALIDATE_INTERVAL_MS).toBeGreaterThan(SMART_POLL_INTERVAL_MS);
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
