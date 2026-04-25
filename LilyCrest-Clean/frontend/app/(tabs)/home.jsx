import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Image,
    Keyboard,
    Linking,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import AppHeader from '../../src/components/AppHeader';
import PropertyShowcase from '../../src/components/PropertyShowcase';
import StyledModal from '../../src/components/StyledModal';
import LilyFlowerIcon from '../../src/components/assistant/LilyFlowerIcon';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext';
import { apiService } from '../../src/services/api';

// ── Helpers ──────────────────────────────────────────────────
function safeFormatDate(dateStr, fmt = 'MMM dd, yyyy') {
  if (!dateStr) return 'Not assigned';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Not assigned';
    return format(d, fmt);
  } catch (_e) {
    return 'Not assigned';
  }
}

function safeCurrency(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '₱0';
  return `₱${n.toLocaleString()}`;
}

function relativeTime(dateStr) {
  if (!dateStr) return '';
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 0 || isNaN(diff)) return '';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return safeFormatDate(dateStr, 'MMM dd');
  } catch (_e) {
    return '';
  }
}


const NOTIF_ICONS = {
  announcement: 'megaphone',
  billing: 'card',
  payment: 'card',
  maintenance: 'construct',
  alert: 'alert-circle',
  general: 'notifications',
};

// ── Skeleton placeholder ──
function SkeletonCard({ height = 120, colors }) {
  return (
    <View style={{ height, backgroundColor: colors.surface, borderRadius: 16, marginBottom: 16, overflow: 'hidden' }}>
      <Animated.View style={{ flex: 1, backgroundColor: colors.surfaceSecondary || colors.inputBg, opacity: 0.6 }} />
    </View>
  );
}

