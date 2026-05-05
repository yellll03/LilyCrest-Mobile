import { Ionicons } from '@expo/vector-icons';
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
import { apiService } from '../src/services/api';
import { saveCredentials } from '../src/services/secureCredentials';

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

  const otpToken = readParam(params.otp_token, '');
  const maskedEmail = readParam(params.masked_email, 'your email');
  const rememberMe = readParam(params.remember_me, 'false') === 'true';
  const savedEmail = readParam(params.email, '');
  const savedPassword = readParam(params.password, '');

  const [digits, setDigits] = useState(Array(OTP_LENGTH).fill(''));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const [isResending, setIsResending] = useState(false);

  const inputRefs = useRef([]);
  const cooldownRef = useRef(null);

  // Start cooldown timer on mount
  useEffect(() => {
    startCooldown();
    // Focus first box
    setTimeout(() => inputRefs.current[0]?.focus(), 300);
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
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

  const handleVerify = async () => {
    if (!otpToken) {
      setError('Your verification session has expired. Please log in again.');
      return;
    }

    const code = digits.join('').replace(/\D/g, '');
    if (code.length !== OTP_LENGTH) {
      setError('Please enter the complete 6-digit code.');
      return;
    }

    setIsLoading(true);
    setError(null);

    const result = await verifyLoginOtp(otpToken, code);

    if (!result.success) {
      setIsLoading(false);
      setError(result.error || 'Invalid code. Please try again.');
      // Clear digits on invalid code
      setDigits(Array(OTP_LENGTH).fill(''));
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
      return;
    }

    // Persist remember-me and biometric preferences post-OTP
    await AsyncStorage.setItem('remember_me', rememberMe ? 'true' : 'false');
    if (rememberMe && savedEmail) {
      await AsyncStorage.setItem('last_email', savedEmail);
    } else {
      await AsyncStorage.removeItem('last_email');
    }

    // Offer biometric if available and not yet enabled
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const bioSetting = await AsyncStorage.getItem('biometricLogin');

    if (hasHardware && isEnrolled && bioSetting === 'true' && savedEmail && savedPassword) {
      await saveCredentials(savedEmail, savedPassword);
      setIsLoading(false);
      router.replace('/(tabs)/home');
    } else if (hasHardware && isEnrolled && bioSetting !== 'true' && savedEmail && savedPassword) {
      setIsLoading(false);
      showAlert({
        title: 'Enable Biometric Login',
        message: 'Sign in faster next time using Biometrics.',
        type: 'info',
        icon: 'finger-print',
        buttons: [
          { text: 'Not Now', style: 'cancel', onPress: () => router.replace('/(tabs)/home') },
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
                  await saveCredentials(savedEmail, savedPassword);
                  await AsyncStorage.setItem('biometricLogin', 'true');
                }
              } catch (_) {}
              router.replace('/(tabs)/home');
            },
          },
        ],
      });
    } else {
      setIsLoading(false);
      router.replace('/(tabs)/home');
    }
  };

  const handleResend = async () => {
    if (!otpToken) {
      setError('Your verification session has expired. Please log in again.');
      return;
    }
    if (cooldown > 0 || isResending) return;
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
      const detail = err?.response?.data?.detail;
      if (detail?.includes('expired') || detail?.includes('Session')) {
        setError('Your session has expired. Please log in again.');
      } else {
        setError('Failed to resend code. Please try again.');
      }
    } finally {
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
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
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
                keyboardType="number-pad"
                maxLength={OTP_LENGTH}
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                selectTextOnFocus
              />
            ))}
          </View>

          {/* Error */}
          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={15} color="#EF4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Verify Button */}
          <TouchableOpacity
            style={[styles.verifyBtn, (!isComplete || isLoading) && styles.verifyBtnDisabled]}
            onPress={handleVerify}
            disabled={!isComplete || isLoading}
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

const createStyles = (c, dark) => StyleSheet.create({
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
    borderWidth: 2, borderColor: dark ? 'rgba(255,101,0,0.3)' : '#FDDCB5',
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
  otpBoxFilled: { borderColor: c.accent, backgroundColor: dark ? 'rgba(255,101,0,0.08)' : '#FFF0E6' },
  otpBoxError: { borderColor: '#EF4444', backgroundColor: dark ? 'rgba(239,68,68,0.1)' : '#FEF2F2' },

  errorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 16 },
  errorText: { fontSize: 13, color: '#EF4444', fontWeight: '500' },

  verifyBtn: {
    backgroundColor: c.accent,
    paddingVertical: 16, borderRadius: 12,
    alignItems: 'center', marginBottom: 20,
    ...Platform.select({
      ios: { shadowColor: c.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
      android: { elevation: 4 },
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
