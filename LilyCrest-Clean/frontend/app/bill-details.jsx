import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAlert } from '../src/context/AlertContext';
import { useAuth } from '../src/context/AuthContext';
import { useTheme, useThemedStyles } from '../src/context/ThemeContext';
import { apiService } from '../src/services/api';
import {
  BILL_UNAVAILABLE_MESSAGE,
  emitBillingRefresh,
  getBillingApiMessage,
  isBillingUnavailableMessage,
} from '../src/services/billingState';
import { safeBack } from '../src/utils/navigation';
import { ensureFirebaseStorageAttachments, IMAGE_UPLOAD_MIME_TYPES, MAX_IMAGE_UPLOAD_BYTES } from '../src/services/firebaseStorageUpload';
import { getBillPaymentDate, getUtilityReleaseSchedule, isBillOutstanding } from '../src/utils/billingStatus';

const getBillId = (bill) => bill?.billing_id || bill?.id || bill?._id || bill?.billingId || bill?.billId || bill?.reference_id;



// ── Helpers ──
function safeCurrency(amount) {
  // null/undefined means "not yet computed by billing", not a real zero balance \u2014
  // showing the same "\u20b10.00" for both would misleadingly imply a paid-up/zero bill.
  if (amount === null || amount === undefined || amount === '') return 'Not available';
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return '\u20b10.00';
  const absolute = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2 });
  return `${n < 0 ? '\u2212' : ''}\u20b1${absolute}`;
}

