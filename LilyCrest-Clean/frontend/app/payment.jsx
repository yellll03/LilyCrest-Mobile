import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAlert } from '../src/context/AlertContext';
import { useTheme } from '../src/context/ThemeContext';
import { apiService } from '../src/services/api';
import {
  BILL_UNAVAILABLE_MESSAGE,
  emitBillingRefresh,
  getBillingApiMessage,
  isBillingUnavailableMessage,
} from '../src/services/billingState';

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
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  } catch (_e) {
    return '\u2014';
  }
}

function isBillOutstanding(bill) {
  const status = String(bill?.status || '').toLowerCase();
  return status !== 'paid' && status !== 'settled';
}

function getBillId(bill) {
  return bill?.billing_id || bill?.id || bill?._id || bill?.billingId || bill?.billId || bill?.reference_id;
}

export default function PaymentScreen() {
  const router = useRouter();
  const { billId: billIdParam } = useLocalSearchParams();
  const billId = Array.isArray(billIdParam) ? billIdParam[0] : billIdParam;
  const { colors, isDarkMode } = useTheme();
  const { showAlert } = useAlert();
  const styles = useMemo(() => createStyles(colors, isDarkMode), [colors, isDarkMode]);

  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creatingCheckout, setCreatingCheckout] = useState(false);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadBill = useCallback(async ({ showLoader = true } = {}) => {
    if (showLoader) setLoading(true);
    setError(null);
    const targetId = String(billId || '').trim();

    if (!targetId) {
      setBill(null);
      setError(BILL_UNAVAILABLE_MESSAGE);
      if (showLoader) setLoading(false);
      setRefreshing(false);
      return null;
    }

    try {
      const response = await apiService.getBillingById(targetId);
      const nextBill = response?.data || null;
      setBill(nextBill);
      return nextBill;
    } catch (err) {
      const message = getBillingApiMessage(err, 'Unable to load bill. Please try again.');
      setBill(null);
      setError(message);
      if (isBillingUnavailableMessage(message)) {
        emitBillingRefresh('bill_unavailable');
      }
      return null;
    } finally {
      if (showLoader) setLoading(false);
      setRefreshing(false);
    }
  }, [billId]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadBill({ showLoader: false });
  }, [loadBill]);

  // Load bill data.
  useEffect(() => {
    loadBill();
  }, [loadBill]);

  useFocusEffect(useCallback(() => {
    loadBill({ showLoader: false });
    return undefined;
  }, [loadBill]));

  const handlePayOnline = async () => {
    const latestBill = await loadBill({ showLoader: false });
    if (!latestBill) return;
    const id = getBillId(latestBill);
    if (!id) {
      setError(BILL_UNAVAILABLE_MESSAGE);
      return;
    }

    setCreatingCheckout(true);
    try {
      const resp = await apiService.createPaymongoCheckout(id);
      const checkoutUrl = resp?.data?.checkout_url;
      const checkoutId = resp?.data?.checkout_id;
      if (!checkoutUrl) {
        showAlert({ title: 'Error', message: 'Could not create payment session. Please try again.', type: 'error' });
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, 'frontend://');

      if (result.type === 'success') {
        const returnUrl = result.url || '';
        if (returnUrl.includes('payment-success')) {
          router.replace({ pathname: '/payment-success', params: { billing_id: id, checkout_id: checkoutId || '' } });
        } else {
          router.replace({ pathname: '/payment-cancel', params: { billing_id: id, checkout_id: checkoutId || '' } });
        }
      }
      // result.type === 'cancel' means the user closed the browser — stay on page.
    } catch (err) {
      const message = getBillingApiMessage(err, 'Failed to create payment session.');
      if (isBillingUnavailableMessage(message)) {
        setBill(null);
        setError(message);
        emitBillingRefresh('bill_unavailable');
      }
      showAlert({ title: 'Payment Error', message, type: 'error' });
    } finally {
      setCreatingCheckout(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  if (error || !bill) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.center, { flexGrow: 1 }]}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          )}
        >
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text style={styles.errorLabel}>{error || BILL_UNAVAILABLE_MESSAGE}</Text>
          <View style={styles.errorActions}>
            <Pressable style={styles.retryBtnSmall} onPress={loadBill}>
              <Text style={styles.retryBtnSmallText}>Try Again</Text>
            </Pressable>
            <Pressable style={styles.backBtnSmall} onPress={() => router.back()}>
              <Text style={styles.backBtnSmallText}>Go Back</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const isOutstanding = isBillOutstanding(bill);
  const totalAmount = bill.total || bill.amount || 0;

  const charges = [];
  if (bill.rent) charges.push({ label: 'Rent', amount: bill.rent, icon: 'home', color: '#1d4ed8' });
  if (bill.electricity) charges.push({ label: 'Electricity', amount: bill.electricity, icon: 'flash', color: '#b45309' });
  if (bill.water) charges.push({ label: 'Water', amount: bill.water, icon: 'water', color: '#0284c7' });
  if (bill.penalties) charges.push({ label: 'Penalties', amount: bill.penalties, icon: 'warning', color: '#b91c1c' });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBack}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Payment</Text>
        <View style={styles.headerBack} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        )}
      >
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Ionicons name="receipt-outline" size={20} color={colors.primary} />
            <Text style={styles.summaryTitle}>{bill.description || bill.billing_period || 'Billing Statement'}</Text>
          </View>

          {bill.billing_period ? (
            <Text style={styles.summaryPeriod}>Period: {bill.billing_period}</Text>
          ) : null}

          <View style={styles.summaryDivider} />

          {charges.length > 0 ? (
            <View style={styles.chargesList}>
              {charges.map((charge, idx) => (
                <View key={idx} style={styles.chargeRow}>
                  <View style={styles.chargeLeft}>
                    <Ionicons name={charge.icon} size={14} color={charge.color} />
                    <Text style={styles.chargeLabel}>{charge.label}</Text>
                  </View>
                  <Text style={styles.chargeAmount}>{safeCurrency(charge.amount)}</Text>
                </View>
              ))}
              <View style={styles.chargeTotalDivider} />
            </View>
          ) : null}

          <View style={styles.summaryDetail}>
            <Text style={styles.summaryLabel}>Total Amount Due</Text>
            <Text style={styles.summaryAmount}>{safeCurrency(totalAmount)}</Text>
          </View>
          <View style={styles.summaryDetail}>
            <Text style={styles.summaryLabel}>Due Date</Text>
            <Text style={styles.summaryValue}>{safeDate(bill.due_date)}</Text>
          </View>
          {bill.release_date ? (
            <View style={styles.summaryDetail}>
              <Text style={styles.summaryLabel}>Released</Text>
              <Text style={styles.summaryValue}>{safeDate(bill.release_date)}</Text>
            </View>
          ) : null}
        </View>

        {!isOutstanding ? (
          <View style={styles.paidCard}>
            <View style={styles.paidHeader}>
              <Ionicons name="checkmark-circle" size={24} color="#22C55E" />
              <Text style={styles.paidTitle}>Payment Complete</Text>
            </View>
            <Text style={styles.paidDesc}>
              This bill has been paid{bill.payment_date ? ` on ${safeDate(bill.payment_date)}` : ''}.
            </Text>
            {bill.paymongo_reference ? (
              <View style={styles.paidRefRow}>
                <Text style={styles.paidRefLabel}>Reference</Text>
                <Text style={styles.paidRefValue}>{bill.paymongo_reference}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.paymentSection}>
            <View style={styles.onlineCard}>
              <View style={styles.onlineHeader}>
                <Ionicons name="shield-checkmark" size={20} color="#22C55E" />
                <Text style={styles.onlineTitle}>Secure Online Payment</Text>
              </View>
              <Text style={styles.onlineDesc}>
                You will be redirected to PayMongo&apos;s secure checkout page where you can pay via:
              </Text>
              <View style={styles.methodsList}>
                {['GCash', 'Maya', 'Credit/Debit Card', 'Online Banking'].map((method) => (
                  <View key={method} style={styles.methodChip}>
                    <Ionicons name="checkmark-circle" size={14} color="#22C55E" />
                    <Text style={styles.methodChipText}>{method}</Text>
                  </View>
                ))}
              </View>
            </View>

            <TouchableOpacity
              style={[styles.payBtn, creatingCheckout && styles.btnDisabled]}
              disabled={creatingCheckout}
              onPress={handlePayOnline}
              activeOpacity={0.8}
            >
              {creatingCheckout ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="card-outline" size={18} color="#ffffff" />
                  <Text style={styles.payBtnText}>Pay {safeCurrency(totalAmount)} via PayMongo</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.secureNote}>
              <Ionicons name="lock-closed" size={12} color={colors.textMuted} />
              <Text style={styles.secureNoteText}>Payments are processed securely by PayMongo</Text>
            </View>

            <View style={styles.singleBillNote}>
              <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
              <Text style={styles.singleBillNoteText}>This payment is for the selected bill only.</Text>
            </View>
          </View>
        )}

        <Pressable style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={styles.cancelText}>{isOutstanding ? 'Cancel' : 'Go Back'}</Text>
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (c, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 16 },
  errorLabel: { fontSize: 16, fontWeight: '700', color: c.text },
  errorActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  retryBtnSmall: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: c.primary, borderRadius: 10 },
  retryBtnSmallText: { color: '#ffffff', fontWeight: '700' },
  backBtnSmall: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: c.surface, borderRadius: 10, borderWidth: 1.5, borderColor: c.border },
  backBtnSmallText: { color: c.text, fontWeight: '700' },

  header: { flexDirection: 'row', alignItems: 'center', height: 50, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  headerBack: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: c.text },

  scrollContent: { padding: 16, gap: 16 },

  summaryCard: {
    backgroundColor: c.headerBg, borderRadius: 18, padding: 18,
    ...Platform.select({ ios: { shadowColor: c.headerBg, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10 }, android: { elevation: 4 } }),
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryTitle: { fontSize: 15, fontWeight: '700', color: '#ffffff', flex: 1 },
  summaryPeriod: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4, fontWeight: '600' },
  summaryDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 12 },
  summaryDetail: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  summaryLabel: { fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  summaryAmount: { fontSize: 24, fontWeight: '800', color: '#ff9000' },
  summaryValue: { fontSize: 14, fontWeight: '700', color: '#ffffff' },

  chargesList: { marginBottom: 8 },
  chargeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  chargeLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chargeLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  chargeAmount: { fontSize: 13, color: '#ffffff', fontWeight: '700' },
  chargeTotalDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginTop: 4, marginBottom: 8 },

  paymentSection: { gap: 14 },
  onlineCard: { backgroundColor: c.surface, borderRadius: 16, padding: 16, gap: 10, borderWidth: isDarkMode ? 1 : 0, borderColor: c.border },
  onlineHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  onlineTitle: { fontSize: 15, fontWeight: '700', color: c.text },
  onlineDesc: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
  methodsList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.surfaceSecondary || c.inputBg, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  methodChipText: { fontSize: 12, fontWeight: '600', color: c.text },

  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.primary, paddingVertical: 16, borderRadius: 14,
  },
  payBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 16 },

  secureNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  secureNoteText: { fontSize: 11, color: c.textMuted },
  singleBillNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  singleBillNoteText: { fontSize: 11, color: c.textMuted },

  paidCard: {
    backgroundColor: c.surface, borderRadius: 16, padding: 18, gap: 10,
    borderWidth: 1.5, borderColor: '#BBF7D0',
  },
  paidHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  paidTitle: { fontSize: 16, fontWeight: '700', color: '#15803d' },
  paidDesc: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
  paidRefRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  paidRefLabel: { fontSize: 12, color: c.textMuted, fontWeight: '600' },
  paidRefValue: { fontSize: 13, fontWeight: '700', color: c.text },

  cancelBtn: { paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', backgroundColor: c.surface },
  cancelText: { color: c.textSecondary, fontWeight: '600', fontSize: 15 },

  btnDisabled: { opacity: 0.6 },
});
