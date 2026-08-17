import { useCallback, useRef, useState } from 'react';
import { apiService } from '../services/api';

export const MAX_ANNOUNCEMENT_DISMISS_IDS = 100;

export function getCanonicalAnnouncementId(item) {
  return String(item?.announcement_id || '').trim();
}

export function normalizeAnnouncementIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
}

// Owns the dedicated News/Announcements collection. Home notifications stay
// in AuthContext and use /notifications; this hook only uses /announcements.
export function useCanonicalAnnouncements() {
  const [announcements, setAnnouncements] = useState([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [submittingIds, setSubmittingIds] = useState(() => new Set());
  const requestSequenceRef = useRef(0);
  const dismissalInFlightRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);

  const loadAnnouncements = useCallback(async ({ silent = false, showRefresh = false } = {}) => {
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    if (showRefresh) setRefreshing(true);
    if (!silent) setFetchError(null);

    try {
      const response = await apiService.getAnnouncements();
      const items = Array.isArray(response?.data) ? response.data : [];
      if (requestSequenceRef.current === requestId) {
        setAnnouncements(items);
        setFetchError(null);
      }
      return true;
    } catch (_error) {
      if (requestSequenceRef.current === requestId && (!silent || !hasLoadedOnceRef.current)) {
        setFetchError('Unable to load announcements. Pull down to refresh.');
      }
      // Keep the last confirmed list on transient failure.
      return false;
    } finally {
      if (requestSequenceRef.current === requestId) {
        hasLoadedOnceRef.current = true;
        setHasLoadedOnce(true);
        setRefreshing(false);
      }
    }
  }, []);

  const dismissAnnouncements = useCallback(async (rawIds) => {
    const ids = normalizeAnnouncementIds(rawIds);
    if (!ids.length) return { ok: false, reason: 'empty', ids };
    if (ids.length > MAX_ANNOUNCEMENT_DISMISS_IDS) {
      return { ok: false, reason: 'limit', ids };
    }
    if (dismissalInFlightRef.current) return { ok: false, reason: 'busy', ids };

    dismissalInFlightRef.current = true;
    setSubmittingIds(new Set(ids));

    try {
      if (ids.length === 1) {
        await apiService.dismissAnnouncement(ids[0]);
      } else {
        await apiService.dismissAnnouncementsBulk(ids);
      }

      // Only remove after the backend confirms the tenant-specific dismissal.
      // Then refetch the canonical list so server visibility/dismissal rules stay
      // authoritative across refresh, navigation, foregrounding, and restart.
      const dismissed = new Set(ids);
      setAnnouncements((current) => current.filter((item) => !dismissed.has(getCanonicalAnnouncementId(item))));
      await loadAnnouncements({ silent: true });
      return { ok: true, ids };
    } catch (_error) {
      // No optimistic removal occurred, so the visible list is already the
      // correct rollback state and the selection can be retried unchanged.
      return { ok: false, reason: 'request', ids };
    } finally {
      dismissalInFlightRef.current = false;
      setSubmittingIds(new Set());
    }
  }, [loadAnnouncements]);

  return {
    announcements,
    hasLoadedOnce,
    refreshing,
    fetchError,
    submittingIds,
    dismissalInFlight: submittingIds.size > 0,
    loadAnnouncements,
    dismissAnnouncements,
  };
}
