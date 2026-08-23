import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '../src/components/ui/LilycrestUI';
import { useAlert } from '../src/context/AlertContext';
import { useAuth } from '../src/context/AuthContext';
import { useTheme, useThemedStyles } from '../src/context/ThemeContext';
import { apiService } from '../src/services/api';
import { getBillingApiMessage } from '../src/services/billingState';
import { getOutstandingBreakdown } from '../src/utils/billingBreakdown';
import { safeBack } from '../src/utils/navigation';

function currency(amount) {
  const value = Number(amount || 0);
  const absolute = Math.abs(value).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? '−' : ''}₱${absolute}`;
}

function billLabel(bill) {
  return bill?.billing_period || bill?.description || 'Billing Statement';
}

function sameAggregate(left, right) {
  const leftIds = [...left.billIds].sort();
  const rightIds = [...right.billIds].sort();
  return leftIds.length === rightIds.length
    && leftIds.every((id, index) => id === rightIds[index])
    && left.total === right.total;
}

export default function OutstandingBalanceScreen() {
  const router = useRouter();
  const { showAlert } = useAlert();
  const { authReady, authStatus, isLoading: authLoading } = useAuth();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const checkoutGuardRef = useRef(false);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingCheckout, setCreatingCheckout] = useState(false);
  const [error, setError] = useState('');
  const aggregate = useMemo(() => getOutstandingBreakdown(bills), [bills]);

  const loadOutstanding = useCallback(async ({ silent = false } = {}) => {
    if (!authReady || authLoading) return null;
    if (authStatus !== 'authenticated') {
      setBills([]);
      setError('Please sign in to view your outstanding balance.');
      setLoading(false);
      setRefreshing(false);
      return null;
    }

    if (!silent) setLoading(true);
    setError('');
    try {
      const response = await apiService.getBillingHistory();
      const nextBills = Array.isArray(response?.data) ? response.data : [];
      setBills(nextBills);
      return getOutstandingBreakdown(nextBills);
    } catch (requestError) {
      setError(getBillingApiMessage(requestError, 'Unable to load your outstanding balance. Pull to retry.'));
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authLoading, authReady, authStatus]);

  useEffect(() => {
    loadOutstanding();
  }, [loadOutstanding]);

  useFocusEffect(useCallback(() => {
    loadOutstanding({ silent: true });
    return undefined;
  }, [loadOutstanding]));

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadOutstanding({ silent: true });
  }, [loadOutstanding]);

  const handlePayOutstanding = async () => {
    if (checkoutGuardRef.current || aggregate.billIds.length === 0) return;
    checkoutGuardRef.current = true;
    setCreatingCheckout(true);
    try {
      // Re-read immediately before creating a provider session. If a payment,
      // admin adjustment, or newly issued bill changed the aggregate, stop and
      // let the tenant review the new exact total instead of paying stale UI.
      const latest = await loadOutstanding({ silent: true });
      if (!latest || latest.billIds.length === 0) return;
      if (!sameAggregate(aggregate, latest)) {
        showAlert({
          title: 'Balance Updated',
          message: 'Your outstanding balance changed. Please review the updated breakdown before paying.',
          type: 'info',
        });
        return;
      }

      const response = await apiService.createPaymongoBatchCheckout(latest.billIds);
      const checkoutUrl = response?.data?.checkout_url;
      const checkoutId = response?.data?.checkout_id;
      if (!checkoutUrl) throw new Error('Payment checkout did not return a secure payment link.');

      const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, 'frontend://');
      if (result.type !== 'success') return;
      const returnUrl = result.url || '';
      router.replace({
        pathname: returnUrl.includes('payment-success') ? '/payment-success' : '/payment-cancel',
        params: { billing_id: 'outstanding', checkout_id: checkoutId || '' },
      });
    } catch (checkoutError) {
      showAlert({
        title: 'Payment Error',
        message: getBillingApiMessage(checkoutError, checkoutError?.message || 'Unable to start payment. Please try again.'),
        type: 'error',
      });
      await loadOutstanding({ silent: true });
    } finally {
      checkoutGuardRef.current = false;
      setCreatingCheckout(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.muted}>Loading your outstanding balance…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Outstanding Balance Details"
        subtitle="All unpaid tenant charges"
        onBack={() => safeBack(router)}
        strong
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        {error ? (
          <View style={styles.stateCard}>
            <Ionicons name="alert-circle-outline" size={28} color={colors.error} />
            <Text style={styles.stateTitle}>Unable to load balance</Text>
            <Text style={styles.muted}>{error}</Text>
            <Pressable style={styles.retryButton} onPress={() => loadOutstanding()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : aggregate.billIds.length === 0 ? (
          <View style={styles.stateCard}>
            <Ionicons name="checkmark-circle-outline" size={36} color={colors.success} />
            <Text style={styles.stateTitle}>No Outstanding Balance</Text>
            <Text style={styles.muted}>You have no unpaid bills.</Text>
          </View>
        ) : (
          <>
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Outstanding Balance</Text>
              <Text style={styles.totalAmount}>{currency(aggregate.total)}</Text>
              <Text style={styles.totalMeta}>{aggregate.bills.length} unpaid bill{aggregate.bills.length === 1 ? '' : 's'} included</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Complete Breakdown</Text>
              {aggregate.items.map((item) => (
                <View key={item.label} style={styles.breakdownRow}>
                  <View style={styles.breakdownLabelWrap}>
                    <Ionicons name={item.icon} size={17} color={item.color || colors.textSecondary} />
                    <Text style={styles.breakdownLabel}>{item.label}</Text>
                  </View>
                  <Text style={styles.breakdownAmount}>{currency(item.amount)}</Text>
                </View>
              ))}
              <View style={styles.divider} />
              <View style={styles.breakdownRow}>
                <Text style={styles.grandTotalLabel}>Total</Text>
                <Text style={styles.grandTotalAmount}>{currency(aggregate.itemTotal)}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Included Bills</Text>
              {aggregate.bills.map((bill) => (
                <View key={String(bill.billing_id || bill.id || bill._id)} style={styles.billRow}>
                  <View style={styles.billCopy}>
                    <Text style={styles.billTitle}>{billLabel(bill)}</Text>
                    <Text style={styles.muted}>{String(bill.status || 'unpaid').replaceAll('_', ' ')}</Text>
                  </View>
                  <Text style={styles.billAmount}>{currency(bill.remaining_amount ?? bill.total ?? bill.amount)}</Text>
                </View>
              ))}
            </View>

            <Pressable
              style={[styles.payButton, creatingCheckout && styles.disabled]}
              disabled={creatingCheckout}
              onPress={handlePayOutstanding}
            >
              {creatingCheckout
                ? <ActivityIndicator color="#ffffff" />
                : <Ionicons name="card-outline" size={20} color="#ffffff" />}
              <Text style={styles.payText}>{creatingCheckout ? 'Preparing secure checkout…' : `Pay ${currency(aggregate.total)}`}</Text>
            </Pressable>
            <Text style={styles.secureText}>The exact total is rechecked before PayMongo checkout. Opening this screen does not mark any bill paid.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: c.background },
  content: { padding: 16, paddingBottom: 44, gap: 16 },
  totalCard: { padding: 20, borderRadius: 16, backgroundColor: c.headerBg, gap: 5 },
  totalLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  totalAmount: { color: '#D4AF37', fontSize: 32, lineHeight: 39, fontWeight: '900' },
  totalMeta: { color: 'rgba(255,255,255,0.72)', fontSize: 13 },
  card: { borderRadius: 14, padding: 16, gap: 13, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  sectionTitle: { color: c.text, fontSize: 16, fontWeight: '800' },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  breakdownLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  breakdownLabel: { color: c.textSecondary, fontSize: 14, flexShrink: 1 },
  breakdownAmount: { color: c.text, fontSize: 14, fontWeight: '700' },
  divider: { height: 1, backgroundColor: c.border, marginVertical: 2 },
  grandTotalLabel: { color: c.text, fontSize: 16, fontWeight: '900' },
  grandTotalAmount: { color: c.primary, fontSize: 18, fontWeight: '900' },
  billRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 4 },
  billCopy: { flex: 1, gap: 2 },
  billTitle: { color: c.text, fontSize: 14, fontWeight: '700' },
  billAmount: { color: c.text, fontSize: 14, fontWeight: '800' },
  muted: { color: c.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  payButton: { minHeight: 54, borderRadius: 12, backgroundColor: c.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 16 },
  payText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  secureText: { color: c.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 10 },
  stateCard: { alignItems: 'center', gap: 10, padding: 24, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  stateTitle: { color: c.text, fontSize: 18, fontWeight: '800' },
  retryButton: { marginTop: 4, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 10, backgroundColor: c.primary },
  retryText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.65 },
});