function safeDate(value) {
  if (!value) return '\u2014';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function shortDate(value) {
  if (!value) return '\u2014';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// PayMongo is the payment gateway, not the payment method the tenant actually
// picked. The backend now captures the actual settled-payment channel
// (GCash/Card/Maya/GrabPay/Online Banking) at reconciliation time and
// returns it as bill.payment_channel; show that when known, and only fall
// back to a generic "Online Payment" label for older records where it
// wasn't captured. Mirrors backend/controllers/billing.controller.js's
// PAYMENT_CHANNEL_LABELS/billPaymentMethodLabel.
const PAYMENT_CHANNEL_LABELS = {
  gcash: 'GCash',
  card: 'Card',
  grab_pay: 'GrabPay',
  paymaya: 'Maya',
  billease: 'BillEase',
  dob: 'Online Banking',
  dob_ubp: 'Online Banking',
};

function paymentMethodLabel(rawMethod, channel) {
  const channelLabel = PAYMENT_CHANNEL_LABELS[String(channel || '').trim().toLowerCase()];
  if (channelLabel) return channelLabel;
  const value = String(rawMethod || '').trim();
  if (!value) return '';
  return value.toLowerCase() === 'paymongo' ? 'Online Payment' : value;
}

const STATUS_CONFIG = {
  paid: { bg: '#ecfdf3', text: '#15803d', icon: 'checkmark-circle', label: 'Paid' },
  settled: { bg: '#ecfdf3', text: '#15803d', icon: 'checkmark-circle', label: 'Paid' },
  unpaid: { bg: '#FDF6EC', text: '#92400e', icon: 'time', label: 'Unpaid' },
  pending: { bg: '#FDF6EC', text: '#92400e', icon: 'time', label: 'Unpaid' },
  overdue: { bg: '#fef2f2', text: '#b91c1c', icon: 'alert-circle', label: 'Overdue' },
  pending_verification: { bg: '#eff6ff', text: '#1d4ed8', icon: 'hourglass', label: 'Payment Under Review' },
  verification: { bg: '#eff6ff', text: '#1d4ed8', icon: 'hourglass', label: 'Payment Under Review' },
  partially_paid: { bg: '#fff7ed', text: '#c2410c', icon: 'pie-chart', label: 'Partially Paid' },
  rejected: { bg: '#fef2f2', text: '#b91c1c', icon: 'close-circle', label: 'Payment Rejected' },
  cancelled: { bg: '#f3f4f6', text: '#6b7280', icon: 'close-circle', label: 'Cancelled' },
};

export default function BillDetailsScreen() {
  const router = useRouter();
  const { billId: billIdParam } = useLocalSearchParams();
  const billId = Array.isArray(billIdParam) ? billIdParam[0] : billIdParam;
  const { colors, isDarkMode } = useTheme();
  const { showAlert } = useAlert();
  const { user } = useAuth();
  const styles = useThemedStyles((c) => createStyles(c, isDarkMode));

  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creatingCheckout, setCreatingCheckout] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);

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
      const message = getBillingApiMessage(err, 'Unable to load bill details');
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

  useEffect(() => {
    loadBill();
  }, [loadBill]);

  useFocusEffect(useCallback(() => {
    loadBill({ showLoader: false });
    return undefined;
  }, [loadBill]));

  // ── PayMongo Payment ──
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

      // Open PayMongo checkout in an in-app browser that monitors for the
      // frontend:// deep-link redirect and closes automatically when it fires.
      const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, 'frontend://');

      if (result.type === 'success') {
        const returnUrl = result.url || '';
        if (returnUrl.includes('payment-success')) {
          router.replace({ pathname: '/payment-success', params: { billing_id: id, checkout_id: checkoutId || '' } });
        } else {
          router.replace({ pathname: '/payment-cancel', params: { billing_id: id, checkout_id: checkoutId || '' } });
        }
      }
      // result.type === 'cancel' means the user closed the browser — stay on page
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

  const handleUploadProof = async () => {
    if (uploadingProof || !billId) return;
    if (String(bill?.status || '').toLowerCase() === 'pending_verification') {
      showAlert({ title: 'Under Review', message: 'Your payment proof is already under review.', type: 'info' });
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert({ title: 'Permission Required', message: 'Photo access is required to select payment proof.', type: 'warning' });
      return;
    }
    const selected = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (selected.canceled || !selected.assets?.[0]) return;
    const asset = selected.assets[0];
    setUploadingProof(true);
    try {
      const [proof] = await ensureFirebaseStorageAttachments([{
        uri: asset.uri,
        name: asset.fileName || `payment-proof-${Date.now()}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
        size: asset.fileSize,
      }], {
        allowedMimeTypes: IMAGE_UPLOAD_MIME_TYPES,
        entityId: String(billId),
        folder: 'payment-proofs',
        maxBytes: MAX_IMAGE_UPLOAD_BYTES,
        tenantId: user?.user_id,
      });
      await apiService.submitPaymentProof(String(billId), proof);
      showAlert({ title: 'Proof Uploaded', message: 'Your payment proof is under review. This bill is not marked paid until verification is complete.', type: 'success' });
      await loadBill({ showLoader: false });
      emitBillingRefresh('proof_uploaded');
    } catch (error) {
      showAlert({ title: 'Upload Failed', message: getBillingApiMessage(error, 'Unable to upload payment proof. Please try again.'), type: 'error' });
    } finally {
      setUploadingProof(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !bill) {
    return (
      <ScrollView
        style={styles.container}
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
        <Text style={styles.errorText}>{error || BILL_UNAVAILABLE_MESSAGE}</Text>
        <Pressable onPress={() => safeBack(router, '/(tabs)/billing')} style={styles.backBtn}><Text style={styles.backBtnText}>Go Back</Text></Pressable>
      </ScrollView>
    );
  }

  const billIdentifier = getBillId(bill);
  const statusKey = (bill.status || 'pending').toLowerCase();
  const statusCfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG.unpaid;
  const isOutstanding = isBillOutstanding(bill);
  const totalAmount = bill.total || bill.amount || 0;
  // Single source of truth for release/due state — matches Billing History
  // and Home so the same bill never shows a contradictory release state
  // depending on which screen rendered it (see billingStatus.js).
  const releaseSchedule = getUtilityReleaseSchedule(bill);
  const utilityDeadlines = Object.entries(bill.utility_deadlines || {})
    .filter(([, deadline]) => deadline?.billReleaseDate && deadline?.finalDueDate);

  const moveInFinancials = bill.move_in_financials || bill.moveInFinancials || null;
  // Charge items
  const charges = [];
  if (moveInFinancials) {
    charges.push(
      { label: 'One Month Advance Rent', amount: moveInFinancials.advanceRent, icon: 'home', color: '#1d4ed8' },
      { label: 'Security Deposit', amount: moveInFinancials.securityDeposit, icon: 'shield-checkmark', color: '#0284c7' },
      { label: 'Reservation Fee Already Paid', amount: -moveInFinancials.reservationFeeAlreadyPaid, icon: 'remove-circle', color: '#15803d' },
    );
  } else {
    if (bill.rent) charges.push({ label: 'Rent', amount: bill.rent, icon: 'home', color: '#1d4ed8' });
    if (bill.electricity) charges.push({ label: 'Electricity', amount: bill.electricity, icon: 'flash', color: '#b45309' });
    if (bill.water) charges.push({ label: 'Water', amount: bill.water, icon: 'water', color: '#0284c7' });
    if (bill.penalties) charges.push({ label: 'Penalty', amount: bill.penalties, icon: 'warning', color: '#b91c1c' });
  }
  // Include extra line items if present. The canonical bridge returns these
  // as bill.additional_charges: [{ name, amount }] (see mobileBillingBridge.js
  // toMobileBill()); bill.items is kept as a fallback for any older/legacy
  // response shape so a genuine adjustment never silently disappears from
  // the breakdown.
  if (!moveInFinancials) {
    const extraItems = Array.isArray(bill.additional_charges) ? bill.additional_charges
      : Array.isArray(bill.items) ? bill.items
      : [];
    extraItems.forEach((item) => {
      const label = item.name || item.label || item.description || 'Charge';
      if (charges.find((charge) => charge.label === label)) return;
      const typeIcons = { rent: 'home', electricity: 'flash', water: 'water', penalty: 'warning' };
      const typeColors = { rent: '#1d4ed8', electricity: '#b45309', water: '#0284c7', penalty: '#b91c1c' };
      const t = (item.type || 'other').toLowerCase();
      charges.push({
        label,
        amount: item.amount || 0,
        icon: typeIcons[t] || 'receipt',
        color: typeColors[t] || '#6B7280',
      });
    });
  }
  // Fallback: if no itemized charges but there's a billing_type, show single charge row
  if (charges.length === 0 && bill.billing_type && totalAmount > 0) {
    const typeMap = {
      rent: { icon: 'home', color: '#1d4ed8' },
      electricity: { icon: 'flash', color: '#b45309' },
      water: { icon: 'water', color: '#0284c7' },
      penalty: { icon: 'warning', color: '#b91c1c' },
    };
    const t = bill.billing_type.toLowerCase();
    const cfg = typeMap[t] || { icon: 'receipt', color: '#6B7280' };
    const label = bill.billing_type.charAt(0).toUpperCase() + bill.billing_type.slice(1);
    charges.push({ label, amount: totalAmount, icon: cfg.icon, color: cfg.color });
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => safeBack(router, '/(tabs)/billing')} style={styles.headerBack}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Bill Details</Text>
        <View style={styles.headerBack} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
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
        {/* ── Billing Header Card ── */}
        <View style={styles.headerCard}>
          <Text style={styles.brandText}>LILYCREST DORMITORY</Text>
          <Text style={styles.billTitle}>{bill.description || bill.billing_period || 'Billing Statement'}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
            <Ionicons name={statusCfg.icon} size={14} color={statusCfg.text} />
            <Text style={[styles.statusText, { color: statusCfg.text }]}>{statusCfg.label}</Text>
          </View>

          <View style={styles.headerGrid}>
            <View style={styles.headerGridItem}>
              <Text style={styles.headerGridLabel}>Bill ID</Text>
              <Text style={styles.headerGridValue} numberOfLines={1}>{billIdentifier || '\u2014'}</Text>
            </View>
            <View style={styles.headerGridItem}>
              <Text style={styles.headerGridLabel}>Period</Text>
              <Text style={styles.headerGridValue}>{bill.billing_period || '\u2014'}</Text>
            </View>
            {!releaseSchedule.unreleasedUtility && <>
              <View style={styles.headerGridItem}>
                <Text style={styles.headerGridLabel}>Released</Text>
                <Text style={styles.headerGridValue}>{shortDate(releaseSchedule.releaseDate)}</Text>
              </View>
              <View style={styles.headerGridItem}>
                <Text style={styles.headerGridLabel}>Due Date</Text>
                <Text style={styles.headerGridValue}>{shortDate(releaseSchedule.dueDate || bill.due_date)}</Text>
              </View>
            </>}
          </View>
        </View>

        {utilityDeadlines.map(([utility, deadline]) => (
          <View key={utility} style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name={utility === 'electricity' ? 'flash' : 'water'} size={16} color={utility === 'electricity' ? '#b45309' : '#0284c7'} />
              <Text style={styles.sectionTitle}>{utility === 'electricity' ? 'Electricity' : 'Water'} Billing Schedule</Text>
            </View>
            <View style={styles.headerGrid}>
              <View style={styles.headerGridItem}><Text style={styles.headerGridLabel}>Reading Date</Text><Text style={styles.headerGridValue}>{shortDate(deadline.meterReadingDate)}</Text></View>
              <View style={styles.headerGridItem}><Text style={styles.headerGridLabel}>Released</Text><Text style={styles.headerGridValue}>{shortDate(deadline.billReleaseDate)}</Text></View>
              <View style={styles.headerGridItem}><Text style={styles.headerGridLabel}>Due Date</Text><Text style={styles.headerGridValue}>{shortDate(deadline.finalDueDate)}</Text></View>
            </View>
          </View>
        ))}
        {releaseSchedule.unreleasedUtility ? (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="information-circle-outline" size={17} color={colors.primary} />
              <Text style={styles.sectionTitle}>Utility Billing Schedule</Text>
            </View>
            <Text style={{ color: colors.textSecondary }}>Your utility bill has not been released yet.</Text>
          </View>
        ) : null}

        {/* ── Billing Summary Table ── */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="receipt-outline" size={16} color={colors.primary} />
            <Text style={styles.sectionTitle}>Billing Summary</Text>
          </View>

          {charges.length > 0 ? (
            <>
              {charges.map((charge, idx) => (
                <View key={idx} style={styles.summaryRow}>
                  <View style={styles.summaryLeft}>
                    <View style={[styles.summaryDot, { backgroundColor: charge.color }]} />
                    <Ionicons name={charge.icon} size={14} color={charge.color} />
                    <Text style={styles.summaryLabel}>{charge.label}</Text>
                  </View>
                  <Text style={styles.summaryValue}>{safeCurrency(charge.amount)}</Text>
                </View>
              ))}
              <View style={styles.totalDivider} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{moveInFinancials ? 'REMAINING BALANCE' : 'TOTAL AMOUNT'}</Text>
                <Text style={styles.totalValue}>{safeCurrency(totalAmount)}</Text>
              </View>
            </>
          ) : (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Amount</Text>
              <Text style={styles.totalValue}>{safeCurrency(totalAmount)}</Text>
            </View>
          )}
        </View>

        {/* ── Electricity Computation Breakdown ──
            Only renders when the backend genuinely supplies a segmented
            reading breakdown; the flat Billing Summary above already shows
            the authoritative electricity total either way, so there is
            nothing to flag as "unavailable" when this segment is absent. */}
        {Array.isArray(bill.electricity_breakdown) && bill.electricity_breakdown.length > 0 && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="flash" size={16} color="#b45309" />
              <Text style={styles.sectionTitle}>Electricity Breakdown</Text>
            </View>

            {bill.electricity_breakdown.map((seg, idx) => {
              const occupants = seg.occupants || seg.active_tenants?.length || 1;
              const consumption = seg.consumption ?? ((seg.reading_to || 0) - (seg.reading_from || 0));
              const rate = seg.rate || 0;

              return (
                <View key={idx} style={styles.elecTable}>
                  {/* Occupants header */}
                  <View style={styles.elecTableHeaderRow}>
                    <Text style={styles.elecHeaderLabel}>No. of occupants in the room:</Text>
                    <Text style={styles.elecHeaderValue}>{occupants}</Text>
                  </View>

                  {/* Column headers */}
                  <View style={styles.elecColHeaderRow}>
                    <View style={styles.elecColFirst} />
                    <View style={styles.elecColDate}>
                      <Text style={styles.elecColHeaderText}>Date</Text>
                    </View>
                    <View style={styles.elecColKwh}>
                      <Text style={styles.elecColHeaderText}>kwh</Text>
                    </View>
                  </View>

                  {/* 1st reading */}
                  <View style={styles.elecDataRow}>
                    <View style={styles.elecColFirst}>
                      <Text style={styles.elecRowLabel}>1st reading</Text>
                    </View>
                    <View style={styles.elecColDate}>
                      <Text style={styles.elecRowValue}>{shortDate(seg.reading_date_from || seg.period_start)}</Text>
                    </View>
                    <View style={styles.elecColKwh}>
                      <Text style={styles.elecRowValue}>{seg.reading_from}</Text>
                    </View>
                  </View>

                  {/* 2nd reading */}
                  <View style={styles.elecDataRow}>
                    <View style={styles.elecColFirst}>
                      <Text style={styles.elecRowLabel}>2nd reading</Text>
                    </View>
                    <View style={styles.elecColDate}>
                      <Text style={styles.elecRowValue}>{shortDate(seg.reading_date_to || seg.period_end)}</Text>
                    </View>
                    <View style={styles.elecColKwh}>
                      <Text style={styles.elecRowValue}>{seg.reading_to}</Text>
                    </View>
                  </View>

                  {/* Total consumption */}
                  <View style={styles.elecDataRow}>
                    <View style={styles.elecColFirst}>
                      <Text style={[styles.elecRowLabel, { fontStyle: 'italic' }]}>Total consumption</Text>
                    </View>
                    <View style={styles.elecColDate} />
                    <View style={styles.elecColKwh}>
                      <Text style={[styles.elecRowValue, { fontWeight: '700' }]}>{consumption.toFixed(2)}</Text>
                    </View>
                  </View>

                  {/* Amount due per person */}
                  <View style={styles.elecAmountRow}>
                    <Text style={styles.elecAmountLabel}>
                      Amount due (Php {rate} / kwh) per person
                    </Text>
                    <Text style={styles.elecAmountValue}>
                      {safeCurrency(seg.share_per_tenant)}
                    </Text>
                  </View>
                </View>
              );
            })}

            {/* ── Total Amount Due Summary ── */}
            <View style={styles.elecSummaryTable}>
              {/* Per-segment shares */}
              {bill.electricity_breakdown.map((seg, idx) => {
                const dateFrom = shortDate(seg.reading_date_from || seg.period_start);
                const dateTo = shortDate(seg.reading_date_to || seg.period_end);
                const occ = seg.occupants || seg.active_tenants?.length || 1;
                return (
                  <View key={idx} style={styles.elecSummaryRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.elecSummaryLabel}>
                        {dateFrom} {"\u2013"} {dateTo} ({occ} {occ === 1 ? "occupant" : "occupants"})
                      </Text>
                    </View>
                    <Text style={styles.elecSummaryAmount}>
                      {safeCurrency(seg.share_per_tenant)}
                    </Text>
                  </View>
                );
              })}

              {/* Addition line when multiple segments */}
              {bill.electricity_breakdown.length > 1 && (
                <View style={styles.elecSummaryAddition}>
                  <Text style={styles.elecSummaryAdditionText}>
                    {bill.electricity_breakdown.map(s => safeCurrency(s.share_per_tenant)).join(' + ')}
                  </Text>
                </View>
              )}

              {/* Total Amount Due */}
              <View style={styles.elecTotalDueRow}>
                <Text style={styles.elecTotalDueLabel}>Total Amount Due</Text>
                <Text style={styles.elecTotalDueValue}>
                  {safeCurrency(bill.electricity_breakdown.reduce((s, seg) => s + (seg.share_per_tenant || 0), 0))}
                </Text>
              </View>

              {/* Due Date */}
              <View style={styles.elecDueDateRow}>
                <Text style={styles.elecDueDateLabel}>Due Date:</Text>
                <Text style={styles.elecDueDateValue}>
                  {safeDate(bill.due_date)}
                </Text>
              </View>
            </View>
          </View>
        )}
        {/* ── Water Breakdown ── only when the backend supplies segmented
            meter-reading detail; otherwise the flat Billing Summary total
            already covers it. */}
        {bill.water_breakdown && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="water" size={16} color="#0284c7" />
              <Text style={styles.sectionTitle}>Water Breakdown</Text>
            </View>

            <View style={styles.segmentCard}>
              <View style={styles.segmentGrid}>
                <View style={styles.segmentGridItem}>
                  <Text style={styles.segmentGridLabel}>Meter Reading</Text>
                  <Text style={styles.segmentGridValue}>
                    {bill.water_breakdown.reading_from} → {bill.water_breakdown.reading_to}
                  </Text>
                </View>
                <View style={styles.segmentGridItem}>
                  <Text style={styles.segmentGridLabel}>Consumption</Text>
                  <Text style={styles.segmentGridValue}>{bill.water_breakdown.consumption} cu.m</Text>
                </View>
                <View style={styles.segmentGridItem}>
                  <Text style={styles.segmentGridLabel}>Rate</Text>
                  <Text style={styles.segmentGridValue}>₱{bill.water_breakdown.rate}/cu.m</Text>
                </View>
                <View style={styles.segmentGridItem}>
                  <Text style={styles.segmentGridLabel}>Total</Text>
                  <Text style={styles.segmentGridValue}>{safeCurrency(bill.water_breakdown.total)}</Text>
                </View>
              </View>
              {bill.water_breakdown.sharing_policy && (
                <Text style={styles.sharingPolicy}>{bill.water_breakdown.sharing_policy}</Text>
              )}
            </View>
          </View>
        )}

        {/* ── Payment Section ── */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="card-outline" size={16} color={colors.primary} />
            <Text style={styles.sectionTitle}>Payment</Text>
          </View>

        {!isOutstanding ? (
            <View style={styles.paidInfo}>
              <View style={styles.paidBadge}>
                <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                <Text style={styles.paidBadgeText}>Payment Complete</Text>
              </View>
              {getBillPaymentDate(bill) && (
                <View style={styles.paymentInfoRow}>
                  <Text style={styles.paymentInfoLabel}>Payment Date</Text>
                  <Text style={styles.paymentInfoValue}>{safeDate(getBillPaymentDate(bill))}</Text>
                </View>
              )}
              {bill.paymongo_reference && (
                <View style={styles.paymentInfoRow}>
                  <Text style={styles.paymentInfoLabel}>Reference No.</Text>
                  <Text style={styles.paymentInfoValue}>{bill.paymongo_reference}</Text>
                </View>
              )}
              {bill.payment_method && (
                <View style={styles.paymentInfoRow}>
                  <Text style={styles.paymentInfoLabel}>Method</Text>
                  <Text style={styles.paymentInfoValue}>{paymentMethodLabel(bill.payment_method, bill.payment_channel)}</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.paySection}>
              <TouchableOpacity
                style={[styles.paymongoBtn, creatingCheckout && styles.btnDisabled]}
                disabled={creatingCheckout}
                onPress={handlePayOnline}
                activeOpacity={0.8}
              >
                {creatingCheckout ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <>
                    <Ionicons name="card-outline" size={18} color="#ffffff" />
                    <Text style={styles.paymongoBtnText}>Pay {safeCurrency(totalAmount)} via PayMongo</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.proofBtn, (uploadingProof || statusKey === 'pending_verification') && styles.btnDisabled]}
                disabled={uploadingProof || statusKey === 'pending_verification'}
                onPress={handleUploadProof}
              >
                {uploadingProof ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="cloud-upload-outline" size={18} color={colors.primary} />}
                <Text style={styles.proofBtnText}>{statusKey === 'pending_verification' ? 'Payment Proof Under Review' : statusKey === 'rejected' ? 'Retry Payment Proof' : 'Upload Payment Proof'}</Text>
              </TouchableOpacity>
              {statusKey === 'rejected' && <Text style={styles.rejectionText}>{bill.rejection_reason || bill.rejectionReason || 'Payment proof was rejected. Please submit a clearer or corrected image.'}</Text>}
              <View style={styles.secureNote}>
                <Ionicons name="lock-closed" size={11} color={colors.textMuted} />
                <Text style={styles.secureNoteText}>Secure payment via GCash, Maya, Card, or Online Banking</Text>
              </View>
            </View>
          )}
        </View>

        {/* ── Documents ── */}
        <Pressable
          style={[styles.downloadBtn, !billIdentifier && styles.btnDisabled]}
          disabled={!billIdentifier}
          onPress={() => {
            if (!billIdentifier) {
              showAlert({ title: 'Download Unavailable', message: 'No downloadable statement for this bill.', type: 'warning' });
              return;
            }
            router.push({
              pathname: '/document-viewer',
              // cacheKey includes statement_version (bumped server-side on every
              // regeneration — see backend resolveStatementVersion()) so a
              // statement that changed since it was last cached (e.g. a utility
              // charge just posted) is never served stale from disk.
              params: { kind: 'bill', id: String(billIdentifier), title: 'Billing Statement', cacheKey: `${billIdentifier}_v${bill?.statement_version || 'v1'}` },
            });
          }}
        >
          <Ionicons name="document-text-outline" size={18} color="#ffffff" />
          <Text style={styles.downloadText}>View Statement</Text>
        </Pressable>

        {!isOutstanding && (
          <Pressable
            style={[styles.downloadBtn, styles.receiptBtn, !billIdentifier && styles.btnDisabled]}
            disabled={!billIdentifier}
            onPress={() => {
              if (!billIdentifier) return;
              router.push({
                pathname: '/document-viewer',
                params: { kind: 'bill-receipt', id: String(billIdentifier), title: 'Payment Receipt', cacheKey: `${billIdentifier}_receipt_v${bill?.statement_version || 'v1'}` },
              });
            }}
          >
            <Ionicons name="receipt-outline" size={18} color={colors.primary} />
            <Text style={[styles.downloadText, { color: colors.primary }]}>View Receipt</Text>
          </Pressable>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ── Styles ──
const createStyles = (c, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16, backgroundColor: c.background },
  errorText: { color: c.error, fontWeight: '800', marginBottom: 12 },
  backBtn: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: c.primary, borderRadius: 10 },
  backBtnText: { color: c.surface, fontWeight: '700' },

  header: {
    flexDirection: 'row', alignItems: 'center', height: 52, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: c.border,
    backgroundColor: isDarkMode ? c.headerBg : c.surface,
  },
  headerBack: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: c.text },
  content: { padding: 16, gap: 14 },

  // Header Card
  headerCard: {
    backgroundColor: c.headerBg, borderRadius: 18, padding: 18,
    ...Platform.select({ ios: { shadowColor: c.headerBg, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10 }, android: { elevation: 4 } }),
  },
  brandText: { fontSize: 10, letterSpacing: 2, color: 'rgba(255,255,255,0.4)', fontWeight: '700', marginBottom: 6 },
  billTitle: { fontSize: 18, fontWeight: '800', color: '#ffffff', marginBottom: 8 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, marginBottom: 14,
  },
  statusText: { fontSize: 12, fontWeight: '700' },
  headerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  headerGridItem: {
    width: '50%', paddingVertical: 6,
  },
  headerGridLabel: { fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: '600' },
  headerGridValue: { fontSize: 13, color: '#ffffff', fontWeight: '700', marginTop: 2 },

  // Section Card (shared)
  sectionCard: {
    backgroundColor: c.surface, borderRadius: 16, padding: 16, gap: 10,
    borderWidth: 1, borderColor: c.border,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: c.text },

  // Summary Table
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, gap: 8 },
  summaryLeft: { flex: 1, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryDot: { width: 4, height: 4, borderRadius: 2 },
  summaryLabel: { flexShrink: 1, fontSize: 14, color: c.textSecondary, fontWeight: '600' },
  summaryValue: { flexShrink: 0, fontSize: 14, fontWeight: '700', color: c.text },
  totalDivider: { height: 1.5, backgroundColor: c.border, marginVertical: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  totalLabel: { fontSize: 14, fontWeight: '800', color: c.text },
  totalValue: { fontSize: 20, fontWeight: '800', color: c.accent },

  // Computation Segments (old styles kept for water breakdown)
  segmentCard: {
    backgroundColor: c.surfaceSecondary || c.inputBg, borderRadius: 12, padding: 14, gap: 8,
    borderWidth: 1, borderColor: c.border,
  },
  segmentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  segmentPeriod: { fontSize: 13, fontWeight: '700', color: c.text },
  segmentTotal: { fontSize: 14, fontWeight: '800', color: '#b45309' },
  segmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  segmentGridItem: { width: '50%', paddingVertical: 4 },
  segmentGridLabel: { fontSize: 11, color: c.textMuted, fontWeight: '600' },
  segmentGridValue: { fontSize: 13, fontWeight: '700', color: c.text, marginTop: 1 },
  sharingPolicy: { fontSize: 11, color: c.textMuted, fontStyle: 'italic', marginTop: 2 },

  // Electricity table (matching reference billing format)
  elecTable: {
    borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: c.border,
    backgroundColor: c.surfaceSecondary || c.inputBg,
  },
  elecTableHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: c.headerBg,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  elecHeaderLabel: { fontSize: 12, fontWeight: '700', color: '#ffffff' },
  elecHeaderValue: { fontSize: 14, fontWeight: '800', color: '#ffffff' },
  elecColHeaderRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border,
    backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    paddingVertical: 6, paddingHorizontal: 12,
  },
  elecColFirst: { flex: 1.2 },
  elecColDate: { flex: 1, alignItems: 'center' },
  elecColKwh: { flex: 0.8, alignItems: 'flex-end' },
  elecColHeaderText: { fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'lowercase' },
  elecDataRow: {
    flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 12,
    borderBottomWidth: 0.5, borderBottomColor: c.border,
  },
  elecRowLabel: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
  elecRowValue: { fontSize: 12, fontWeight: '600', color: c.text },
  elecAmountRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 9,
    backgroundColor: isDarkMode ? 'rgba(212,104,42,0.15)' : '#FFF7ED',
  },
  elecAmountLabel: { fontSize: 11, fontWeight: '600', color: c.accent, flex: 1 },
  elecAmountValue: { fontSize: 14, fontWeight: '800', color: c.accent },
  // Electricity summary table (total due + due date)
  elecSummaryTable: {
    borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: c.border,
    backgroundColor: c.surfaceSecondary || c.inputBg, marginTop: 6,
  },
  elecSummaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 7,
    borderBottomWidth: 0.5, borderBottomColor: c.border,
  },
  elecSummaryLabel: { fontSize: 11, fontWeight: '600', color: c.textSecondary },
  elecSummaryAmount: { fontSize: 12, fontWeight: '700', color: c.text },
  elecSummaryAddition: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderBottomWidth: 0.5, borderBottomColor: c.border,
    alignItems: 'flex-end',
  },
  elecSummaryAdditionText: { fontSize: 11, fontWeight: '600', color: c.textMuted, fontStyle: 'italic' },
  elecTotalDueRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: c.headerBg,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  elecTotalDueLabel: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  elecTotalDueValue: { fontSize: 16, fontWeight: '800', color: '#ff9000' },
  elecDueDateRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: isDarkMode ? '#1A1A1A' : '#0A2040',
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
  },
  elecDueDateLabel: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },
  elecDueDateValue: { fontSize: 13, fontWeight: '700', color: '#ffffff' },

  // Payment
  paidInfo: { gap: 8 },
  paidBadge: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  paidBadgeText: { fontSize: 14, fontWeight: '700', color: '#15803d' },
  paymentInfoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  paymentInfoLabel: { fontSize: 13, color: c.textMuted, fontWeight: '600' },
  paymentInfoValue: { fontSize: 13, fontWeight: '700', color: c.text },
  paySection: { gap: 10 },
  paymongoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.primary, paddingVertical: 16, borderRadius: 14,
  },
  paymongoBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
  proofBtn: { minHeight: 48, borderWidth: 1.5, borderColor: c.primary, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  proofBtnText: { color: c.primary, fontSize: 14, fontWeight: '700' },
  rejectionText: { color: '#b91c1c', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  secureNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  secureNoteText: { fontSize: 11, color: c.textMuted },

  // Download
  downloadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.headerBg, paddingVertical: 14, borderRadius: 14,
  },
  downloadText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
  receiptBtn: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: c.primary, marginTop: 10 },

  btnDisabled: { opacity: 0.5 },
});
