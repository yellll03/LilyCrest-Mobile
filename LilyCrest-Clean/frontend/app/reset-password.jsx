import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../src/context/ThemeContext';
import { API_BASE_URL } from '../src/config/api';

/**
 * Transitional handoff for custom-scheme links issued by the retired mobile
 * reset-token system. New reset emails point directly to the canonical web
 * /auth-action flow. Keeping password entry out of this screen ensures the
 * mobile client no longer implements an independent reset authority or policy.
 */
export default function ResetPasswordHandoffScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { token: rawToken } = useLocalSearchParams();
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  const normalizedToken = typeof token === 'string' ? token.trim() : '';
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const attempted = useRef(false);
  const legacyWebUrl = useMemo(
    () => normalizedToken
      ? `${API_BASE_URL}/api/m/auth/reset-password?token=${encodeURIComponent(normalizedToken)}`
      : '',
    [normalizedToken],
  );

  const openSecureReset = useCallback(async () => {
    if (!legacyWebUrl || opening) return;
    setOpening(true);
    setOpenFailed(false);
    try {
      await Linking.openURL(legacyWebUrl);
    } catch (_error) {
      setOpenFailed(true);
    } finally {
      setOpening(false);
    }
  }, [legacyWebUrl, opening]);

  useEffect(() => {
    if (!legacyWebUrl || attempted.current) return;
    attempted.current = true;
    openSecureReset();
  }, [legacyWebUrl, openSecureReset]);

  const styles = createStyles(colors);
  const invalid = !normalizedToken;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconBox}>
          <Ionicons name={invalid ? 'alert-circle' : 'open-outline'} size={46} color={colors.primary} />
        </View>
        <Text style={styles.title}>{invalid ? 'Reset Link Unavailable' : 'Continue Securely'}</Text>
        <Text style={styles.subtitle}>
          {invalid
            ? 'This password reset link is no longer valid. Request a new link to continue.'
            : 'Password reset now uses Lilycrest’s verified web flow. We are opening it in your browser.'}
        </Text>
        {openFailed ? <Text style={styles.error}>We couldn&apos;t open the browser. Try again below.</Text> : null}
        {!invalid ? (
          <TouchableOpacity style={[styles.primaryButton, opening && styles.disabled]} onPress={openSecureReset} disabled={opening}>
            {opening ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Open Password Reset</Text>}
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.secondaryButton} onPress={() => router.replace('/forgot-password')}>
          <Text style={styles.secondaryText}>Request a New Link</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.loginLink} onPress={() => router.replace('/login')}>
          <Text style={styles.loginText}>Back to Login</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  card: { padding: 28, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  iconBox: { width: 78, height: 78, borderRadius: 24, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight, marginBottom: 22 },
  title: { color: colors.text, fontSize: 26, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  subtitle: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  error: { color: '#B91C1C', textAlign: 'center', marginBottom: 14 },
  primaryButton: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  secondaryText: { color: colors.primary, fontWeight: '600', fontSize: 15 },
  loginLink: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  loginText: { color: colors.textSecondary, fontSize: 14 },
});