export default function HomeScreen() {
  const { user, checkAuth, authReady, isLoading: authLoading } = useAuth();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();

  const [dashboardData, setDashboardData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [modalData, setModalData] = useState({ visible: false, title: '', message: '', type: 'info' });
  const searchInputRef = useRef(null);
  const pollingRef = useRef(null);
  const retriedRef = useRef(false);
  const isFetchingRef = useRef(false);

  // FAB pulse animation
  const fabScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(fabScale, { toValue: 1.08, duration: 1400, useNativeDriver: true }),
        Animated.timing(fabScale, { toValue: 1, duration: 1400, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [fabScale]);

  // ── Debounce search ──
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── Memoized data slices ──
  const billingSummary = useMemo(() => dashboardData?.billing?.summary || dashboardData?.billing?.latest || {}, [dashboardData]);
  const bills = useMemo(() => dashboardData?.billing?.items || dashboardData?.billing?.list || dashboardData?.billing || [], [dashboardData]);
  const outstandingBills = useMemo(() => {
    if (!Array.isArray(bills)) return [];
    return bills.filter((b) => {
      const status = (b.status || '').toLowerCase();
      return status !== 'paid' && status !== 'settled';
    });
  }, [bills]);
  const latestBill = useMemo(() => {
    if (billingSummary && (billingSummary.amount || billingSummary.due_date || billingSummary.dueDate)) {
      return billingSummary;
    }
    const source = outstandingBills.length ? outstandingBills : bills;
    if (!Array.isArray(source) || !source.length) return null;
    const sorted = [...source].sort((a, b) => new Date(b.due_date || b.dueDate || 0) - new Date(a.due_date || a.dueDate || 0));
    return sorted[0];
  }, [bills, outstandingBills, billingSummary]);
  const outstandingBillCount = useMemo(() => {
    if (typeof billingSummary?.outstanding_count === 'number') return billingSummary.outstanding_count;
    return outstandingBills.length;
  }, [outstandingBills, billingSummary]);

  const maintenanceSummary = useMemo(() => dashboardData?.maintenance?.summary || {}, [dashboardData]);
  const maintenanceItems = useMemo(() => dashboardData?.maintenance?.items || dashboardData?.maintenance?.list || dashboardData?.maintenance || [], [dashboardData]);
  const activeMaintenanceCount = useMemo(() => {
    if (typeof maintenanceSummary?.active_count === 'number') return maintenanceSummary.active_count;
    if (typeof dashboardData?.active_maintenance_count === 'number') return dashboardData.active_maintenance_count;
    const activeStatuses = ['pending', 'viewed', 'in_progress', 'open'];
    if (Array.isArray(maintenanceItems) && maintenanceItems.length) {
      return maintenanceItems.filter((m) => activeStatuses.includes((m.status || '').toLowerCase())).length;
    }
    return 0;
  }, [maintenanceItems, maintenanceSummary, dashboardData]);

  const notifications = useMemo(() => dashboardData?.notifications?.items || dashboardData?.notifications || [], [dashboardData]);
  const policyItems = useMemo(() => dashboardData?.policies || dashboardData?.house_rules || [], [dashboardData]);

  const tenancyRoom = useMemo(() => {
    return dashboardData?.room || null;
  }, [dashboardData]);

  const tenancyAssignment = useMemo(() => {
    return dashboardData?.assignment || null;
  }, [dashboardData]);

  // ── Quick-action items for search ──
  const quickActionSearch = useMemo(() => [
    { category: 'Quick Actions', title: 'Pay Bills', subtitle: 'View and pay outstanding bills', route: '/(tabs)/billing', icon: 'card' },
    { category: 'Quick Actions', title: 'Request Maintenance', subtitle: 'Submit a repair or service request', route: '/(tabs)/services', icon: 'construct' },
    { category: 'Quick Actions', title: 'My Documents', subtitle: 'View lease, ID, and policies', route: '/my-documents', icon: 'document-text' },
    { category: 'Quick Actions', title: 'Lily Assistant', subtitle: 'Chat with the dorm assistant', route: '/(tabs)/chatbot', icon: 'chatbubbles' },
    { category: 'Quick Actions', title: 'Settings', subtitle: 'Theme, notifications, and account', route: '/settings', icon: 'settings' },
    { category: 'Quick Actions', title: 'About', subtitle: 'App info and contact details', route: '/about', icon: 'information-circle' },
  ], []);

  const MAX_PER_CATEGORY = 5;

  const searchResults = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const matchText = (text) => (text || '').toLowerCase().includes(q);
    const results = [];

    quickActionSearch.forEach((a) => { if (matchText(a.title) || matchText(a.subtitle)) results.push(a); });

    if (matchText('room') || matchText(tenancyRoom?.room_number) || matchText(tenancyRoom?.room_type) || matchText(tenancyRoom?.bed_type)) {
      results.push({ category: 'Room', title: `Room ${tenancyRoom?.room_number || '---'}`, subtitle: `${tenancyRoom?.room_type || 'Standard'} • Floor ${tenancyRoom?.floor || 1}`, route: '/(tabs)/home', icon: 'bed' });
    }

    (Array.isArray(bills) ? bills : []).forEach((b) => {
      if (matchText(b.type) || matchText(b.description) || matchText(String(b.amount)) || matchText(b.status)) {
        results.push({ category: 'Bills', title: b.type || 'Bill', subtitle: `${safeCurrency(b.amount)} • ${b.status || 'Pending'}`, route: '/(tabs)/billing', icon: 'cash' });
      }
    });

    (Array.isArray(maintenanceItems) ? maintenanceItems : []).forEach((m) => {
      if (matchText(m.title) || matchText(m.description) || matchText(m.status)) {
        results.push({ category: 'Maintenance', title: m.title || 'Request', subtitle: m.status || '—', route: '/(tabs)/services', icon: 'construct' });
      }
    });

    (Array.isArray(policyItems) ? policyItems : []).forEach((p) => {
      if (matchText(p.title) || matchText(p.content)) {
        results.push({ category: 'Policies', title: p.title || 'Policy', subtitle: 'Dormitory guideline', route: '/my-documents', icon: 'shield-checkmark' });
      }
    });

    (Array.isArray(notifications) ? notifications : []).forEach((n) => {
      if (matchText(n.title) || matchText(n.body) || matchText(n.type)) {
        results.push({ category: 'Notifications', title: n.title || 'Alert', subtitle: (n.body || '').slice(0, 60), route: '/(tabs)/announcements', icon: 'notifications' });
      }
    });

    return results;
  }, [bills, maintenanceItems, notifications, policyItems, quickActionSearch, tenancyRoom, debouncedQuery]);

  const groupedResults = useMemo(() => {
    const groups = {};
    searchResults.forEach((item) => {
      if (!groups[item.category]) groups[item.category] = [];
      if (groups[item.category].length < MAX_PER_CATEGORY) groups[item.category].push(item);
    });
    return groups;
  }, [searchResults]);

  const totalResultCount = searchResults.length;

  const highlightMatch = (text, query) => {
    if (!query || query.length < 2 || !text) return <Text>{text}</Text>;
    const q = query.trim().toLowerCase();
    const idx = (text || '').toLowerCase().indexOf(q);
    if (idx === -1) return <Text>{text}</Text>;
    return (
      <Text>
        {text.slice(0, idx)}
        <Text style={{ backgroundColor: '#FEF08A', fontWeight: '700', borderRadius: 2 }}>{text.slice(idx, idx + q.length)}</Text>
        {text.slice(idx + q.length)}
      </Text>
    );
  };

  const categoryMeta = {
    'Quick Actions': { icon: 'flash', color: '#E0793A' },
    'Room': { icon: 'bed', color: '#6366F1' },
    'Bills': { icon: 'card', color: '#3B82F6' },
    'Maintenance': { icon: 'construct', color: '#0EA5E9' },
    'Policies': { icon: 'shield-checkmark', color: '#9333EA' },
    'Notifications': { icon: 'notifications', color: '#EF4444' },
  };

  // ── Data fetching ──
  const fetchDashboard = async () => {
    if (isFetchingRef.current) return; // Prevent overlapping fetches
    isFetchingRef.current = true;
    try {
      setLoadError(null);
      const [dashboardRes, announcementsRes] = await Promise.all([
        apiService.getDashboard(),
        apiService.getAnnouncements().catch(() => ({ data: [] })),
      ]);

      const dashboard = dashboardRes?.data || {};
      const announcements = announcementsRes?.data || [];

      const billingItems = Array.isArray(dashboard?.billing?.items)
        ? dashboard.billing.items
        : Array.isArray(dashboard?.billing)
          ? dashboard.billing
          : dashboard?.latest_bill ? [dashboard.latest_bill] : [];

      const mItems = Array.isArray(dashboard?.maintenance?.items)
        ? dashboard.maintenance.items
        : Array.isArray(dashboard?.maintenance)
          ? dashboard.maintenance
          : dashboard?.active_maintenance_count != null
            ? [{ title: 'Maintenance', description: 'Service tickets', status: `${dashboard.active_maintenance_count} active` }]
            : [];

      const notifItems = Array.isArray(dashboard?.notifications?.items)
        ? dashboard.notifications.items
        : Array.isArray(dashboard?.notifications)
          ? dashboard.notifications
          : announcements.map((a) => ({
            title: a.title,
            body: a.content || a.description,
            type: a.category || 'announcement',
            created_at: a.created_at,
          }));

      setDashboardData({ ...dashboard, billing: billingItems, maintenance: mItems, notifications: notifItems });
      retriedRef.current = false;
    } catch (error) {
      console.error('Dashboard fetch error:', error);
      const is401 = error.response?.status === 401;
      if (is401 && !retriedRef.current) {
        retriedRef.current = true;
        try { await checkAuth?.(); } catch (_) { }
        isFetchingRef.current = false;
        return fetchDashboard();
      }
      setLoadError('Unable to load dashboard. Pull to retry.');
    } finally {
      isFetchingRef.current = false;
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!authReady || authLoading) return;
    if (!user) {
      setIsLoading(false);
      setLoadError('Please sign in to load your dashboard.');
      return;
    }
    // User just became available (login) — clear any stale error and fetch
    setLoadError(null);
    setIsLoading(true);
    fetchDashboard();
  }, [authLoading, authReady, user?.user_id]);

  useFocusEffect(
    useCallback(() => {
      if (!authReady || !user?.user_id) return undefined;
      // Fetch immediately when tab gains focus (e.g., after login redirect)
      fetchDashboard();
      // Also poll while this tab is focused
      const interval = setInterval(() => fetchDashboard(), 60000);
      return () => clearInterval(interval);
    }, [authReady, user?.user_id])
  );

  const onRefresh = useCallback(() => {
    if (!authReady || !user?.user_id) { setRefreshing(false); return; }
    setRefreshing(true);
    fetchDashboard();
  }, [authReady, user?.user_id]);

  const openMap = () => {
    const address = '#7 Gil Puyat Ave. cor Marconi St. Brgy Palanan, Makati City';
    const url = Platform.select({
      ios: `maps:0,0?q=${encodeURIComponent(address)}`,
      android: `geo:0,0?q=${encodeURIComponent(address)}`,
      web: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    });
    if (url) Linking.openURL(url);
  };

  // ── Loading state ──
  if (!authReady || isLoading) {
    return (
      <View style={styles.container}>
        <AppHeader />
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <SkeletonCard height={56} colors={colors} />
          <SkeletonCard height={88} colors={colors} />
          <SkeletonCard height={220} colors={colors} />
          <SkeletonCard height={140} colors={colors} />
          <SkeletonCard height={160} colors={colors} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader />
      {loadError ? (
        <View style={styles.errorBanner}>
          <Ionicons name="warning" size={16} color="#b91c1c" />
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity onPress={fetchDashboard}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
        </View>
      ) : null}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1E3A5F']} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Search Bar ── */}
        <View style={[styles.searchContainer, searchFocused && styles.searchContainerFocused]}>
          <Ionicons name="search" size={20} color={searchFocused ? colors.primary : '#9CA3AF'} />
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder="Search bills, maintenance, policies…"
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={(text) => setSearchQuery(text.replace(/[<>]/g, ''))}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            returnKeyType="search"
            maxLength={60}
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchQuery(''); setDebouncedQuery(''); Keyboard.dismiss(); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Search Results ── */}
        {debouncedQuery.length >= 2 && (
          <View style={styles.searchResultsCard}>
            <View style={styles.searchResultsHeader}>
              <Text style={styles.searchResultsTitle}>
                {totalResultCount > 0 ? `${totalResultCount} result${totalResultCount !== 1 ? 's' : ''}` : 'No results'}
              </Text>
              {totalResultCount > 0 && (
                <View style={styles.searchCountBadge}><Text style={styles.searchCountText}>{totalResultCount}</Text></View>
              )}
            </View>

            {totalResultCount === 0 ? (
              <View style={styles.searchEmptyState}>
                <Ionicons name="search-outline" size={36} color={colors.textMuted} />
                <Text style={styles.searchEmptyTitle}>No matches found</Text>
                <Text style={styles.searchEmptyHint}>Try &quot;bills&quot;, &quot;maintenance&quot;, &quot;curfew&quot;, or &quot;payment&quot;</Text>
              </View>
            ) : (
              Object.keys(groupedResults).map((group) => {
                const meta = categoryMeta[group] || { icon: 'ellipse', color: '#6B7280' };
                return (
                  <View key={group} style={styles.searchGroup}>
                    <View style={styles.searchGroupHeader}>
                      <View style={[styles.searchGroupIcon, { backgroundColor: `${meta.color}15` }]}>
                        <Ionicons name={meta.icon} size={14} color={meta.color} />
                      </View>
                      <Text style={styles.searchGroupTitle}>{group}</Text>
                      <Text style={styles.searchGroupCount}>{groupedResults[group].length}</Text>
                    </View>
                    {groupedResults[group].map((item, idx) => (
                      <TouchableOpacity
                        key={`${group}-${idx}`}
                        style={[styles.searchResultRow, idx === groupedResults[group].length - 1 && { borderBottomWidth: 0 }]}
                        onPress={() => { Keyboard.dismiss(); if (item.route) router.push(item.route); }}
                        activeOpacity={0.6}
                      >
                        <View style={[styles.searchResultIcon, { backgroundColor: `${meta.color}10` }]}>
                          <Ionicons name={item.icon || meta.icon} size={16} color={meta.color} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.searchResultTitle}>{highlightMatch(item.title, debouncedQuery)}</Text>
                          <Text style={styles.searchResultSubtitle} numberOfLines={1}>{highlightMatch(item.subtitle, debouncedQuery)}</Text>
                        </View>
                        {item.route && <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />}
                      </TouchableOpacity>
                    ))}
                  </View>
                );
              })
            )}
          </View>
        )}


        {/* ── Location Card ── */}
        <TouchableOpacity style={styles.locationCard} onPress={openMap} activeOpacity={0.7}>
          <View style={styles.locationIconContainer}>
            <Ionicons name="location" size={22} color={colors.primary} />
          </View>
          <View style={styles.locationInfo}>
            <Text style={styles.branchName}>LilyCrest Gil Puyat</Text>
            <Text style={styles.addressText}>#7 Gil Puyat Ave. cor Marconi St., Brgy Palanan, Makati City</Text>
          </View>
          <View style={styles.mapButton}>
            <Ionicons name="navigate" size={16} color={colors.primary} />
          </View>
        </TouchableOpacity>

        {/* ── Property Showcase ── */}
        <PropertyShowcase />

        {/* ── Tenancy Card ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.sectionTitle}>Your Room</Text>
            {tenancyAssignment ? (
              <View style={styles.activeBadge}>
                <View style={styles.activeDot} />
                <Text style={styles.activeText}>Active Tenant</Text>
              </View>
            ) : (
              <View style={[styles.activeBadge, { backgroundColor: '#FEF3C7' }]}>
                <Text style={[styles.activeText, { color: '#D97706' }]}>No Room Assigned</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={styles.tenancyContent}
            activeOpacity={0.7}
            onPress={() => {
              const room = tenancyRoom;
              setModalData({
                visible: true,
                title: `Room ${room?.room_number || '---'}`,
                message: [
                  `Type: ${room?.room_type || 'Standard'}`,
                  `Bed: ${room?.bed_type || 'N/A'}`,
                  `Capacity: ${room?.capacity || 0} pax`,
                  `Floor: ${room?.floor || 1}`,
                  `Monthly Rate: ${safeCurrency(room?.price)}`,
                  '',
                  room?.amenities?.length ? `Amenities: ${room.amenities.join(', ')}` : '',
                  room?.description ? room.description : '',
                ].filter(Boolean).join('\n'),
                type: 'info',
              });
            }}
          >
            <View style={styles.roomImageContainer}>
              <Image
                source={tenancyRoom?.images?.[0] ? { uri: tenancyRoom.images[0] } : require('../../assets/images/Pic-quad.jpg')}
                style={styles.roomImage}
              />
              <View style={styles.roomTypeBadge}>
                <Text style={styles.roomTypeText}>{tenancyRoom?.room_type || 'Standard'}</Text>
              </View>
              <View style={styles.roomViewBadge}>
                <Ionicons name="expand-outline" size={12} color="#ffffff" />
              </View>
            </View>

            <View style={styles.roomDetails}>
              <Text style={styles.roomNumber}>Room {tenancyRoom?.room_number || '---'}</Text>
              <View style={styles.roomInfoGrid}>
                <View style={styles.roomInfoItem}>
                  <Ionicons name="bed-outline" size={15} color={colors.textSecondary} />
                  <Text style={styles.roomInfoText}>{tenancyRoom?.bed_type || 'N/A'}</Text>
                </View>
                <View style={styles.roomInfoItem}>
                  <Ionicons name="people-outline" size={15} color={colors.textSecondary} />
                  <Text style={styles.roomInfoText}>{tenancyRoom?.capacity || 0} pax</Text>
                </View>
                <View style={styles.roomInfoItem}>
                  <Ionicons name="layers-outline" size={15} color={colors.textSecondary} />
                  <Text style={styles.roomInfoText}>Floor {tenancyRoom?.floor || 1}</Text>
                </View>
              </View>
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>Monthly Rate</Text>
                <Text style={styles.priceValue}>{safeCurrency(tenancyRoom?.price)}</Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Tenancy Dates — with duration & countdown */}
          <View style={styles.tenancyDates}>
            <TouchableOpacity
              style={styles.dateItem}
              onPress={() => {
                const moveIn = tenancyAssignment?.move_in_date;
                if (!moveIn || moveIn === 'Not assigned') {
                  setModalData({ visible: true, title: 'Move-in Date', message: 'No move-in date assigned yet.', type: 'info' });
                  return;
                }
                const moveInDate = new Date(moveIn);
                const now = new Date();
                const diffMs = now - moveInDate;
                const totalDays = Math.floor(diffMs / 86400000);
                const years = Math.floor(totalDays / 365);
                const months = Math.floor((totalDays % 365) / 30);
                const days = totalDays % 30;
                const parts = [];
                if (years > 0) parts.push(`${years} year${years > 1 ? 's' : ''}`);
                if (months > 0) parts.push(`${months} month${months > 1 ? 's' : ''}`);
                if (days > 0 || parts.length === 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
                setModalData({
                  visible: true,
                  title: 'Move-in Date',
                  message: `${safeFormatDate(moveIn, 'MMMM dd, yyyy')}\n\nYou have been living here for:\n${parts.join(', ')}`,
                  type: 'success',
                });
              }}
            >
              <View style={[styles.dateItemIcon, { backgroundColor: '#DCFCE7' }]}>
                <Ionicons name="enter-outline" size={17} color="#22C55E" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.dateLabel}>Move-in</Text>
                <Text style={styles.dateValue}>{safeFormatDate(tenancyAssignment?.move_in_date)}</Text>
                {(() => {
                  const moveIn = tenancyAssignment?.move_in_date;
                  if (!moveIn) return null;
                  try {
                    const totalDays = Math.floor((Date.now() - new Date(moveIn).getTime()) / 86400000);
                    if (totalDays < 0 || isNaN(totalDays)) return null;
                    const months = Math.floor(totalDays / 30);
                    return (
                      <Text style={styles.dateMeta}>
                        {months > 0 ? `${months}mo ${totalDays % 30}d` : `${totalDays}d`} ago
                      </Text>
                    );
                  } catch (_e) { return null; }
                })()}
              </View>
            </TouchableOpacity>
            <View style={styles.dateDivider} />
            <TouchableOpacity
              style={styles.dateItem}
              onPress={() => {
                const moveOut = tenancyAssignment?.move_out_date;
                if (!moveOut || moveOut === 'Not assigned') {
                  setModalData({ visible: true, title: 'Contract End', message: 'No contract end date assigned yet.', type: 'info' });
                  return;
                }
                const endDate = new Date(moveOut);
                const now = new Date();
                const diffMs = endDate - now;
                const daysLeft = Math.floor(diffMs / 86400000);
                let message = '';
                if (daysLeft < 0) {
                  message = `${safeFormatDate(moveOut, 'MMMM dd, yyyy')}\n\nYour contract expired ${Math.abs(daysLeft)} days ago.\nPlease contact the admin about renewal.`;
                } else if (daysLeft === 0) {
                  message = `${safeFormatDate(moveOut, 'MMMM dd, yyyy')}\n\nYour contract ends today!\nPlease arrange move-out or renewal with the admin.`;
                } else if (daysLeft <= 30) {
                  message = `${safeFormatDate(moveOut, 'MMMM dd, yyyy')}\n\nOnly ${daysLeft} days remaining!\nConsider renewing your contract soon.`;
                } else if (daysLeft <= 90) {
                  message = `${safeFormatDate(moveOut, 'MMMM dd, yyyy')}\n\n${daysLeft} days remaining.\nYour contract will end in about ${Math.floor(daysLeft / 30)} months.`;
                } else {
                  const months = Math.floor(daysLeft / 30);
                  message = `${safeFormatDate(moveOut, 'MMMM dd, yyyy')}\n\n${daysLeft} days remaining (${months} months).\nYour tenancy is in good standing.`;
                }
                const modalType = daysLeft < 0 ? 'error' : daysLeft <= 30 ? 'warning' : 'success';
                setModalData({ visible: true, title: 'Contract End', message, type: modalType });
              }}
            >
              <View style={[styles.dateItemIcon, { backgroundColor: '#FEE2E2' }]}>
                <Ionicons name="exit-outline" size={17} color="#EF4444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.dateLabel}>Contract End</Text>
                <Text style={styles.dateValue}>{safeFormatDate(tenancyAssignment?.move_out_date)}</Text>
                {(() => {
                  const moveOut = tenancyAssignment?.move_out_date;
                  if (!moveOut) return null;
                  try {
                    const daysLeft = Math.floor((new Date(moveOut).getTime() - Date.now()) / 86400000);
                    if (isNaN(daysLeft)) return null;
                    let color = '#22C55E';
                    let text = `${daysLeft}d left`;
                    if (daysLeft < 0) { color = '#b91c1c'; text = `Expired ${Math.abs(daysLeft)}d ago`; }
                    else if (daysLeft <= 30) { color = '#EF4444'; text = `${daysLeft}d left`; }
                    else if (daysLeft <= 90) { color = '#E0793A'; text = `${daysLeft}d left`; }
                    return <Text style={[styles.dateMeta, { color }]}>{text}</Text>;
                  } catch (_e) { return null; }
                })()}
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Summary Card ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Summary</Text>
          <TouchableOpacity style={styles.summaryRow} onPress={() => router.push('/(tabs)/billing')} activeOpacity={0.7}>
            <View style={styles.summaryItem}>
              <View style={[styles.summaryIcon, { backgroundColor: '#FDF6EC' }]}>
                <Ionicons name="card" size={20} color="#D4682A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryLabel}>Billing</Text>
                <Text style={styles.summaryValue}>
                  {latestBill ? `${safeCurrency(latestBill.total || latestBill.amount)} • ${latestBill.status || 'Pending'}` : 'No bills found'}
                </Text>
                <Text style={styles.summaryMeta}>
                  {[
                    outstandingBillCount > 0 ? `${outstandingBillCount} outstanding` : latestBill ? 'Up to date' : '',
                    latestBill?.due_date || latestBill?.dueDate ? `Due ${safeFormatDate(latestBill.due_date || latestBill.dueDate)}` : '',
                  ].filter(Boolean).join(' • ')}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.summaryDivider} />

          <TouchableOpacity style={styles.summaryRow} onPress={() => router.push('/(tabs)/services')} activeOpacity={0.7}>
            <View style={styles.summaryItem}>
              <View style={[styles.summaryIcon, { backgroundColor: '#E0F2FE' }]}>
                <Ionicons name="construct" size={20} color="#0EA5E9" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryLabel}>Maintenance</Text>
                <Text style={styles.summaryValue}>
                  {activeMaintenanceCount > 0 ? `${activeMaintenanceCount} active` : 'No pending requests'}
                </Text>
                <Text style={styles.summaryMeta}>
                  {activeMaintenanceCount > 0 ? 'Pending or in progress' : 'Track your service tickets'}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* ── Notifications ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.sectionTitle}>Notifications</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/announcements')}>
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>
          {notifications.length > 0 ? (
            notifications.slice(0, 4).map((note, idx) => {
              const notifType = (note.type || 'general').toLowerCase();
              const iconName = NOTIF_ICONS[notifType] || NOTIF_ICONS.general;
              return (
                <TouchableOpacity
                  key={idx}
                  style={[styles.notifRow, idx === Math.min(notifications.length - 1, 3) && { borderBottomWidth: 0 }]}
                  onPress={() => router.push('/(tabs)/announcements')}
                  activeOpacity={0.6}
                >
                  <View style={styles.notifIconWrap}>
                    <Ionicons name={iconName} size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.notifTitle}>{note.title || 'Alert'}</Text>
                    {note.body ? <Text style={styles.notifBody} numberOfLines={2}>{note.body}</Text> : null}
                  </View>
                  <View style={styles.notifRight}>
                    <Text style={styles.notifTime}>{relativeTime(note.created_at)}</Text>
                    <Ionicons name="chevron-forward" size={14} color="#9CA3AF" />
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="checkmark-circle-outline" size={36} color="#22C55E" />
              <Text style={styles.emptyTitle}>You&apos;re all caught up!</Text>
              <Text style={styles.emptyHint}>No new notifications</Text>
            </View>
          )}
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* ── Floating Chatbot Button ── */}
      <Link href="/(tabs)/chatbot" prefetch asChild>
        <TouchableOpacity activeOpacity={0.85}>
          <Animated.View style={[styles.chatbotButton, { transform: [{ scale: fabScale }] }]}>
            <LilyFlowerIcon size={28} glow={false} />
          </Animated.View>
        </TouchableOpacity>
      </Link>

      <StyledModal
        visible={modalData.visible}
        title={modalData.title}
        message={modalData.message}
        type={modalData.type}
        onClose={() => setModalData(m => ({ ...m, visible: false }))}
      />
    </View>
  );
}

