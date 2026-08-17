import { Ionicons } from '@expo/vector-icons';
import { format, formatDistanceToNow } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext';
import { useToast } from '../../src/context/ToastContext';
import { resolveNotificationRoute } from '../../src/services/notifications';
import { SURVEY_FEEDBACK_ENABLED } from '../../src/config/features';
import {
  buildNotificationFilterCounts,
  filterNotifications,
  getNotificationDateValue as getAnnouncementDateValue,
  isUrgentNotification,
  normalizeNotificationCategory as normalizeCategoryKey,
  sortNotifications,
} from '../../src/utils/notificationFilters';

function safeFormat(dateStr, fmt) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return format(d, fmt);
  } catch (_e) { return '—'; }
}
function safeDistanceToNow(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return formatDistanceToNow(d, { addSuffix: true });
  } catch (_e) { return ''; }
}

const CATEGORY_LABELS = {
  announcement: 'Announcement',
  account: 'Account',
  billing: 'Billing',
  maintenance: 'Maintenance',
  assistant: 'Assistant',
  security: 'Security',
  reservation: 'Reservation',
  survey: 'Survey',
  rules: 'Rules',
  promo: 'Promo',
  event: 'Event',
  general: 'General',
};

function categoryLabel(key) {
  if (!key || key === 'all') return 'All';
  return CATEGORY_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

function isNew(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return (Date.now() - d.getTime()) < 3 * 24 * 60 * 60 * 1000;
  } catch (_e) { return false; }
}

