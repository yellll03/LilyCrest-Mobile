import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiService } from '../src/services/api';
import { useTheme, useThemedStyles } from '../src/context/ThemeContext';
import { useToast } from '../src/context/ToastContext';
import { AUTH_MESSAGES, classifyAuthError, normalizeEmail, validateEmail as validateAuthEmail } from '../src/utils/authStability';
import { safeBack } from '../src/utils/navigation';

const validateEmail = (value) => {
  const normalized = normalizeEmail(value);
  if (!normalized) return { valid: false, error: 'Email is required.' };
  if (!validateAuthEmail(normalized).valid) return { valid: false, error: AUTH_MESSAGES.invalidEmail };
  return { valid: true, error: '' };
};

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState({ email: '' });
  const [touched, setTouched] = useState({ email: false });
  const requestInFlight = useRef(false);

  useEffect(() => {
    if (!touched.email) return;
    setErrors({ email: validateEmail(email).error });
  }, [email, touched.email]);

  const handleBackToLogin = () => {
    router.replace('/login');
  };

  const handleResetPassword = async () => {
    if (requestInFlight.current) return;
    const emailValidation = validateEmail(email);
    setTouched({ email: true });
    setErrors({ email: emailValidation.error });

    if (!emailValidation.valid) {
      return;
    }

    requestInFlight.current = true;
    setIsLoading(true);
    try {
      // Shared with the website: the canonical backend generates a genuine
      // Firebase action code and sends the branded Lilycrest email. The app
      // never creates or consumes a separate mobile reset credential.
      await apiService.forgotPassword(normalizeEmail(email));
      setSent(true);
      // The canonical backend intentionally returns the same generic success
      // for a registered and an unknown email (enumeration-safe), so the app
      // must not claim a link was definitely sent. Neutral, conditional copy
      // that matches the on-screen message.
      showToast({
        type: 'info',
        title: 'Check Your Email',
        message: AUTH_MESSAGES.forgotSuccess,
      });
    } catch (err) {
      const classified = classifyAuthError(err);
      showToast({
        type: 'error',
        title: 'Unable to Send Reset Link',
        message: classified.message || 'Please check your connection and try again.',
      });
    } finally {
      requestInFlight.current = false;
      setIsLoading(false);
    }
  };

  const isEmailValid = validateEmail(email).valid;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity style={styles.backButton} onPress={() => safeBack(router, '/login')}><Ionicons name="arrow-back" size={24} color={colors.text} /></TouchableOpacity>
          
          <View style={styles.iconContainer}><Ionicons name={sent ? 'mail-open' : 'lock-closed'} size={48} color={colors.interactive} /></View>
          <Text style={styles.title}>{sent ? 'Check Your Email' : 'Forgot Password?'}</Text>
          <Text style={styles.subtitle}>{sent ? AUTH_MESSAGES.forgotSuccess : 'Enter your email address and we\'ll send you a link to reset your password.'}</Text>

          {!sent ? (
            <>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Email Address</Text>
                <View style={[styles.inputWrapper, touched.email && errors.email ? styles.inputWrapperError : null, touched.email && !errors.email && isEmailValid ? styles.inputWrapperSuccess : null]}>
                  <Ionicons name="mail-outline" size={20} color={touched.email && errors.email ? colors.error : colors.iconSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your email"
                    placeholderTextColor={colors.textMuted}
                    value={email}
                    onChangeText={setEmail}
                    onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {touched.email && !errors.email && isEmailValid ? (
                    <Ionicons name="checkmark-circle" size={20} color="#059669" />
                  ) : null}
                </View>
                {touched.email && errors.email ? (
                  <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle" size={14} color="#DC2626" />
                    <Text style={styles.errorText}>{errors.email}</Text>
                  </View>
                ) : null}
              </View>
              <TouchableOpacity
                style={[styles.resetButton, isLoading && styles.resetButtonDisabled]}
                onPress={handleResetPassword}
                disabled={isLoading}
                accessibilityRole="button"
                accessibilityLabel="Send Reset Link"
              >
                {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.resetButtonText}>Send Reset Link</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.resetButton} onPress={handleBackToLogin}><Text style={styles.resetButtonText}>Return to Login</Text></TouchableOpacity>
          )}

          {!sent ? (
            <TouchableOpacity style={styles.backToLogin} onPress={handleBackToLogin}>
              <Ionicons name="arrow-back" size={18} color={colors.interactive} /><Text style={styles.backToLoginText}>Back to Login</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(c) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    keyboardView: { flex: 1 },
    scrollContent: { flexGrow: 1, padding: 24 },
    backButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.surfaceSecondary, justifyContent: 'center', alignItems: 'center', marginBottom: 32 },
    iconContainer: { width: 80, height: 80, borderRadius: 24, backgroundColor: c.primaryLight, justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 24 },
    title: { fontSize: 28, fontWeight: '700', color: c.text, textAlign: 'center', marginBottom: 12 },
    subtitle: { fontSize: 15, color: c.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 32, paddingHorizontal: 16 },
    inputContainer: { marginBottom: 24 },
    label: { fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    inputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: c.border, borderRadius: 12, backgroundColor: c.inputBg, paddingHorizontal: 16 },
    inputWrapperError: { borderColor: c.error, backgroundColor: c.errorBg },
    inputWrapperSuccess: { borderColor: c.success, backgroundColor: c.successBg },
    inputIcon: { marginRight: 12 },
    input: { flex: 1, paddingVertical: 14, fontSize: 15, color: c.text },
    errorContainer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
    errorText: { color: '#DC2626', fontSize: 12 },
    resetButton: { backgroundColor: c.primary, paddingVertical: 16, borderRadius: 8, alignItems: 'center', marginBottom: 16 },
    resetButtonDisabled: { backgroundColor: c.textMuted },
    resetButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
    backToLogin: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 12, paddingBottom: 12, marginTop: 'auto' },
    backToLoginText: { color: c.interactive, fontSize: 15, fontWeight: '600' },
  });
}
