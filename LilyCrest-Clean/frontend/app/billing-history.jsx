import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Link, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LilyFlowerIcon from '../src/components/assistant/LilyFlowerIcon';
import { useAuth } from '../src/context/AuthContext';
import { useTheme, useThemedStyles } from '../src/context/ThemeContext';
import { apiService } from '../src/services/api';
import { downloadBillPdf } from '../src/utils/downloadBillPdf';

// ── Helpers ──
function safeCurrency(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return '₱0.00';
  return `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function safeDate(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (_e) { return '—'; }
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

const getBillTypes = (bill) => {
  const types = new Set();
  if (bill?.rent) types.add('rent');
  if (bill?.water) types.add('water');
  if (bill?.electricity) types.add('electricity');
  if (bill?.penalties) types.add('penalty');
  if (bill?.items?.length) {
    bill.items.forEach(item => {
      const t = (item.type || 'other').toLowerCase();
      types.add(t === 'penalties' ? 'penalty' : t);
    });
  }
  if (bill?.billing_type) types.add(bill.billing_type.toLowerCase());
  return Array.from(types);
};

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


export default function BillingScreen() {
  const router = useRouter();
  const { isLoading: authLoading, checkAuth, user } = useAuth();
  const { colors, isDarkMode } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeStatus, setActiveStatus] = useState('all');
  // Type filter removed — consolidated bills contain all charge types
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => { if (!authLoading) loadData(); }, [authLoading]);
  useFocusEffect(useCallback(() => { if (!authLoading) loadData(); return undefined; }, [authLoading]));

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [currentResp, historyResp] = await Promise.all([
        apiService.getLatestBilling?.().catch(() => null),
        apiService.getMyBilling?.(),
      ]);
      const historyList = historyResp?.data || [];
      setHistory(historyList);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401) { try { await checkAuth?.(); } catch (_) {} }
      setError('Unable to load billing data. Pull to retry.');
    } finally {
      setLoading(false);
    }
  };



  // ── Computed values ──
  const totalOutstanding = useMemo(() => {
    return history
      .filter(b => { const s = (b.status || '').toLowerCase(); return s === 'pending' || s === 'overdue' || !s; })
      .reduce((sum, b) => sum + (b.remaining_amount ?? b.total ?? b.amount ?? 0), 0);
  }, [history]);

  const unpaidCount = useMemo(() => {
    return history.filter(b => { const s = (b.status || '').toLowerCase(); return s !== 'paid'; }).length;
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
          <Ionicons name="receipt-outline" size={14} color="#D4682A" />
          <Text style={styles.heroBadgeText}>{unpaidCount} unpaid</Text>
        </View>
      </View>
      {totalOutstanding > 0 && (
        <Pressable
          style={styles.heroPayBtn}
          onPress={() => {
            const firstUnpaid = history.find(b => !isPaid(b));
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
      backgroundColor: isDarkMode ? '#1A1A2E' : '#14365A',
      borderRadius: 20, padding: 20,
      ...Platform.select({
        ios: { shadowColor: '#14365A', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12 },
        android: { elevation: 6 },
      }),
    },
    heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    heroLabel: { fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: '600', marginBottom: 4 },
    heroAmount: { fontSize: 30, fontWeight: '800', color: '#ffffff' },
    heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(212,148,42,0.15)', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 20 },
    heroBadgeText: { fontSize: 12, fontWeight: '700', color: '#E0793A' },
    heroPayBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#D4682A', paddingVertical: 13, borderRadius: 14, marginTop: 16 },
    heroPayText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },

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
      backgroundColor: '#1E3A5F', borderColor: '#1E3A5F',
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
    payBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#D4682A', paddingVertical: 9, paddingHorizontal: 16, borderRadius: 10 },
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
      width: 60, height: 60, borderRadius: 30, backgroundColor: isDarkMode ? '#1A1A2E' : '#14365A',
      justifyContent: 'center', alignItems: 'center',
      ...Platform.select({
        ios: { shadowColor: '#14365A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8 },
        android: { elevation: 8 },
      }),
    },
  });
}