export default function AnnouncementsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  // This screen's visible list previously fetched GET /announcements
  // independently, while the unread badge/push-routing logic elsewhere in
  // the app polled a SEPARATE endpoint, GET /notifications — which the
  // backend already merges (personal notifications like bill releases +
  // visible announcements, deduplicated, sorted newest-first) into one
  // feed. There is no client-side merge to build: the fix is to read from
  // the same already-unified source AuthContext already owns, instead of
  // maintaining a second, narrower fetch/store here.
  const {
    notifications: rawFeedItems, refreshNotifications, clearNotificationUnread,
    dismissNotification, dismissAnnouncement, dismissAnnouncementsBulk,
  } = useAuth();
  const { showToast } = useToast();
  const styles = useThemedStyles((c, dark) => StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background },

    // ── Header ──
    headerWrapper: {
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 8,
      gap: 8,
    },
    headerLeft: { flex: 1 },
    headerTitle: { fontSize: 20, fontWeight: '800', color: c.text, letterSpacing: -0.3 },
    headerSubtitle: { fontSize: 12, color: c.textMuted, marginTop: 2 },
    toolbarRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 14, paddingBottom: 12, gap: 8,
    },
    toolbarButton: {
      flex: 1, minHeight: 42, paddingHorizontal: 8, borderRadius: 10,
      backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: 'transparent',
      flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5,
    },
    toolbarButtonActive: {
      backgroundColor: dark ? 'rgba(59,130,246,0.14)' : '#EFF6FF',
      borderColor: c.accent,
    },
    toolbarButtonDisabled: { opacity: 0.65 },
    toolbarButtonText: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
    toolbarButtonTextActive: { color: c.accent },

    readMoreBtn: { marginTop: 6, alignSelf: 'flex-start' },
    readMoreText: { fontSize: 13, fontWeight: '600', color: c.primary },

    // ── Cards ──
    scrollView: { flex: 1 },
    scrollContent: { padding: 14, paddingTop: 14, gap: 10 },
    announcementCard: {
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
      ...Platform.select({
        web: { boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
        default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: dark ? 0.18 : 0.06, shadowRadius: 6, elevation: 2 },
      }),
    },
    cardAccent: {
      position: 'absolute', left: 0, top: 0, bottom: 0,
      width: 4, borderTopLeftRadius: 16, borderBottomLeftRadius: 16,
    },
    cardBody: { padding: 14, paddingLeft: 16 },
    cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, gap: 10 },
    priorityIcon: {
      width: 36, height: 36, borderRadius: 11,
      justifyContent: 'center', alignItems: 'center', flexShrink: 0,
    },
    titleColumn: { flex: 1 },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    announcementTitle: { fontSize: 15, fontWeight: '700', color: c.text, flex: 1, lineHeight: 21 },
    newDot: {
      width: 7, height: 7, borderRadius: 4,
      backgroundColor: '#3B82F6', marginTop: 7, flexShrink: 0,
    },
    announcementTime: { fontSize: 12, color: c.textMuted, marginTop: 3 },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10, gap: 6 },
    categoryBadge: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 3, paddingHorizontal: 8,
      borderRadius: 6, gap: 4,
    },
    categoryBadgeText: { fontSize: 12, fontWeight: '600' },
    urgentBadge: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: dark ? 'rgba(239,68,68,0.18)' : '#FEE2E2',
      paddingVertical: 3, paddingHorizontal: 8,
      borderRadius: 6, gap: 4,
    },
    urgentText: { fontSize: 12, fontWeight: '600', color: dark ? '#FCA5A5' : '#DC2626' },
    announcementContent: {
      fontSize: 14, color: c.textSecondary, lineHeight: 21,
    },
    announcementFooter: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      borderTopWidth: 1, borderTopColor: c.border,
      paddingTop: 10, marginTop: 12,
    },
    footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    announcementDate: { fontSize: 12, color: c.textMuted, fontWeight: '500' },
    footerAuthor: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    authorText: { fontSize: 12, color: c.textMuted, fontWeight: '500' },

    // ── Error banner ──
    errorBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: dark ? '#2C1A00' : '#FEF3C7',
      borderWidth: 1, borderColor: dark ? '#78350F' : '#FDE68A',
      borderRadius: 10, padding: 12, marginBottom: 10,
    },
    errorBannerText: { flex: 1, fontSize: 13, color: dark ? '#FCD34D' : '#92400E', fontWeight: '500' },
    retryButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 6 },
    retryButtonText: { fontSize: 13, fontWeight: '800', color: dark ? '#FCD34D' : '#92400E' },

    // ── Empty state ──
    emptyState: { alignItems: 'center', paddingVertical: 56 },
    emptyIcon: {
      width: 64, height: 64, borderRadius: 20,
      backgroundColor: c.surfaceSecondary,
      justifyContent: 'center', alignItems: 'center',
      marginBottom: 14,
    },
    emptyTitle: { fontSize: 15, fontWeight: '700', color: c.text, marginBottom: 6 },
    emptyText: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 19, paddingHorizontal: 36 },
    emptyAction: {
      minHeight: 44, marginTop: 14, paddingHorizontal: 18, borderRadius: 10,
      backgroundColor: c.accent, justifyContent: 'center', alignItems: 'center',
    },
    emptyActionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },

    // ── Filter sheet ──
    filterModalOverlay: {
      flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)',
    },
    filterSheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      maxHeight: '84%', paddingTop: 10,
      paddingBottom: Platform.OS === 'ios' ? 34 : 20,
      ...Platform.select({
        default: { shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.16, shadowRadius: 18, elevation: 18 },
      }),
    },
    filterSheetHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 18, paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
    },
    filterSheetTitleWrap: { flex: 1 },
    filterSheetTitle: { fontSize: 17, fontWeight: '800', color: c.text },
    filterSheetSubtitle: { fontSize: 12, color: c.textMuted, marginTop: 2 },
    filterCloseButton: {
      width: 44, height: 44, borderRadius: 12,
      backgroundColor: c.surfaceSecondary, justifyContent: 'center', alignItems: 'center',
    },
    filterSheetScroll: { paddingHorizontal: 18 },
    filterSection: { paddingTop: 16 },
    filterSectionTitle: {
      fontSize: 12, fontWeight: '800', color: c.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6,
    },
    filterSectionHint: { fontSize: 11, color: c.textMuted, marginTop: 4, marginBottom: 2, paddingHorizontal: 10 },
    filterOption: {
      minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 10, borderRadius: 10,
    },
    filterOptionSelected: { backgroundColor: dark ? 'rgba(59,130,246,0.12)' : '#EFF6FF' },
    radioOuter: {
      width: 20, height: 20, borderRadius: 10, borderWidth: 2,
      borderColor: c.textMuted, justifyContent: 'center', alignItems: 'center',
    },
    radioOuterSelected: { borderColor: c.accent },
    radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent },
    filterOptionText: { flex: 1, fontSize: 14, color: c.textSecondary, fontWeight: '600' },
    filterOptionTextSelected: { color: c.text, fontWeight: '800' },
    filterCount: {
      minWidth: 28, height: 24, borderRadius: 12, paddingHorizontal: 7,
      backgroundColor: c.surfaceSecondary, justifyContent: 'center', alignItems: 'center',
    },
    filterCountSelected: { backgroundColor: dark ? 'rgba(59,130,246,0.22)' : '#DBEAFE' },
    filterCountText: { fontSize: 12, color: c.textMuted, fontWeight: '700' },
    filterCountTextSelected: { color: c.accent },
    filterSheetActions: {
      flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingTop: 14,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
    },
    filterResetButton: {
      minHeight: 46, paddingHorizontal: 22, borderRadius: 12,
      borderWidth: 1, borderColor: c.border, justifyContent: 'center', alignItems: 'center',
    },
    filterResetText: { fontSize: 14, fontWeight: '800', color: c.textSecondary },
    filterApplyButton: {
      flex: 1, minHeight: 46, borderRadius: 12,
      backgroundColor: c.accent, justifyContent: 'center', alignItems: 'center',
    },
    filterApplyText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },

    // ── Detail sheet ──
    modalOverlay: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 18, paddingBottom: Platform.OS === 'ios' ? 34 : 20,
      maxHeight: '82%',
    },
    dragHandle: { alignItems: 'center', marginBottom: 14 },
    dragHandlePill: {
      width: 36, height: 4, borderRadius: 2,
      backgroundColor: dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)',
    },
    modalHeader: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12,
    },
    modalTitleWrap: { flex: 1 },
    modalTitle: { fontSize: 15, fontWeight: '700', color: c.text, lineHeight: 22 },
    modalTime: { fontSize: 12, color: c.textMuted, marginTop: 3 },
    modalBody: { marginVertical: 12 },
    modalContent: { fontSize: 14, color: c.textSecondary, lineHeight: 22 },
    modalFooter: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12,
    },
    notificationAction: {
      minHeight: 44, borderRadius: 10, backgroundColor: c.accent,
      justifyContent: 'center', alignItems: 'center', marginTop: 10,
    },
    notificationActionText: { color: '#FFFFFF', fontWeight: '800' },
    modalCloseBtn: {
      width: 28, height: 28, borderRadius: 8,
      backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      justifyContent: 'center', alignItems: 'center',
    },

    bottomSpacer: { height: Platform.OS === 'ios' ? 80 : 60 },

    // ── Selection mode ──
    selectCheckbox: {
      width: 36, height: 36, borderRadius: 11, borderWidth: 2, borderColor: c.border,
      justifyContent: 'center', alignItems: 'center', flexShrink: 0,
    },
    selectCheckboxChecked: { backgroundColor: c.accent, borderColor: c.accent },
    selectionBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 10, gap: 10,
    },
    selectionBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    selectionCount: { fontSize: 15, fontWeight: '800', color: c.text },
    selectionBarButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 4 },
    selectionBarButtonText: { fontSize: 13, fontWeight: '700', color: c.accent },
    selectionDeleteButton: {
      minHeight: 38, paddingHorizontal: 14, borderRadius: 10,
      backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center',
      flexDirection: 'row', gap: 6,
    },
    selectionDeleteButtonDisabled: { opacity: 0.5 },
    selectionDeleteText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },

    // ── Undo snackbar ──
    undoSnackbar: {
      position: 'absolute', left: 14, right: 14, bottom: 18,
      backgroundColor: dark ? '#1F2937' : '#111827',
      borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      ...Platform.select({
        web: { boxShadow: '0 4px 16px rgba(0,0,0,0.24)' },
        default: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.24, shadowRadius: 10, elevation: 6 },
      }),
    },
    undoSnackbarText: { color: '#F9FAFB', fontSize: 13, fontWeight: '600', flex: 1 },
    undoSnackbarAction: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 4 },
    undoSnackbarActionText: { color: '#93C5FD', fontSize: 13, fontWeight: '800' },
  }));

  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [isFilterSheetVisible, setIsFilterSheetVisible] = useState(false);
  const [selectedAnn, setSelectedAnn] = useState(null);
  const [sortOrder, setSortOrder] = useState('newest');
  const [expandedIds, setExpandedIds] = useState(new Set());
  const fetchInFlightRef = useRef(null);

  // Deleting an announcement here must hide it from THIS screen only — never
  // from the Home bell, and never the shared `announcements` record other
  // tenants see (see backend POST /announcements/:id/dismiss). So this is a
  // client-side hide layered on top of AuthContext's shared feed, distinct
  // from personal (billing/maintenance/etc.) items, which reuse the same
  // dismissNotification() the bell uses since there's only ever one copy of
  // those records for this tenant.
  const [hiddenAnnouncementIds, setHiddenAnnouncementIds] = useState(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pendingDeletion, setPendingDeletion] = useState(null); // { ids: Set, items, timeoutId }
  const pendingDeletionRef = useRef(null);

  const feedItems = useMemo(
    () => rawFeedItems.filter((item) => {
      const id = item.notification_id || item.announcement_id;
      if (hiddenAnnouncementIds.has(id)) return false;
      if (pendingDeletion?.ids?.has(id)) return false;
      return true;
    }),
    [rawFeedItems, hiddenAnnouncementIds, pendingDeletion]
  );

  // Thin wrapper around the shared refreshNotifications() — this screen adds
  // only its own loading/error/retry UI state on top; the fetch itself, the
  // merge of personal notifications + announcements, and the unread count
  // all remain owned by AuthContext (single source of truth).
  const loadFeed = useCallback((silent = false) => {
    if (fetchInFlightRef.current) return fetchInFlightRef.current;
    if (!silent) setFetchError(null);

    const request = (async () => {
      const succeeded = await refreshNotifications();
      if (succeeded) {
        setFetchError(null);
      } else if (!silent) {
        setFetchError('Unable to load notifications. Pull down to refresh.');
      }
      setHasLoadedOnce(true);
      setRefreshing(false);
      fetchInFlightRef.current = null;
    })();

    fetchInFlightRef.current = request;
    return request;
  }, [refreshNotifications]);

  // No local polling interval here: AuthContext already polls /notifications
  // every 60s for as long as the tenant is authenticated (see refreshNotifications
  // usage in AuthContext.js), independent of which screen is focused — an
  // additional interval in this screen would just double that same request
  // while Notifications happens to be open.
  useEffect(() => { loadFeed(); }, [loadFeed]);
  useFocusEffect(
    useCallback(() => {
      loadFeed(true);
      clearNotificationUnread().catch(() => {});
    }, [clearNotificationUnread, loadFeed])
  );

  const onRefresh = useCallback(() => { setRefreshing(true); loadFeed(); }, [loadFeed]);

  useEffect(() => () => {
    if (pendingDeletionRef.current?.timeoutId) clearTimeout(pendingDeletionRef.current.timeoutId);
  }, []);

  const commitDeletion = useCallback(async (items) => {
    const announcementIds = items
      .filter((item) => item.type === 'announcement' && item.announcement_id)
      .map((item) => item.announcement_id);
    const personalIds = items
      .filter((item) => item.type !== 'announcement')
      .map((item) => item.notification_id)
      .filter(Boolean);

    let failedCount = 0;

    if (announcementIds.length) {
      const succeeded = announcementIds.length === 1
        ? await dismissAnnouncement(announcementIds[0])
        : await dismissAnnouncementsBulk(announcementIds);
      if (succeeded) {
        setHiddenAnnouncementIds((prev) => {
          const next = new Set(prev);
          announcementIds.forEach((id) => next.add(id));
          return next;
        });
      } else {
        // Leaving it out of hiddenAnnouncementIds means the item reappears
        // (it's no longer in pendingDeletion once this resolves) instead of
        // vanishing silently — the toast below is what tells the tenant why.
        failedCount += announcementIds.length;
      }
    }

    if (personalIds.length) {
      const results = await Promise.all(personalIds.map((id) => dismissNotification(id)));
      failedCount += results.filter((succeeded) => !succeeded).length;
    }

    if (failedCount > 0) {
      // "Remove" here, not "Delete" — this only hides the item from the
      // tenant's own list (per-tenant dismissal on the backend). An
      // announcement item is never actually deleted; it stays fully intact
      // for admin and every other tenant. See dismissAnnouncement/
      // dismissAnnouncementsBulk in AuthContext.js.
      showToast({
        type: 'error',
        title: 'Remove failed',
        message: failedCount === items.length
          ? "Couldn't remove — check your connection and try again."
          : `${failedCount} of ${items.length} couldn't be removed — check your connection and try again.`,
      });
    }
  }, [dismissNotification, dismissAnnouncement, dismissAnnouncementsBulk, showToast]);

  const schedulePendingDeletion = useCallback((items) => {
    const ids = new Set(items.map((item) => item.notification_id || item.announcement_id).filter(Boolean));
    if (!ids.size) return;
    if (pendingDeletionRef.current?.timeoutId) clearTimeout(pendingDeletionRef.current.timeoutId);
    const timeoutId = setTimeout(() => {
      commitDeletion(items);
      setPendingDeletion(null);
      pendingDeletionRef.current = null;
    }, 5000);
    const next = { ids, items, timeoutId };
    pendingDeletionRef.current = next;
    setPendingDeletion(next);
  }, [commitDeletion]);

  const undoPendingDeletion = useCallback(() => {
    if (pendingDeletionRef.current?.timeoutId) clearTimeout(pendingDeletionRef.current.timeoutId);
    pendingDeletionRef.current = null;
    setPendingDeletion(null);
  }, []);

  const toggleSelected = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const enterSelectionMode = useCallback((id) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const deleteSelected = useCallback(() => {
    const items = feedItems.filter((item) => selectedIds.has(item.notification_id || item.announcement_id));
    schedulePendingDeletion(items);
    exitSelectionMode();
  }, [feedItems, selectedIds, schedulePendingDeletion, exitSelectionMode]);

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return '#EF4444';
      case 'normal': return '#3B82F6';
      case 'low': return '#22C55E';
      default: return '#6B7280';
    }
  };

  const getPriorityIcon = (priority) => {
    switch (priority) {
      case 'high': return 'alert-circle';
      case 'normal': return 'information-circle';
      case 'low': return 'checkmark-circle';
      default: return 'information-circle';
    }
  };

  const getCategoryColor = (category) => {
    switch (category?.toLowerCase()) {
      case 'announcement': return { bg: '#EEF2FF', text: '#4F46E5', icon: 'megaphone' };
      case 'billing':     return { bg: '#DBEAFE', text: '#2563EB', icon: 'card' };
      case 'maintenance': return { bg: '#FEF3C7', text: '#D97706', icon: 'construct' };
      case 'assistant':   return { bg: '#F3E8FF', text: '#9333EA', icon: 'chatbubble-ellipses' };
      case 'security':    return { bg: '#FEE2E2', text: '#DC2626', icon: 'shield-checkmark' };
      case 'reservation': return { bg: '#DCFCE7', text: '#16A34A', icon: 'calendar' };
      case 'survey':      return { bg: '#F3E8FF', text: '#7E22CE', icon: 'chatbox-ellipses' };
      case 'rules':       return { bg: '#EEF2FF', text: '#4F46E5', icon: 'document-text' };
      case 'promo':       return { bg: '#DCFCE7', text: '#16A34A', icon: 'pricetag' };
      case 'event':       return { bg: '#F3E8FF', text: '#9333EA', icon: 'calendar' };
      default:            return { bg: '#F3F4F6', text: '#4B5563', icon: 'megaphone' };
    }
  };

  const getCategoryIcon = (category) => getCategoryColor(category).icon;

  const categories = useMemo(
    () => ['all', ...new Set(feedItems.map((item) => normalizeCategoryKey(item.category)))],
    [feedItems]
  );

  const filteredAnnouncements = useMemo(
    () => filterNotifications(feedItems, { category: selectedCategory, priority: priorityFilter }),
    [feedItems, priorityFilter, selectedCategory]
  );

  const visibleAnnouncements = useMemo(
    () => sortNotifications(filteredAnnouncements, sortOrder),
    [filteredAnnouncements, sortOrder]
  );

  // Counts reflect the live selection directly — filters apply the instant
  // you tap them, so there's no separate draft state to track anymore.
  const filterCounts = useMemo(
    () => buildNotificationFilterCounts(feedItems, { category: selectedCategory, priority: priorityFilter }),
    [feedItems, selectedCategory, priorityFilter]
  );

  const activeFilterCount = Number(Boolean(selectedCategory)) + Number(priorityFilter !== 'all');
  const hasActiveFilters = activeFilterCount > 0;

  const openFilterSheet = useCallback(() => setIsFilterSheetVisible(true), []);
  const closeFilterSheet = useCallback(() => setIsFilterSheetVisible(false), []);

  const clearFilters = useCallback(() => {
    setSelectedCategory(null);
    setPriorityFilter('all');
  }, []);

  const announcementKeyExtractor = useCallback(
    (announcement) => announcement.notification_id || announcement.announcement_id || `${announcement.title}-${String(getAnnouncementDateValue(announcement) || '')}`,
    []
  );

  const toggleExpanded = useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const renderAnnouncementItem = useCallback(({ item: announcement }) => {
    const catColor = getCategoryColor(announcement.category || 'General');
    const prioColor = getPriorityColor(announcement.priority);
    const announcementDate = getAnnouncementDateValue(announcement);
    const isRecent = isNew(announcementDate);
    const announcementId = announcement.notification_id || announcement.announcement_id;
    const isExpanded = expandedIds.has(announcementId);
    const isLong = (announcement.content || '').length > 120;
    const isSelected = selectedIds.has(announcementId);

    return (
      <TouchableOpacity
        style={styles.announcementCard}
        onPress={() => (selectionMode ? toggleSelected(announcementId) : setSelectedAnn(announcement))}
        onLongPress={() => enterSelectionMode(announcementId)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Notification: ${announcement.title || 'Untitled'}`}
      >
        {/* Left priority accent */}
        <View style={[styles.cardAccent, { backgroundColor: prioColor }]} />

        <View style={styles.cardBody}>
          {/* Icon + title row */}
          <View style={styles.cardHeader}>
            {selectionMode ? (
              <TouchableOpacity
                onPress={() => toggleSelected(announcementId)}
                style={[styles.selectCheckbox, isSelected && styles.selectCheckboxChecked]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {isSelected ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
              </TouchableOpacity>
            ) : (
              <View style={[styles.priorityIcon, { backgroundColor: `${prioColor}14` }]}>
                <Ionicons name={getPriorityIcon(announcement.priority)} size={16} color={prioColor} />
              </View>
            )}
            <View style={styles.titleColumn}>
              <View style={styles.titleRow}>
                <Text style={styles.announcementTitle} numberOfLines={2}>{announcement.title}</Text>
                {isRecent && <View style={styles.newDot} />}
              </View>
              <Text style={styles.announcementTime}>{safeDistanceToNow(announcementDate)}</Text>
            </View>
            {!selectionMode && (
              <TouchableOpacity
                onPress={() => schedulePendingDeletion([announcement])}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${announcement.title || 'notification'}`}
              >
                <Ionicons name="trash-outline" size={17} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Category + Urgent badges */}
          <View style={styles.badgeRow}>
            <View style={[styles.categoryBadge, { backgroundColor: catColor.bg }]}>
              <Ionicons name={catColor.icon} size={10} color={catColor.text} />
              <Text style={[styles.categoryBadgeText, { color: catColor.text }]}>{categoryLabel(normalizeCategoryKey(announcement.category))}</Text>
            </View>
            {isUrgentNotification(announcement) && (
              <View style={styles.urgentBadge}>
                <Ionicons name="warning" size={10} color="#DC2626" />
                <Text style={styles.urgentText}>Urgent</Text>
              </View>
            )}
          </View>

          {/* Content preview */}
          <Text style={styles.announcementContent} numberOfLines={isExpanded ? undefined : 3}>
            {announcement.content}
          </Text>
          {isLong && (
            <TouchableOpacity
              style={styles.readMoreBtn}
              onPress={() => toggleExpanded(announcementId)}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Text style={styles.readMoreText}>{isExpanded ? 'Show less' : 'Read more'}</Text>
            </TouchableOpacity>
          )}

          {/* Footer */}
          <View style={styles.announcementFooter}>
            <View style={styles.footerLeft}>
              <Ionicons name="calendar-outline" size={11} color={colors.textMuted} />
              <Text style={styles.announcementDate}>{safeFormat(announcementDate, 'MMM dd, yyyy')}</Text>
            </View>
            <View style={styles.footerAuthor}>
              <Ionicons name="person-circle-outline" size={11} color={colors.textMuted} />
              <Text style={styles.authorText}>{announcement.author_name || announcement.source_label || 'LilyCrest System'}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [colors.textMuted, expandedIds, styles, toggleExpanded, selectionMode, selectedIds, toggleSelected, enterSelectionMode, schedulePendingDeletion]);

  if (!hasLoadedOnce) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.headerWrapper}>
        {selectionMode ? (
          <View style={styles.selectionBar}>
            <View style={styles.selectionBarLeft}>
              <TouchableOpacity
                style={styles.selectionBarButton}
                onPress={exitSelectionMode}
                accessibilityRole="button"
                accessibilityLabel="Cancel selection"
              >
                <Text style={styles.selectionBarButtonText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.selectionCount}>{selectedIds.size} selected</Text>
              <TouchableOpacity
                style={styles.selectionBarButton}
                onPress={() => setSelectedIds(new Set(visibleAnnouncements.map((item) => item.notification_id || item.announcement_id)))}
                accessibilityRole="button"
                accessibilityLabel="Select all"
              >
                <Text style={styles.selectionBarButtonText}>Select all</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.selectionDeleteButton, !selectedIds.size && styles.selectionDeleteButtonDisabled]}
              onPress={deleteSelected}
              disabled={!selectedIds.size}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${selectedIds.size} selected`}
            >
              <Ionicons name="trash-outline" size={15} color="#FFFFFF" />
              <Text style={styles.selectionDeleteText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : (
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Notifications</Text>
            <Text style={styles.headerSubtitle}>
              {hasActiveFilters
                ? `${filteredAnnouncements.length} of ${feedItems.length} ${feedItems.length === 1 ? 'update' : 'updates'} in your inbox`
                : `${feedItems.length} ${feedItems.length === 1 ? 'update' : 'updates'} in your inbox`}
            </Text>
          </View>
        </View>
        )}

        {!selectionMode && <View style={styles.toolbarRow}>
          <TouchableOpacity
            style={[styles.toolbarButton, hasActiveFilters && styles.toolbarButtonActive]}
            onPress={openFilterSheet}
            accessibilityRole="button"
            accessibilityLabel={`Open notification filters${activeFilterCount ? `, ${activeFilterCount} active` : ''}`}
          >
            <Ionicons name="options-outline" size={16} color={hasActiveFilters ? colors.accent : colors.textSecondary} />
            <Text style={[styles.toolbarButtonText, hasActiveFilters && styles.toolbarButtonTextActive]}>
              Filters{activeFilterCount ? ` · ${activeFilterCount}` : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.toolbarButton}
            onPress={() => setSortOrder((prev) => prev === 'newest' ? 'oldest' : 'newest')}
            accessibilityRole="button"
            accessibilityLabel={`Sort order: ${sortOrder === 'newest' ? 'Newest' : 'Oldest'}`}
          >
            <Ionicons name={sortOrder === 'newest' ? 'arrow-down' : 'arrow-up'} size={13} color={colors.textSecondary} />
            <Text style={styles.toolbarButtonText}>{sortOrder === 'newest' ? 'Newest' : 'Oldest'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toolbarButton, refreshing && styles.toolbarButtonDisabled]}
            onPress={() => { if (!refreshing) { setRefreshing(true); loadFeed(); } }}
            disabled={refreshing}
            accessibilityRole="button"
            accessibilityLabel="Refresh notifications"
            accessibilityState={{ disabled: refreshing, busy: refreshing }}
          >
            {refreshing
              ? <ActivityIndicator size={14} color={colors.primary} />
              : <Ionicons name="refresh" size={16} color={colors.textMuted} />
            }
            <Text style={styles.toolbarButtonText}>{refreshing ? 'Refreshing' : 'Refresh'}</Text>
          </TouchableOpacity>
        </View>}
      </View>

      {/* ── Content ── */}
      <FlatList
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        data={visibleAnnouncements}
        keyExtractor={announcementKeyExtractor}
        renderItem={renderAnnouncementItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={fetchError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="cloud-offline-outline" size={15} color="#92400E" />
            <Text style={styles.errorBannerText}>{fetchError}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => loadFeed()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading notifications"
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="notifications-outline" size={26} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>
              {fetchError && feedItems.length === 0
                ? 'Could not load notifications'
                : feedItems.length === 0
                  ? 'No notifications yet'
                  : 'No notifications match these filters'}
            </Text>
            <Text style={styles.emptyText}>
              {fetchError && feedItems.length === 0
                ? 'Check your connection and retry.'
                : feedItems.length === 0
                  ? 'Updates from LilyCrest will appear here.'
                  : 'Try another category or priority, or clear the active filters.'}
            </Text>
            {feedItems.length > 0 && hasActiveFilters ? (
              <TouchableOpacity
                style={styles.emptyAction}
                onPress={clearFilters}
                accessibilityRole="button"
                accessibilityLabel="Clear notification filters"
              >
                <Text style={styles.emptyActionText}>Clear filters</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
        ListFooterComponent={<View style={styles.bottomSpacer} />}
      />

      {/* Compact filter controls expand into this modal sheet only when needed. */}
      <Modal
        visible={isFilterSheetVisible}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={closeFilterSheet}
      >
        <View style={styles.filterModalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={closeFilterSheet}
            accessibilityRole="button"
            accessibilityLabel="Close notification filters"
          />
          <View style={styles.filterSheet} accessibilityViewIsModal>
            <View style={styles.dragHandle}>
              <View style={styles.dragHandlePill} />
            </View>
            <View style={styles.filterSheetHeader}>
              <View style={styles.filterSheetTitleWrap}>
                <Text style={styles.filterSheetTitle}>Filter Notifications</Text>
                <Text style={styles.filterSheetSubtitle}>Tap a category or priority to filter instantly.</Text>
              </View>
              <TouchableOpacity
                style={styles.filterCloseButton}
                onPress={closeFilterSheet}
                accessibilityRole="button"
                accessibilityLabel="Close notification filters"
              >
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.filterSheetScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Category</Text>
                {categories.map((category) => {
                  const selected = category === 'all' ? !selectedCategory : selectedCategory === category;
                  const count = category === 'all'
                    ? filterCounts.allCategories
                    : (filterCounts.categories.get(category) || 0);
                  const label = categoryLabel(category);
                  return (
                    <TouchableOpacity
                      key={category}
                      style={[styles.filterOption, selected && styles.filterOptionSelected]}
                      onPress={() => setSelectedCategory(category === 'all' ? null : category)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${label}, ${count} ${count === 1 ? 'notification' : 'notifications'}`}
                    >
                      <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                        {selected ? <View style={styles.radioInner} /> : null}
                      </View>
                      <Ionicons
                        name={category === 'all' ? 'apps-outline' : getCategoryIcon(category)}
                        size={17}
                        color={selected ? colors.accent : colors.textMuted}
                      />
                      <Text style={[styles.filterOptionText, selected && styles.filterOptionTextSelected]}>{label}</Text>
                      <View style={[styles.filterCount, selected && styles.filterCountSelected]}>
                        <Text style={[styles.filterCountText, selected && styles.filterCountTextSelected]}>{count}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Priority</Text>
                {[
                  { key: 'all', label: 'All', icon: 'layers-outline' },
                  { key: 'urgent', label: 'Urgent', icon: 'alert-circle-outline' },
                  { key: 'normal', label: 'Normal', icon: 'information-circle-outline' },
                ].map((option) => {
                  const selected = priorityFilter === option.key;
                  const count = filterCounts.priorities[option.key];
                  return (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.filterOption, selected && styles.filterOptionSelected]}
                      onPress={() => setPriorityFilter(option.key)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${option.label} priority, ${count} ${count === 1 ? 'notification' : 'notifications'}`}
                    >
                      <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                        {selected ? <View style={styles.radioInner} /> : null}
                      </View>
                      <Ionicons
                        name={option.icon}
                        size={17}
                        color={option.key === 'urgent' ? '#EF4444' : (selected ? colors.accent : colors.textMuted)}
                      />
                      <Text style={[styles.filterOptionText, selected && styles.filterOptionTextSelected]}>{option.label}</Text>
                      <View style={[styles.filterCount, selected && styles.filterCountSelected]}>
                        <Text style={[styles.filterCountText, selected && styles.filterCountTextSelected]}>{count}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                <Text style={styles.filterSectionHint}>Normal includes all non-urgent updates, including low priority.</Text>
              </View>
            </ScrollView>

            <View style={styles.filterSheetActions}>
              <TouchableOpacity
                style={styles.filterResetButton}
                onPress={clearFilters}
                accessibilityRole="button"
                accessibilityLabel="Reset notification filters"
              >
                <Text style={styles.filterResetText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.filterApplyButton}
                onPress={closeFilterSheet}
                accessibilityRole="button"
                accessibilityLabel="Done filtering notifications"
              >
                <Text style={styles.filterApplyText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Detail sheet ── */}
      <Modal
        visible={!!selectedAnn}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedAnn(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {/* Drag handle */}
            <View style={styles.dragHandle}>
              <View style={styles.dragHandlePill} />
            </View>

            {selectedAnn && (() => {
              const catColor = getCategoryColor(selectedAnn.category || 'General');
              const prioColor = getPriorityColor(selectedAnn.priority);
              return (
                <>
                  {/* Modal header */}
                  <View style={styles.modalHeader}>
                    <View style={[styles.priorityIcon, { backgroundColor: `${prioColor}14` }]}>
                      <Ionicons name={getPriorityIcon(selectedAnn.priority)} size={16} color={prioColor} />
                    </View>
                    <View style={styles.modalTitleWrap}>
                      <Text style={styles.modalTitle}>{selectedAnn.title}</Text>
                      <Text style={styles.modalTime}>{safeDistanceToNow(getAnnouncementDateValue(selectedAnn))}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.modalCloseBtn}
                      onPress={() => setSelectedAnn(null)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close" size={15} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  {/* Badges */}
                  <View style={styles.badgeRow}>
                    <View style={[styles.categoryBadge, { backgroundColor: catColor.bg }]}>
                      <Ionicons name={catColor.icon} size={10} color={catColor.text} />
                      <Text style={[styles.categoryBadgeText, { color: catColor.text }]}>{categoryLabel(normalizeCategoryKey(selectedAnn.category))}</Text>
                    </View>
                    {isUrgentNotification(selectedAnn) && (
                      <View style={styles.urgentBadge}>
                        <Ionicons name="warning" size={10} color="#DC2626" />
                        <Text style={styles.urgentText}>Urgent</Text>
                      </View>
                    )}
                  </View>

                  {/* Full content */}
                  <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                    <Text style={styles.modalContent}>{selectedAnn.content}</Text>
                    {SURVEY_FEEDBACK_ENABLED && String(selectedAnn.category || selectedAnn.type || '').toLowerCase() === 'survey' ? (
                      <TouchableOpacity
                        style={styles.notificationAction}
                        accessibilityRole="button"
                        accessibilityLabel="Open survey"
                        onPress={() => {
                          const destination = resolveNotificationRoute({
                            ...(selectedAnn.data || {}),
                            url: selectedAnn.url || selectedAnn.data?.url,
                            type: 'survey',
                            surveyId: selectedAnn.data?.surveyId || selectedAnn.surveyId,
                          });
                          setSelectedAnn(null);
                          router.push(destination);
                        }}
                      >
                        <Text style={styles.notificationActionText}>Open Survey</Text>
                      </TouchableOpacity>
                    ) : null}
                    {normalizeCategoryKey(selectedAnn.category) === 'billing' && selectedAnn.billing_id ? (
                      <TouchableOpacity
                        style={styles.notificationAction}
                        accessibilityRole="button"
                        accessibilityLabel="View bill"
                        onPress={() => {
                          // billing_id is server-resolved (see
                          // services/mobileNotificationBridge.js sanitizeStoredNotification,
                          // sourced from the canonical Notification's entityId) — never
                          // client-supplied. resolveNotificationRoute is the same
                          // resolver already used for OS push taps, so a personal
                          // bill notification navigates identically whether it was
                          // opened from a push or from this in-app list.
                          const destination = resolveNotificationRoute({
                            screen: 'billing',
                            billing_id: selectedAnn.billing_id,
                          });
                          setSelectedAnn(null);
                          router.push(destination);
                        }}
                      >
                        <Text style={styles.notificationActionText}>View Bill</Text>
                      </TouchableOpacity>
                    ) : null}
                  </ScrollView>

                  {/* Footer */}
                  <View style={styles.modalFooter}>
                    <View style={styles.footerLeft}>
                      <Ionicons name="calendar-outline" size={11} color={colors.textMuted} />
                      <Text style={styles.announcementDate}>{safeFormat(getAnnouncementDateValue(selectedAnn), 'MMM dd, yyyy · h:mm a')}</Text>
                    </View>
                  <View style={styles.footerAuthor}>
                    <Ionicons name="person-circle-outline" size={11} color={colors.textMuted} />
                    <Text style={styles.authorText}>{selectedAnn.author_name || selectedAnn.source_label || 'LilyCrest System'}</Text>
                  </View>
                </View>
              </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* ── Undo snackbar ── */}
      {pendingDeletion ? (
        <View style={styles.undoSnackbar}>
          <Text style={styles.undoSnackbarText}>
            {pendingDeletion.items.length === 1 ? '1 notification removed' : `${pendingDeletion.items.length} notifications removed`}
          </Text>
          <TouchableOpacity
            style={styles.undoSnackbarAction}
            onPress={undoPendingDeletion}
            accessibilityRole="button"
            accessibilityLabel="Undo remove"
          >
            <Text style={styles.undoSnackbarActionText}>Undo</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
