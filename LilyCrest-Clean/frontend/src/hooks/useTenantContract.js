import { useCallback, useEffect, useState } from 'react';
import { apiService } from '../services/api';

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

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiService.getCurrentContract();
      setContract(response.data?.contract || null);
      setState(response.data?.state || (response.data?.contract ? 'CONTRACT_AVAILABLE' : 'NO_PUBLISHED_CONTRACT'));
    } catch (err) {
      setContract(null);
      setState('ERROR');
      setError(
        err?.response?.status === 401 || err?.response?.status === 403
          ? 'Please sign in again to view your lease contract.'
          : 'Unable to load your lease contract right now.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { contract, state, loading, error, reload: load };
}
