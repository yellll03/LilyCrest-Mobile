import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../src/context/AuthContext';
import { useTheme, useThemedStyles } from '../src/context/ThemeContext';
import { useAlert } from '../src/context/AlertContext';
import { apiService } from '../src/services/api';
import { downloadBillPdf } from '../src/utils/downloadBillPdf';

const getBillId = (bill) => bill?.billing_id || bill?.id || bill?._id || bill?.billingId || bill?.billId || bill?.reference_id;

// ── Mock data matching actual LilyCrest billing format ──
// Readings recorded every 15th of the month, bills released every 18th
// Multiple segments happen when someone moves in or out mid-period
const MOCK_BILLS = [
  {
    billing_id: 'BILL-2026-004',
    description: 'April 2026 Billing Statement',
    billing_period: 'April 2026',
    release_date: '2026-04-18',
    due_date: '2026-04-28',
    status: 'pending',
    billing_type: 'consolidated',
    rent: 5400, electricity: 353.89, water: 450, penalties: 0,
    total: 6203.89, amount: 6203.89,
    electricity_breakdown: [
      {
        occupants: 4,
        reading_date_from: '2026-03-15', reading_date_to: '2026-03-24',
        reading_from: 1091.91, reading_to: 1127.69,
        consumption: 35.78, rate: 16,
        segment_total: 572.48, share_per_tenant: 143.12,
      },
      {
        occupants: 3,
        reading_date_from: '2026-03-24', reading_date_to: '2026-04-15',
        reading_from: 1127.69, reading_to: 1167.21,
        consumption: 39.52, rate: 16,
        segment_total: 632.32, share_per_tenant: 210.77,
      },
    ],
    water_breakdown: {
      reading_from: 22, reading_to: 31,
      consumption: 9, rate: 50,
      total: 450,
      sharing_policy: 'Equal division among active tenants',
    },
  },
  {
    billing_id: 'BILL-2026-003',
    description: 'Electricity Bill - March 2026',
    billing_period: 'March 2026',
    period_start: '2026-02-15',
    period_end: '2026-03-15',
    release_date: '2026-03-18',
    due_date: '2026-03-25',
    status: 'overdue',
    billing_type: 'electricity',
    electricity: 353.89,
    total: 353.89,
    amount: 353.89,
    electricity_breakdown: [
      {
        // Segment 1: before tenant moved out on Feb 24
        occupants: 4,
        reading_date_from: '2026-02-15', reading_date_to: '2026-02-24',
        reading_from: 1016.61, reading_to: 1052.39,
        consumption: 35.78, rate: 16,
        segment_total: 572.48,
        share_per_tenant: 143.12,
      },
      {
        // Segment 2: after tenant moved out
        occupants: 3,
        reading_date_from: '2026-02-24', reading_date_to: '2026-03-15',
        reading_from: 1052.39, reading_to: 1091.91,
        consumption: 39.52, rate: 16,
        segment_total: 632.32,
        share_per_tenant: 210.77,
      },
    ],
  },
  {
    billing_id: 'BILL-2026-002',
    description: 'Electricity Bill - February 2026',
    billing_period: 'February 2026',
    period_start: '2026-01-15',
    period_end: '2026-02-15',
    release_date: '2026-02-18',
    due_date: '2026-02-25',
    status: 'paid',
    billing_type: 'electricity',
    electricity: 280.00,
    total: 280.00,
    amount: 280.00,
    payment_method: 'paymongo',
    payment_date: '2026-02-20T10:30:00Z',
    paymongo_reference: 'LC-BILL-2026-002-1709500000',
    electricity_breakdown: [
      {
        // No move-in/out = single segment 15th to 15th
        occupants: 4,
        reading_date_from: '2026-01-15', reading_date_to: '2026-02-15',
        reading_from: 946.61, reading_to: 1016.61,
        consumption: 70, rate: 16,
        segment_total: 1120,
        share_per_tenant: 280,
      },
    ],
  },
  {
    billing_id: 'BILL-2026-001',
    description: 'Electricity Bill - January 2026',
    billing_period: 'January 2026',
    period_start: '2025-12-15',
    period_end: '2026-01-15',
    release_date: '2026-01-18',
    due_date: '2026-01-25',
    status: 'paid',
    billing_type: 'electricity',
    electricity: 195.50,
    total: 195.50,
    amount: 195.50,
    payment_method: 'paymongo',
    payment_date: '2026-01-22T14:20:00Z',
    electricity_breakdown: [
      {
        occupants: 4,
        reading_date_from: '2025-12-15', reading_date_to: '2026-01-15',
        reading_from: 898.00, reading_to: 946.61,
        consumption: 48.61, rate: 16,
        segment_total: 777.76,
        share_per_tenant: 194.44,
      },
    ],
  },
];

