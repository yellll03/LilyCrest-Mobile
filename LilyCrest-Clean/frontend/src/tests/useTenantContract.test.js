/* global test */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { apiService } from '../services/api';
import { useTenantContract } from '../hooks/useTenantContract';

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

function currentResponse(type = 'generated_draft') {
  const isFinal = type === 'final_notarized';
  return {
    data: {
      contract: { id: '507f1f77bcf86cd799439011', status: isFinal ? 'active' : 'generated' },
      tenantDocument: {
        available: true,
        type,
        label: isFinal ? 'Final Notarized Contract' : 'Generated Draft — For Signing',
        isFinal,
        version: isFinal ? undefined : 1,
      },
    },
  };
}

function emitAppState(nextState) {
  mockAppStateListeners.forEach((listener) => listener(nextState));
}

describe('useTenantContract canonical refresh behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppStateListeners.clear();
  });

  test('normalizes the canonical top-level tenantDocument on initial focus', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce(currentResponse());
    const { result } = renderHook(() => useTenantContract());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contract.tenantDocument.type).toBe('generated_draft');
    expect(result.current.state).toBe('CONTRACT_AVAILABLE');
  });

  test('keeps the last safe view on a transient refresh failure and exposes the error', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce(currentResponse());
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.loading).toBe(false));

    apiService.getCurrentContract.mockRejectedValueOnce({ response: { status: 502 } });
    await act(async () => result.current.reload());

    expect(result.current.contract.tenantDocument.type).toBe('generated_draft');
    expect(result.current.state).toBe('ERROR');
    expect(result.current.error).toBe('Unable to load your lease contract right now.');
  });

  test('clears prior private contract data when authorization expires', async () => {
    apiService.getCurrentContract.mockResolvedValueOnce(currentResponse());
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.loading).toBe(false));

    apiService.getCurrentContract.mockRejectedValueOnce({ response: { status: 401 } });
    await act(async () => result.current.reload());

    expect(result.current.contract).toBeNull();
    expect(result.current.error).toBe('Please sign in again to view your lease contract.');
  });

  test('re-fetches when the app returns to the foreground so final replaces draft', async () => {
    apiService.getCurrentContract
      .mockResolvedValueOnce(currentResponse('generated_draft'))
      .mockResolvedValueOnce(currentResponse('final_notarized'));
    const { result } = renderHook(() => useTenantContract());
    await waitFor(() => expect(result.current.contract?.tenantDocument.type).toBe('generated_draft'));

    act(() => emitAppState('background'));
    act(() => emitAppState('active'));

    await waitFor(() => expect(result.current.contract?.tenantDocument.type).toBe('final_notarized'));
    expect(apiService.getCurrentContract).toHaveBeenCalledTimes(2);
  });
});
