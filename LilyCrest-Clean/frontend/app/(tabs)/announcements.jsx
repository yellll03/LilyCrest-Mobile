import { Ionicons } from '@expo/vector-icons';
import { format, formatDistanceToNow } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext';
import { useToast } from '../../src/context/ToastContext';
import {
  getCanonicalAnnouncementId,
  MAX_ANNOUNCEMENT_DISMISS_IDS,
  useCanonicalAnnouncements,
} from '../../src/hooks/useCanonicalAnnouncements';
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
  // The News tab reads the backend's canonical announcement list. Home's
  // notification center remains a separate AuthContext-owned collection.
  const {
    announcements: feedItems,
    hasLoadedOnce,
    refreshing,
    fetchError,
    dismissalInFlight,
    loadAnnouncements,
    dismissAnnouncements,
    restoreAnnouncement,
  } = useCanonicalAnnouncements();
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
      backgroundColor: c.headerBg,
      borderBottomWidth: 3,
      borderBottomColor: c.accent,
    },
    headerLeft: { flex: 1 },
    headerTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
    headerSubtitle: { fontSize: 12, color: '#D0D7E2', marginTop: 2 },
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
      backgroundColor: dark ? c.surfaceSecondary : '#FBF7EA',
      borderColor: c.accent,
    },
    toolbarButtonDisabled: { opacity: 0.65 },
    toolbarButtonText: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
    toolbarButtonTextActive: { color: dark ? c.accent : c.heading },

    readMoreBtn: { marginTop: 6, alignSelf: 'flex-start' },
    readMoreText: { fontSize: 13, fontWeight: '600', color: c.primary },

    // ── Cards ──
    scrollView: { flex: 1 },
    scrollContent: { padding: 14, paddingTop: 14, gap: 10 },
    announcementCard: {
      backgroundColor: c.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
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
      backgroundColor: c.accent, marginTop: 7, flexShrink: 0,
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
      backgroundColor: c.errorBg,
      paddingVertical: 3, paddingHorizontal: 8,
      borderRadius: 6, gap: 4,
    },
    urgentText: { fontSize: 12, fontWeight: '600', color: dark ? '#DC2626' : '#DC2626' },
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
      backgroundColor: dark ? c.errorBg : '#FEF2F2',
      borderWidth: 1, borderColor: c.error,
      borderRadius: 10, padding: 12, marginBottom: 10,
    },
    errorBannerText: { flex: 1, fontSize: 13, color: dark ? c.errorText : '#991B1B', fontWeight: '500' },
    retryButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 6 },
    retryButtonText: { fontSize: 13, fontWeight: '800', color: dark ? c.errorText : '#991B1B' },

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
    emptyActionText: { color: '#0A1628', fontSize: 13, fontWeight: '800' },

    // ── Filter sheet ──
    filterModalOverlay: {
      flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)',
    },
    filterSheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 12, borderTopRightRadius: 12,
      maxHeight: '84%', paddingTop: 10,
      paddingBottom: Platform.OS === 'ios' ? 34 : 20,
      borderWidth: 1, borderColor: c.border,
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
    filterOptionSelected: { backgroundColor: c.accentSubtle },
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
    filterCountSelected: { backgroundColor: c.accentSubtle },
    filterCountText: { fontSize: 12, color: c.textMuted, fontWeight: '700' },
    filterCountTextSelected: { color: c.heading },
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
    filterApplyText: { fontSize: 14, fontWeight: '800', color: '#0A1628' },

    // ── Detail sheet ──
    modalOverlay: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 12, borderTopRightRadius: 12,
      padding: 18, paddingBottom: Platform.OS === 'ios' ? 34 : 20,
      maxHeight: '82%', borderWidth: 1, borderColor: c.border,
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
    notificationActionText: { color: '#0A1628', fontWeight: '800' },
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
      backgroundColor: '#DC2626', justifyContent: 'center', alignItems: 'center',
      flexDirection: 'row', gap: 6,
    },
    selectionDeleteButtonDisabled: { opacity: 0.5 },
    selectionDeleteText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },

    swipeAction: {
      width: 96, marginBottom: 10, borderRadius: 12,
      backgroundColor: c.error,
      justifyContent: 'center', alignItems: 'center', gap: 5,
    },
    swipeActionText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
    undoSnackbar: {
      position: 'absolute', left: 16, right: 16, bottom: Platform.OS === 'ios' ? 94 : 76,
      minHeight: 52, borderRadius: 12, paddingHorizontal: 16,
      backgroundColor: dark ? '#E5E7EB' : '#0A1628',
      flexDirection: 'row', alignItems: 'center', gap: 12,
      ...Platform.select({
        default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.14, shadowRadius: 5, elevation: 3 },
      }),
    },
    undoSnackbarText: { flex: 1, color: dark ? '#0A1628' : '#FFFFFF', fontSize: 13, fontWeight: '600' },
    undoSnackbarButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 4 },
    undoSnackbarButtonText: { color: c.accent, fontSize: 13, fontWeight: '900' },

  }));

  const [selectedCategory, setSelectedCategory] = useState(null);
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [isFilterSheetVisible, setIsFilterSheetVisible] = useState(false);
  const [selectedAnn, setSelectedAnn] = useState(null);
  const [sortOrder, setSortOrder] = useState('newest');
  const [expandedIds, setExpandedIds] = useState(new Set());

  // Selection contains only canonical announcement IDs. The backend owns
  // visibility and tenant-specific persistence.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [undoDismissal, setUndoDismissal] = useState(null);
  const undoTimerRef = useRef(null);

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  // Navigation focus and foreground both reconcile with canonical server data.
  useFocusEffect(
    useCallback(() => {
      loadAnnouncements({ silent: true });
    }, [loadAnnouncements])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') loadAnnouncements({ silent: true });
    });
    return () => subscription.remove();
  }, [loadAnnouncements]);

  const onRefresh = useCallback(
    () => loadAnnouncements({ showRefresh: true }),
    [loadAnnouncements],
  );

  const removeAnnouncements = useCallback(async (ids, { exitSelectionOnSuccess = false } = {}) => {
    const result = await dismissAnnouncements(ids);

    if (!result.ok) {
      if (result.reason === 'busy' || result.reason === 'empty') return false;
      showToast({
        type: 'error',
        title: result.reason === 'limit' ? 'Selection limit reached' : 'Archive failed',
        message: result.reason === 'limit'
          ? `Select up to ${MAX_ANNOUNCEMENT_DISMISS_IDS} announcements at a time.`
          : "Couldn't remove the announcement. Check your connection and try again.",
      });
      return false;
    }

    if (exitSelectionOnSuccess) {
      setSelectionMode(false);
      setSelectedIds(new Set());
    }
    setSelectedAnn((current) => (
      result.ids.includes(getCanonicalAnnouncementId(current)) ? null : current
    ));
    if (result.ids.length === 1 && result.removed?.[0]) {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndoDismissal({ id: result.ids[0], removedEntry: result.removed[0] });
      undoTimerRef.current = setTimeout(() => setUndoDismissal(null), 6000);
    }
    return true;
  }, [dismissAnnouncements, showToast]);

  const undoLastDismissal = useCallback(async () => {
    const pending = undoDismissal;
    if (!pending) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoDismissal(null);
    const result = await restoreAnnouncement(pending.id, pending.removedEntry);
    if (!result.ok) {
      showToast({
        type: 'error',
        title: 'Undo failed',
        message: "Couldn't restore the announcement. Pull down to refresh and try again.",
      });
    }
  }, [restoreAnnouncement, showToast, undoDismissal]);

  const toggleSelected = useCallback((id) => {
    if (!selectedIds.has(id) && selectedIds.size >= MAX_ANNOUNCEMENT_DISMISS_IDS) {
      showToast({
        type: 'error',
        title: 'Selection limit reached',
        message: `Select up to ${MAX_ANNOUNCEMENT_DISMISS_IDS} announcements at a time.`,
      });
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [selectedIds, showToast]);

  const enterSelectionMode = useCallback((id) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const deleteSelected = useCallback(() => {
    removeAnnouncements([...selectedIds], { exitSelectionOnSuccess: true });
  }, [removeAnnouncements, selectedIds]);

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return '#DC2626';
      case 'normal': return '#2563EB';
      case 'low': return '#059669';
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
      case 'announcement': return { bg: '#F1F5F9', text: '#2563EB', icon: 'megaphone' };
      case 'billing':     return { bg: '#EFF6FF', text: '#2563EB', icon: 'card' };
      case 'maintenance': return { bg: '#FFFBEB', text: '#D97706', icon: 'construct' };
      case 'assistant':   return { bg: '#FBF7EA', text: '#B9921F', icon: 'chatbubble-ellipses' };
      case 'security':    return { bg: '#FEF2F2', text: '#DC2626', icon: 'shield-checkmark' };
      case 'reservation': return { bg: '#ECFDF5', text: '#059669', icon: 'calendar' };
      case 'survey':      return { bg: '#EFF6FF', text: '#2563EB', icon: 'chatbox-ellipses' };
      case 'rules':       return { bg: '#F1F5F9', text: '#2563EB', icon: 'document-text' };
      case 'promo':       return { bg: '#ECFDF5', text: '#059669', icon: 'pricetag' };
      case 'event':       return { bg: '#EFF6FF', text: '#2563EB', icon: 'calendar' };
      default:            return { bg: '#F1F5F9', text: '#4B5563', icon: 'megaphone' };
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
    (announcement) => getCanonicalAnnouncementId(announcement) || `${announcement.title}-${String(getAnnouncementDateValue(announcement) || '')}`,
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
    const announcementId = getCanonicalAnnouncementId(announcement);
    const isExpanded = expandedIds.has(announcementId);
    const isLong = (announcement.content || '').length > 120;
    const isSelected = selectedIds.has(announcementId);

    const archiveAction = (
      <Pressable
        style={styles.swipeAction}
        onPress={() => removeAnnouncements([announcementId])}
        accessibilityRole="button"
        accessibilityLabel={`Archive ${announcement.title || 'announcement'}`}
      >
        <Ionicons name="archive-outline" size={20} color="#FFFFFF" />
        <Text style={styles.swipeActionText}>Archive</Text>
      </Pressable>
    );

    return (
      <Swipeable
        enabled={!selectionMode && !dismissalInFlight}
        renderRightActions={() => archiveAction}
        rightThreshold={64}
        overshootRight={false}
        onSwipeableOpen={(direction) => {
          if (direction === 'right') removeAnnouncements([announcementId]);
        }}
      >
      <TouchableOpacity
        style={styles.announcementCard}
        onPress={() => (selectionMode ? toggleSelected(announcementId) : setSelectedAnn(announcement))}
        onLongPress={() => enterSelectionMode(announcementId)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Announcement: ${announcement.title || 'Untitled'}`}
        accessibilityActions={[{ name: 'archive', label: 'Archive announcement' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'archive') removeAnnouncements([announcementId]);
        }}
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
                {isSelected ? <Ionicons name="checkmark" size={14} color="#0A1628" /> : null}
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
      </Swipeable>
    );
  }, [colors.textMuted, dismissalInFlight, expandedIds, styles, toggleExpanded, selectionMode, selectedIds, toggleSelected, enterSelectionMode, removeAnnouncements]);

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
                onPress={() => setSelectedIds(new Set(
                  visibleAnnouncements
                    .map(getCanonicalAnnouncementId)
                    .filter(Boolean)
                    .slice(0, MAX_ANNOUNCEMENT_DISMISS_IDS),
                ))}
                disabled={dismissalInFlight}
                accessibilityRole="button"
                accessibilityLabel="Select all"
              >
                <Text style={styles.selectionBarButtonText}>Select all</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.selectionDeleteButton, (!selectedIds.size || dismissalInFlight) && styles.selectionDeleteButtonDisabled]}
              onPress={deleteSelected}
              disabled={!selectedIds.size || dismissalInFlight}
              accessibilityRole="button"
              accessibilityLabel={`Archive ${selectedIds.size} selected`}
              accessibilityState={{ disabled: !selectedIds.size || dismissalInFlight, busy: dismissalInFlight }}
            >
              {dismissalInFlight
                ? <ActivityIndicator size={15} color="#FFFFFF" />
                : <Ionicons name="archive-outline" size={15} color="#FFFFFF" />
              }
              <Text style={styles.selectionDeleteText}>{dismissalInFlight ? 'Archiving' : 'Archive'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Announcements</Text>
            <Text style={styles.headerSubtitle}>
              {hasActiveFilters
                ? `${filteredAnnouncements.length} of ${feedItems.length} ${feedItems.length === 1 ? 'announcement' : 'announcements'}`
                : `${feedItems.length} ${feedItems.length === 1 ? 'announcement' : 'announcements'}`}
            </Text>
          </View>
        </View>
        )}

        {!selectionMode && <View style={styles.toolbarRow}>
          <TouchableOpacity
            style={[styles.toolbarButton, hasActiveFilters && styles.toolbarButtonActive]}
            onPress={openFilterSheet}
            accessibilityRole="button"
            accessibilityLabel={`Open announcement filters${activeFilterCount ? `, ${activeFilterCount} active` : ''}`}
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
            onPress={() => { if (!refreshing) loadAnnouncements({ showRefresh: true }); }}
            disabled={refreshing}
            accessibilityRole="button"
            accessibilityLabel="Refresh announcements"
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
            <Ionicons name="cloud-offline-outline" size={15} color="#991B1B" />
            <Text style={styles.errorBannerText}>{fetchError}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => loadAnnouncements()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading announcements"
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="megaphone-outline" size={26} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>
              {fetchError && feedItems.length === 0
                ? 'Could not load announcements'
                : feedItems.length === 0
                  ? 'No announcements yet'
                  : 'No announcements match these filters'}
            </Text>
            <Text style={styles.emptyText}>
              {fetchError && feedItems.length === 0
                ? 'Check your connection and retry.'
                : feedItems.length === 0
                  ? 'News and announcements from LilyCrest will appear here.'
                  : 'Try another category or priority, or clear the active filters.'}
            </Text>
            {feedItems.length > 0 && hasActiveFilters ? (
              <TouchableOpacity
                style={styles.emptyAction}
                onPress={clearFilters}
                accessibilityRole="button"
                accessibilityLabel="Clear announcement filters"
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
            accessibilityLabel="Close announcement filters"
          />
          <View style={styles.filterSheet} accessibilityViewIsModal>
            <View style={styles.dragHandle}>
              <View style={styles.dragHandlePill} />
            </View>
            <View style={styles.filterSheetHeader}>
              <View style={styles.filterSheetTitleWrap}>
                <Text style={styles.filterSheetTitle}>Filter Announcements</Text>
                <Text style={styles.filterSheetSubtitle}>Tap a category or priority to filter instantly.</Text>
              </View>
              <TouchableOpacity
                style={styles.filterCloseButton}
                onPress={closeFilterSheet}
                accessibilityRole="button"
                accessibilityLabel="Close announcement filters"
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
                      accessibilityLabel={`${label}, ${count} ${count === 1 ? 'announcement' : 'announcements'}`}
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
                      accessibilityLabel={`${option.label} priority, ${count} ${count === 1 ? 'announcement' : 'announcements'}`}
                    >
                      <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                        {selected ? <View style={styles.radioInner} /> : null}
                      </View>
                      <Ionicons
                        name={option.icon}
                        size={17}
                        color={option.key === 'urgent' ? '#DC2626' : (selected ? colors.accent : colors.textMuted)}
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
                accessibilityLabel="Reset announcement filters"
              >
                <Text style={styles.filterResetText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.filterApplyButton}
                onPress={closeFilterSheet}
                accessibilityRole="button"
                accessibilityLabel="Done filtering announcements"
              >
                <Text style={styles.filterApplyText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {undoDismissal ? (
        <View style={styles.undoSnackbar} accessibilityRole="alert">
          <Text style={styles.undoSnackbarText}>Announcement removed</Text>
          <Pressable
            style={styles.undoSnackbarButton}
            onPress={undoLastDismissal}
            accessibilityRole="button"
            accessibilityLabel="Undo announcement archive"
          >
            <Text style={styles.undoSnackbarButtonText}>Undo</Text>
          </Pressable>
        </View>
      ) : null}

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

    </SafeAreaView>
  );
}
