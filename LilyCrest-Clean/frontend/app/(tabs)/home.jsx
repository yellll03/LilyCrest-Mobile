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
import { subscribeBillingRefresh } from '../../src/services/billingState';
import { getBillingInsightPanel } from '../../src/utils/billingInsights';

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const HOME_NON_PAYABLE = new Set([
  'paid', 'settled', 'cancelled', 'rejected', 'void',
  'refunded', 'duplicate', 'archived', 'verification',
]);

function getBillStatus(bill) {
  return String(bill?.status || '').toLowerCase();
}

function isBillOutstanding(bill) {
  return !HOME_NON_PAYABLE.has(getBillStatus(bill));
}

function getBillOwedAmount(bill) {
  const candidates = [bill?.remaining_amount, bill?.total, bill?.amount];
  for (const value of candidates) {
    const amount = Number(value);
    if (Number.isFinite(amount)) return amount;
  }
  return 0;
}

// ── Skeleton placeholder ──
function SkeletonCard({ height = 120, colors }) {
  return (
    <View style={{ height, backgroundColor: colors.surface, borderRadius: 16, marginBottom: 16, overflow: 'hidden' }}>
      <Animated.View style={{ flex: 1, backgroundColor: colors.surfaceSecondary || colors.inputBg, opacity: 0.6 }} />
    </View>
  );
}

