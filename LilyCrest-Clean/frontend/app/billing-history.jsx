import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Link, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LilyFlowerIcon from '../src/components/assistant/LilyFlowerIcon';
import { useAuth } from '../src/context/AuthContext';
import { useTheme, useThemedStyles } from '../src/context/ThemeContext';
import { apiService } from '../src/services/api';
import { subscribeBillingRefresh } from '../src/services/billingState';
import { downloadBillPdf } from '../src/utils/downloadBillPdf';

// Helpers
function safeCurrency(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return '\u20b10.00';
  return `\u20b1${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function safeDate(value) {
  if (!value) return '\u2014';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '\u2014';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (_e) { return '\u2014'; }
}

function relativeDate(value) {
  if (!value) return '';
  try {
    const diff = Date.now() - new Date(value).getTime();
    if (isNaN(diff) || diff < 0) return safeDate(value);
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return safeDate(value);
  } catch (_e) { return ''; }
}

const STATUS_CONFIG = {
  paid: { bg: '#ecfdf3', text: '#15803d', icon: 'checkmark-circle', label: 'Paid' },
  pending: { bg: '#FDF6EC', text: '#92400e', icon: 'time', label: 'Pending' },
  overdue: { bg: '#fef2f2', text: '#b91c1c', icon: 'alert-circle', label: 'Overdue' },
  verification: { bg: '#eff6ff', text: '#1d4ed8', icon: 'hourglass', label: 'Verifying' },
};

const TYPE_ICONS = {
  rent: { icon: 'home', color: '#1d4ed8' },
  water: { icon: 'water', color: '#0284c7' },
  electricity: { icon: 'flash', color: '#b45309' },
  penalty: { icon: 'warning', color: '#b91c1c' },
  other: { icon: 'receipt', color: '#6B7280' },
};

// ── Filter Definitions ──
const STATUS_FILTERS = [
  { id: 'all', label: 'All', icon: 'list-outline' },
  { id: 'pending', label: 'Pending', icon: 'time-outline', dotColor: '#F59E0B' },
  { id: 'overdue', label: 'Overdue', icon: 'alert-circle-outline', dotColor: '#EF4444' },
  { id: 'paid', label: 'Paid', icon: 'checkmark-circle-outline', dotColor: '#22C55E' },
];

// Type filters removed — consolidated bills contain all charge types

const normalizeBreakdown = (bill) => {
  const parts = [];
  if (bill?.rent) parts.push({ label: 'Rent', amount: bill.rent, type: 'rent' });
  if (bill?.water) parts.push({ label: 'Water', amount: bill.water, type: 'water' });
  if (bill?.electricity) parts.push({ label: 'Electricity', amount: bill.electricity, type: 'electricity' });
  if (bill?.penalties) parts.push({ label: 'Penalties', amount: bill.penalties, type: 'penalty' });
  if (bill?.items?.length) {
    bill.items.forEach((item) => {
      if (!parts.find(p => p.label === (item.label || item.description))) {
        parts.push({ label: item.label || item.description || 'Charge', amount: item.amount || 0, type: item.type || 'other' });
      }
    });
  }
  return parts;
};

const getBillId = (bill) => bill?.billing_id || bill?.id || bill?.billingId || bill?.billId || bill?.reference_id || bill?._id;
const getBillStatus = (bill) => String(bill?.status || '').toLowerCase();
const NON_PAYABLE_STATUSES = new Set([
  'paid', 'settled', 'cancelled', 'rejected', 'void',
  'refunded', 'duplicate', 'archived', 'verification',
]);
const isBillOutstanding = (bill) => !NON_PAYABLE_STATUSES.has(getBillStatus(bill));
const getBillOwedAmount = (bill) => {
  const candidates = [bill?.remaining_amount, bill?.total, bill?.amount];
  for (const value of candidates) {
    const amount = Number(value);
    if (Number.isFinite(amount)) return amount;
  }
  return 0;
};

const getBillDateValue = (bill) => (
  bill?.billing_period ||
  bill?.due_date ||
  bill?.dueDate ||
  bill?.release_date ||
  bill?.releaseDate ||
  bill?.created_at ||
  bill?.createdAt ||
  null
);

const getBillTimestamp = (bill) => {
  const value = getBillDateValue(bill);
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const sortBillsNewestFirst = (bills) => [...bills].sort((a, b) => getBillTimestamp(b) - getBillTimestamp(a));

const getFiniteAmountValue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};



const getPreferredInsightAmount = (bill) => {
  // Use total/amount for trend comparison — remaining_amount reflects partial payments
  // and would produce misleading comparisons (e.g. paid ₱0 vs new bill's full amount).
  const candidates = [bill?.total, bill?.amount];
  for (const value of candidates) {
    const parsed = getFiniteAmountValue(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const getUtilityAmount = (bill, utility) => {
  const directAmount = getFiniteAmountValue(bill?.[utility]);
  if (directAmount !== null) return directAmount;

  const breakdownItem = normalizeBreakdown(bill).find((item) => item.type === utility);
  const breakdownAmount = getFiniteAmountValue(breakdownItem?.amount);
  if (breakdownAmount !== null) return breakdownAmount;

  const billType = String(bill?.billing_type || bill?.type || '').toLowerCase();
  if (billType === utility) {
    return getPreferredInsightAmount(bill);
  }

  return null;
};

export default function BillingScreen() {
  const router = useRouter();
  const { isLoading: authLoading, checkAuth } = useAuth();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [activeStatus, setActiveStatus] = useState('all');
  // Type filter removed — consolidated bills contain all charge types
  const [downloadingId, setDownloadingId] = useState(null);
  const latestBillingRequestRef = useRef(0);
  const [latestBillingDegraded, setLatestBillingDegraded] = useState(false);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    const requestId = latestBillingRequestRef.current + 1;
    latestBillingRequestRef.current = requestId;
    if (!silent) setLoading(true);
    setError(null);
    setLatestBillingDegraded(false);
    try {
      const [latestBillingResult, historyResp] = await Promise.allSettled([
        apiService.getLatestBilling?.(),
        apiService.getBillingHistory?.(),
      ]);
      if (latestBillingResult.status === 'rejected') {
        const status = latestBillingResult.reason?.response?.status;
        if (status === 401) { try { await checkAuth?.(); } catch (_) {} }
        setLatestBillingDegraded(true);
      }
      if (historyResp.status !== 'fulfilled') {
        throw historyResp.reason;
      }
      const historyList = historyResp.value?.data || [];
      if (latestBillingRequestRef.current !== requestId) return;
      setHistory(historyList);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401) { try { await checkAuth?.(); } catch (_) {} }
      if (latestBillingRequestRef.current !== requestId) return;
      setError('Unable to load billing data. Pull to retry.');
    } finally {
      if (latestBillingRequestRef.current !== requestId) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [checkAuth]);

  useEffect(() => { if (!authLoading) loadData(); }, [authLoading, loadData]);
  useFocusEffect(useCallback(() => { if (!authLoading) loadData(); return undefined; }, [authLoading, loadData]));
  useEffect(() => {
    if (authLoading) return undefined;
    return subscribeBillingRefresh(() => {
      loadData({ silent: true });
    });
  }, [authLoading, loadData]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadData({ silent: true });
  }, [loadData]);



  // ── Computed values ──
  const totalOutstanding = useMemo(() => {
    return history
      .filter(isBillOutstanding)
      .reduce((sum, b) => {
        const amount = getBillOwedAmount(b);
        return sum + (amount > 0 ? amount : 0);
      }, 0);
  }, [history]);

  const unpaidCount = useMemo(() => {
    return history.filter(b => isBillOutstanding(b) && getBillOwedAmount(b) > 0).length;
  }, [history]);

  const statusCounts = useMemo(() => {
    const counts = { all: history.length, pending: 0, overdue: 0, paid: 0 };
    history.forEach(b => {
      const s = (b.status || 'pending').toLowerCase();
      if (counts[s] !== undefined) counts[s]++;
    });
    return counts;
  }, [history]);

  const filteredBills = useMemo(() => {
    return history.filter(b => {
      if (activeStatus !== 'all' && (b.status || 'pending').toLowerCase() !== activeStatus) return false;
      return true;
    });
  }, [history, activeStatus]);

  const isPaid = (bill) => (bill?.status || '').toLowerCase() === 'paid';
  const getStatusConfig = (status) => STATUS_CONFIG[(status || 'pending').toLowerCase()] || STATUS_CONFIG.pending;

  // ── Outstanding Hero Card ──
  const renderHero = () => (
    <View style={styles.heroCard}>
      <View style={styles.heroTop}>
        <View>
          <Text style={styles.heroLabel}>Total Outstanding</Text>
          <Text style={styles.heroAmount}>{safeCurrency(totalOutstanding)}</Text>
        </View>
        <View style={styles.heroBadge}>
          <Ionicons name="receipt-outline" size={14} color={colors.accent} />
          <Text style={styles.heroBadgeText}>{unpaidCount} unpaid</Text>
        </View>
      </View>
      {totalOutstanding > 0 && (
        <Pressable
          style={styles.heroPayBtn}
          onPress={() => {
            const firstUnpaid = history.find(isBillOutstanding);
            const id = getBillId(firstUnpaid);
            router.push({ pathname: '/payment', params: { billId: id ? String(id) : undefined, mode: 'now' } });
          }}
        >
          <Ionicons name="card-outline" size={18} color="#ffffff" />
          <Text style={styles.heroPayText}>Pay Now</Text>
        </Pressable>
      )}
    </View>
  );

  // ── Clean Filter Pills ──
  const renderFilters = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterRowContent}>
      {STATUS_FILTERS.map(f => {
        const isActive = activeStatus === f.id;
        const count = statusCounts[f.id] || 0;
        return (
          <Pressable
            key={f.id}
            style={[styles.filterPill, isActive && styles.filterPillActive]}
            onPress={() => setActiveStatus(f.id)}
          >
            {f.dotColor && <View style={[styles.filterDot, { backgroundColor: isActive ? '#fff' : f.dotColor }]} />}
            <Text style={[styles.filterPillText, isActive && styles.filterPillTextActive]}>
              {f.label}
            </Text>
            {count > 0 && (
              <View style={[styles.filterCountWrap, isActive && styles.filterCountWrapActive]}>
                <Text style={[styles.filterCountText, isActive && styles.filterCountTextActive]}>{count}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );


  // ── Bill Card ──
  const renderBillCard = ({ item: bill }) => {
    const billId = getBillId(bill);
    const paid = isPaid(bill);
    const statusCfg = getStatusConfig(bill?.status);
    const breakdown = normalizeBreakdown(bill);

    return (
      <Pressable
        style={styles.billCard}
        onPress={() => {
          if (!billId) return;
          router.push({ pathname: '/bill-details', params: { billId: String(billId) } });
        }}
      >
        {/* Header: status + amount */}
        <View style={styles.billHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.billTitle} numberOfLines={1}>{bill.billing_period || bill.description || 'Billing Statement'}</Text>
            <Text style={styles.billDue}>
              {bill.release_date ? `Released ${safeDate(bill.release_date)} • ` : ''}Due {safeDate(bill.due_date)}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
            <Ionicons name={statusCfg.icon} size={12} color={statusCfg.text} />
            <Text style={[styles.statusText, { color: statusCfg.text }]}>{statusCfg.label}</Text>
          </View>
        </View>

        {/* Amount */}
        <Text style={styles.billAmount}>{safeCurrency(bill.total || bill.amount)}</Text>

        {/* Breakdown chips */}
        {breakdown.length > 0 && (
          <View style={styles.breakdownRow}>
            {breakdown.map((item, idx) => {
              const typeCfg = TYPE_ICONS[item.type] || TYPE_ICONS.other;
              return (
                <View key={idx} style={styles.breakdownChip}>
                  <Ionicons name={typeCfg.icon} size={12} color={typeCfg.color} />
                  <Text style={styles.breakdownLabel}>{item.label}</Text>
                  <Text style={styles.breakdownAmount}>{safeCurrency(item.amount)}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Actions */}
        <View style={styles.billActions}>
          {!paid && (
            <Pressable
              style={styles.payBtn}
              onPress={() => router.push({ pathname: '/payment', params: { billId: billId ? String(billId) : undefined, mode: 'now' } })}
            >
              <Ionicons name="card-outline" size={14} color="#ffffff" />
              <Text style={styles.payBtnText}>Pay</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.outlineBtn, (downloadingId === billId || !billId) && styles.btnDisabled]}
            disabled={downloadingId === billId || !billId}
            onPress={() => {
              if (!billId) return;
              downloadBillPdf(billId, (busy) => setDownloadingId(busy ? billId : null));
            }}
          >
            <Ionicons name="download-outline" size={14} color={colors.text} />
            <Text style={styles.outlineBtnText}>{downloadingId === billId ? 'Preparing…' : 'PDF'}</Text>
          </Pressable>
          {paid && bill.payment_date && (
            <View style={styles.paidMeta}>
              <Ionicons name="checkmark" size={12} color="#15803d" />
              <Text style={styles.paidMetaText}>Paid {relativeDate(bill.payment_date)}</Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  // ── List Header ──
  const renderListHeader = () => (
    <View style={styles.listHeader}>
      {renderHero()}
      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="warning" size={14} color="#b91c1c" />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={loadData}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      )}
      {latestBillingDegraded && !error && (
        <View style={styles.errorBanner}>
          <Ionicons name="information-circle" size={14} color="#92400e" />
          <Text style={styles.errorText}>Latest billing summary is temporarily unavailable. Billing history is shown below.</Text>
          <Pressable onPress={loadData}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      )}
      {renderFilters()}
      <Text style={styles.sectionLabel}>
        {activeStatus === 'all' ? 'All Bills' : `${STATUS_FILTERS.find(t => t.id === activeStatus)?.label || ''} Bills`}
        {' '}({filteredBills.length})
      </Text>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.topTitle}>Billing</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.loadingContainer}>
          <View style={styles.skeleton} />
          <View style={[styles.skeleton, { height: 40 }]} />
          <View style={[styles.skeleton, { height: 140 }]} />
          <View style={[styles.skeleton, { height: 140 }]} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.topTitle}>Billing</Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        data={filteredBills}
        keyExtractor={(item) => `${getBillId(item) || Math.random()}`}
        renderItem={renderBillCard}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={renderListHeader}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#204b7e']}
            tintColor="#204b7e"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No bills found</Text>
            <Text style={styles.emptyHint}>
              {activeStatus !== 'all'
                ? 'No bills match your filter. Try a different one.'
                : 'Your billing history will appear here.'}
            </Text>
          </View>
        }
      />

      <Link href="/(tabs)/chatbot" prefetch asChild>
        <TouchableOpacity style={styles.chatbotFab}>
          <LilyFlowerIcon size={26} />
        </TouchableOpacity>
      </Link>
    </SafeAreaView>
  );
}

// ── Styles ──
function createStyles(c, isDarkMode) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    topBar: { flexDirection: 'row', alignItems: 'center', height: 50, paddingHorizontal: 12 },
    backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    topTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: c.text },
    loadingContainer: { flex: 1, padding: 16, gap: 12 },
    skeleton: { height: 100, backgroundColor: c.surface, borderRadius: 16, opacity: 0.6 },

    listContent: { padding: 14, paddingBottom: 100, gap: 10 },
    listHeader: { gap: 12, marginBottom: 4 },

    // Hero
    heroCard: {
      backgroundColor: c.headerBg,
      borderRadius: 20, padding: 20,
      ...Platform.select({
        ios: { shadowColor: c.headerBg, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12 },
        android: { elevation: 6 },
      }),
    },
    heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    heroLabel: { fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: '600', marginBottom: 4 },
    heroAmount: { fontSize: 30, fontWeight: '800', color: '#ffffff' },
    heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(212,148,42,0.15)', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 20 },
    heroBadgeText: { fontSize: 12, fontWeight: '700', color: c.accent },
    heroPayBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.primary, paddingVertical: 13, borderRadius: 14, marginTop: 16 },
    heroPayText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },

    insightCard: {
      backgroundColor: c.surface,
      borderRadius: 16,
      padding: 16,
      gap: 12,
      borderWidth: isDarkMode ? 1 : 0,
      borderColor: c.border,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
        android: { elevation: 2 },
      }),
    },
    insightHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    insightTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    insightIconBadge: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    insightTitle: { fontSize: 16, fontWeight: '700', color: c.text },
    insightList: { gap: 10 },
    insightRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    insightRowLast: {
      paddingBottom: 0,
      borderBottomWidth: 0,
    },
    insightToneIcon: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    insightToneIncrease: { backgroundColor: '#B45309' },
    insightToneDecrease: { backgroundColor: '#15803D' },
    insightToneNeutral: { backgroundColor: '#64748B' },
    insightMessage: {
      flex: 1,
      fontSize: 13,
      lineHeight: 19,
      color: c.textSecondary,
      fontWeight: '600',
    },
    insightFallback: {
      fontSize: 13,
      lineHeight: 19,
      color: c.textMuted,
      fontWeight: '600',
    },

    // ── Clean Filter Pills ──
    filterRow: {
      flexGrow: 0,
    },
    filterRowContent: {
      flexDirection: 'row', gap: 8, paddingHorizontal: 0, paddingVertical: 2,
    },
    filterPill: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingVertical: 8, paddingHorizontal: 14,
      borderRadius: 20,
      backgroundColor: isDarkMode ? 'rgba(255,255,255,0.06)' : c.surface,
      borderWidth: 1, borderColor: c.border,
    },
    filterPillActive: {
      backgroundColor: c.accent, borderColor: c.accent,
    },
    filterPillText: {
      fontSize: 13, fontWeight: '600', color: c.textSecondary,
    },
    filterPillTextActive: {
      color: '#FFFFFF',
    },
    filterDot: {
      width: 7, height: 7, borderRadius: 4,
    },
    filterCountWrap: {
      minWidth: 18, height: 18, borderRadius: 9,
      justifyContent: 'center', alignItems: 'center',
      backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
      paddingHorizontal: 5,
    },
    filterCountWrapActive: {
      backgroundColor: 'rgba(255,255,255,0.2)',
    },
    filterCountText: {
      fontSize: 10, fontWeight: '700', color: c.textMuted,
    },
    filterCountTextActive: {
      color: '#FFFFFF',
    },

    sectionLabel: { fontSize: 14, fontWeight: '700', color: c.textSecondary },

    // Bill Card
    billCard: {
      backgroundColor: c.surface, borderRadius: 16, padding: 16, gap: 12,
      borderWidth: isDarkMode ? 1 : 0, borderColor: c.border,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
        android: { elevation: 2 },
      }),
    },
    billHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    billTitle: { fontSize: 15, fontWeight: '700', color: c.text, flex: 1, marginRight: 8 },
    billDue: { fontSize: 12, color: c.textMuted, marginTop: 3 },
    billAmount: { fontSize: 24, fontWeight: '800', color: c.text },

    statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
    statusText: { fontSize: 11, fontWeight: '700' },

    breakdownRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    breakdownChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.surfaceSecondary || c.inputBg, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8 },
    breakdownLabel: { fontSize: 11, fontWeight: '600', color: c.textSecondary },
    breakdownAmount: { fontSize: 11, fontWeight: '700', color: c.text },

    billActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    payBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.primary, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 10 },
    payBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
    outlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5, borderColor: c.border },
    outlineBtnText: { color: c.text, fontWeight: '600', fontSize: 13 },
    btnDisabled: { opacity: 0.5 },
    paidMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' },
    paidMetaText: { fontSize: 12, color: '#15803d', fontWeight: '600' },

    // Error
    errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: '#fecaca' },
    errorText: { flex: 1, color: '#b91c1c', fontWeight: '600', fontSize: 13 },
    retryText: { color: '#b91c1c', fontWeight: '700', fontSize: 13 },

    // Empty
    emptyState: { alignItems: 'center', paddingVertical: 48, gap: 8 },
    emptyTitle: { fontSize: 17, fontWeight: '700', color: c.text },
    emptyHint: { fontSize: 13, color: c.textMuted, textAlign: 'center' },

    // Lily AI FAB
    chatbotFab: {
      position: 'absolute', bottom: Platform.OS === 'ios' ? 110 : 90, right: 20,
      width: 60, height: 60, borderRadius: 30, backgroundColor: c.headerBg,
      justifyContent: 'center', alignItems: 'center',
      ...Platform.select({
        ios: { shadowColor: c.headerBg, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8 },
        android: { elevation: 8 },
      }),
    },
  });
}
