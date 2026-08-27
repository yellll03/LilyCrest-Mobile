import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { apiService } from '../services/api';
import { subscribeCanonicalNotifications } from '../services/canonicalEvents';
import { contractLifecycleState } from '../utils/contractPresentation';

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
// Canonical lifecycle events that must invalidate the current-Contract view.
// Receiving any of these (whether the tenant taps the notification or not) is
// enough to trigger a refetch — Mobile never guesses the new state, it
// re-reads /contracts/current and lets the backend resolver decide. Renewal
// activation, move-out/termination and transfer all change which Contract (if
// any) is current, so a stale predecessor/terminal Contract must not linger.
const CONTRACT_REFRESH_EVENT_TYPES = new Set([
  'contract_document_ready',
  'contract_replaced',
  'contract_finalized',
  'renewal_effective',
  'move_out',
  'stay_terminal',
  'termination_complete',
  'transfer_complete',
  // A settled payment can make a Contract newly eligible for automatic
  // generation. Re-read /contracts/current; never assume a Contract exists
  // yet (the loading/preparing state covers the async-generation window).
  'payment_completed',
]);

// While the tenant is sitting on the Contract screen waiting for a document
// to move from "preparing"/"draft" to a published final, poll /contracts/current
// on this cadence so the transition appears without a manual pull-to-refresh.
// The existing focus / foreground / canonical-notification refreshes remain
// the primary mechanism; this is only a bounded fallback for the wait window.
export const SMART_POLL_INTERVAL_MS = 20_000;

// Once the document is already "final", it is normally stable — but an admin
// can replace the notarized scan in place (Final v1 -> Final v2), and the
// canonical `contract_replaced` push that would invalidate it is best-effort:
// it can be delayed, coalesced, or dropped by the OS, and the tenant may
// never leave/background the screen to hit a focus/foreground refresh. A slow
// focused-and-foregrounded revalidation closes that gap without behaving like
// an always-on poller. Much lower frequency than the in-flight cadence above.
export const FINAL_REVALIDATE_INTERVAL_MS = 90_000;

// Document lifecycle states this hook will re-read /contracts/current for while
// the Contract screen stays open. "preparing"/"draft" are the fast in-flight
// wait; "final" is the slow in-place-replacement guard.
const POLLABLE_LIFECYCLE_STATES = new Set(['preparing', 'draft', 'final']);
const IN_FLIGHT_LIFECYCLE_STATES = new Set(['preparing', 'draft']);
const NON_POLLABLE_CONTRACT_STATES = new Set([
  'LOADING',
  'ERROR',
  'STALE',
  'MULTIPLE_CONTRACTS',
  'NO_PUBLISHED_CONTRACT',
]);

/**
 * Whether the Contract screen should be re-reading /contracts/current on an
 * interval right now. True when a contract exists, the hook is not in a
 * loading/error/blocking/empty state, and the resolved document lifecycle is
 * "preparing", "draft" (a final is still expected) or "final" (guarding against
 * an in-place Final replacement whose notification never arrived).
 */
export function shouldPollFor(contract, state) {
  if (!contract) return false;
  if (NON_POLLABLE_CONTRACT_STATES.has(state)) return false;
  return POLLABLE_LIFECYCLE_STATES.has(contractLifecycleState(contract));
}

/**
 * The interval to use for the current lifecycle: the fast in-flight cadence
 * while waiting for a first final, the slow revalidation cadence once final.
 */
export function pollIntervalFor(contract) {
  return IN_FLIGHT_LIFECYCLE_STATES.has(contractLifecycleState(contract))
    ? SMART_POLL_INTERVAL_MS
    : FINAL_REVALIDATE_INTERVAL_MS;
}

export function useTenantContract() {
  const [contract, setContract] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  const [state, setState] = useState('LOADING');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [isPolling, setIsPolling] = useState(false);
  // Focus and foreground are kept as state (not just refs) because the poll
  // interval must be armed/torn down in response to them — a bare ref change
  // would not re-run the effect below.
  const [isFocused, setIsFocused] = useState(false);
  const [isForeground, setIsForeground] = useState(AppState.currentState === 'active');
  const requestSequence = useRef(0);
  const appState = useRef(AppState.currentState);
  const hasLoadedOnce = useRef(false);
  const isFocusedRef = useRef(false);
  const isForegroundRef = useRef(AppState.currentState === 'active');

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
      // The backend exposes a not-yet-effective renewal/transfer successor
      // separately as `upcoming` — it is NOT the current Contract and must
      // never be merged into it. Mobile only presents it as a distinct
      // "upcoming" card; the current-Contract resolver stays authoritative
      // over when it becomes current.
      const nextUpcoming = response.data?.upcoming || null;
      hasLoadedOnce.current = true;
      setContract(nextContract);
      setUpcoming(nextUpcoming);
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
        setUpcoming(null);
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
        setUpcoming(null);
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
    isFocusedRef.current = true;
    setIsFocused(true);
    load();
    return () => {
      isFocusedRef.current = false;
      setIsFocused(false);
    };
  }, [load]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returningToForeground = /inactive|background/.test(appState.current) && nextState === 'active';
      appState.current = nextState;
      const foreground = nextState === 'active';
      isForegroundRef.current = foreground;
      setIsForeground(foreground);
      if (returningToForeground) load();
    });
    return () => subscription.remove();
  }, [load]);

  useEffect(() => subscribeCanonicalNotifications((notification) => {
    const type = String(notification?.data?.type || notification?.type || '').toLowerCase();
    if (CONTRACT_REFRESH_EVENT_TYPES.has(type)) load();
  }), [load]);

  // Contract-screen revalidation. One interval only, armed solely when the
  // screen is focused, the app is in the foreground, and shouldPollFor() is
  // true. Torn down on blur, backgrounding, unmount, and as soon as the
  // contract reaches an empty / error / blocking state. Cadence depends on
  // lifecycle: SMART_POLL_INTERVAL_MS while a first final is still in flight
  // (preparing/draft), FINAL_REVALIDATE_INTERVAL_MS once final — the slow
  // pass only exists to catch an in-place Final v1 -> Final v2 replacement
  // whose canonical `contract_replaced` push was delayed or dropped. Every
  // tick calls the same canonical load(), so requestSequence stale-response
  // protection and all the error handling above apply unchanged.
  const pollActive = isFocused && isForeground && shouldPollFor(contract, state);
  const pollInterval = pollIntervalFor(contract);
  useEffect(() => {
    if (!pollActive) {
      setIsPolling(false);
      return undefined;
    }
    setIsPolling(true);
    const interval = setInterval(() => {
      // Re-check at fire time — focus/AppState can change between renders.
      if (isForegroundRef.current && isFocusedRef.current) load();
    }, pollInterval);
    return () => {
      clearInterval(interval);
      setIsPolling(false);
    };
  }, [pollActive, pollInterval, load]);

  const reload = useCallback(() => load(), [load]);
  const refresh = useCallback(() => load({ isManualRefresh: true }), [load]);

  return { contract, upcoming, state, loading, refreshing, error, isPolling, reload, refresh };
}

export { CONTRACT_REFRESH_EVENT_TYPES };
