import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Link, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import LilyFlowerIcon from '../src/components/assistant/LilyFlowerIcon';
import { useAuth } from '../src/context/AuthContext';
import { useTheme, useThemedStyles } from '../src/context/ThemeContext';
import { apiService, getApiErrorMessage } from '../src/services/api';
import { subscribeBillingRefresh } from '../src/services/billingState';
import { getBillOwedAmount, getBillPaymentDate, getBillStatus, getUtilityReleaseSchedule, isBillOutstanding } from '../src/utils/billingStatus';
import { safeBack } from '../src/utils/navigation';
import { billingDocumentCacheKey } from '../src/utils/billingDocumentCache';
import { BILLING_SCREEN_STATES, normalizeLatestBillingResponse, resolveBillingScreenState } from '../src/utils/billingScreenState';
import { ScreenHeader } from '../src/components/ui/LilycrestUI';

// Helpers
function safeCurrency(amount) {
  // null/undefined means "not yet computed by billing", not a real zero balance \u2014
  // showing the same "\u20b10.00" for both would misleadingly imply a paid-up/zero bill.
  if (amount === null || amount === undefined || amount === '') return 'Not available';
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return '\u20b10.00';
  return `\u20b1${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function nextBillingPeriod(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  date.setDate(1);
  date.setMonth(date.getMonth() + 1);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

const STATUS_CONFIG = {
  paid: { bg: '#ECFDF5', text: '#065F46', icon: 'checkmark-circle', label: 'Paid' },
  settled: { bg: '#ECFDF5', text: '#065F46', icon: 'checkmark-circle', label: 'Paid' },
  unpaid: { bg: '#FFFBEB', text: '#92400E', icon: 'time', label: 'Unpaid' },
  pending: { bg: '#FFFBEB', text: '#92400E', icon: 'time', label: 'Unpaid' },
  overdue: { bg: '#FEF2F2', text: '#991B1B', icon: 'alert-circle', label: 'Overdue' },
  pending_verification: { bg: '#EFF6FF', text: '#1E40AF', icon: 'hourglass', label: 'Payment Under Review' },
  verification: { bg: '#EFF6FF', text: '#1E40AF', icon: 'hourglass', label: 'Payment Under Review' },
  partially_paid: { bg: '#FFFBEB', text: '#92400E', icon: 'pie-chart', label: 'Partially Paid' },
  rejected: { bg: '#FEF2F2', text: '#991B1B', icon: 'close-circle', label: 'Payment Rejected' },
  cancelled: { bg: '#F1F5F9', text: '#6B7280', icon: 'close-circle', label: 'Cancelled' },
};

// Filter Definitions
const STATUS_FILTERS = [
  { id: 'all', label: 'All', icon: 'list-outline' },
  { id: 'unpaid', label: 'Unpaid', icon: 'time-outline', dotColor: '#D97706' },
  { id: 'overdue', label: 'Overdue', icon: 'alert-circle-outline', dotColor: '#DC2626' },
  { id: 'paid', label: 'Paid', icon: 'checkmark-circle-outline', dotColor: '#059669' },
];

// Type filters removed - consolidated bills contain all charge types

const getBillId = (bill) => bill?.billing_id || bill?.id || bill?.billingId || bill?.billId || bill?.reference_id || bill?._id;
const PAID_STATUSES = new Set(['paid', 'settled']);
const isPaidBillStatus = (status) => PAID_STATUSES.has(String(status || '').toLowerCase());
function mergeBillingLists(...lists) {
  const mergedById = new Map();

  lists.flat().forEach((bill) => {
    if (!bill) return;
    const id = String(getBillId(bill) || '').trim();
    const key = id || JSON.stringify([
      bill.billing_period || '',
      bill.description || '',
      bill.due_date || bill.dueDate || '',
      bill.total || bill.amount || '',
    ]);
    const existing = mergedById.get(key);
    mergedById.set(key, { ...(existing || {}), ...bill });
  });

  return Array.from(mergedById.values()).sort((left, right) => {
    const leftDate = new Date(left.due_date || left.dueDate || left.payment_date || left.paymentDate || left.created_at || 0).getTime();
    const rightDate = new Date(right.due_date || right.dueDate || right.payment_date || right.paymentDate || right.created_at || 0).getTime();
    return (Number.isFinite(rightDate) ? rightDate : 0) - (Number.isFinite(leftDate) ? leftDate : 0);
  });
}

export default function BillingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, authReady, authStatus, isLoading: authLoading, checkAuth } = useAuth();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [activeStatus, setActiveStatus] = useState('all');
  // Type filter removed - consolidated bills contain all charge types
  const latestBillingRequestRef = useRef(0);
  const [screenState, setScreenState] = useState(BILLING_SCREEN_STATES.LOADING);
  const [historyWarnings, setHistoryWarnings] = useState([]);
  const [currentSummary, setCurrentSummary] = useState({
    bill: null,
    timing: null,
    previous_balance: 0,
    previous_bill_id: '',
    server_time: '',
  });
  const userId = user?.user_id || null;

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!authReady || authLoading) return;
    if (authStatus !== 'authenticated' || !userId) {
      setHistory([]);
      setLoading(false);
      setRefreshing(false);
      setError('Please sign in to view billing history.');
      setScreenState(BILLING_SCREEN_STATES.UNAUTHORIZED);
      return;
    }

    const requestId = latestBillingRequestRef.current + 1;
    latestBillingRequestRef.current = requestId;
    if (!silent) {
      setLoading(true);
      setScreenState(BILLING_SCREEN_STATES.LOADING);
    }
    setError(null);
    setHistoryWarnings([]);
    try {
      const [latestBillingResult, historyResp, paymentHistoryResp] = await Promise.allSettled([
        apiService.getLatestBilling?.(),
        apiService.getBillingHistory?.(),
        apiService.getPaymentHistory?.(),
      ]);
      if (latestBillingRequestRef.current !== requestId) return;
      let latestOutcome = 'failed';
      if (latestBillingResult.status === 'rejected') {
        const status = latestBillingResult.reason?.response?.status;
        if (status === 401) {
          latestOutcome = 'unauthorized';
          try { await checkAuth?.(); } catch (_) {}
        } else if (status === 404) {
          // Compatibility with servers predating the explicit 200 no-bill contract.
          latestOutcome = 'no_current';
        }
        setCurrentSummary({ bill: null, timing: null, previous_balance: 0, previous_bill_id: '', server_time: '' });
      } else {
        const normalized = normalizeLatestBillingResponse(latestBillingResult.value);
        const payload = normalized.payload || {};
        latestOutcome = normalized.outcome;
        setCurrentSummary({
          bill: normalized.bill,
          timing: payload.timing || null,
          previous_balance: Number(payload.previous_balance || 0),
          previous_bill_id: payload.previous_bill_id || '',
          server_time: payload.server_time || '',
        });
      }
      const hasHistory = historyResp.status === 'fulfilled' && Array.isArray(historyResp.value?.data);
      const hasPaymentHistory = paymentHistoryResp.status === 'fulfilled' && Array.isArray(paymentHistoryResp.value?.data);
      const historyList = hasHistory ? historyResp.value.data : [];
      const paymentHistoryList = hasPaymentHistory ? paymentHistoryResp.value.data : [];
      const mergedHistory = mergeBillingLists(historyList, paymentHistoryList);
      setHistory(mergedHistory);
      const warnings = [];
      if (!hasHistory) warnings.push('Billing history is temporarily unavailable.');
      if (!hasPaymentHistory) warnings.push('Paid history is temporarily unavailable.');
      setHistoryWarnings(warnings);
      const nextState = resolveBillingScreenState({
        loading: false,
        latest: latestOutcome,
        historyAvailable: hasHistory || hasPaymentHistory,
        historyCount: mergedHistory.length,
      });
      setScreenState(nextState);
      if (nextState === BILLING_SCREEN_STATES.TOTAL_FAILURE) {
        const failure = latestBillingResult.reason || historyResp.reason || paymentHistoryResp.reason;
        setError(getApiErrorMessage(failure, 'Unable to load billing data. Pull to retry.'));
      } else if (nextState === BILLING_SCREEN_STATES.UNAUTHORIZED) {
        setError('Please sign in to view billing history.');
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401) { try { await checkAuth?.(); } catch (_) {} }
      if (latestBillingRequestRef.current !== requestId) return;
      setError(getApiErrorMessage(err, 'Unable to load billing data. Pull to retry.'));
      setScreenState(status === 401 ? BILLING_SCREEN_STATES.UNAUTHORIZED : BILLING_SCREEN_STATES.TOTAL_FAILURE);
    } finally {
      if (latestBillingRequestRef.current !== requestId) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [authLoading, authReady, authStatus, checkAuth, userId]);

  useEffect(() => { if (authReady && !authLoading) loadData(); }, [authLoading, authReady, loadData]);
  useFocusEffect(useCallback(() => { if (authReady && !authLoading) loadData(); return undefined; }, [authLoading, authReady, loadData]));
  useEffect(() => {
    if (authLoading || !authReady || authStatus !== 'authenticated' || !userId) return undefined;
    return subscribeBillingRefresh(() => {
      loadData({ silent: true });
    });
  }, [authLoading, authReady, authStatus, loadData, userId]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadData({ silent: true });
  }, [loadData]);



  // Computed values
  const totalOutstanding = useMemo(() => {
    return history
      .filter(isBillOutstanding)
      .reduce((sum, b) => {
        const amount = getBillOwedAmount(b);
        return sum + (amount > 0 ? amount : 0);
      }, 0);
  }, [history]);

  const statusCounts = useMemo(() => {
    const counts = { all: history.length, unpaid: 0, overdue: 0, paid: 0 };
    history.forEach(b => {
      const raw = (b.status || 'unpaid').toLowerCase();
      const s = raw === 'pending' ? 'unpaid' : raw;
      const countKey = isPaidBillStatus(s) ? 'paid' : s;
      if (counts[countKey] !== undefined) counts[countKey]++;
    });
    return counts;
  }, [history]);

  const filteredBills = useMemo(() => {
    return history.filter(b => {
      const rawStatus = getBillStatus(b) || 'unpaid';
      const status = rawStatus === 'pending' ? 'unpaid' : rawStatus;
      if (activeStatus === 'paid') return isPaidBillStatus(status);
      if (activeStatus !== 'all' && status !== activeStatus) return false;
      return true;
    });
  }, [history, activeStatus]);

  const isPaid = (bill) => isPaidBillStatus(bill?.status);
  const getStatusConfig = (status) => STATUS_CONFIG[(status || 'unpaid').toLowerCase()] || STATUS_CONFIG.unpaid;

  const outstandingBills = useMemo(
    () => history.filter(bill => isBillOutstanding(bill) && getBillOwedAmount(bill) > 0),
    [history],
  );

  // The hero only presents backend billing values; it does not recalculate billing rules.
  const renderHero = () => {
    if (screenState === BILLING_SCREEN_STATES.PARTIAL_FAILURE && !currentSummary.bill) {
      return (
        <View style={styles.heroCard}>
          <Text style={styles.heroStateTitle}>Current Bill Unavailable</Text>
          <Text style={styles.heroStateText}>Your available billing history is shown below. Retry to refresh the current bill.</Text>
        </View>
      );
    }
    if (screenState === BILLING_SCREEN_STATES.NO_CURRENT_BILL) {
      return (
        <View style={styles.heroCard}>
          <Text style={styles.heroStateTitle}>No Current Bill</Text>
          <Text style={styles.heroStateText}>No bill has been issued for the current billing period.</Text>
        </View>
      );
    }
    const underReviewStatuses = new Set(['pending_verification', 'verification']);
    const allUnderReview = outstandingBills.length > 0
      && outstandingBills.every(bill => underReviewStatuses.has(getBillStatus(bill)));
    const overdueBill = outstandingBills.find(bill => getBillStatus(bill) === 'overdue');
    const summaryBill = overdueBill || outstandingBills[0] || currentSummary.bill || history[0] || null;
    const summaryStatus = getBillStatus(summaryBill);
    const latestIsPaid = totalOutstanding <= 0 && isPaidBillStatus(summaryStatus);
    const penalty = outstandingBills.reduce((sum, bill) => {
      const value = Number(bill.penalties ?? bill.penalty ?? bill.late_penalty ?? bill.latePenalty ?? 0);
      return sum + (Number.isFinite(value) && value > 0 ? value : 0);
    }, 0);
    const summarySchedule = getUtilityReleaseSchedule(summaryBill);
    const dueDate = summarySchedule.dueDate;
    const summaryId = getBillId(summaryBill);
    const timingApplies = summaryId && String(summaryId) === String(getBillId(currentSummary.bill) || '');
    const daysOverdue = timingApplies
      ? Number(currentSummary.timing?.days_overdue ?? currentSummary.timing?.daysOverdue ?? currentSummary.timing?.days ?? 0)
      : 0;

    if (latestIsPaid) {
      return (
        <View style={styles.heroCard}>
          <Text style={styles.heroStateTitle}>Bill Paid</Text>
          <Text style={styles.heroStateLead}>Thank you.</Text>
          <Text style={styles.heroStateText}>Your latest billing period has been settled.</Text>
        </View>
      );
    }

    if (totalOutstanding <= 0) {
      const upcomingPeriod = nextBillingPeriod(currentSummary.server_time);
      return (
        <View style={styles.heroCard}>
          <Text style={styles.heroStateTitle}>No Outstanding Balance</Text>
          <Text style={styles.heroStateLead}>You have no unpaid bills.</Text>
          {!!upcomingPeriod && (
            <Text style={styles.heroStateText}>Next billing period: {upcomingPeriod}</Text>
          )}
        </View>
      );
    }

    const status = overdueBill
      ? { label: 'Overdue', color: '#991B1B', bg: '#FEF2F2', icon: 'alert-circle' }
      : allUnderReview
        ? { label: 'Payment Under Review', color: '#1E40AF', bg: '#EFF6FF', icon: 'hourglass' }
        : { label: 'Unpaid', color: '#92400E', bg: '#FFFBEB', icon: 'time' };

    return (
      <View style={styles.heroCard}>
        <View style={styles.heroTop}>
          <Text style={styles.heroLabel}>Outstanding Balance</Text>
          <View style={[styles.accountStatus, { backgroundColor: status.bg }]}>
            <Ionicons name={status.icon} size={13} color={status.color} />
            <Text style={[styles.accountStatusText, { color: status.color }]}>{status.label}</Text>
          </View>
        </View>
        <Text style={styles.heroAmount}>{safeCurrency(totalOutstanding)}</Text>
        <View style={styles.heroDivider} />
        {allUnderReview ? (
          <View style={styles.heroMessage}>
            <Text style={styles.heroMessageLead}>Your payment proof has been submitted.</Text>
            <Text style={styles.heroMessageText}>Waiting for admin verification.</Text>
          </View>
        ) : (
          <>
            {summarySchedule.unreleasedUtility ? (
              <View style={styles.utilityPendingBanner}>
                <Ionicons name="information-circle-outline" size={18} color="#2563EB" />
                <View style={styles.utilityPendingCopy}>
                  <Text style={styles.utilityPendingTitle}>Utility schedule pending</Text>
                  <Text style={styles.heroMessageText}>Your utility bill has not been released yet.</Text>
                </View>
              </View>
            ) : <View style={styles.heroMetadata}>
              <View style={styles.heroMetadataItem}>
                <Text style={styles.heroMetadataLabel}>Due Date</Text>
                <Text style={styles.heroMetadataValue}>{safeDate(dueDate)}</Text>
              </View>
              <View style={styles.heroMetadataItem}>
                <Text style={styles.heroMetadataLabel}>Late Penalty</Text>
                <Text style={styles.heroMetadataValue}>{penalty > 0 ? safeCurrency(penalty) : 'None'}</Text>
              </View>
            </View>}
            {overdueBill && daysOverdue > 0 && (
              <Text style={styles.heroOverdueText}>Overdue by {daysOverdue} {daysOverdue === 1 ? 'day' : 'days'}</Text>
            )}
            <Pressable
              style={[styles.heroPayBtn, summarySchedule.unreleasedUtility && styles.heroPayBtnAfterMessage]}
              onPress={() => {
                const id = getBillId(overdueBill || outstandingBills[0]);
                if (id) router.push({ pathname: '/bill-details', params: { billId: String(id) } });
              }}
            >
              <Ionicons name="card-outline" size={15} color="#0A1628" />
              <Text style={styles.heroPayText}>Pay Now</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  };

  // Clean Filter Pills
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


  // Bill Card
  const renderBillCard = ({ item: bill }) => {
    const billId = getBillId(bill);
    const paid = isPaid(bill);
    const statusCfg = getStatusConfig(bill?.status);
    const schedule = getUtilityReleaseSchedule(bill);

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
              {schedule.unreleasedUtility ? 'Your utility bill has not been released yet.' : `Released ${safeDate(schedule.releaseDate)} · Due ${safeDate(schedule.dueDate)}`}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
            <Ionicons name={statusCfg.icon} size={12} color={statusCfg.text} />
            <Text style={[styles.statusText, { color: statusCfg.text }]}>{statusCfg.label}</Text>
          </View>
        </View>

        {/* Amount */}
        <Text style={styles.billAmount}>{safeCurrency(bill.total || bill.amount)}</Text>

        {/* Actions */}
        <View style={styles.billActions}>
          <Pressable
            style={[styles.detailsBtn, !billId && styles.btnDisabled]}
            disabled={!billId}
            onPress={() => billId && router.push({ pathname: '/bill-details', params: { billId: String(billId) } })}
          >
            <Text style={styles.detailsBtnText}>View Details</Text>
          </Pressable>
          <Pressable
            style={[styles.outlineBtn, !billId && styles.btnDisabled]}
            disabled={!billId}
            onPress={() => {
              if (!billId) return;
              router.push({
                pathname: '/document-viewer',
                params: { kind: 'bill', id: String(billId), title: 'Billing Statement', cacheKey: billingDocumentCacheKey(billId, bill) },
              });
            }}
          >
            <Ionicons name="download-outline" size={14} color={colors.text} />
            <Text style={styles.outlineBtnText}>View Statement</Text>
          </Pressable>
          {paid && (
            <Pressable
              style={[styles.outlineBtn, !billId && styles.btnDisabled]}
              disabled={!billId}
              onPress={() => {
                if (!billId) return;
                router.push({
                  pathname: '/document-viewer',
                  params: { kind: 'bill-receipt', id: String(billId), title: 'Payment Receipt', cacheKey: billingDocumentCacheKey(billId, bill, 'receipt') },
                });
              }}
            >
              <Ionicons name="receipt-outline" size={14} color={colors.text} />
              <Text style={styles.outlineBtnText}>View Receipt</Text>
            </Pressable>
          )}
          {paid && getBillPaymentDate(bill) && (
            <View style={styles.paidMeta}>
              <Ionicons name="checkmark" size={12} color="#065F46" />
              <Text style={styles.paidMetaText}>Paid {relativeDate(getBillPaymentDate(bill))}</Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  // List Header
  const renderListHeader = () => (
    <View style={styles.listHeader}>
      {!error && renderHero()}
      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="warning" size={14} color="#991B1B" />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={loadData}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      )}
      {screenState === BILLING_SCREEN_STATES.PARTIAL_FAILURE && !error && currentSummary.bill && (
        <View style={styles.errorBanner}>
          <Ionicons name="information-circle" size={14} color="#92400e" />
          <Text style={styles.errorText}>Some billing history could not be refreshed. The current bill is still available.</Text>
          <Pressable onPress={loadData}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      )}
      {historyWarnings.map((warning) => (
        <View key={warning} style={styles.errorBanner}>
          <Ionicons name="information-circle" size={14} color="#92400e" />
          <Text style={styles.errorText}>{warning}</Text>
        </View>
      ))}
      <Text style={styles.sectionLabel}>
        {activeStatus === 'all' ? 'Billing History' : `${STATUS_FILTERS.find(t => t.id === activeStatus)?.label || ''} Bills`}
        {' '}({filteredBills.length})
      </Text>
      {history.length > 0 && renderFilters()}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Billing" subtitle="Statements, balances, and receipts" onBack={() => safeBack(router)} strong />
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
      <ScreenHeader title="Billing" subtitle="Statements, balances, and receipts" onBack={() => safeBack(router)} strong />

      <FlatList
        data={filteredBills}
        keyExtractor={(item, index) => `${getBillId(item) || `billing-row-${index}`}`}
        renderItem={renderBillCard}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={renderListHeader}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#0A1628']}
            tintColor="#0A1628"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>{activeStatus === 'all' ? 'No bills available.' : 'No bills found'}</Text>
            <Text style={styles.emptyHint}>
              {activeStatus !== 'all'
                ? 'No bills match your filter. Try a different one.'
                : 'Your future bills will appear here once generated.'}
            </Text>
          </View>
        }
      />

      <Link href="/(tabs)/chatbot" prefetch asChild>
        <TouchableOpacity
          style={[styles.chatbotFab, { bottom: Math.max(insets.bottom + 76, 92) }]}
          accessibilityRole="button"
          accessibilityLabel="Open AI Assistant"
        >
          <LilyFlowerIcon size={26} />
        </TouchableOpacity>
      </Link>
    </SafeAreaView>
  );
}

// Styles
function createStyles(c, isDarkMode) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    loadingContainer: { flex: 1, padding: 16, gap: 12 },
    skeleton: { height: 100, backgroundColor: c.surface, borderRadius: 12, opacity: 0.6 },

    listContent: { padding: 14, paddingBottom: 176, gap: 10 },
    listHeader: { gap: 12, marginBottom: 4 },

    // Hero
    heroCard: {
      backgroundColor: c.headerBg,
      borderRadius: 12, padding: 20,
    },
    heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    heroLabel: { fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
    heroAmount: { fontSize: 34, fontWeight: '800', color: '#ffffff', marginBottom: 16 },
    heroStateTitle: { fontSize: 22, fontWeight: '800', color: '#ffffff', marginBottom: 14 },
    heroStateLead: { fontSize: 16, fontWeight: '700', color: '#ffffff', marginBottom: 5 },
    heroStateText: { fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.75)' },
    heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginBottom: 14 },
    heroMetadata: { flexDirection: 'row', gap: 24, marginBottom: 15 },
    heroMetadataItem: { flex: 1, gap: 4 },
    heroMetadataLabel: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' },
    heroMetadataValue: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
    heroMessage: { gap: 4 },
    heroMessageLead: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
    heroMessageText: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
    utilityPendingBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 12,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.08)',
    },
    utilityPendingCopy: { flex: 1, gap: 3 },
    utilityPendingTitle: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
    heroOverdueText: { fontSize: 12, fontWeight: '700', color: '#DC2626', marginBottom: 12 },
    accountStatus: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 20 },
    accountStatusText: { fontSize: 12, fontWeight: '700' },
    heroPayBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.accent, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8 },
    heroPayBtnAfterMessage: { marginTop: 14 },
    heroPayText: { color: '#0A1628', fontWeight: '700', fontSize: 14 },

    insightCard: {
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: 16,
      gap: 12,
      borderWidth: 1,
      borderColor: c.border,
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
    insightToneIncrease: { backgroundColor: '#92400E' },
    insightToneDecrease: { backgroundColor: '#065F46' },
    insightToneNeutral: { backgroundColor: '#4B5563' },
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

    // Clean Filter Pills
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
      color: '#0A1628',
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
      color: '#0A1628',
    },

    sectionLabel: { fontSize: 14, fontWeight: '700', color: c.textSecondary },

    // Bill Card
    billCard: {
      backgroundColor: c.surface, borderRadius: 12, padding: 16, gap: 12,
      borderWidth: 1, borderColor: c.border,
    },
    billHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    billTitle: { fontSize: 15, fontWeight: '700', color: c.text, flex: 1, marginRight: 8 },
    billDue: { fontSize: 12, color: c.textMuted, marginTop: 3 },
    billAmount: { fontSize: 24, fontWeight: '800', color: c.text },

    statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
    statusText: { fontSize: 11, fontWeight: '700' },

    billActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    detailsBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: c.primary },
    detailsBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
    outlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5, borderColor: c.border },
    outlineBtnText: { color: c.text, fontWeight: '600', fontSize: 13 },
    btnDisabled: { opacity: 0.5 },
    paidMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' },
    paidMetaText: { fontSize: 12, color: '#065F46', fontWeight: '600' },

    // Error
    errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: '#DC2626' },
    errorText: { flex: 1, color: '#991B1B', fontWeight: '600', fontSize: 13 },
    retryText: { color: '#991B1B', fontWeight: '700', fontSize: 13 },

    // Empty
    emptyState: { alignItems: 'center', paddingVertical: 48, gap: 8 },
    emptyTitle: { fontSize: 17, fontWeight: '700', color: c.text },
    emptyHint: { fontSize: 13, color: c.textMuted, textAlign: 'center' },

    // Lily AI FAB
    chatbotFab: {
      position: 'absolute', right: 20,
      width: 52, height: 52, borderRadius: 26, backgroundColor: c.headerBg,
      justifyContent: 'center', alignItems: 'center',
      ...Platform.select({
        ios: { shadowColor: c.headerBg, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.16, shadowRadius: 4 },
        android: { elevation: 3 },
      }),
    },
  });
}
