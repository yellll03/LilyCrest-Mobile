import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '../services/api';
import { subscribeCanonicalNotifications } from '../services/canonicalEvents';

// Contract acknowledgement state, read from and written through the backend
// (Capstone via the /api/m bridge). The backend is the sole authority:
//
//  - `acknowledged`            whether the CURRENT document version is acknowledged
//  - `requiresAcknowledgement` whether the tenant still needs to acknowledge
//                              (true after a replacement created a new version)
//  - `documentVersion`         the version the state refers to
//
// Mobile never persists acknowledgement as authoritative local state — it
// always re-reads it. It is *acknowledgement*, never a signature. When the
// backend says a replacement requires a fresh acknowledgement, an
// already-recorded acknowledgement of an older version must not suppress the
// prompt — that decision lives entirely in `requiresAcknowledgement`.
export function useContractAcknowledgement(contractId) {
  const [status, setStatus] = useState(null); // { acknowledged, requiresAcknowledgement, documentVersion, acknowledgedAt }
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    if (!contractId) {
      setStatus(null);
      return;
    }
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError('');
    try {
      const response = await apiService.getContractAcknowledgement(contractId);
      if (requestId !== requestSequence.current) return;
      const data = response.data || {};
      setStatus({
        acknowledged: Boolean(data.acknowledged),
        // Default to the inverse of `acknowledged` when the backend does not
        // send an explicit flag (older deployment), so a never-acknowledged
        // document still prompts.
        requiresAcknowledgement:
          data.requiresAcknowledgement != null
            ? Boolean(data.requiresAcknowledgement)
            : !data.acknowledged,
        documentVersion: data.documentVersion ?? null,
        acknowledgedAt: data.acknowledgedAt ?? null,
      });
    } catch (err) {
      if (requestId !== requestSequence.current) return;
      // A 404 here means "no acknowledgeable contract for this id" — treat as
      // simply nothing to acknowledge, not an error banner.
      if (err?.response?.status === 404) {
        setStatus(null);
      } else {
        setError('Unable to load acknowledgement status right now.');
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [contractId]);

  const acknowledge = useCallback(async () => {
    if (!contractId || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await apiService.acknowledgeContract(contractId);
      // Re-read authoritative state rather than assuming success shape.
      await load();
    } catch (err) {
      // 409 => the backend decided a newer version now needs acknowledgement;
      // re-load so the prompt reflects that instead of showing "done".
      if (err?.response?.status === 409) {
        await load();
      } else {
        setError('Unable to record your acknowledgement right now. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [contractId, submitting, load]);

  useEffect(() => {
    load();
  }, [load]);

  // A replaced/finalized document can change what needs acknowledging.
  useEffect(() => subscribeCanonicalNotifications((notification) => {
    const type = String(notification?.data?.type || notification?.type || '').toLowerCase();
    if (['contract_document_ready', 'contract_replaced', 'contract_finalized'].includes(type)) {
      load();
    }
  }), [load]);

  return {
    status,
    loading,
    submitting,
    error,
    reload: load,
    acknowledge,
    // Convenience: the viewer only needs "should I show the prompt".
    needsAcknowledgement: Boolean(status?.requiresAcknowledgement),
    isAcknowledged: Boolean(status?.acknowledged) && !status?.requiresAcknowledgement,
  };
}
