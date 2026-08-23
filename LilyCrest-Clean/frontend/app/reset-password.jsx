import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_BASE_URL } from '../src/config/api';
import { useTheme } from '../src/context/ThemeContext';
import { apiService } from '../src/services/api';

/**
 * Transitional handoff for custom-scheme links issued by the retired mobile
 * reset-token system. New Firebase action-code links intentionally stay in the
 * canonical website. This screen verifies a legacy token before opening that
 * hosted flow, and never accepts or submits a password itself.
 */
export default function ResetPasswordHandoffScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { token: rawToken } = useLocalSearchParams();
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  const normalizedToken = typeof token === 'string' ? token.trim() : '';
  const [linkState, setLinkState] = useState(normalizedToken ? 'checking' : 'invalid');
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const attempted = useRef(false);
  const legacyWebUrl = useMemo(
    () => normalizedToken
      ? `${API_BASE_URL}/api/m/auth/reset-password?token=${encodeURIComponent(normalizedToken)}`
      : '',
    [normalizedToken],
  );

  const openSecureReset = useCallback(async () => {
    if (!legacyWebUrl || linkState !== 'ready' || opening) return;
    setOpening(true);
    setOpenFailed(false);
    try {
      await Linking.openURL(legacyWebUrl);
    } catch (_error) {
      setOpenFailed(true);
    } finally {
      setOpening(false);
    }
  }, [legacyWebUrl, linkState, opening]);

  useEffect(() => {
    if (!normalizedToken) {
      setLinkState('invalid');
      return undefined;
    }

    let cancelled = false;
    attempted.current = false;
    setLinkState('checking');
    setOpenFailed(false);
    apiService.checkResetPasswordToken(normalizedToken)
      .then((response) => {
        if (!cancelled) setLinkState(response?.data?.valid === true ? 'ready' : 'invalid');
      })
      .catch(() => {
        if (!cancelled) setLinkState('network');
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedToken, verificationAttempt]);

  useEffect(() => {
    if (linkState !== 'ready' || attempted.current) return;
    attempted.current = true;
    openSecureReset();
  }, [linkState, openSecureReset]);

  const styles = createStyles(colors);
  const invalid = linkState === 'invalid';
  const checking = linkState === 'checking';
  const network = linkState === 'network';
  const ready = linkState === 'ready';
  const title = invalid
    ? 'Reset Link Unavailable'
    : network
      ? 'Unable to Verify Link'
      : checking
        ? 'Checking Reset Link'
        : 'Continue Securely';
  const subtitle = invalid
    ? 'This password reset link has already been used, expired, or is no longer valid. Request a new link to continue.'
    : network
      ? 'We could not verify this one-time link. Check your connection and try again.'
      : checking
        ? 'Please wait while LilyCrest verifies this one-time password reset link.'
        : 'This link is valid. Password reset will continue in LilyCrest\'s verified web flow.';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconBox}>
          <Ionicons
            name={invalid || network ? 'alert-circle' : ready ? 'open-outline' : 'shield-checkmark-outline'}
            size={46}
            color={colors.primary}
          />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {checking ? <ActivityIndicator color={colors.primary} style={styles.checking} /> : null}
        {openFailed ? <Text style={styles.error}>We couldn&apos;t open the browser. Try again below.</Text> : null}
        {ready ? (
          <TouchableOpacity style={[styles.primaryButton, opening && styles.disabled]} onPress={openSecureReset} disabled={opening}>
            {opening ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Open Password Reset</Text>}
          </TouchableOpacity>
        ) : null}
        {network ? (
          <TouchableOpacity style={styles.primaryButton} onPress={() => setVerificationAttempt((attempt) => attempt + 1)}>
            <Text style={styles.primaryText}>Try Again</Text>
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
  card: { padding: 28, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  iconBox: { width: 78, height: 78, borderRadius: 12, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight, marginBottom: 22 },
  title: { color: colors.text, fontSize: 26, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  subtitle: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  error: { color: '#991B1B', textAlign: 'center', marginBottom: 14 },
  checking: { marginBottom: 18 },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 15, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  secondaryText: { color: colors.primary, fontWeight: '600', fontSize: 15 },
  loginLink: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  loginText: { color: colors.textSecondary, fontSize: 14 },
});
