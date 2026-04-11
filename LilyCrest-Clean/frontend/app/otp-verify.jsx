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
import { useAuth } from '../src/context/AuthContext';
import { useAlert } from '../src/context/AlertContext';
import { saveCredentials } from '../src/services/secureCredentials';
import { apiService } from '../src/services/api';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60; // seconds

export default function OtpVerifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { verifyLoginOtp } = useAuth();
  const { showAlert } = useAlert();

  const otpToken = params.otp_token;
  const maskedEmail = params.masked_email || 'your email';
  const rememberMe = params.remember_me === 'true';
  const savedEmail = params.email;
  const savedPassword = params.password;

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
    // Accept paste of full 6-digit code
    const cleaned = text.replace(/\D/g, '');
    if (cleaned.length === OTP_LENGTH) {
      const arr = cleaned.split('');
      setDigits(arr);
      setError(null);
      inputRefs.current[OTP_LENGTH - 1]?.focus();
      return;
    }

    const char = cleaned.slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    setError(null);

    if (char && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
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
    const code = digits.join('');
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
    if (cooldown > 0 || isResending) return;
    setIsResending(true);
    setError(null);
    try {
      await apiService.resendLoginOtp(otpToken);
      setDigits(Array(OTP_LENGTH).fill(''));
      startCooldown();
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
            <Ionicons name="arrow-back" size={24} color="#0f172a" />
          </TouchableOpacity>

          {/* Icon */}
          <View style={styles.iconWrap}>
            <View style={styles.iconCircle}>
              <Ionicons name="mail" size={36} color="#1E3A5F" />
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
            <Text style={styles.resendLabel}>Didn't receive the code? </Text>
            {cooldown > 0 ? (
              <Text style={styles.resendCooldown}>Resend in {cooldown}s</Text>
            ) : (
              <TouchableOpacity onPress={handleResend} disabled={isResending}>
                {isResending
                  ? <ActivityIndicator size={14} color="#1E3A5F" />
                  : <Text style={styles.resendLink}>Resend Code</Text>
                }
              </TouchableOpacity>
            )}
          </View>

          {/* Info note */}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color="#6B7280" />
            <Text style={styles.infoText}>
              The code expires in 10 minutes. Check your spam folder if you don't see it.
            </Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },

  backBtn: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: '#CBD5E1',
    ...Platform.select({
      ios: { shadowColor: '#0f172a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 4 },
      android: { elevation: 3 },
    }),
  },

  iconWrap: { alignItems: 'center', marginTop: 40, marginBottom: 24 },
  iconCircle: {
    width: 88, height: 88, borderRadius: 24,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#DBEAFE',
  },

  title: { fontSize: 26, fontWeight: '700', color: '#1E3A5F', textAlign: 'center', marginBottom: 10 },
  subtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 36 },
  emailHighlight: { color: '#1E3A5F', fontWeight: '700' },

  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 20 },
  otpBox: {
    width: 48, height: 58,
    borderWidth: 2, borderColor: '#E5E7EB',
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 22, fontWeight: '700', color: '#1E3A5F',
    backgroundColor: '#F8FAFC',
  },
  otpBoxFilled: { borderColor: '#1E3A5F', backgroundColor: '#EFF6FF' },
  otpBoxError: { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },

  errorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 16 },
  errorText: { fontSize: 13, color: '#EF4444', fontWeight: '500' },

  verifyBtn: {
    backgroundColor: '#1E3A5F',
    paddingVertical: 16, borderRadius: 12,
    alignItems: 'center', marginBottom: 20,
    ...Platform.select({
      ios: { shadowColor: '#1E3A5F', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
      android: { elevation: 4 },
    }),
  },
  verifyBtnDisabled: {
    backgroundColor: '#94A3B8',
    ...Platform.select({ ios: { shadowOpacity: 0 }, android: { elevation: 0 } }),
  },
  verifyBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },

  resendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  resendLabel: { fontSize: 13, color: '#6B7280' },
  resendLink: { fontSize: 13, fontWeight: '700', color: '#1E3A5F' },
  resendCooldown: { fontSize: 13, color: '#9CA3AF' },

  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#F8FAFC', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  infoText: { flex: 1, fontSize: 12, color: '#6B7280', lineHeight: 18 },
});
