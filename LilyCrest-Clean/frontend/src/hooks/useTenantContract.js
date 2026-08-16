import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { apiService } from '../services/api';
import { currentContractFromResponse } from '../utils/contractPresentation';

// Single source of truth for "my lease contract" across the app. Fetches the
// tenant's canonical Contract record from the Web admin's authoritative
// backend (GET /api/m/contracts/current — served by Capstone-Website's
// mobileContractRoutes.js, mounted into the shared mobile API at /api/m)
// instead of relying on a `user.contract` field that nothing on the backend
// ever populates. This is the real, actively-maintained Contract lifecycle
// (draft → signed → notarized → published) tied to reservation approval —
// not the separate, test-only `generatedContracts` collection in this repo's
// own backend/, which has no production trigger and must not be duplicated.
export function useTenantContract() {
  const [contract, setContract] = useState(null);
  const [state, setState] = useState('LOADING');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);
  const appState = useRef(AppState.currentState);

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError('');
    try {
      const response = await apiService.getCurrentContract();
      if (requestId !== requestSequence.current) return;
      const nextContract = currentContractFromResponse(response.data);
      setContract(nextContract);
      setState(response.data?.state || (nextContract ? 'CONTRACT_AVAILABLE' : 'NO_CURRENT_CONTRACT'));
    } catch (err) {
      if (requestId !== requestSequence.current) return;
      const authorizationFailed = err?.response?.status === 401 || err?.response?.status === 403;
      // Keep the last successfully authorized view visible during a transient
      // refresh failure. It remains presentation-only; the API is still the
      // lifecycle source of truth and the error is surfaced with Retry.
      // Authorization failures are different: discard the prior private view.
      if (authorizationFailed) setContract(null);
      setState('ERROR');
      setError(
        authorizationFailed
          ? 'Please sign in again to view your lease contract.'
          : 'Unable to load your lease contract right now.',
      );
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returningToForeground = /inactive|background/.test(appState.current) && nextState === 'active';
      appState.current = nextState;
      if (returningToForeground) load();
    });
    return () => subscription.remove();
  }, [load]);

  return { contract, state, loading, error, reload: load };
}
