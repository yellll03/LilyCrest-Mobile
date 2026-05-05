import { Ionicons } from '@expo/vector-icons';
import { format, formatDistanceToNow } from 'date-fns';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext';
import { apiService } from '../../src/services/api';

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

function getAnnouncementDateValue(announcement = {}) {
  return announcement.publishedAt
    || announcement.sentAt
    || announcement.created_at
    || announcement.createdAt
    || announcement.updated_at
    || announcement.updatedAt
    || null;
}

function getAnnouncementTimestamp(announcement = {}) {
  const value = getAnnouncementDateValue(announcement);
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function sortAnnouncements(list = [], direction = 'desc') {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...list].sort((left, right) => {
    const leftTimestamp = getAnnouncementTimestamp(left);
    const rightTimestamp = getAnnouncementTimestamp(right);
    if (leftTimestamp === null && rightTimestamp === null) return 0;
    if (leftTimestamp === null) return 1;
    if (rightTimestamp === null) return -1;
    return (leftTimestamp - rightTimestamp) * multiplier;
  });
}

function isNew(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return (Date.now() - d.getTime()) < 3 * 24 * 60 * 60 * 1000;
  } catch (_e) { return false; }
}

export default function AnnouncementsScreen() {
  const { colors } = useTheme();
  const { clearNotificationUnread } = useAuth();
  const styles = useThemedStyles((c) => StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background },

    // ── Header ──
    headerWrapper: {
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 8,
    },
    headerLeft: { flex: 1 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: c.text, letterSpacing: -0.2 },
    headerSubtitle: { fontSize: 11.5, color: c.textMuted, marginTop: 1 },
    refreshBtn: {
      width: 32, height: 32, borderRadius: 8,
      backgroundColor: c.surfaceSecondary,
      justifyContent: 'center', alignItems: 'center',
    },

    // ── Sort button (in header) ──
    sortBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 3,
      paddingVertical: 5, paddingHorizontal: 9,
      borderRadius: 8, backgroundColor: c.surfaceSecondary,
      marginRight: 6,
    },
    sortBtnText: { fontSize: 11.5, fontWeight: '600', color: c.textSecondary },

    // ── Filter strip ──
    filterScroll: { backgroundColor: c.surface },
    filterScrollContent: {
      paddingHorizontal: 14,
      paddingTop: 4,
      paddingBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    chip: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 6, paddingHorizontal: 12,
      borderRadius: 999, backgroundColor: c.surfaceSecondary,
      gap: 5,
    },
    chipActive: { backgroundColor: c.accent },
    urgentChipInactive: {
      backgroundColor: 'transparent',
      borderWidth: 1.5, borderColor: '#EF4444',
    },
    urgentChipActive: { backgroundColor: '#DC2626' },
    chipText: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary },
    chipTextActive: { color: '#FFFFFF' },
    chipTextUrgent: { color: '#EF4444' },
    chipBadge: {
      minWidth: 18, height: 18, borderRadius: 9,
      backgroundColor: 'rgba(0,0,0,0.09)',
      justifyContent: 'center', alignItems: 'center',
      paddingHorizontal: 4,
    },
    chipBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
    chipBadgeUrgent: { backgroundColor: '#FEE2E2' },
    chipBadgeText: { fontSize: 10.5, fontWeight: '700', color: c.textSecondary },
    chipBadgeTextActive: { color: '#FFFFFF' },
    chipBadgeTextUrgent: { color: '#DC2626' },

    readMoreBtn: { marginTop: 4, alignSelf: 'flex-start' },
    readMoreText: { fontSize: 13, fontWeight: '600', color: c.primary },

    // ── Cards ──
    scrollView: { flex: 1 },
    scrollContent: { padding: 12, paddingTop: 12 },
    announcementCard: {
      backgroundColor: c.surface, borderRadius: 12, marginBottom: 9,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
      overflow: 'hidden',
    },
    cardAccent: {
      position: 'absolute', left: 0, top: 0, bottom: 0,
      width: 3, borderTopLeftRadius: 12, borderBottomLeftRadius: 12,
    },
    cardBody: { padding: 11, paddingLeft: 13 },
    cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
    priorityIcon: {
      width: 28, height: 28, borderRadius: 8,
      justifyContent: 'center', alignItems: 'center', marginRight: 8,
    },
    titleColumn: { flex: 1 },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
    announcementTitle: { fontSize: 14, fontWeight: '700', color: c.text, flex: 1, lineHeight: 20 },
    newDot: {
      width: 6, height: 6, borderRadius: 3,
      backgroundColor: '#3B82F6', marginTop: 6,
    },
    announcementTime: { fontSize: 11.5, color: c.textMuted, marginTop: 2 },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6, gap: 4 },
    categoryBadge: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 2, paddingHorizontal: 6,
      borderRadius: 4, gap: 3,
    },
    categoryBadgeText: { fontSize: 11, fontWeight: '600' },
    urgentBadge: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: '#FEE2E2', paddingVertical: 2, paddingHorizontal: 6,
      borderRadius: 4, gap: 3,
    },
    urgentText: { fontSize: 11, fontWeight: '600', color: '#DC2626' },
    announcementContent: {
      fontSize: 13.5, color: c.textSecondary, lineHeight: 20,
    },
    announcementFooter: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
      paddingTop: 8, marginTop: 8,
    },
    footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    announcementDate: { fontSize: 11, color: c.textMuted, fontWeight: '500' },
    footerAuthor: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    authorText: { fontSize: 11, color: c.textMuted, fontWeight: '500' },

    // ── Error banner ──
    errorBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A',
      borderRadius: 8, padding: 10, marginBottom: 10,
    },
    errorBannerText: { flex: 1, fontSize: 12.5, color: '#92400E', fontWeight: '500' },

    // ── Empty state ──
    emptyState: { alignItems: 'center', paddingVertical: 48 },
    emptyIcon: {
      width: 56, height: 56, borderRadius: 16,
      backgroundColor: c.surfaceSecondary,
      justifyContent: 'center', alignItems: 'center',
      marginBottom: 12,
    },
    emptyTitle: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 4 },
    emptyText: { fontSize: 12.5, color: c.textMuted, textAlign: 'center', lineHeight: 18, paddingHorizontal: 36 },

    // ── Detail sheet ──
    modalOverlay: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.42)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 18,
      maxHeight: '82%',
    },
    dragHandle: { alignItems: 'center', marginBottom: 12 },
    dragHandlePill: {
      width: 32, height: 3, borderRadius: 2,
      backgroundColor: 'rgba(0,0,0,0.12)',
    },
    modalHeader: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10,
    },
    modalTitleWrap: { flex: 1 },
    modalTitle: { fontSize: 14, fontWeight: '700', color: c.text, lineHeight: 20, flex: 1 },
    modalTime: { fontSize: 11, color: c.textMuted, marginTop: 2 },
    modalBody: { marginVertical: 10 },
    modalContent: { fontSize: 13.5, color: c.textSecondary, lineHeight: 20 },
    modalFooter: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingTop: 10,
    },
    modalCloseBtn: {
      width: 26, height: 26, borderRadius: 7,
      backgroundColor: 'rgba(0,0,0,0.06)',
      justifyContent: 'center', alignItems: 'center',
    },

    bottomSpacer: { height: Platform.OS === 'ios' ? 80 : 60 },
  }));

  const [announcements, setAnnouncements] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [selectedAnn, setSelectedAnn] = useState(null);
  const [sortOrder, setSortOrder] = useState('newest');
  const [expandedIds, setExpandedIds] = useState(new Set());

  const fetchAnnouncements = useCallback(async (silent = false) => {
    if (!silent) setFetchError(null);
    try {
      const response = await apiService.getAnnouncements();
      setAnnouncements(Array.isArray(response.data) ? response.data : []);
      setFetchError(null);
    } catch (error) {
      console.error('Fetch announcements error:', error);
      if (!silent) setFetchError('Unable to load announcements. Pull down to refresh.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAnnouncements(); }, [fetchAnnouncements]);
  useFocusEffect(
    useCallback(() => {
      clearNotificationUnread().catch(() => {});
      const interval = setInterval(() => { fetchAnnouncements(true); }, 60000);
      return () => clearInterval(interval);
    }, [clearNotificationUnread, fetchAnnouncements])
  );

  const onRefresh = useCallback(() => { setRefreshing(true); fetchAnnouncements(); }, [fetchAnnouncements]);

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
      case 'billing':     return { bg: '#DBEAFE', text: '#2563EB', icon: 'card' };
      case 'maintenance': return { bg: '#FEF3C7', text: '#D97706', icon: 'construct' };
      case 'rules':       return { bg: '#EEF2FF', text: '#4F46E5', icon: 'document-text' };
      case 'promo':       return { bg: '#DCFCE7', text: '#16A34A', icon: 'pricetag' };
      case 'event':       return { bg: '#F3E8FF', text: '#9333EA', icon: 'calendar' };
      default:            return { bg: '#F3F4F6', text: '#4B5563', icon: 'megaphone' };
    }
  };

  const getCategoryIcon = (category) => getCategoryColor(category).icon;

  const sortedAnnouncements = useMemo(
    () => sortAnnouncements(announcements, sortOrder === 'oldest' ? 'asc' : 'desc'),
    [announcements, sortOrder]
  );

  const categories = ['All', ...new Set(sortedAnnouncements.map((a) => a.category || 'General'))];

  const filteredAnnouncements = sortedAnnouncements.filter((a) => {
    const catMatch = !selectedCategory || selectedCategory === 'All' || (a.category || 'General') === selectedCategory;
    const urgentMatch = !urgentOnly || (a.priority || '').toLowerCase() === 'high';
    return catMatch && urgentMatch;
  });

  const getCategoryCount = (cat) => {
    return announcements.filter((a) => {
      const catMatch = cat === 'All' || (a.category || 'General') === cat;
      const urgentMatch = !urgentOnly || (a.priority || '').toLowerCase() === 'high';
      return catMatch && urgentMatch;
    }).length;
  };

  const urgentCount = announcements.filter((a) => {
    const catMatch = !selectedCategory || selectedCategory === 'All' || (a.category || 'General') === selectedCategory;
    return catMatch && (a.priority || '').toLowerCase() === 'high';
  }).length;

  if (isLoading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.headerWrapper}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Announcements</Text>
            <Text style={styles.headerSubtitle}>
              {filteredAnnouncements.length} of {announcements.length}{announcements.length !== 1 ? ' notices' : ' notice'} from management
            </Text>
          </View>
          <TouchableOpacity
            style={styles.sortBtn}
            onPress={() => setSortOrder((prev) => prev === 'newest' ? 'oldest' : 'newest')}
            accessibilityLabel="Toggle sort order"
          >
            <Ionicons name={sortOrder === 'newest' ? 'arrow-down' : 'arrow-up'} size={13} color={colors.textSecondary} />
            <Text style={styles.sortBtnText}>{sortOrder === 'newest' ? 'Newest' : 'Oldest'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => { if (!refreshing) { setRefreshing(true); fetchAnnouncements(); } }}
            disabled={refreshing}
            accessibilityLabel="Refresh announcements"
          >
            {refreshing
              ? <ActivityIndicator size={14} color={colors.primary} />
              : <Ionicons name="refresh" size={16} color={colors.textMuted} />
            }
          </TouchableOpacity>
        </View>

        {/* ── Filter strip ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterScrollContent}
        >
          {categories.map((category) => {
            const isActive = selectedCategory === category || (!selectedCategory && category === 'All');
            const count = getCategoryCount(category);
            return (
              <TouchableOpacity
                key={category}
                style={[styles.chip, isActive && styles.chipActive]}
                onPress={() => { setSelectedCategory(category === 'All' ? null : category); setUrgentOnly(false); }}
              >
                <Ionicons
                  name={category === 'All' ? 'apps' : getCategoryIcon(category)}
                  size={13}
                  color={isActive ? '#FFFFFF' : colors.textSecondary}
                />
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{category}</Text>
                {count > 0 && (
                  <View style={[styles.chipBadge, isActive && styles.chipBadgeActive]}>
                    <Text style={[styles.chipBadgeText, isActive && styles.chipBadgeTextActive]}>{count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={[styles.chip, urgentOnly ? styles.urgentChipActive : styles.urgentChipInactive]}
            onPress={() => setUrgentOnly((prev) => !prev)}
          >
            <Ionicons name="alert-circle" size={13} color={urgentOnly ? '#FFFFFF' : '#EF4444'} />
            <Text style={[styles.chipText, urgentOnly ? styles.chipTextActive : styles.chipTextUrgent]}>Urgent</Text>
            {urgentCount > 0 && (
              <View style={[styles.chipBadge, urgentOnly ? styles.chipBadgeActive : styles.chipBadgeUrgent]}>
                <Text style={[styles.chipBadgeText, urgentOnly ? styles.chipBadgeTextActive : styles.chipBadgeTextUrgent]}>{urgentCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* ── Content ── */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        showsVerticalScrollIndicator={false}
      >
        {fetchError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="cloud-offline-outline" size={15} color="#92400E" />
            <Text style={styles.errorBannerText}>{fetchError}</Text>
          </View>
        ) : null}

        {filteredAnnouncements.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="megaphone-outline" size={26} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>{fetchError ? 'Could not load announcements' : 'No announcements'}</Text>
            <Text style={styles.emptyText}>{fetchError ? 'Check your connection and pull down to refresh.' : 'No announcements in this category yet. Pull down to refresh.'}</Text>
          </View>
        ) : filteredAnnouncements.map((announcement) => {
          const catColor = getCategoryColor(announcement.category || 'General');
          const prioColor = getPriorityColor(announcement.priority);
          const announcementDate = getAnnouncementDateValue(announcement);
          const isRecent = isNew(announcementDate);

          return (
            <TouchableOpacity
              key={announcement.announcement_id}
              style={styles.announcementCard}
              onPress={() => setSelectedAnn(announcement)}
              activeOpacity={0.85}
            >
              {/* Left priority accent */}
              <View style={[styles.cardAccent, { backgroundColor: prioColor }]} />

              <View style={styles.cardBody}>
                {/* Icon + title row */}
                <View style={styles.cardHeader}>
                  <View style={[styles.priorityIcon, { backgroundColor: `${prioColor}14` }]}>
                    <Ionicons name={getPriorityIcon(announcement.priority)} size={16} color={prioColor} />
                  </View>
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
                    <Text style={[styles.categoryBadgeText, { color: catColor.text }]}>{announcement.category || 'General'}</Text>
                  </View>
                  {(announcement.priority || '').toLowerCase() === 'high' && (
                    <View style={styles.urgentBadge}>
                      <Ionicons name="warning" size={10} color="#DC2626" />
                      <Text style={styles.urgentText}>Urgent</Text>
                    </View>
                  )}
                </View>

                {/* Content preview */}
                {(() => {
                  const isExpanded = expandedIds.has(announcement.announcement_id);
                  const isLong = (announcement.content || '').length > 120;
                  return (
                    <>
                      <Text style={styles.announcementContent} numberOfLines={isExpanded ? undefined : 3}>
                        {announcement.content}
                      </Text>
                      {isLong && (
                        <TouchableOpacity
                          style={styles.readMoreBtn}
                          onPress={() => setExpandedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(announcement.announcement_id)) next.delete(announcement.announcement_id);
                            else next.add(announcement.announcement_id);
                            return next;
                          })}
                          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        >
                          <Text style={styles.readMoreText}>{isExpanded ? 'Show less' : 'Read more'}</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  );
                })()}

                {/* Footer */}
                <View style={styles.announcementFooter}>
                  <View style={styles.footerLeft}>
                    <Ionicons name="calendar-outline" size={11} color={colors.textMuted} />
                    <Text style={styles.announcementDate}>{safeFormat(announcementDate, 'MMM dd, yyyy')}</Text>
                  </View>
                  <View style={styles.footerAuthor}>
                    <Ionicons name="person-circle-outline" size={11} color={colors.textMuted} />
                    <Text style={styles.authorText}>Management</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
        <View style={styles.bottomSpacer} />
      </ScrollView>

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
                      <Text style={[styles.categoryBadgeText, { color: catColor.text }]}>{selectedAnn.category || 'General'}</Text>
                    </View>
                    {selectedAnn.priority === 'high' && (
                      <View style={styles.urgentBadge}>
                        <Ionicons name="warning" size={10} color="#DC2626" />
                        <Text style={styles.urgentText}>Urgent</Text>
                      </View>
                    )}
                  </View>

                  {/* Full content */}
                  <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                    <Text style={styles.modalContent}>{selectedAnn.content}</Text>
                  </ScrollView>

                  {/* Footer */}
                  <View style={styles.modalFooter}>
                    <View style={styles.footerLeft}>
                      <Ionicons name="calendar-outline" size={11} color={colors.textMuted} />
                      <Text style={styles.announcementDate}>{safeFormat(getAnnouncementDateValue(selectedAnn), 'MMM dd, yyyy · h:mm a')}</Text>
                    </View>
                    <View style={styles.footerAuthor}>
                      <Ionicons name="person-circle-outline" size={11} color={colors.textMuted} />
                      <Text style={styles.authorText}>Management</Text>
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