// ── Stylesheet factory ──
function createStyles(c) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scrollView: { flex: 1 },
    scrollContent: { padding: 16, paddingTop: 12 },
    errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, marginHorizontal: 16, marginBottom: 8, borderRadius: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.error },
    errorText: { flex: 1, color: c.error, fontWeight: '700', fontSize: 12 },
    retryText: { color: c.error, fontWeight: '700', fontSize: 12 },

    // Search
    searchContainer: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, paddingHorizontal: 16, borderRadius: 14, marginBottom: 16, borderWidth: 2, borderColor: 'transparent',
      ...Platform.select({
        web: { boxShadow: '0 2px 4px rgba(0,0,0,0.05)' },
        default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
      }),
    },
    searchContainerFocused: { borderColor: c.primary },
    searchInput: { flex: 1, paddingVertical: 13, paddingHorizontal: 12, fontSize: 15, color: c.text },
    searchResultsCard: {
      backgroundColor: c.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: c.border,
      ...Platform.select({
        web: { boxShadow: '0 4px 12px rgba(0,0,0,0.08)' },
        default: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 4 },
      }),
    },
    searchResultsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    searchResultsTitle: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    searchCountBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center' },
    searchCountText: { fontSize: 11, fontWeight: '700', color: '#fff' },
    searchEmptyState: { alignItems: 'center', paddingVertical: 24 },
    searchEmptyTitle: { fontSize: 15, fontWeight: '600', color: c.text, marginTop: 10 },
    searchEmptyHint: { fontSize: 12, color: c.textMuted, textAlign: 'center', marginTop: 4, lineHeight: 18 },
    searchGroup: { marginBottom: 14 },
    searchGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
    searchGroupIcon: { width: 24, height: 24, borderRadius: 7, justifyContent: 'center', alignItems: 'center' },
    searchGroupTitle: { fontSize: 13, fontWeight: '700', color: c.text, flex: 1 },
    searchGroupCount: { fontSize: 11, fontWeight: '700', color: c.textMuted, backgroundColor: c.surfaceSecondary || c.inputBg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
    searchResultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border, gap: 10 },
    searchResultIcon: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
    searchResultTitle: { fontSize: 14, fontWeight: '600', color: c.text },
    searchResultSubtitle: { fontSize: 12, color: c.textSecondary, marginTop: 1 },

    sectionTitle: { fontSize: 17, fontWeight: '700', color: c.text, marginBottom: 14 },

    // Location
    locationCard: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 16, padding: 14, marginBottom: 16,
      ...Platform.select({
        web: { boxShadow: '0 2px 6px rgba(0,0,0,0.06)' },
        default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
      }),
    },
    locationIconContainer: { width: 42, height: 42, borderRadius: 12, backgroundColor: c.surfaceSecondary, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    locationInfo: { flex: 1 },
    branchName: { fontSize: 15, fontWeight: '600', color: c.text, marginBottom: 3 },
    addressText: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },
    mapButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.primaryLight, justifyContent: 'center', alignItems: 'center' },

    // Card (generic)
    card: {
      backgroundColor: c.surface, borderRadius: 16, padding: 16, marginBottom: 16,
      ...Platform.select({
        web: { boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
        default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
      }),
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },

    // Tenancy
    activeBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#DCFCE7', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 20, gap: 5 },
    activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22C55E' },
    activeText: { fontSize: 11, fontWeight: '600', color: '#22C55E' },
    tenancyContent: { flexDirection: 'row', marginBottom: 14 },
    roomImageContainer: { width: 105, height: 105, borderRadius: 12, overflow: 'hidden', marginRight: 14, position: 'relative' },
    roomImage: { width: '100%', height: '100%' },
    roomTypeBadge: { position: 'absolute', bottom: 6, left: 6, backgroundColor: c.headerBg, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
    roomTypeText: { fontSize: 10, fontWeight: '600', color: '#ffffff' },
    roomViewBadge: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
    roomDetails: { flex: 1, justifyContent: 'center' },
    roomNumber: { fontSize: 21, fontWeight: '700', color: c.text, marginBottom: 8 },
    roomInfoGrid: { gap: 5 },
    roomInfoItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    roomInfoText: { fontSize: 13, color: c.textSecondary },
    priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border },
    priceLabel: { fontSize: 12, color: c.textSecondary },
    priceValue: { fontSize: 18, fontWeight: '700', color: c.primary },
    tenancyDates: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 14 },
    dateItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    dateItemIcon: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    dateDivider: { width: 1, height: 38, backgroundColor: c.border, marginHorizontal: 10 },
    dateLabel: { fontSize: 11, color: c.textMuted },
    dateValue: { fontSize: 12, fontWeight: '600', color: c.text },
    dateMeta: { fontSize: 10, fontWeight: '600', color: c.textMuted, marginTop: 2 },

    // Summary
    summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    summaryItem: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    summaryIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    summaryLabel: { fontSize: 13, color: c.textSecondary },
    summaryValue: { fontSize: 14, fontWeight: '700', color: c.text },
    summaryMeta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
    summaryDivider: { height: 1, backgroundColor: c.border, marginVertical: 14 },

    // Notifications
    viewAllText: { color: c.primary, fontSize: 13, fontWeight: '600' },
    notifRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border },
    notifIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.primaryLight, justifyContent: 'center', alignItems: 'center' },
    notifTitle: { fontSize: 14, fontWeight: '600', color: c.text },
    notifBody: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 17 },
    notifRight: { alignItems: 'flex-end', gap: 4 },
    notifTime: { fontSize: 11, color: c.textMuted, fontWeight: '500' },

    // Empty states
    emptyState: { alignItems: 'center', paddingVertical: 20 },
    emptyTitle: { fontSize: 15, fontWeight: '600', color: c.text, marginTop: 8 },
    emptyHint: { fontSize: 12, color: c.textMuted, marginTop: 3 },

    // FAB
    chatbotButton: {
      position: 'absolute',
      bottom: Platform.OS === 'ios' ? 110 : 90,
      right: 20,
      width: 58,
      height: 58,
      borderRadius: 29,
      backgroundColor: c.primary,
      justifyContent: 'center',
      alignItems: 'center',
      ...Platform.select({
        ios: { shadowColor: c.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8 },
        android: { elevation: 8 },
        web: { boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)' },
      }),
    },

    bottomSpacer: { height: Platform.OS === 'ios' ? 120 : 100 },
  });
}
