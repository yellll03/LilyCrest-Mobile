import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../src/context/ThemeContext';

export default function PaymentSuccessScreen() {
  const router = useRouter();
  const { billing_id } = useLocalSearchParams();
  const { colors, isDarkMode } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDarkMode), [colors, isDarkMode]);

  // Auto-navigate back after a few seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/(tabs)/billing');
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

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
