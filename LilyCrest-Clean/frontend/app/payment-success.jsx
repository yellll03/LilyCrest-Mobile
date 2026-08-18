import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../src/context/ThemeContext';
import { apiService } from '../src/services/api';
import { emitBillingRefresh } from '../src/services/billingState';

// Backend now returns a normalized status enum (paymongo.controller.js
// normalizeCheckoutStatusForClient) instead of leaving the client to
// interpret PayMongo's raw payment_intent/session strings. 'outcome' here is
// the resolved, final UI state this screen renders — distinct from
// 'isVerifying', which just tracks whether polling is still in progress.
const OUTCOME_COPY = {
  paid: {
    icon: 'checkmark-circle',
    iconColor: '#059669',
    iconBg: { light: '#ECFDF5', dark: '#0B2D26' },
    title: 'Payment Successful!',
    subtitle: 'Your payment has been processed successfully. It will be reflected in your billing shortly.',
  },
  failed: {
    icon: 'close-circle',
    iconColor: '#DC2626',
    iconBg: { light: '#FEF2F2', dark: '#3A1519' },
    title: 'Payment Failed',
    subtitle: 'Your payment was not completed. No successful payment was recorded — please try again.',
  },
  cancelled: {
    icon: 'remove-circle',
    iconColor: '#6B7280',
    iconBg: { light: '#F1F5F9', dark: '#0B1628' },
    title: 'Payment Cancelled',
    subtitle: 'This payment was cancelled before it completed. No charge was made.',
  },
  pending: {
    icon: 'time',
    iconColor: '#D97706',
    iconBg: { light: '#FFFBEB', dark: '#35250E' },
    title: 'Verifying Payment',
    subtitle: 'Your payment is still being verified. This can take a moment for some payment methods.',
  },
};

export default function PaymentSuccessScreen() {
  const router = useRouter();
  const { billing_id, checkout_id } = useLocalSearchParams();
  const checkoutId = String(checkout_id || '').trim();
  const { colors, isDarkMode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [isVerifying, setIsVerifying] = useState(Boolean(checkoutId));
  // 'pending' is the safe default: never assume success before the backend
  // confirms it, and never assume failure while verification is still in
  // flight.
  const [outcome, setOutcome] = useState('pending');
  const [verifyMessage, setVerifyMessage] = useState(
    checkoutId
      ? 'Finalizing your payment...'
      : 'Payment verification is unavailable for this redirect. Please check Billing in a few moments.'
  );

  // Confirm the PayMongo checkout result so backend can mark the bill as paid.
  // If checkout_id is missing (older app flows), fall back to the old timed redirect.
  useEffect(() => {
    let timer;
    let cancelled = false;

    const pollCheckoutStatus = async () => {
      if (!checkoutId) {
        setIsVerifying(false);
        timer = setTimeout(() => {
          emitBillingRefresh('payment_success');
          router.replace('/(tabs)/billing');
        }, 5000);
        return;
      }

      const maxAttempts = 24;
      const delayMs = 2500;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (cancelled) return;
        try {
          const response = await apiService.getPaymongoCheckoutStatus(checkoutId);
          const payload = response?.data || {};
          const status = String(payload.status || '').toLowerCase();

          if (status === 'paid') {
            setOutcome('paid');
            setVerifyMessage('Payment confirmed. Redirecting to billing...');
            setIsVerifying(false);
            emitBillingRefresh('payment_success');
            timer = setTimeout(() => {
              if (!cancelled) {
                router.replace('/(tabs)/billing');
              }
            }, 1200);
            return;
          }

          // Failed/cancelled are final, backend-confirmed outcomes — stop
          // polling immediately rather than waiting out the full 60s and
          // implying the payment might still complete on its own.
          if (status === 'failed' || status === 'cancelled') {
            setOutcome(status);
            setIsVerifying(false);
            setVerifyMessage(status === 'failed'
              ? 'Payment was not completed.'
              : 'Payment was cancelled.');
            return;
          }

          if (attempt < maxAttempts) {
            setVerifyMessage('Waiting for payment confirmation...');
            await new Promise((resolve) => {
              timer = setTimeout(resolve, delayMs);
            });
          }
        } catch (_error) {
          if (attempt < maxAttempts) {
            setVerifyMessage('Rechecking payment status...');
            await new Promise((resolve) => {
              timer = setTimeout(resolve, delayMs);
            });
          }
        }
      }

      if (!cancelled) {
        setIsVerifying(false);
        setVerifyMessage('Payment is still processing. Please check Billing in a few moments.');
      }
    };

    pollCheckoutStatus();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [checkoutId, router]);

  const copy = OUTCOME_COPY[outcome] || OUTCOME_COPY.pending;
  const isFailedOrCancelled = outcome === 'failed' || outcome === 'cancelled';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: isDarkMode ? copy.iconBg.dark : copy.iconBg.light }]}>
          <Ionicons name={copy.icon} size={64} color={copy.iconColor} />
        </View>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
        <View style={styles.verifyRow}>
          {isVerifying ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />}
          <Text style={styles.verifyText}>{verifyMessage}</Text>
        </View>
        {billing_id && (
          <Text style={styles.ref}>Bill ID: {billing_id}</Text>
        )}

        {isFailedOrCancelled ? (
          <Pressable
            style={styles.primaryBtn}
            onPress={() => {
              if (billing_id) {
                router.replace({ pathname: '/payment', params: { billId: billing_id } });
              } else {
                router.replace('/(tabs)/billing');
              }
            }}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Try Again</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.primaryBtn} onPress={() => { emitBillingRefresh('payment_success'); router.replace('/(tabs)/billing'); }}>
            <Ionicons name="receipt-outline" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>View Billing</Text>
          </Pressable>
        )}

        <Pressable style={styles.secondaryBtn} onPress={() => { emitBillingRefresh('payment_success'); router.replace('/(tabs)/home'); }}>
          <Text style={styles.secondaryBtnText}>Go to Home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  content: {
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 14,
  },
  iconCircle: {
    width: 100, height: 100, borderRadius: 50,
    justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  title: { fontSize: 24, fontWeight: '800', color: c.text },
  subtitle: { fontSize: 15, color: c.textSecondary, textAlign: 'center', lineHeight: 22, maxWidth: 300 },
  verifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    maxWidth: 320,
  },
  verifyText: {
    fontSize: 13,
    color: c.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    flexShrink: 1,
  },
  ref: { fontSize: 12, color: c.textMuted, fontWeight: '600' },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.primary, paddingVertical: 15, paddingHorizontal: 32,
    borderRadius: 8, marginTop: 16, width: '100%', maxWidth: 300,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: {
    paddingVertical: 12, paddingHorizontal: 24,
  },
  secondaryBtnText: { color: c.primary, fontWeight: '600', fontSize: 14 },
});
