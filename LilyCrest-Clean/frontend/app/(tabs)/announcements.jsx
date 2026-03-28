import { Ionicons } from '@expo/vector-icons';
import { format, formatDistanceToNow } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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

export default function AnnouncementsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles((c) => StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border },
    backButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '600', color: c.text },
    refreshIndicator: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
    categoryFilter: { backgroundColor: c.surface, maxHeight: 56, borderBottomWidth: 1, borderBottomColor: c.border },
    categoryFilterContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
    categoryChip: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: c.surfaceSecondary, marginRight: 8, gap: 6 },
    categoryChipActive: { backgroundColor: c.primary },
    categoryChipText: { fontSize: 13, fontWeight: '500', color: c.textSecondary },
    categoryChipTextActive: { color: c.surface },
    scrollView: { flex: 1 },
    scrollContent: { padding: 16 },
    statsContainer: { flexDirection: 'row', marginBottom: 16, gap: 12 },
    statCard: { flex: 1, backgroundColor: c.surface, padding: 16, borderRadius: 12, alignItems: 'center', ...Platform.select({ web: { boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }, default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 } }) },
    statNumber: { fontSize: 24, fontWeight: 'bold', color: c.text },
    statLabel: { fontSize: 12, color: c.textMuted, marginTop: 2 },
    emptyState: { alignItems: 'center', paddingVertical: 48 },
    emptyText: { fontSize: 16, color: c.textMuted, marginTop: 12 },
    announcementCard: { backgroundColor: c.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: c.border },
    announcementHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
    priorityIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12, borderWidth: 1, borderColor: c.border },
    announcementTitleContainer: { flex: 1 },
    announcementTitle: { fontSize: 16, fontWeight: '600', color: c.text, marginBottom: 4 },
    announcementTime: { fontSize: 12, color: c.textMuted },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12, gap: 8 },
    categoryBadge: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, gap: 4 },
    categoryBadgeText: { fontSize: 12, fontWeight: '500' },
    urgentBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEE2E2', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, gap: 4, borderWidth: 1, borderColor: '#fecdd3' },
    urgentText: { fontSize: 12, fontWeight: '500', color: '#EF4444' },
    announcementContent: { fontSize: 14, color: c.text, lineHeight: 22, marginBottom: 12 },
    announcementFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 },
    footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    announcementDate: { fontSize: 12, color: c.textMuted },
    bottomSpacer: { height: Platform.OS === 'ios' ? 100 : 80 },
  }));
  const [announcements, setAnnouncements] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);

  const fetchAnnouncements = async () => {
    try {
      const response = await apiService.getAnnouncements();
      // Clone array so even identical payload triggers rerender
      setAnnouncements([...(response.data || [])]);
    } catch (error) {
      console.error('Fetch announcements error:', error);
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

  const getPriorityIcon = (priority) => {
    switch (priority) {
      case 'high': return 'alert-circle';
      case 'normal': return 'information-circle';
      case 'low': return 'checkmark-circle';
      default: return 'information-circle';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return '#EF4444';
      case 'normal': return '#3B82F6';
      case 'low': return '#22C55E';
      default: return '#6B7280';
    }
  };

  const getCategoryColor = (category) => {
    switch (category?.toLowerCase()) {
      case 'maintenance': return { bg: '#FEF3C7', text: '#D97706' };
      case 'billing': return { bg: '#DBEAFE', text: '#2563EB' };
      case 'event': return { bg: '#F3E8FF', text: '#9333EA' };
      case 'promo': return { bg: '#DCFCE7', text: '#16A34A' };
      case 'rules': return { bg: '#FFE4E6', text: '#E11D48' };
      default: return { bg: '#F3F4F6', text: '#4B5563' };
    }
  };

  const getCategoryIcon = (category) => {
    switch (category?.toLowerCase()) {
      case 'maintenance': return 'construct';
      case 'billing': return 'card';
      case 'event': return 'calendar';
      case 'promo': return 'pricetag';
      case 'rules': return 'document-text';
      default: return 'megaphone';
    }
  };

  const categories = ['All', ...new Set(announcements.map((a) => a.category || 'General'))];
  const filteredAnnouncements = selectedCategory && selectedCategory !== 'All' ? announcements.filter((a) => (a.category || 'General') === selectedCategory) : announcements;

  if (isLoading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Announcements</Text>
        <TouchableOpacity
          style={styles.refreshIndicator}
          onPress={() => { if (!refreshing) { setRefreshing(true); fetchAnnouncements(); } }}
          disabled={refreshing}
          accessibilityLabel="Refresh announcements"
        >
          {refreshing ? (
            <ActivityIndicator size={18} color={colors.primary} />
          ) : (
            <Ionicons name="sync" size={18} color={colors.textMuted} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryFilter} contentContainerStyle={styles.categoryFilterContent}>
        {categories.map((category) => (
          <TouchableOpacity key={category} style={[styles.categoryChip, (selectedCategory === category || (!selectedCategory && category === 'All')) && styles.categoryChipActive]} onPress={() => setSelectedCategory(category === 'All' ? null : category)}>
            <Ionicons name={category === 'All' ? 'apps' : getCategoryIcon(category)} size={14} color={(selectedCategory === category || (!selectedCategory && category === 'All')) ? colors.surface : colors.textMuted} />
            <Text style={[styles.categoryChipText, (selectedCategory === category || (!selectedCategory && category === 'All')) && styles.categoryChipTextActive]}>{category}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />} showsVerticalScrollIndicator={false}>
        <View style={styles.statsContainer}>
          <View style={styles.statCard}><Text style={styles.statNumber}>{announcements.length}</Text><Text style={styles.statLabel}>Total</Text></View>
          <View style={styles.statCard}><Text style={[styles.statNumber, { color: '#EF4444' }]}>{announcements.filter((a) => a.priority === 'high').length}</Text><Text style={styles.statLabel}>Urgent</Text></View>
          <View style={styles.statCard}><Text style={[styles.statNumber, { color: '#22C55E' }]}>{announcements.filter((a) => a.category === 'Event').length}</Text><Text style={styles.statLabel}>Events</Text></View>
        </View>


        {filteredAnnouncements.length === 0 ? (
          <View style={styles.emptyState}><Ionicons name="megaphone-outline" size={48} color="#D1D5DB" /><Text style={styles.emptyText}>No announcements yet</Text></View>
        ) : filteredAnnouncements.map((announcement) => {
          const categoryColor = getCategoryColor(announcement.category || 'General');
          return (
            <View key={announcement.announcement_id} style={styles.announcementCard}>
              <View style={styles.announcementHeader}>
                <View style={[styles.priorityIcon, { backgroundColor: `${getPriorityColor(announcement.priority)}15` }]}>
                  <Ionicons name={getPriorityIcon(announcement.priority)} size={24} color={getPriorityColor(announcement.priority)} />
                </View>
                <View style={styles.announcementTitleContainer}>
                  <Text style={styles.announcementTitle} numberOfLines={2}>{announcement.title}</Text>
                  <Text style={styles.announcementTime}>{safeDistanceToNow(announcement.created_at)}</Text>
                </View>
              </View>
              <View style={styles.badgeRow}>
                <View style={[styles.categoryBadge, { backgroundColor: categoryColor.bg }]}>
                  <Ionicons name={getCategoryIcon(announcement.category || 'General')} size={12} color={categoryColor.text} />
                  <Text style={[styles.categoryBadgeText, { color: categoryColor.text }]}>{announcement.category || 'General'}</Text>
                </View>
                {announcement.priority === 'high' && <View style={styles.urgentBadge}><Ionicons name="warning" size={12} color="#EF4444" /><Text style={styles.urgentText}>Urgent</Text></View>}
              </View>
              <Text style={styles.announcementContent}>{announcement.content}</Text>
              <View style={styles.announcementFooter}>
                <View style={styles.footerLeft}><Ionicons name="calendar-outline" size={14} color="#9CA3AF" /><Text style={styles.announcementDate}>{safeFormat(announcement.created_at, 'MMM dd, yyyy • h:mm a')}</Text></View>
              </View>
            </View>
          );
        })}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

