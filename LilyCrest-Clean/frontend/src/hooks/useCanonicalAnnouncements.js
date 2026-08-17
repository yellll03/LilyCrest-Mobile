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
  const optimisticDismissedIdsRef = useRef(new Set());
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
        setAnnouncements(items.filter((item) => (
          !optimisticDismissedIdsRef.current.has(getCanonicalAnnouncementId(item))
        )));
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
    const idSet = new Set(ids);
    const removed = [];
    setAnnouncements((current) => {
      current.forEach((item, index) => {
        if (idSet.has(getCanonicalAnnouncementId(item))) removed.push({ item, index });
      });
      return current.filter((item) => !idSet.has(getCanonicalAnnouncementId(item)));
    });
    ids.forEach((id) => optimisticDismissedIdsRef.current.add(id));

    try {
      if (ids.length === 1) {
        await apiService.dismissAnnouncement(ids[0]);
      } else {
        await apiService.dismissAnnouncementsBulk(ids);
      }

      await loadAnnouncements({ silent: true });
      ids.forEach((id) => optimisticDismissedIdsRef.current.delete(id));
      return { ok: true, ids, removed };
    } catch (_error) {
      ids.forEach((id) => optimisticDismissedIdsRef.current.delete(id));
      setAnnouncements((current) => {
        const existing = new Set(current.map(getCanonicalAnnouncementId));
        const restored = [...current];
        removed
          .filter(({ item }) => !existing.has(getCanonicalAnnouncementId(item)))
          .sort((left, right) => left.index - right.index)
          .forEach(({ item, index }) => restored.splice(Math.min(index, restored.length), 0, item));
        return restored;
      });
      return { ok: false, reason: 'request', ids, removed };
    } finally {
      dismissalInFlightRef.current = false;
      setSubmittingIds(new Set());
    }
  }, [loadAnnouncements]);

  const restoreAnnouncement = useCallback(async (announcementId, removedEntry = null) => {
    const id = String(announcementId || '').trim();
    if (!id || dismissalInFlightRef.current) return { ok: false, reason: id ? 'busy' : 'empty' };

    const item = removedEntry?.item || null;
    const index = Number.isInteger(removedEntry?.index) ? removedEntry.index : 0;
    if (item) {
      setAnnouncements((current) => {
        if (current.some((entry) => getCanonicalAnnouncementId(entry) === id)) return current;
        const next = [...current];
        next.splice(Math.min(index, next.length), 0, item);
        return next;
      });
    }

    try {
      await apiService.restoreAnnouncement(id);
      await loadAnnouncements({ silent: true });
      return { ok: true, id };
    } catch (_error) {
      if (item) {
        setAnnouncements((current) => current.filter((entry) => getCanonicalAnnouncementId(entry) !== id));
      }
      return { ok: false, reason: 'request', id };
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
    restoreAnnouncement,
  };
}
