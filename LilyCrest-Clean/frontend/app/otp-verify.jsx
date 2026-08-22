import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAlert } from '../src/context/AlertContext';
import { useAuth } from '../src/context/AuthContext';
import { useTheme, useThemedStyles } from '../src/context/ThemeContext';
import { useToast } from '../src/context/ToastContext';
import { apiService, getApiErrorMessage } from '../src/services/api';
import {
  clearPendingLogin,
  enableBiometricSession,
  getPendingLogin,
} from '../src/services/secureCredentials';
import { resetToHome, safeBack } from '../src/utils/navigation';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60; // seconds

function readParam(value, fallback = '') {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

export default function OtpVerifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { verifyLoginOtp } = useAuth();
  const { showAlert } = useAlert();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { showToast } = useToast();

  const routeMaskedEmail = readParam(params.masked_email, '');

  const [digits, setDigits] = useState(Array(OTP_LENGTH).fill(''));
  const [isLoading, setIsLoading] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const [isResending, setIsResending] = useState(false);
  const [pendingLogin, setPendingLogin] = useState(null);

  const inputRefs = useRef([]);
  const cooldownRef = useRef(null);
  const verifyGuardRef = useRef(false);
  const resendGuardRef = useRef(false);
  const otpToken = pendingLogin?.otpToken || '';
  const maskedEmail = pendingLogin?.maskedEmail || routeMaskedEmail || 'your email';
  const savedEmail = pendingLogin?.email || '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await getPendingLogin();
      if (cancelled) return;
      setPendingLogin(pending);
      setIsSessionLoading(false);
      if (!pending) {
        setError('Your verification session has expired. Please log in again.');
      }
    })();

    startCooldown();
    setTimeout(() => inputRefs.current[0]?.focus(), 300);
    return () => {
      cancelled = true;
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) { clearInterval(cooldownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const handleDigitChange = (text, index) => {
    // Android autofill and fast typing can inject multiple digits into one box.
    // Distribute any digit chunk across the remaining boxes instead of dropping digits.
    const cleaned = String(text || '').replace(/\D/g, '');
    const next = [...digits];

    if (!cleaned) {
      next[index] = '';
      setDigits(next);
      setError(null);
      return;
    }

    const available = OTP_LENGTH - index;
    const incomingChars = cleaned.slice(0, available).split('');
    incomingChars.forEach((char, offset) => {
      next[index + offset] = char;
    });

    setDigits(next);
    setError(null);

    const nextIndex = index + incomingChars.length;
    if (nextIndex < OTP_LENGTH) {
      inputRefs.current[nextIndex]?.focus();
    } else {
      inputRefs.current[OTP_LENGTH - 1]?.focus();
    }
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      const next = [...digits];
      next[index - 1] = '';
      setDigits(next);
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpFocus = async (index) => {
    if (index !== 0 || digits.some(Boolean)) return;
    const clipboardValue = await Clipboard.getStringAsync().catch(() => '');
    const pastedCode = String(clipboardValue || '').trim();
    if (/^\d{6}$/.test(pastedCode)) {
      handleDigitChange(pastedCode, 0);
    }
  };

  const handleVerify = async () => {
    if (isSessionLoading || isLoading || verifyGuardRef.current) return;
    if (!otpToken) {
      setError('Your verification session has expired. Please log in again.');
      return;
    }

    const code = digits.join('').replace(/\D/g, '');
    if (code.length !== OTP_LENGTH) {
      setError('Please enter the complete 6-digit code.');
      return;
    }

    verifyGuardRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const result = await verifyLoginOtp(otpToken, code);

      if (!result.success) {
        setError(result.error || 'Invalid code. Please try again.');
        // Clear digits on invalid code
        setDigits(Array(OTP_LENGTH).fill(''));
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
        return;
      }

      await clearPendingLogin();

    // Offer biometric if available and not yet enabled
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const bioSetting = await AsyncStorage.getItem('biometricLogin');

      if (hasHardware && isEnrolled && bioSetting === 'true') {
        await enableBiometricSession(savedEmail);
        resetToHome(router);
      } else if (hasHardware && isEnrolled && bioSetting !== 'true') {
        showAlert({
        title: 'Enable Biometric Login',
        message: 'Use Biometrics to unlock this valid session on this device. For your security, you will need to log in again when the session expires.',
        type: 'info',
        icon: 'finger-print',
        buttons: [
          { text: 'Not Now', style: 'cancel', onPress: () => resetToHome(router) },
          {
            text: 'Enable',
            onPress: async () => {
              try {
                const bioResult = await LocalAuthentication.authenticateAsync({
                  promptMessage: 'Confirm your identity to enable biometric login',
                  cancelLabel: 'Skip',
                  disableDeviceFallback: false,
                });
                if (bioResult.success) {
                  await AsyncStorage.setItem('biometricLogin', 'true');
                  await enableBiometricSession(savedEmail);
                }
              } catch (_) {}
              resetToHome(router);
            },
          },
        ],
        });
      } else {
        resetToHome(router);
      }
    } catch (error) {
      setError(getApiErrorMessage(error, 'Unable to finish verification. Please try again.'));
    } finally {
      verifyGuardRef.current = false;
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (!otpToken) {
      setError('Your verification session has expired. Please log in again.');
      return;
    }
    if (cooldown > 0 || isResending || resendGuardRef.current) return;
    resendGuardRef.current = true;
    setIsResending(true);
    setError(null);
    try {
      await apiService.resendLoginOtp(otpToken);
      setDigits(Array(OTP_LENGTH).fill(''));
      startCooldown();
      showToast({
        type: 'success',
        title: 'Code Sent',
        message: 'A new verification code was sent. Use the latest email you received.',
      });
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch (err) {
      if (err?.response?.data?.code === 'OTP_SESSION_EXPIRED') {
        setError('Your session has expired. Please log in again.');
      } else {
        setError(getApiErrorMessage(err, 'Failed to resend code. Please try again.'));
      }
    } finally {
      resendGuardRef.current = false;
      setIsResending(false);
    }
  };

  const code = digits.join('');
  const isComplete = code.length === OTP_LENGTH;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Back */}
          <TouchableOpacity style={styles.backBtn} onPress={() => safeBack(router, '/login')}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>

          {/* Icon */}
          <View style={styles.iconWrap}>
            <View style={styles.iconCircle}>
              <Ionicons name="mail" size={36} color={colors.accent} />
            </View>
          </View>

          <Text style={styles.title}>Check Your Email</Text>
          <Text style={styles.subtitle}>
            We sent a 6-digit verification code to{'\n'}
            <Text style={styles.emailHighlight}>{maskedEmail}</Text>
          </Text>

          {/* OTP Boxes */}
          <View style={styles.otpRow}>
            {digits.map((digit, i) => (
              <TextInput
                key={i}
                ref={(r) => { inputRefs.current[i] = r; }}
                style={[
                  styles.otpBox,
                  digit ? styles.otpBoxFilled : null,
                  error ? styles.otpBoxError : null,
                ]}
                value={digit}
                onChangeText={(t) => handleDigitChange(t, i)}
                onKeyPress={(e) => handleKeyPress(e, i)}
                onFocus={() => handleOtpFocus(i)}
                keyboardType="number-pad"
                maxLength={1}
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                selectTextOnFocus
              />
            ))}
          </View>

          {/* Error */}
          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={15} color="#DC2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Verify Button */}
          <TouchableOpacity
            style={[styles.verifyBtn, (!isComplete || isLoading || isSessionLoading) && styles.verifyBtnDisabled]}
            onPress={handleVerify}
            disabled={!isComplete || isLoading || isSessionLoading}
          >
            {isLoading
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={styles.verifyBtnText}>Verify & Log In</Text>
            }
          </TouchableOpacity>

          {/* Resend */}
          <View style={styles.resendRow}>
            <Text style={styles.resendLabel}>Didn&apos;t receive the code? </Text>
            {cooldown > 0 ? (
              <Text style={styles.resendCooldown}>Resend in {cooldown}s</Text>
            ) : (
              <TouchableOpacity onPress={handleResend} disabled={isResending}>
                {isResending
                  ? <ActivityIndicator size={14} color={colors.accent} />
                  : <Text style={styles.resendLink}>Resend Code</Text>
                }
              </TouchableOpacity>
            )}
          </View>

          {/* Info note */}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color="#6B7280" />
            <Text style={styles.infoText}>
              The code expires in 10 minutes. If you requested more than one code, use the newest email you received.
            </Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.surface },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },

  backBtn: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: c.surfaceSecondary,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.border,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },

  iconWrap: { alignItems: 'center', marginTop: 40, marginBottom: 24 },
  iconCircle: {
    width: 88, height: 88, borderRadius: 24,
    backgroundColor: c.primaryLight,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.accentLight,
  },

  title: { fontSize: 26, fontWeight: '700', color: c.text, textAlign: 'center', marginBottom: 10 },
  subtitle: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 36 },
  emailHighlight: { color: c.accent, fontWeight: '700' },

  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 20 },
  otpBox: {
    width: 48, height: 58,
    borderWidth: 2, borderColor: c.border,
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 22, fontWeight: '700', color: c.text,
    backgroundColor: c.inputBg,
  },
  otpBoxFilled: { borderColor: c.accent, backgroundColor: c.accentSubtle },
  otpBoxError: { borderColor: c.error, backgroundColor: c.errorBg },

  errorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 16 },
  errorText: { fontSize: 13, color: '#DC2626', fontWeight: '500' },

  verifyBtn: {
    backgroundColor: c.primary,
    paddingVertical: 16, borderRadius: 8,
    alignItems: 'center', marginBottom: 20,
    ...Platform.select({
      ios: { shadowColor: '#0A1628', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.16, shadowRadius: 4 },
      android: { elevation: 3 },
    }),
  },
  verifyBtnDisabled: {
    backgroundColor: c.textMuted,
    ...Platform.select({ ios: { shadowOpacity: 0 }, android: { elevation: 0 } }),
  },
  verifyBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },

  resendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  resendLabel: { fontSize: 13, color: c.textSecondary },
  resendLink: { fontSize: 13, fontWeight: '700', color: c.primary },
  resendCooldown: { fontSize: 13, color: c.textMuted },

  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.inputBg, borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: c.border,
  },
  infoText: { flex: 1, fontSize: 12, color: c.textSecondary, lineHeight: 18 },
});