// ── Helpers ──
function safeCurrency(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return '₱0.00';
  return `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function safeDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function shortDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const STATUS_CONFIG = {
  paid: { bg: '#ecfdf3', text: '#15803d', icon: 'checkmark-circle', label: 'Paid' },
  pending: { bg: '#FDF6EC', text: '#92400e', icon: 'time', label: 'Pending' },
  overdue: { bg: '#fef2f2', text: '#b91c1c', icon: 'alert-circle', label: 'Overdue' },
  verification: { bg: '#eff6ff', text: '#1d4ed8', icon: 'hourglass', label: 'Verifying' },
};

export default function BillDetailsScreen() {
  const router = useRouter();
  const { billId: billIdParam } = useLocalSearchParams();
  const billId = Array.isArray(billIdParam) ? billIdParam[0] : billIdParam;
  const { user } = useAuth();
  const { colors, isDarkMode } = useTheme();
  const { showAlert } = useAlert();
  const styles = useThemedStyles((c) => createStyles(c, isDarkMode));

  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [creatingCheckout, setCreatingCheckout] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await apiService.getMyBilling();
        const all = resp?.data || [];
        const match = all.find((b) => {
          const ids = [b.billing_id, b.id, b._id, b.billingId, b.billId, b.reference_id].filter(Boolean).map((id) => String(id));
          return ids.includes(String(billId));
        });
        if (match) { setBill(match); return; }
        const mockMatch = MOCK_BILLS.find((b) => String(getBillId(b)) === String(billId));
        if (mockMatch) { setBill(mockMatch); return; }
        setError('Bill not found');
      } catch (err) {
        const mockMatch = MOCK_BILLS.find((b) => String(getBillId(b)) === String(billId));
        if (mockMatch) { setBill(mockMatch); return; }
        setError('Unable to load bill details');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [billId]);

  // ── PayMongo Payment ──
  const handlePayOnline = async () => {
    const id = getBillId(bill);
    if (!id) return;
    setCreatingCheckout(true);
    try {
      const resp = await apiService.createPaymongoCheckout(id);
      const checkoutUrl = resp?.data?.checkout_url;
      if (!checkoutUrl) {
        showAlert({ title: 'Error', message: 'Could not create payment session. Please try again.', type: 'error' });
        return;
      }
      const supported = await Linking.canOpenURL(checkoutUrl);
      if (supported) {
        await Linking.openURL(checkoutUrl);
        setTimeout(() => {
          showAlert({
            title: 'Payment Status',
            message: 'If you completed the payment, it will be reflected in your billing within a few minutes.',
            type: 'info',
          });
        }, 1000);
      } else {
        showAlert({ title: 'Error', message: 'Unable to open payment page. Please try again.', type: 'error' });
      }
    } catch (err) {
      showAlert({ title: 'Payment Error', message: err?.response?.data?.detail || 'Failed to create payment session.', type: 'error' });
    } finally {
      setCreatingCheckout(false);
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
      <View style={styles.center}>
        <Text style={styles.errorText}>{error || 'Bill not found'}</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}><Text style={styles.backBtnText}>Go Back</Text></Pressable>
      </View>
    );
  }

  const billIdentifier = getBillId(bill);
  const MOCK_IDS = new Set(MOCK_BILLS.map(b => getBillId(b)).filter(Boolean).map(String));
  const isMockBill = String(billIdentifier || '').startsWith('mock') || MOCK_IDS.has(String(billIdentifier));
  const statusKey = (bill.status || 'pending').toLowerCase();
  const statusCfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG.pending;
  const isPaid = statusKey === 'paid';
  const totalAmount = bill.total || bill.amount || 0;

  // Auto-generate electricity breakdown for presentation if bill is electricity type but lacks breakdown data
  if (
    (!bill.electricity_breakdown || bill.electricity_breakdown.length === 0) &&
    ((bill.billing_type || '').toLowerCase() === 'electricity' || (bill.electricity && !bill.rent && !bill.water))
  ) {
    const elecAmount = bill.electricity || totalAmount;
    const rate = 16;
    const occupants = 4;
    const totalShare = elecAmount;
    const segTotal = totalShare * occupants;
    const consumption = segTotal / rate;
    const baseReading = 1016.61;
    // Default to 15th-to-15th reading period
    const dueDate = bill.due_date ? new Date(bill.due_date) : new Date();
    const readingEnd = new Date(dueDate);
    readingEnd.setDate(15);
    const readingStart = new Date(readingEnd);
    readingStart.setMonth(readingStart.getMonth() - 1);
    bill.electricity_breakdown = [
      {
        occupants,
        reading_date_from: shortDate(bill.period_start || readingStart),
        reading_date_to: shortDate(bill.period_end || readingEnd),
        reading_from: baseReading,
        reading_to: +(baseReading + consumption).toFixed(2),
        consumption: +consumption.toFixed(2),
        rate,
        segment_total: +segTotal.toFixed(2),
        share_per_tenant: +totalShare.toFixed(2),
      },
    ];
    if (!bill.electricity) bill.electricity = elecAmount;
  }

  // Auto-generate water breakdown for presentation if bill is water type but lacks breakdown data
  if (
    !bill.water_breakdown &&
    ((bill.billing_type || '').toLowerCase() === 'water' || (bill.water && !bill.rent && !bill.electricity))
  ) {
    const waterAmount = bill.water || totalAmount;
    const rate = 50;
    const consumption = waterAmount / rate;
    const baseReading = 15;
    bill.water_breakdown = {
      reading_from: baseReading,
      reading_to: +(baseReading + consumption).toFixed(1),
      consumption: +consumption.toFixed(1),
      rate,
      total: waterAmount,
      sharing_policy: 'Equal division among active tenants',
    };
    if (!bill.water) bill.water = waterAmount;
  }

  // Charge items
  const charges = [];
  if (bill.rent) charges.push({ label: 'Rent', amount: bill.rent, icon: 'home', color: '#1d4ed8' });
  if (bill.electricity) charges.push({ label: 'Electricity', amount: bill.electricity, icon: 'flash', color: '#b45309' });
  if (bill.water) charges.push({ label: 'Water', amount: bill.water, icon: 'water', color: '#0284c7' });
  if (bill.penalties) charges.push({ label: 'Penalty', amount: bill.penalties, icon: 'warning', color: '#b91c1c' });
  // Include extra line items if present
  if (Array.isArray(bill.items)) {
    bill.items.forEach((item) => {
      const typeIcons = { rent: 'home', electricity: 'flash', water: 'water', penalty: 'warning' };
      const typeColors = { rent: '#1d4ed8', electricity: '#b45309', water: '#0284c7', penalty: '#b91c1c' };
      const t = (item.type || 'other').toLowerCase();
      charges.push({
        label: item.label || item.description || 'Charge',
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
        <Pressable onPress={() => router.back()} style={styles.headerBack}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Bill Details</Text>
        <View style={styles.headerBack} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
              <Text style={styles.headerGridValue} numberOfLines={1}>{billIdentifier || '—'}</Text>
            </View>
            <View style={styles.headerGridItem}>
              <Text style={styles.headerGridLabel}>Period</Text>
              <Text style={styles.headerGridValue}>{bill.billing_period || '—'}</Text>
            </View>
            <View style={styles.headerGridItem}>
              <Text style={styles.headerGridLabel}>Released</Text>
              <Text style={styles.headerGridValue}>{shortDate(bill.release_date || bill.created_at)}</Text>
            </View>
            <View style={styles.headerGridItem}>
              <Text style={styles.headerGridLabel}>Due Date</Text>
              <Text style={styles.headerGridValue}>{shortDate(bill.due_date)}</Text>
            </View>
          </View>
        </View>

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
                <Text style={styles.totalLabel}>TOTAL AMOUNT</Text>
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

        {/* ── Electricity Computation Breakdown ── */}
        {bill.electricity_breakdown && bill.electricity_breakdown.length > 0 && (
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
                        {dateFrom} – {dateTo} ({occ} occupants)
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

        {/* ── Water Breakdown ── */}
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

          {isPaid ? (
            <View style={styles.paidInfo}>
              <View style={styles.paidBadge}>
                <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                <Text style={styles.paidBadgeText}>Payment Complete</Text>
              </View>
              {bill.payment_date && (
                <View style={styles.paymentInfoRow}>
                  <Text style={styles.paymentInfoLabel}>Payment Date</Text>
                  <Text style={styles.paymentInfoValue}>{safeDate(bill.payment_date)}</Text>
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
                  <Text style={styles.paymentInfoValue}>{bill.payment_method === 'paymongo' ? 'PayMongo' : bill.payment_method}</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.paySection}>
              <TouchableOpacity
                style={[styles.paymongoBtn, creatingCheckout && styles.btnDisabled]}
                disabled={creatingCheckout || isMockBill}
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
              <View style={styles.secureNote}>
                <Ionicons name="lock-closed" size={11} color={colors.textMuted} />
                <Text style={styles.secureNoteText}>Secure payment via GCash, Maya, Card, or Online Banking</Text>
              </View>
            </View>
          )}
        </View>

        {/* ── Download PDF ── */}
        <Pressable
          style={[styles.downloadBtn, (downloading || !billIdentifier) && styles.btnDisabled]}
          disabled={downloading || !billIdentifier}
          onPress={() => {
            if (!billIdentifier) {
              showAlert({ title: 'Download Unavailable', message: 'No downloadable receipt for this bill.', type: 'warning' });
              return;
            }
            downloadBillPdf(billIdentifier, setDownloading);
          }}
        >
          <Ionicons name="document-text-outline" size={18} color="#ffffff" />
          <Text style={styles.downloadText}>{downloading ? 'Preparing PDF...' : 'Download Official Receipt'}</Text>
        </Pressable>

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
    backgroundColor: isDarkMode ? '#1A1A2E' : '#14365A', borderRadius: 18, padding: 18,
    ...Platform.select({ ios: { shadowColor: '#14365A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10 }, android: { elevation: 4 } }),
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
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  summaryLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryDot: { width: 4, height: 4, borderRadius: 2 },
  summaryLabel: { fontSize: 14, color: c.textSecondary, fontWeight: '600' },
  summaryValue: { fontSize: 14, fontWeight: '700', color: c.text },
  totalDivider: { height: 1.5, backgroundColor: c.border, marginVertical: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  totalLabel: { fontSize: 14, fontWeight: '800', color: c.text },
  totalValue: { fontSize: 20, fontWeight: '800', color: '#D4682A' },

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
    backgroundColor: isDarkMode ? '#1A1A2E' : '#14365A',
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
  elecAmountLabel: { fontSize: 11, fontWeight: '600', color: '#D4682A', flex: 1 },
  elecAmountValue: { fontSize: 14, fontWeight: '800', color: '#D4682A' },
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
    backgroundColor: isDarkMode ? '#1A1A2E' : '#14365A',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  elecTotalDueLabel: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  elecTotalDueValue: { fontSize: 16, fontWeight: '800', color: '#D4682A' },
  elecDueDateRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: isDarkMode ? '#222240' : '#1A3D6A',
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
    backgroundColor: '#D4682A', paddingVertical: 16, borderRadius: 14,
  },
  paymongoBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
  secureNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  secureNoteText: { fontSize: 11, color: c.textMuted },

  // Download
  downloadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#152774', paddingVertical: 14, borderRadius: 14,
  },
  downloadText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },

  btnDisabled: { opacity: 0.5 },
});
