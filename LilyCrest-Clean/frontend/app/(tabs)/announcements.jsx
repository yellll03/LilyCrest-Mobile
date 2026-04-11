import { Ionicons } from '@expo/vector-icons';
import { format, formatDistanceToNow } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

// Check if announcement is less than 3 days old
function isNew(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return (Date.now() - d.getTime()) < 3 * 24 * 60 * 60 * 1000;
  } catch (_e) { return false; }
}

export default function AnnouncementsScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
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

    bottomSpacer: { height: Platform.OS === 'ios' ? 100 : 80 },
  }));

  const [announcements, setAnnouncements] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [urgentOnly, setUrgentOnly] = useState(false);

  const MOCK_ANNOUNCEMENTS = [
    {
      announcement_id: 'ann_001',
      title: 'April 2026 Billing Statements Released',
      content: 'Your April 2026 billing statements are now available in the app. Kindly settle your balance on or before April 28, 2026 to avoid late fees. You may pay conveniently via GCash, Maya, or Credit/Debit Card through our in-app PayMongo payment. For concerns, message us at 0917 1000087.',
      author_name: 'LilyCrest Admin',
      priority: 'high',
      category: 'Billing',
      is_urgent: true,
      created_at: '2026-04-18T08:00:00.000Z',
    },
    {
      announcement_id: 'ann_002',
      title: 'Scheduled Water Interruption – April 12, 2026',
      content: 'Please be advised that there will be a scheduled water interruption on Saturday, April 12, 2026, from 8:00 AM to 5:00 PM due to pipe maintenance. Please store enough water before the interruption. We apologize for the inconvenience and appreciate your understanding.',
      author_name: 'LilyCrest Admin',
      priority: 'high',
      category: 'Maintenance',
      is_urgent: true,
      created_at: '2026-04-09T09:00:00.000Z',
    },
    {
      announcement_id: 'ann_003',
      title: 'House Rules Reminder: Quiet Hours',
      content: 'As a reminder to all tenants, quiet hours are strictly observed from 10:00 PM to 7:00 AM. Please keep noise to a minimum during these hours out of respect for your fellow residents. Repeated violations may result in a notice from management. Thank you for your cooperation.',
      author_name: 'LilyCrest Admin',
      priority: 'normal',
      category: 'Rules',
      is_urgent: false,
      created_at: '2026-04-05T10:00:00.000Z',
    },
    {
      announcement_id: 'ann_004',
      title: 'Refer a Friend – Get 1 Month FREE!',
      content: 'Know someone looking for a place to stay? Refer a friend and get 1 month of free WiFi when they successfully move in! Simply have them mention your name upon inquiry. This promo is ongoing until slots are filled. Spread the word and enjoy the perks!',
      author_name: 'LilyCrest Admin',
      priority: 'normal',
      category: 'Promo',
      is_urgent: false,
      created_at: '2026-04-01T08:00:00.000Z',
    },
    {
      announcement_id: 'ann_005',
      title: 'Welcome, New Tenants! – April 2026 Move-Ins',
      content: 'LilyCrest warmly welcomes our new tenants who moved in this April! We hope you feel at home. Should you need anything or have questions about the dorm policies, do not hesitate to reach out to us at 0917 1000087 or message us on our Facebook page. Enjoy your stay!',
      author_name: 'LilyCrest Admin',
      priority: 'low',
      category: 'General',
      is_urgent: false,
      created_at: '2026-04-01T07:00:00.000Z',
    },
  ];

  const fetchAnnouncements = async () => {
    try {
      const response = await apiService.getAnnouncements();
      const real = response.data || [];
      // Always show mock announcements; real ones are prepended and take priority
      const realIds = new Set(real.map(a => a.announcement_id).filter(Boolean));
      const merged = [
        ...real,
        ...MOCK_ANNOUNCEMENTS.filter(m => !realIds.has(m.announcement_id)),
      ];
      setAnnouncements(merged);
    } catch (error) {
      console.error('Fetch announcements error:', error);
      setAnnouncements([...MOCK_ANNOUNCEMENTS]);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchAnnouncements(); }, []);
  useFocusEffect(
    useCallback(() => {
      // Only poll while this tab is focused
      const interval = setInterval(() => { fetchAnnouncements(); }, 60000);
      return () => clearInterval(interval);
    }, [])
  );

  const onRefresh = useCallback(() => { setRefreshing(true); fetchAnnouncements(); }, []);

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

  const categories = ['All', ...new Set(announcements.map((a) => a.category || 'General'))];

  const filteredAnnouncements = announcements.filter((a) => {
    const catMatch = !selectedCategory || selectedCategory === 'All' || (a.category || 'General') === selectedCategory;
    const urgentMatch = !urgentOnly || a.priority === 'high';
    return catMatch && urgentMatch;
  });

  const getCategoryCount = (cat) => {
    return announcements.filter((a) => {
      const catMatch = cat === 'All' || (a.category || 'General') === cat;
      const urgentMatch = !urgentOnly || a.priority === 'high';
      return catMatch && urgentMatch;
    }).length;
  };

  const urgentCount = announcements.filter((a) => {
    const catMatch = !selectedCategory || selectedCategory === 'All' || (a.category || 'General') === selectedCategory;
    return catMatch && a.priority === 'high';
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
          {categories.map((category) => {
            const isActive = selectedCategory === category || (!selectedCategory && category === 'All');
            const count = getCategoryCount(category);
            return (
              <TouchableOpacity
                key={category}
                style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                onPress={() => setSelectedCategory(category === 'All' ? null : category)}
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


        {/* ── Announcement Cards ── */}
        {filteredAnnouncements.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="megaphone-outline" size={32} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No announcements</Text>
            <Text style={styles.emptyText}>There are no announcements in this category yet. Pull down to refresh.</Text>
          </View>
        ) : filteredAnnouncements.map((announcement) => {
          const catColor = getCategoryColor(announcement.category || 'General');
          const prioColor = getPriorityColor(announcement.priority);
          const isRecent = isNew(announcement.created_at);
          return (
            <View key={announcement.announcement_id} style={styles.announcementCard}>
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
                    <Text style={styles.announcementTime}>{safeDistanceToNow(announcement.created_at)}</Text>
                  </View>
                </View>

                {/* Category + Urgent badges */}
                <View style={styles.badgeRow}>
                  <View style={[styles.categoryBadge, { backgroundColor: catColor.bg }]}>
                    <Ionicons name={catColor.icon} size={11} color={catColor.text} />
                    <Text style={[styles.categoryBadgeText, { color: catColor.text }]}>{announcement.category || 'General'}</Text>
                  </View>
                  {announcement.priority === 'high' && (
                    <View style={styles.urgentBadge}>
                      <Ionicons name="warning" size={11} color="#EF4444" />
                      <Text style={styles.urgentText}>Urgent</Text>
                    </View>
                  )}
                </View>

                {/* Content */}
                <Text style={styles.announcementContent} numberOfLines={4}>{announcement.content}</Text>

                {/* Footer */}
                <View style={styles.announcementFooter}>
                  <View style={styles.footerLeft}>
                    <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
                    <Text style={styles.announcementDate}>{safeFormat(announcement.created_at, 'MMM dd, yyyy • h:mm a')}</Text>
                  </View>
                  <View style={styles.footerAuthor}>
                    <Ionicons name="person-circle-outline" size={13} color={colors.textMuted} />
                    <Text style={styles.authorText}>{announcement.author_name || 'Admin'}</Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}
