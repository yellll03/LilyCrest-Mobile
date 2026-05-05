import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../src/context/ThemeContext';
import { apiService } from '../src/services/api';

export default function PaymentSuccessScreen() {
  const router = useRouter();
  const { billing_id, checkout_id } = useLocalSearchParams();
  const checkoutId = String(checkout_id || '').trim();
  const { colors, isDarkMode } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDarkMode), [colors, isDarkMode]);
  const [isVerifying, setIsVerifying] = useState(Boolean(checkoutId));
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
          const paid = Boolean(payload.paid) || status === 'paid' || status === 'succeeded';

          if (paid) {
            setVerifyMessage('Payment confirmed. Redirecting to billing...');
            setIsVerifying(false);
            timer = setTimeout(() => {
              if (!cancelled) {
                router.replace('/(tabs)/billing');
              }
            }, 1200);
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark-circle" size={64} color="#22C55E" />
        </View>
        <Text style={styles.title}>Payment Successful!</Text>
        <Text style={styles.subtitle}>
          Your payment has been processed successfully. It will be reflected in your billing shortly.
        </Text>
        <View style={styles.verifyRow}>
          {isVerifying ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />}
          <Text style={styles.verifyText}>{verifyMessage}</Text>
        </View>
        {billing_id && (
          <Text style={styles.ref}>Bill ID: {billing_id}</Text>
        )}

        <Pressable style={styles.primaryBtn} onPress={() => router.replace('/(tabs)/billing')}>
          <Ionicons name="receipt-outline" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>View Billing</Text>
        </Pressable>

        <Pressable style={styles.secondaryBtn} onPress={() => router.replace('/(tabs)/home')}>
          <Text style={styles.secondaryBtnText}>Go to Home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (c, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  content: {
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 14,
  },
  iconCircle: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: '#f0fdf4',
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
    backgroundColor: '#D4682A', paddingVertical: 15, paddingHorizontal: 32,
    borderRadius: 14, marginTop: 16, width: '100%', maxWidth: 300,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: {
    paddingVertical: 12, paddingHorizontal: 24,
  },
  secondaryBtnText: { color: c.primary, fontWeight: '600', fontSize: 14 },
});