export default function HomeScreen() {
  const { user, authReady, isLoading: authLoading } = useAuth();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();

  const [dashboardData, setDashboardData] = useState(null);
  const [billingHistory, setBillingHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [modalData, setModalData] = useState({ visible: false, title: '', message: '', type: 'info' });
  const searchInputRef = useRef(null);
  const latestDashboardRequestRef = useRef(0);
  const isFetchingRef = useRef(false);
  const userId = user?.user_id || null;

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
    return bills.filter(isBillOutstanding);
  }, [bills]);
  const latestBill = useMemo(() => {
    if (billingSummary && isBillOutstanding(billingSummary) && (getBillOwedAmount(billingSummary) > 0 || billingSummary.due_date || billingSummary.dueDate)) {
      return billingSummary;
    }
    const source = outstandingBills.length ? outstandingBills : bills;
    if (!Array.isArray(source) || !source.length) return null;
    const sorted = [...source].sort((a, b) => new Date(b.due_date || b.dueDate || 0) - new Date(a.due_date || a.dueDate || 0));
    return sorted[0];
  }, [bills, outstandingBills, billingSummary]);
  const outstandingBillCount = useMemo(() => {
    return outstandingBills.filter(b => getBillOwedAmount(b) > 0).length;
  }, [outstandingBills]);
  const outstandingBalance = useMemo(() => {
    return outstandingBills.reduce((sum, bill) => sum + getBillOwedAmount(bill), 0);
  }, [outstandingBills]);
  const billingInsightPanel = useMemo(() => {
    try {
      return getBillingInsightPanel(billingHistory);
    } catch (error) {
      console.error('Billing insight render guard:', error);
      return null;
    }
  }, [billingHistory]);

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
  const billingHeadlineTone = billingInsightPanel?.headline?.tone || 'neutral';
  const billingIsCleared = outstandingBillCount === 0 && Boolean(latestBill);
  const billingCardMode = useMemo(() => {
    if (outstandingBillCount > 0 && billingHeadlineTone === 'critical') return 'overdue';
    if (outstandingBillCount > 0) return 'open';
    if (billingIsCleared) return 'cleared';
    return 'empty';
  }, [billingHeadlineTone, billingIsCleared, outstandingBillCount]);
  const summaryMaintenanceValue = useMemo(() => (
    activeMaintenanceCount > 0 ? `${activeMaintenanceCount} active` : 'All clear'
  ), [activeMaintenanceCount]);
  const summaryMaintenanceMeta = useMemo(() => (
    activeMaintenanceCount > 0 ? 'Pending or in progress' : 'No open service requests'
  ), [activeMaintenanceCount]);
  const billingCardSubtitle = useMemo(() => {
    if (billingCardMode === 'overdue') return 'Action is needed on your current balance';
    if (billingCardMode === 'open') return 'Keep track of active bills and due dates';
    if (billingCardMode === 'cleared') return 'Everything currently looks settled';
    return 'Your billing activity will appear here once records are posted';
  }, [billingCardMode]);
  const billingHeroLabel = useMemo(() => {
    if (billingCardMode === 'overdue') return 'Payment required';
    if (billingCardMode === 'open') return 'Outstanding balance';
    if (billingCardMode === 'cleared') return 'Account status';
    return 'Billing overview';
  }, [billingCardMode]);
  const billingHeroValue = useMemo(() => {
    if (billingCardMode === 'overdue' || billingCardMode === 'open') return safeCurrency(outstandingBalance);
    if (billingCardMode === 'cleared') return 'No outstanding balance';
    return 'No billing yet';
  }, [billingCardMode, outstandingBalance]);
  const billingNextDueStat = useMemo(() => {
    const stats = Array.isArray(billingInsightPanel?.stats) ? billingInsightPanel.stats : [];
    return stats.find((stat) => stat?.id === 'next-due') || null;
  }, [billingInsightPanel]);
  const billingHeroMeta = useMemo(() => {
    if (billingCardMode === 'overdue') {
      return billingInsightPanel?.headline?.message
        || `${outstandingBillCount} unpaid bill${outstandingBillCount === 1 ? '' : 's'} ${outstandingBillCount === 1 ? 'requires' : 'require'} your attention.`;
    }
    if (billingCardMode === 'open') {
      return billingInsightPanel?.headline?.message
        || `${outstandingBillCount} bill${outstandingBillCount === 1 ? '' : 's'} pending payment.`;
    }
    if (billingCardMode === 'cleared') {
      return billingInsightPanel?.headline?.message || 'All billing records are currently settled.';
    }
    return 'No billing records posted yet.';
  }, [billingCardMode, billingInsightPanel, outstandingBillCount]);
  const billingStatusChip = useMemo(() => {
    if (billingHeadlineTone === 'critical') return 'Overdue';
    if (outstandingBillCount > 0) return billingHeadlineTone === 'warning' ? 'Due soon' : 'Open';
    return latestBill ? 'Clear' : 'No bills';
  }, [billingHeadlineTone, latestBill, outstandingBillCount]);
  const billingHeroActionLabel = useMemo(() => {
    if (billingCardMode === 'overdue') return 'Review overdue bills';
    if (billingCardMode === 'open') return 'Open billing';
    if (billingCardMode === 'cleared') return 'View billing history';
    return 'Go to billing';
  }, [billingCardMode]);
  const billingHeroIconName = useMemo(() => {
    if (billingCardMode === 'overdue') return 'alert-circle';
    if (billingCardMode === 'open') return 'time';
    if (billingCardMode === 'cleared') return 'checkmark-circle';
    return 'document-text';
  }, [billingCardMode]);
  const billingTonePalette = useMemo(() => {
    if (billingCardMode === 'overdue') {
      return {
        accent: '#B91C1C',
        border: '#FECACA',
        chipBg: '#FEF2F2',
        chipText: '#B91C1C',
        iconBg: '#FEE2E2',
      };
    }
    if (billingCardMode === 'open') {
      return {
        accent: '#C2410C',
        border: '#FED7AA',
        chipBg: '#FFF7ED',
        chipText: '#C2410C',
        iconBg: '#FFEDD5',
      };
    }
    if (billingCardMode === 'cleared') {
      return {
        accent: '#15803D',
        border: '#BBF7D0',
        chipBg: '#F0FDF4',
        chipText: '#166534',
        iconBg: '#DCFCE7',
      };
    }

    return {
      accent: '#204B7E',
      border: '#D8E2F0',
      chipBg: '#F8FAFC',
      chipText: '#204B7E',
      iconBg: '#E8F0FA',
    };
  }, [billingCardMode]);
  const billingLastPaidStat = useMemo(() => {
    const stats = Array.isArray(billingInsightPanel?.stats) ? billingInsightPanel.stats : [];
    return stats.find((stat) => stat?.id === 'last-paid') || null;
  }, [billingInsightPanel]);
  const billingLatestAmount = useMemo(() => {
    const amount = Number(billingInsightPanel?.meta?.latestAmount);
    return Number.isFinite(amount) ? safeCurrency(amount) : null;
  }, [billingInsightPanel]);
  const billingRecordCount = useMemo(() => {
    if (typeof billingInsightPanel?.meta?.recordCount === 'number') return billingInsightPanel.meta.recordCount;
    return Array.isArray(billingHistory) ? billingHistory.length : 0;
  }, [billingHistory, billingInsightPanel]);
  const billingLatestLabel = useMemo(() => {
    if (billingInsightPanel?.meta?.latestLabel) return billingInsightPanel.meta.latestLabel;
    const raw = latestBill?.billing_period || latestBill?.period || latestBill?.label || latestBill?.due_date || latestBill?.dueDate || null;
    return raw ? safeFormatDate(raw, 'MMM yyyy') || String(raw) : null;
  }, [billingInsightPanel, latestBill]);
  const billingNextDueLabel = useMemo(() => {
    if (billingNextDueStat?.value) return billingNextDueStat.value;
    if (billingInsightPanel?.meta?.nextDueLabel) return billingInsightPanel.meta.nextDueLabel;
    if (latestBill?.due_date || latestBill?.dueDate) return safeFormatDate(latestBill.due_date || latestBill.dueDate, 'MMM dd');
    return null;
  }, [billingInsightPanel, billingNextDueStat, latestBill]);
  const billingMetaChips = useMemo(() => {
    const chips = [];
    if (billingRecordCount > 0) {
      chips.push({ id: 'records', icon: 'albums-outline', label: `${billingRecordCount} on record` });
    }

    if (billingCardMode === 'overdue' || billingCardMode === 'open') {
      chips.push({ id: 'open-count', icon: 'card-outline', label: `${outstandingBillCount} unpaid` });
      if (billingNextDueLabel) {
        chips.push({ id: 'next-due', icon: 'alarm-outline', label: `Next due ${billingNextDueLabel}` });
      }
    } else if (billingLatestLabel) {
      chips.push({ id: 'latest', icon: 'calendar-outline', label: `Latest ${billingLatestLabel}` });
    } else if (billingCardMode === 'empty') {
      chips.push({ id: 'waiting', icon: 'time-outline', label: 'Waiting for first billing record' });
    }

    return chips.slice(0, 3);
  }, [billingCardMode, billingLatestLabel, billingNextDueLabel, billingRecordCount, outstandingBillCount]);
  const billingHeroHighlights = useMemo(() => {
    if (billingCardMode === 'overdue' || billingCardMode === 'open') {
      return [
        {
          id: 'open-bills',
          label: 'Unpaid bills',
          value: String(outstandingBillCount),
          helper: billingCardMode === 'overdue' ? 'Includes overdue balance' : 'Still awaiting payment',
        },
        billingNextDueLabel ? {
          id: 'next-due',
          label: 'Next due',
          value: billingNextDueLabel,
          helper: billingNextDueStat?.helper || 'Date on record',
        } : null,
      ].filter(Boolean);
    }

    if (billingCardMode === 'cleared') {
      return [
        billingLatestAmount ? {
          id: 'latest-amount',
          label: 'Latest bill',
          value: billingLatestAmount,
          helper: billingLatestLabel || 'Most recent record',
        } : null,
        billingLastPaidStat?.value ? {
          id: 'last-paid',
          label: billingLastPaidStat.label,
          value: billingLastPaidStat.value,
          helper: billingLastPaidStat.helper || 'Recorded in your history',
        } : null,
      ].filter(Boolean);
    }

    return [];
  }, [billingCardMode, billingLastPaidStat, billingLatestAmount, billingLatestLabel, billingNextDueLabel, billingNextDueStat, outstandingBillCount]);
  const billingDetailStats = useMemo(() => {
    const heroStatId = outstandingBillCount > 0 ? 'outstanding' : latestBill ? 'latest-bill' : '';
    const hiddenStatIds = new Set(heroStatId ? [heroStatId] : []);
    if (billingIsCleared) hiddenStatIds.add('last-paid');
    return (Array.isArray(billingInsightPanel?.stats) ? billingInsightPanel.stats : [])
      .filter((stat) => stat && !hiddenStatIds.has(stat.id))
      .slice(0, 3);
  }, [billingInsightPanel, billingIsCleared, latestBill, outstandingBillCount]);
  const billingSignalItems = useMemo(() => {
    return (Array.isArray(billingInsightPanel?.signals) ? billingInsightPanel.signals : [])
      .filter(Boolean)
      .slice(0, 2);
  }, [billingInsightPanel]);
  const billingDetailSectionLabel = useMemo(() => (
    billingCardMode === 'cleared' ? 'Recent billing details' : 'Key details'
  ), [billingCardMode]);
  const billingSignalSectionLabel = useMemo(() => (
    billingCardMode === 'cleared' ? 'Recent signals' : 'What stands out'
  ), [billingCardMode]);

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
        results.push({ category: 'Notifications', title: n.title || 'Alert', subtitle: ((n.body || n.content || '')).slice(0, 60), route: '/(tabs)/announcements', icon: 'notifications' });
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
    'Quick Actions': { icon: 'flash', color: '#ff9000' },
    'Room': { icon: 'bed', color: '#6366F1' },
    'Bills': { icon: 'card', color: '#3B82F6' },
    'Maintenance': { icon: 'construct', color: '#0EA5E9' },
    'Policies': { icon: 'shield-checkmark', color: '#9333EA' },
    'Notifications': { icon: 'notifications', color: '#EF4444' },
  };

  // ── Data fetching ──
  const fetchDashboard = useCallback(async (force = false) => {
    if (!force && isFetchingRef.current) return;
    isFetchingRef.current = true;
    const requestId = latestDashboardRequestRef.current + 1;
    latestDashboardRequestRef.current = requestId;
    try {
      setLoadError(null);
      const [dashboardRes, announcementsRes, billingHistoryRes] = await Promise.all([
        apiService.getDashboard(),
        (apiService.getNotifications
          ? apiService.getNotifications()
          : apiService.getAnnouncements()
        ).catch(() => ({ data: [] })),
        apiService.getBillingHistory ? apiService.getBillingHistory().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);

      const dashboard = dashboardRes?.data;
      if (!isPlainObject(dashboard)) {
        throw new Error('Invalid dashboard response shape');
      }
      const announcements = Array.isArray(announcementsRes?.data) ? announcementsRes.data : [];
      const billingHistoryItems = Array.isArray(billingHistoryRes?.data) ? billingHistoryRes.data : [];

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
          : announcements.map((item) => ({
            title: item.title,
            body: item.content || item.description,
            type: item.category || 'announcement',
            category: item.category || 'announcement',
            created_at: item.created_at,
          }));

      if (latestDashboardRequestRef.current !== requestId) return;
      setDashboardData({ ...dashboard, billing: billingItems, maintenance: mItems, notifications: notifItems });
      setBillingHistory(billingHistoryItems);
    } catch (error) {
      console.error('Dashboard fetch error:', error);
      if (latestDashboardRequestRef.current !== requestId) return;
      setLoadError('Unable to load dashboard. Pull to retry.');
    } finally {
      isFetchingRef.current = false;
      if (latestDashboardRequestRef.current !== requestId) return;
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady || authLoading) return;
    if (!userId) {
      setDashboardData(null);
      setBillingHistory([]);
      setIsLoading(false);
      setLoadError('Please sign in to load your dashboard.');
      return;
    }
    // User just became available (login) — clear any stale error and fetch
    setLoadError(null);
    setIsLoading(true);
    fetchDashboard();
  }, [authLoading, authReady, fetchDashboard, userId]);

  useEffect(() => {
    if (!authReady || !userId) return undefined;
    return subscribeBillingRefresh(() => {
      fetchDashboard();
    });
  }, [authReady, fetchDashboard, userId]);

  useFocusEffect(
    useCallback(() => {
      if (!authReady || !userId) return undefined;
      // Fetch immediately when tab gains focus (e.g., after login redirect)
      fetchDashboard();
      // Also poll while this tab is focused
      const interval = setInterval(() => fetchDashboard(), 60000);
      return () => clearInterval(interval);
    }, [authReady, fetchDashboard, userId])
  );

  const onRefresh = useCallback(() => {
    if (!authReady || !userId) { setRefreshing(false); return; }
    setRefreshing(true);
    fetchDashboard(true);
  }, [authReady, fetchDashboard, userId]);

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
        <AppHeader recentNotifications={notifications} />
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
      <AppHeader recentNotifications={notifications} />
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
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
                    else if (daysLeft <= 90) { color = '#ff9000'; text = `${daysLeft}d left`; }
                    return <Text style={[styles.dateMeta, { color }]}>{text}</Text>;
                  } catch (_e) { return null; }
                })()}
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.billingInsightCard}>
          <View style={styles.billingInsightHeader}>
            <View style={styles.billingInsightBadge}>
              <Ionicons name="analytics-outline" size={16} color={colors.accent} />
            </View>
            <View style={styles.billingInsightHeaderText}>
              <Text style={styles.billingInsightTitle}>Billing Summary</Text>
              <Text style={styles.billingInsightSubtitle}>{billingCardSubtitle}</Text>
            </View>
          </View>

          {billingMetaChips.length > 0 ? (
            <View style={styles.billingInsightTrustRow}>
              {billingMetaChips.map((chip) => (
                <View key={chip.id} style={styles.billingInsightTrustChip}>
                  <Ionicons name={chip.icon} size={13} color={colors.primary} />
                  <Text style={styles.billingInsightTrustText}>{chip.label}</Text>
                </View>
              ))}
            </View>
          ) : null}

            <View
              style={[
                styles.billingHeroCard,
                {
                  borderColor: billingTonePalette.border,
                  borderLeftColor: billingTonePalette.accent,
                },
              ]}
            >
              <View style={styles.billingHeroTop}>
                <View style={styles.billingHeroTitleBlock}>
                  <Text style={styles.billingHeroLabel}>{billingHeroLabel}</Text>
                  <Text style={[
                    styles.billingHeroValue,
                    (billingCardMode === 'cleared' || billingCardMode === 'empty') && styles.billingHeroValueCompact,
                  ]}>{billingHeroValue}</Text>
                </View>
                <View style={[styles.billingHeroStatusPill, { backgroundColor: billingTonePalette.chipBg }]}>
                  <View style={[styles.billingHeroStatusDot, { backgroundColor: billingTonePalette.accent }]} />
                  <Ionicons
                    name={billingHeroIconName}
                    size={13}
                    color={billingTonePalette.chipText}
                  />
                  <Text style={[styles.billingHeroStatusText, { color: billingTonePalette.chipText }]}>
                    {billingStatusChip}
                  </Text>
                </View>
              </View>
              <Text style={styles.billingHeroMeta}>{billingHeroMeta}</Text>

              {billingHeroHighlights.length > 0 ? (
                <View style={styles.billingHeroHighlightsRow}>
                  {billingHeroHighlights.map((item) => (
                    <View key={item.id} style={styles.billingHeroHighlightCard}>
                      <Text style={styles.billingHeroHighlightLabel}>{item.label}</Text>
                      <Text style={styles.billingHeroHighlightValue}>{item.value}</Text>
                      <Text style={styles.billingHeroHighlightHelper}>{item.helper}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <TouchableOpacity
                style={styles.billingHeroActionButton}
                onPress={() => router.push('/(tabs)/billing')}
                activeOpacity={0.88}
              >
                <Text style={styles.billingHeroActionText}>{billingHeroActionLabel}</Text>
                <Ionicons name="arrow-forward" size={14} color="#ffffff" />
              </TouchableOpacity>
            </View>

            {billingDetailStats.length > 0 ? (
              <View style={styles.billingInsightSection}>
                <View style={styles.billingInsightSectionHeader}>
                  <Text style={styles.billingInsightSectionLabel}>{billingDetailSectionLabel}</Text>
                  <Text style={styles.billingInsightSectionCaption}>Recent records</Text>
                </View>
                <View style={styles.billingInsightDetailList}>
                  {billingDetailStats.map((stat, index) => (
                    <View
                      key={stat.id}
                      style={[
                        styles.billingInsightDetailItem,
                        index === billingDetailStats.length - 1 && styles.billingInsightDetailItemLast,
                      ]}
                    >
                      <View style={styles.billingInsightDetailCopy}>
                        <Text style={styles.billingInsightDetailLabel}>{stat.label}</Text>
                        <Text style={styles.billingInsightDetailHelper}>{stat.helper}</Text>
                      </View>
                      <View
                        style={[
                          styles.billingInsightDetailValuePill,
                          stat.tone === 'critical' && styles.billingInsightDetailValueCritical,
                          stat.tone === 'warning' && styles.billingInsightDetailValueWarning,
                          stat.tone === 'positive' && styles.billingInsightDetailValuePositive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.billingInsightDetailValue,
                            stat.tone === 'critical' && styles.billingInsightDetailValueTextCritical,
                            stat.tone === 'warning' && styles.billingInsightDetailValueTextWarning,
                            stat.tone === 'positive' && styles.billingInsightDetailValueTextPositive,
                          ]}
                        >
                          {stat.value}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {billingSignalItems.length > 0 ? (
              <View style={styles.billingInsightSection}>
                <Text style={styles.billingInsightSectionLabel}>{billingSignalSectionLabel}</Text>
                <View style={styles.billingInsightList}>
                  {billingSignalItems.map((insight, index) => (
                    <View
                      key={insight.id || insight.utility || index}
                      style={[styles.billingInsightRow, index === billingSignalItems.length - 1 && styles.billingInsightRowLast]}
                    >
                      <View
                        style={[
                          styles.billingInsightToneIcon,
                          insight.tone === 'critical' && styles.billingInsightToneCritical,
                          insight.tone === 'warning' && styles.billingInsightToneWarning,
                          insight.tone === 'positive' && styles.billingInsightTonePositive,
                          insight.tone === 'increase' && styles.billingInsightToneIncrease,
                          insight.tone === 'decrease' && styles.billingInsightToneDecrease,
                          insight.tone === 'neutral' && styles.billingInsightToneNeutral,
                        ]}
                      >
                        <Ionicons name={insight.icon} size={15} color="#ffffff" />
                      </View>
                      <View style={styles.billingInsightItemBody}>
                        <Text style={styles.billingInsightItemTitle}>{insight.title}</Text>
                        <Text style={styles.billingInsightItemMessage}>{insight.message}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.sectionTitle}>Quick Status</Text>
            <Text style={styles.summaryCaption}>Helpful shortcuts</Text>
          </View>
          <TouchableOpacity style={styles.summaryRow} onPress={() => router.push('/(tabs)/services')} activeOpacity={0.75}>
            <View style={styles.summaryItem}>
              <View style={[styles.summaryIcon, { backgroundColor: '#E0F2FE' }]}>
                <Ionicons name="construct" size={20} color="#0EA5E9" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryLabel}>Maintenance</Text>
                <Text style={styles.summaryValue}>{summaryMaintenanceValue}</Text>
                <Text style={styles.summaryMeta}>{summaryMaintenanceMeta}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
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
    summaryCaption: { fontSize: 12, color: c.textMuted },
    summaryGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    summaryTile: {
      flex: 1,
      minWidth: 145,
      borderRadius: 16,
      padding: 14,
      backgroundColor: c.surfaceSecondary,
      borderWidth: 1,
      borderColor: c.border,
      gap: 8,
    },
    summaryTileBillingAlert: {
      backgroundColor: '#FFF7ED',
      borderColor: '#FED7AA',
    },
    summaryTileHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    summaryTileIcon: {
      width: 36,
      height: 36,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    summaryTileLabel: {
      fontSize: 12,
      color: c.textSecondary,
      fontWeight: '700',
    },
    summaryTileValue: {
      fontSize: 18,
      lineHeight: 23,
      fontWeight: '800',
      color: c.text,
    },
    summaryTileMeta: {
      fontSize: 12,
      lineHeight: 17,
      color: c.textMuted,
    },

    billingInsightCard: {
      backgroundColor: c.cardBg,
      borderRadius: 20,
      padding: 18,
      marginBottom: 16,
      gap: 16,
      borderWidth: 1,
      borderColor: c.border,
      ...Platform.select({
        web: { boxShadow: '0 10px 24px rgba(15,23,42,0.06)' },
        default: { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 18, elevation: 2 },
      }),
    },
    billingInsightHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    billingInsightHeaderText: { flex: 1, gap: 2 },
    billingInsightBadge: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: c.accentLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    billingInsightTitle: { fontSize: 18, fontWeight: '800', color: c.text },
    billingInsightSubtitle: { fontSize: 12, color: c.textSecondary, lineHeight: 18 },
    billingInsightHeaderCta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 999,
      backgroundColor: c.surfaceSecondary,
      borderWidth: 1,
      borderColor: c.border,
    },
    billingInsightHeaderCtaText: { fontSize: 12, fontWeight: '700', color: c.primary },
    billingInsightTrustRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    billingInsightTrustChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 10,
      borderRadius: 999,
      backgroundColor: c.surfaceSecondary,
      borderWidth: 1,
      borderColor: c.border,
    },
    billingInsightTrustText: {
      fontSize: 12,
      color: c.text,
      fontWeight: '600',
    },
    billingHeroCard: {
      borderRadius: 18,
      padding: 16,
      gap: 12,
      backgroundColor: c.cardBg,
      borderWidth: 1,
      borderLeftWidth: 4,
    },
    billingHeroTitleBlock: {
      flex: 1,
      gap: 2,
    },
    billingHeroIconWrap: {
      width: 42,
      height: 42,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    billingHeroTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 10,
    },
    billingHeroMessageRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    billingHeroStatusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 10,
      borderRadius: 999,
      alignSelf: 'flex-start',
    },
    billingHeroStatusDot: {
      width: 8,
      height: 8,
      borderRadius: 999,
    },
    billingHeroStatusText: {
      fontSize: 12,
      fontWeight: '700',
    },
    billingHeroLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: c.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    billingHeroValue: {
      fontSize: 26,
      lineHeight: 30,
      fontWeight: '700',
      color: c.text,
    },
    billingHeroValueCompact: {
      fontSize: 20,
      lineHeight: 24,
    },
    billingHeroMeta: {
      fontSize: 12,
      lineHeight: 17,
      color: c.textSecondary,
    },
    billingHeroHighlightsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    billingHeroHighlightCard: {
      flex: 1,
      minWidth: 128,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 14,
      backgroundColor: c.surfaceSecondary,
      borderWidth: 1,
      borderColor: c.border,
      gap: 3,
    },
    billingHeroHighlightLabel: {
      fontSize: 11,
      lineHeight: 15,
      color: c.textSecondary,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    billingHeroHighlightValue: {
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '800',
      color: c.text,
    },
    billingHeroHighlightHelper: {
      fontSize: 11,
      lineHeight: 16,
      color: c.textSecondary,
    },
    billingHeroActionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: c.accent,
    },
    billingHeroActionText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800',
      color: '#ffffff',
    },
    billingInsightCallout: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingHorizontal: 2,
    },
    billingInsightCalloutText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 19,
      color: c.textSecondary,
      fontWeight: '500',
    },
    billingInsightSection: { gap: 10 },
    billingInsightSectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    billingInsightSectionLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: c.textSecondary,
    },
    billingInsightSectionCaption: {
      fontSize: 11,
      lineHeight: 16,
      color: c.textMuted,
    },
    billingInsightDetailList: { gap: 10 },
    billingInsightDetailItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 14,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 14,
      backgroundColor: c.surfaceSecondary,
      borderWidth: 1,
      borderColor: c.border,
    },
    billingInsightDetailItemLast: {},
    billingInsightDetailCopy: {
      flex: 1,
      gap: 2,
    },
    billingInsightDetailLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: c.text,
    },
    billingInsightDetailHelper: {
      fontSize: 11,
      lineHeight: 16,
      color: c.textSecondary,
    },
    billingInsightDetailValue: {
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '800',
      color: c.text,
      textAlign: 'center',
    },
    billingInsightDetailValuePill: {
      minWidth: 84,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    billingInsightDetailValueCritical: { backgroundColor: '#FEE2E2' },
    billingInsightDetailValueWarning: { backgroundColor: '#FFEDD5' },
    billingInsightDetailValuePositive: { backgroundColor: '#DCFCE7' },
    billingInsightDetailValueTextCritical: { color: '#B91C1C' },
    billingInsightDetailValueTextWarning: { color: '#C2410C' },
    billingInsightDetailValueTextPositive: { color: '#15803D' },
    billingInsightList: { gap: 12 },
    billingInsightRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 12,
      borderRadius: 14,
      backgroundColor: c.surfaceSecondary,
      borderWidth: 1,
      borderColor: c.border,
    },
    billingInsightRowLast: {
      marginBottom: 0,
    },
    billingInsightToneIcon: {
      width: 28,
      height: 28,
      borderRadius: 14,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 1,
    },
    billingInsightToneCritical: { backgroundColor: '#B91C1C' },
    billingInsightToneWarning: { backgroundColor: '#EA580C' },
    billingInsightTonePositive: { backgroundColor: '#15803D' },
    billingInsightToneIncrease: { backgroundColor: '#B45309' },
    billingInsightToneDecrease: { backgroundColor: '#15803D' },
    billingInsightToneNeutral: { backgroundColor: '#64748B' },
    billingInsightItemBody: { flex: 1, gap: 4, paddingTop: 1 },
    billingInsightItemTitle: {
      fontSize: 13,
      lineHeight: 18,
      color: c.text,
      fontWeight: '700',
    },
    billingInsightItemMessage: {
      fontSize: 13,
      lineHeight: 19,
      color: c.textSecondary,
      fontWeight: '500',
    },

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
      backgroundColor: c.accent,
      justifyContent: 'center',
      alignItems: 'center',
      ...Platform.select({
        ios: { shadowColor: c.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8 },
        android: { elevation: 8 },
        web: { boxShadow: '0 4px 16px rgba(255,144,0,0.4)' },
      }),
    },

    bottomSpacer: { height: Platform.OS === 'ios' ? 120 : 100 },
  });
}
