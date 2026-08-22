import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { apiService } from '../services/api';
import { subscribeCanonicalNotifications } from '../services/canonicalEvents';

// Single source of truth for "my lease contract" across the app. Fetches the
// tenant's canonical Contract record from the Web admin's authoritative
// backend (GET /api/m/contracts/current — served by Capstone-Website's
// mobileContractRoutes.js, mounted into the shared mobile API at /api/m)
// instead of relying on a `user.contract` field that nothing on the backend
// ever populates. This is the real, actively-maintained Contract lifecycle
// (draft → signed → notarized → published) tied to reservation approval —
// not the separate, test-only `generatedContracts` collection in this repo's
// own backend/, which has no production trigger and must not be duplicated.
//
// The response shape consumed here is exactly what Capstone-Website returns
// today, including contract.tenantDocument — the backend's own canonical
// document-selection resolver output, the same field its Web tenant page
// reads. See contractPresentation.js's preferredContractDocument() for the
// selection logic; do not re-derive document priority here.
export function useTenantContract() {
  const [contract, setContract] = useState(null);
  const [state, setState] = useState('LOADING');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);
  const appState = useRef(AppState.currentState);
  const hasLoadedOnce = useRef(false);

  const load = useCallback(async ({ isManualRefresh = false } = {}) => {
    const requestId = ++requestSequence.current;
    if (isManualRefresh) setRefreshing(true);
    else if (!hasLoadedOnce.current) setLoading(true);
    setError('');
    try {
      const response = await apiService.getCurrentContract();
      // A newer request that already resolved must not be overwritten by an
      // older one finishing late (e.g. focus refresh racing pull-to-refresh).
      if (requestId !== requestSequence.current) return;
      const nextContract = response.data?.contract || null;
      hasLoadedOnce.current = true;
      setContract(nextContract);
      setState(response.data?.state || (nextContract ? 'CONTRACT_AVAILABLE' : 'NO_PUBLISHED_CONTRACT'));
    } catch (err) {
      if (requestId !== requestSequence.current) return;
      const authorizationFailed = err?.response?.status === 401 || err?.response?.status === 403;
      const multipleCanonicalContracts = err?.response?.status === 409;
      if (authorizationFailed) {
        // Authorization was lost — never keep a previously-authorized private
        // contract/document presentation visible.
        hasLoadedOnce.current = false;
        setContract(null);
        setState('ERROR');
        setError('Please sign in again to view your lease contract.');
      } else if (multipleCanonicalContracts) {
        // The backend intentionally refuses to guess between two candidate
        // Contract records for this tenant (selectCanonicalTenantContract()
        // throwing rather than picking one). Mobile must never resolve this
        // itself — surface it as a distinct, blocking state instead of
        // folding it into the generic error/stale copy.
        hasLoadedOnce.current = false;
        setContract(null);
        setState('MULTIPLE_CONTRACTS');
        setError("We found multiple active contract records associated with your account. Please contact Lilycrest support so the records can be reviewed.");
      } else if (hasLoadedOnce.current) {
        // Transient network/upstream failure after a successful load: keep
        // showing the last safe presentation, surface a retryable warning
        // instead of inventing a new lifecycle state.
        setState('STALE');
        setError('Unable to refresh your lease contract right now.');
      } else {
        setContract(null);
        setState('ERROR');
        setError('Unable to load your lease contract right now.');
      }
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
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

  useEffect(() => subscribeCanonicalNotifications((notification) => {
    if (notification?.data?.type === 'contract_document_ready') load();
  }), [load]);

  const reload = useCallback(() => load(), [load]);
  const refresh = useCallback(() => load({ isManualRefresh: true }), [load]);

  return { contract, state, loading, refreshing, error, reload, refresh };
}
