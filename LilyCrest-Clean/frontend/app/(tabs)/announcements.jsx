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

// Check if announcement is less than 3 days old
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
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 12,
    },
    headerLeft: { flex: 1 },
    headerTitle: { fontSize: 22, fontWeight: '700', color: c.text, letterSpacing: -0.3 },
    headerSubtitle: { fontSize: 13, color: c.textMuted, marginTop: 2 },
    refreshBtn: {
      width: 36, height: 36, borderRadius: 10,
      backgroundColor: c.surfaceSecondary,
      justifyContent: 'center', alignItems: 'center',
    },

    // ── Category Filter ──
    sortRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 10,
      gap: 12,
    },
    sortLabel: { fontSize: 12, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    sortControl: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surfaceSecondary,
      borderRadius: 999,
      padding: 4,
      gap: 4,
    },
    sortChip: {
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: 999,
    },
    sortChipActive: { backgroundColor: '#1E3A5F' },
    sortChipText: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
    sortChipTextActive: { color: '#FFFFFF' },
    categoryFilter: { backgroundColor: c.surface },
    categoryFilterContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, gap: 6 },
    categoryChip: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 6, paddingHorizontal: 12,
      borderRadius: 20, backgroundColor: c.surfaceSecondary,
      marginRight: 4, gap: 5,
    },
    categoryChipActive: { backgroundColor: '#1E3A5F' },
    urgentChipActive: { backgroundColor: '#EF4444' },
    categoryChipText: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
    categoryChipTextActive: { color: '#FFFFFF' },
    chipDivider: { width: 1, height: 20, backgroundColor: c.border, alignSelf: 'center', marginHorizontal: 2 },
    chipCountWrap: {
      backgroundColor: 'rgba(0,0,0,0.08)',
      borderRadius: 8,
      minWidth: 18, height: 18,
      justifyContent: 'center', alignItems: 'center',
      paddingHorizontal: 5,
    },
    chipCountWrapActive: {
      backgroundColor: 'rgba(255,255,255,0.2)',
    },
    chipCount: {
      fontSize: 10, fontWeight: '700',
      color: c.textMuted,
      textAlign: 'center',
    },
    chipCountActive: {
      color: '#FFFFFF',
    },


    // ── Cards ──
    scrollView: { flex: 1 },
    scrollContent: { padding: 16, paddingTop: 16 },
    announcementCard: {
      backgroundColor: c.surface, borderRadius: 14, marginBottom: 12,
      borderWidth: 1, borderColor: c.border,
      overflow: 'hidden',
    },
    cardAccent: {
      position: 'absolute', left: 0, top: 0, bottom: 0,
      width: 3.5, borderTopLeftRadius: 14, borderBottomLeftRadius: 14,
    },
    cardBody: { padding: 14, paddingLeft: 16 },
    announcementHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
    priorityIcon: {
      width: 36, height: 36, borderRadius: 10,
      justifyContent: 'center', alignItems: 'center', marginRight: 10,
    },
    announcementTitleContainer: { flex: 1 },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    announcementTitle: { fontSize: 14, fontWeight: '700', color: c.text, flex: 1, lineHeight: 20 },
    newDot: {
      width: 7, height: 7, borderRadius: 4,
      backgroundColor: '#3B82F6', marginTop: 6,
    },
    announcementTime: { fontSize: 11.5, color: c.textMuted, marginTop: 2 },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8, gap: 6 },
    categoryBadge: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 3, paddingHorizontal: 8,
      borderRadius: 5, gap: 4,
    },
    categoryBadgeText: { fontSize: 10.5, fontWeight: '600' },
    urgentBadge: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: '#FEE2E2', paddingVertical: 3, paddingHorizontal: 8,
      borderRadius: 5, gap: 4,
    },
    urgentText: { fontSize: 10.5, fontWeight: '600', color: '#EF4444' },
    announcementContent: {
      fontSize: 13, color: c.textSecondary, lineHeight: 20,
    },
    announcementFooter: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
      paddingTop: 10, marginTop: 10,
    },
    footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    announcementDate: { fontSize: 10.5, color: c.textMuted, fontWeight: '500' },
    footerAuthor: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    authorText: { fontSize: 10.5, color: c.textMuted, fontWeight: '500' },

    // ── Error Banner ──
    errorBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A',
      borderRadius: 10, padding: 12, marginBottom: 12,
    },
    errorBannerText: { flex: 1, fontSize: 13, color: '#92400E', fontWeight: '500' },

    // ── Empty ──
    emptyState: { alignItems: 'center', paddingVertical: 60 },
    emptyIcon: {
      width: 72, height: 72, borderRadius: 20,
      backgroundColor: c.surfaceSecondary,
      justifyContent: 'center', alignItems: 'center',
      marginBottom: 16,
    },
    emptyTitle: { fontSize: 16, fontWeight: '600', color: c.text, marginBottom: 4 },
    emptyText: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 20, paddingHorizontal: 40 },

    readMoreText: { fontSize: 12, color: c.primary, fontWeight: '600', marginTop: 4 },

    // ── Detail Modal ──
    modalOverlay: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 24,
      maxHeight: '85%',
    },
    modalHeader: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12,
    },
    modalTitle: { fontSize: 15, fontWeight: '700', color: c.text, lineHeight: 22, flex: 1 },
    modalTime: { fontSize: 11.5, color: c.textMuted, marginTop: 2 },
    modalBody: { marginVertical: 14 },
    modalContent: { fontSize: 14, color: c.textSecondary, lineHeight: 22 },
    modalFooter: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingTop: 12,
    },

    bottomSpacer: { height: Platform.OS === 'ios' ? 100 : 80 },
  }));

  const [announcements, setAnnouncements] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [selectedAnn, setSelectedAnn] = useState(null);
  const [sortOrder, setSortOrder] = useState('newest');

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
      // Only poll while this tab is focused
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
    // Color palette — red is RESERVED for urgency, never used for categories
    switch (category?.toLowerCase()) {
      case 'billing':     return { bg: '#DBEAFE', text: '#2563EB', icon: 'card' };            // Blue
      case 'maintenance': return { bg: '#FEF3C7', text: '#D97706', icon: 'construct' };       // Amber
      case 'rules':       return { bg: '#EEF2FF', text: '#4F46E5', icon: 'document-text' };   // Indigo
      case 'promo':       return { bg: '#DCFCE7', text: '#16A34A', icon: 'pricetag' };        // Green
      case 'event':       return { bg: '#F3E8FF', text: '#9333EA', icon: 'calendar' };        // Purple
      default:            return { bg: '#F3F4F6', text: '#4B5563', icon: 'megaphone' };       // Gray
    }
  };

  const getCategoryIcon = (category) => {
    return getCategoryColor(category).icon;
  };

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
      {/* ── Premium Header ── */}
      <View style={styles.headerWrapper}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Announcements</Text>
            <Text style={styles.headerSubtitle}>
              {filteredAnnouncements.length} of {announcements.length} notice{announcements.length !== 1 ? 's' : ''} from management
            </Text>
          </View>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => { if (!refreshing) { setRefreshing(true); fetchAnnouncements(); } }}
            disabled={refreshing}
            accessibilityLabel="Refresh announcements"
          >
            {refreshing ? (
              <ActivityIndicator size={16} color={colors.primary} />
            ) : (
              <Ionicons name="refresh" size={18} color={colors.textMuted} />
            )}
          </TouchableOpacity>
        </View>

        {/* ── Filter Pills ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryFilter} contentContainerStyle={styles.categoryFilterContent}>
          <View style={styles.sortRow}>
            <Text style={styles.sortLabel}>Sort by</Text>
            <View style={styles.sortControl}>
              <TouchableOpacity
                style={[styles.sortChip, sortOrder === 'newest' && styles.sortChipActive]}
                onPress={() => setSortOrder('newest')}
              >
                <Text style={[styles.sortChipText, sortOrder === 'newest' && styles.sortChipTextActive]}>Newest</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sortChip, sortOrder === 'oldest' && styles.sortChipActive]}
                onPress={() => setSortOrder('oldest')}
              >
                <Text style={[styles.sortChipText, sortOrder === 'oldest' && styles.sortChipTextActive]}>Oldest</Text>
              </TouchableOpacity>
            </View>
          </View>
          {categories.map((category) => {
            const isActive = selectedCategory === category || (!selectedCategory && category === 'All');
            const count = getCategoryCount(category);
            return (
              <TouchableOpacity
                key={category}
                style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                onPress={() => { setSelectedCategory(category === 'All' ? null : category); setUrgentOnly(false); }}
              >
                <Ionicons
                  name={category === 'All' ? 'apps' : getCategoryIcon(category)}
                  size={13}
                  color={isActive ? '#FFFFFF' : colors.textMuted}
                />
                <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>{category}</Text>
                <View style={[styles.chipCountWrap, isActive && styles.chipCountWrapActive]}>
                  <Text style={[styles.chipCount, isActive && styles.chipCountActive]}>{count}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Divider + Urgent toggle */}
          <View style={styles.chipDivider} />
          <TouchableOpacity
            style={[styles.categoryChip, urgentOnly && styles.urgentChipActive]}
            onPress={() => setUrgentOnly((prev) => !prev)}
          >
            <Ionicons name="alert-circle" size={13} color={urgentOnly ? '#FFFFFF' : '#EF4444'} />
            <Text style={[styles.categoryChipText, urgentOnly && styles.categoryChipTextActive]}>Urgent</Text>
            <View style={[styles.chipCountWrap, urgentOnly && styles.chipCountWrapActive]}>
              <Text style={[styles.chipCount, urgentOnly && styles.chipCountActive]}>{urgentCount}</Text>
            </View>
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
        {/* ── Fetch Error Banner ── */}
        {fetchError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color="#92400E" />
            <Text style={styles.errorBannerText}>{fetchError}</Text>
          </View>
        ) : null}

        {/* ── Announcement Cards ── */}
        {filteredAnnouncements.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="megaphone-outline" size={32} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>{fetchError ? 'Could not load announcements' : 'No announcements'}</Text>
            <Text style={styles.emptyText}>{fetchError ? 'Check your connection and pull down to refresh.' : 'There are no announcements in this category yet. Pull down to refresh.'}</Text>
          </View>
        ) : filteredAnnouncements.map((announcement) => {
          const catColor = getCategoryColor(announcement.category || 'General');
          const prioColor = getPriorityColor(announcement.priority);
          const announcementDate = getAnnouncementDateValue(announcement);
          const isRecent = isNew(announcementDate);
          const isTruncated = (announcement.content || '').length > 180;
          return (
            <TouchableOpacity
              key={announcement.announcement_id}
              style={styles.announcementCard}
              onPress={() => setSelectedAnn(announcement)}
              activeOpacity={0.85}
            >
              {/* Left accent bar */}
              <View style={[styles.cardAccent, { backgroundColor: prioColor }]} />

              <View style={styles.cardBody}>
                {/* Header row: icon + title */}
                <View style={styles.announcementHeader}>
                  <View style={[styles.priorityIcon, { backgroundColor: `${prioColor}14` }]}>
                    <Ionicons name={getPriorityIcon(announcement.priority)} size={22} color={prioColor} />
                  </View>
                  <View style={styles.announcementTitleContainer}>
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
                    <Ionicons name={catColor.icon} size={11} color={catColor.text} />
                    <Text style={[styles.categoryBadgeText, { color: catColor.text }]}>{announcement.category || 'General'}</Text>
                  </View>
                  {(announcement.priority || '').toLowerCase() === 'high' && (
                    <View style={styles.urgentBadge}>
                      <Ionicons name="warning" size={11} color="#EF4444" />
                      <Text style={styles.urgentText}>Urgent</Text>
                    </View>
                  )}
                </View>

                {/* Content preview */}
                <Text style={styles.announcementContent} numberOfLines={4}>{announcement.content}</Text>

                {isTruncated && (
                  <Text style={styles.readMoreText}>Read more...</Text>
                )}

                {/* Footer */}
                <View style={styles.announcementFooter}>
                  <View style={styles.footerLeft}>
                    <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
                    <Text style={styles.announcementDate}>{safeFormat(announcementDate, 'MMM dd, yyyy • h:mm a')}</Text>
                  </View>
                  <View style={styles.footerAuthor}>
                    <Ionicons name="person-circle-outline" size={13} color={colors.textMuted} />
                    <Text style={styles.authorText}>{announcement.author_name || 'Admin'}</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* ── Announcement Detail Modal ── */}
      <Modal
        visible={!!selectedAnn}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedAnn(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {selectedAnn && (() => {
              const catColor = getCategoryColor(selectedAnn.category || 'General');
              const prioColor = getPriorityColor(selectedAnn.priority);
              return (
                <>
                  {/* Modal header */}
                  <View style={styles.modalHeader}>
                    <View style={[styles.priorityIcon, { backgroundColor: `${prioColor}14` }]}>
                      <Ionicons name={getPriorityIcon(selectedAnn.priority)} size={22} color={prioColor} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalTitle}>{selectedAnn.title}</Text>
                      <Text style={styles.modalTime}>{safeDistanceToNow(getAnnouncementDateValue(selectedAnn))}</Text>
                    </View>
                    <TouchableOpacity onPress={() => setSelectedAnn(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Ionicons name="close" size={22} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  {/* Badges */}
                  <View style={styles.badgeRow}>
                    <View style={[styles.categoryBadge, { backgroundColor: catColor.bg }]}>
                      <Ionicons name={catColor.icon} size={11} color={catColor.text} />
                      <Text style={[styles.categoryBadgeText, { color: catColor.text }]}>{selectedAnn.category || 'General'}</Text>
                    </View>
                    {selectedAnn.priority === 'high' && (
                      <View style={styles.urgentBadge}>
                        <Ionicons name="warning" size={11} color="#EF4444" />
                        <Text style={styles.urgentText}>Urgent</Text>
                      </View>
                    )}
                  </View>

                  {/* Full content */}
                  <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                    <Text style={styles.modalContent}>{selectedAnn.content}</Text>
                  </ScrollView>

                  {/* Modal footer */}
                  <View style={styles.modalFooter}>
                    <View style={styles.footerLeft}>
                      <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
                      <Text style={styles.announcementDate}>{safeFormat(getAnnouncementDateValue(selectedAnn), 'MMM dd, yyyy • h:mm a')}</Text>
                    </View>
                    <View style={styles.footerAuthor}>
                      <Ionicons name="person-circle-outline" size={13} color={colors.textMuted} />
                      <Text style={styles.authorText}>{selectedAnn.author_name || 'Admin'}</Text>
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
