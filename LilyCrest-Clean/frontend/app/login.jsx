import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';


import { useGoogleSignIn } from '../src/config/googleSignIn';
import { useAuth } from '../src/context/AuthContext';
import { useTheme, useThemedStyles } from '../src/context/ThemeContext';
import { savePendingLogin } from '../src/services/secureCredentials';
import { loadRememberedEmail, saveRememberedEmail } from '../src/services/rememberedEmail';
import { resetToHome } from '../src/utils/navigation';
import { AUTH_MESSAGES, authErrorTypeForUi, normalizeEmail, validateEmail as validateAuthEmail } from '../src/utils/authStability';
import { validateLoginPassword } from '../src/utils/passwordValidation';

/* cspell:words creds prefs lilycrest wordmark */

// Validation helpers
const validateEmail = (email) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return { valid: false, error: 'Email is required' };
  if (normalized.length > 254) return { valid: false, error: 'Email address is too long' };
  if (!validateAuthEmail(normalized).valid) return { valid: false, error: AUTH_MESSAGES.invalidEmail };
  return { valid: true, error: '' };
};

export default function LoginScreen() {
  const router = useRouter();
  const { loginWithEmail, signInWithGoogle, isLoading } = useAuth();
  const { signInWithGoogle: googleSignIn } = useGoogleSignIn();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberEmail, setRememberEmail] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });
  const [touched, setTouched] = useState({ email: false, password: false });
  // loginError: { message: string, type: 'credentials' | 'access' | 'ratelimit' | 'network' }
  const [loginError, setLoginError] = useState(null);
  const emailRequestInFlight = useRef(false);
  const googleRequestInFlight = useRef(false);

  // Real-time validation
  useEffect(() => {
    if (touched.email) {
      const emailValidation = validateEmail(email);
      setErrors(prev => ({ ...prev, email: emailValidation.error }));
    }
  }, [email, touched.email]);

  useEffect(() => {
    if (touched.password) {
      const passwordValidation = validateLoginPassword(password);
      setErrors(prev => ({ ...prev, password: passwordValidation.error }));
    }
  }, [password, touched.password]);

  useEffect(() => {
    setLoginError(null);
  }, [email, password]);

  const handlePasswordChange = (nextValue) => {
    // Passwords are opaque credentials: never trim, normalize, or otherwise alter them.
    setPassword(nextValue);
  };

  // Remember me is an email-only convenience. Session persistence remains
  // owned by SecureStore and is deliberately independent of this preference.
  useEffect(() => {
    const init = async () => {
      try {
        const remembered = await loadRememberedEmail();
        setEmail(remembered.email);
        setRememberEmail(remembered.rememberEmail);
        setPassword('');
      } catch (err) {
        console.warn('Init login prefs failed:', err?.message);
      }
    };
    init();
  }, []);

  const handleLogin = async () => {
    if (emailRequestInFlight.current) return;
    const emailValidation = validateEmail(email);
    const passwordValidation = validateLoginPassword(password);

    setTouched({ email: true, password: true });
    setErrors({ email: emailValidation.error, password: passwordValidation.error });

    if (!emailValidation.valid || !passwordValidation.valid) return;

    emailRequestInFlight.current = true;
    setIsEmailLoading(true);
    setLoginError(null);
    const normalizedEmail = normalizeEmail(email);
    const normalizedPassword = password;

    try {
      const result = await loginWithEmail(normalizedEmail, normalizedPassword);

      // OTP required — credentials were valid, navigate to verification screen
      if (result.otpRequired) {
        await savePendingLogin({
          otpToken: result.otpToken,
          maskedEmail: result.maskedEmail,
          email: normalizedEmail,
          rememberEmail,
        });
        router.push({
          pathname: '/otp-verify',
          params: {
            masked_email: result.maskedEmail,
          },
        });
        return;
      }

      if (!result.success) {
        const { status, errorType } = result;
        if (status === 400) {
          setLoginError({ message: result.error, type: 'credentials' });
        } else if (status === 401) {
          setLoginError({ message: result.error || 'Incorrect email or password.', type: 'credentials' });
        } else if (status === 403) {
          setLoginError({ message: result.error, type: 'access' });
        } else if (status === 429) {
          setLoginError({ message: result.error, type: 'ratelimit' });
        } else if (errorType) {
          setLoginError({ message: result.error, type: authErrorTypeForUi(errorType) });
        } else if (status >= 500 || status === 0) {
          setLoginError({ message: result.error, type: 'network' });
        } else {
          setLoginError({ message: result.error, type: 'credentials' });
        }
        setErrors({ email: '', password: '' });
        setTouched({ email: false, password: false });
        return;
      }

      await saveRememberedEmail({ rememberEmail, email: normalizedEmail })
        .catch((error) => console.warn('Remembered email update failed:', error?.message));

      resetToHome(router);
    } catch (error) {
      console.error('Login error:', error?.message || 'Unexpected error');
      setLoginError({ message: 'An unexpected error occurred. Please try again.', type: 'unexpected' });
    } finally {
      emailRequestInFlight.current = false;
      setIsEmailLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (googleRequestInFlight.current) return;
    googleRequestInFlight.current = true;
    setIsGoogleLoading(true);
    setLoginError(null);

    try {
      const result = await googleSignIn();
      const { success, cancelled } = result;

      if (success) {
        // Use the idToken returned directly by Google Sign-In.
        // Calling getFreshIdToken() after signInWithCredential fails in release
        // builds because Firebase auth state hasn't propagated yet.
        let { idToken } = result;

        if (!idToken) {
          // Last-resort: wait briefly for Firebase to settle then grab the token
          try {
            await new Promise(r => setTimeout(r, 800));
            const { getFreshIdToken } = await import('../src/config/firebase');
            idToken = await getFreshIdToken(true);
          } catch (_) {}
        }

        if (!idToken) {
          setLoginError({ message: 'Failed to get authentication token. Please try again.', type: 'network' });
          return;
        }

        const backendResult = await signInWithGoogle(idToken);
        const {
          success: backendSuccess,
          status,
          error: backendError,
          errorType,
        } = backendResult;

        if (backendSuccess) {
          resetToHome(router);
        } else {
          const type = status === 403 || errorType === 'access'
            ? 'access'
            : errorType === 'rate-limit'
              ? 'ratelimit'
              : ['offline', 'timeout', 'server'].includes(errorType)
                ? 'network'
                : 'credentials';
          setLoginError({ message: backendError || 'Failed to create session.', type });
        }
      } else if (cancelled) {
        // User deliberately cancelled — not an error
      } else {
        const type = result.type === 'network'
          ? 'network'
          : result.type === 'configuration'
            ? 'access'
            : 'credentials';
        setLoginError({ message: result.error || 'Unable to sign in with Google. Please try again.', type });
      }
    } catch (error) {
      console.warn('[GoogleAuth]', {
        stage: 'login-orchestration',
        code: String(error?.code || 'unexpected'),
        type: 'unexpected',
      });
      setLoginError({ message: 'Google sign-in failed. Please try again or use email/password.', type: 'network' });
    } finally {
      googleRequestInFlight.current = false;
      setIsGoogleLoading(false);
    }
  };

  const isEmailValid = validateEmail(email).valid;
  const isPasswordValid = validateLoginPassword(password).valid;

  // Derive field-level error highlighting from loginError
  const showEmailFieldError = (touched.email && errors.email) || (loginError && ['credentials', 'access', 'ratelimit'].includes(loginError.type));
  const showPasswordFieldError = (touched.password && errors.password) || (loginError && ['credentials'].includes(loginError.type));

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Logo */}
          <View style={styles.logoContainer}>
            <Image
              source={require('../assets/images/lilycrest-wordmark.png')}
              style={styles.authLogo}
              resizeMode="contain"
              accessibilityLabel="LilyCrest logo"
            />
          </View>

          {/* Title */}
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Sign in to access your tenant portal</Text>

          {/* Login Error Banner — placed above the form so it's always visible */}
          {loginError ? (() => {
            const cfg = {
              credentials: { bg: '#FEF2F2', border: '#DC2626', text: '#991B1B', icon: 'lock-closed', iconColor: '#DC2626' },
              access:      { bg: '#FFFBEB', border: '#F3E4B0', text: '#92400E', icon: 'shield-checkmark', iconColor: '#D97706' },
              ratelimit:   { bg: '#FFFBEB', border: '#F3E4B0', text: '#92400E', icon: 'time', iconColor: '#D97706' },
              network:     { bg: '#EFF6FF', border: '#2563EB', text: '#1E40AF', icon: 'wifi', iconColor: '#2563EB' },
            }[loginError.type] || { bg: '#FEF2F2', border: '#DC2626', text: '#991B1B', icon: 'alert-circle', iconColor: '#DC2626' };
            return (
              <View style={[styles.loginErrorContainer, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
                <Ionicons name={cfg.icon} size={18} color={cfg.iconColor} />
                <Text style={[styles.loginErrorText, { color: cfg.text }]}>{loginError.message}</Text>
              </View>
            );
          })() : null}

          {/* Form */}
          <View style={styles.form}>
            {/* Email Input */}
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Email Address</Text>
              <View style={[styles.inputWrapper, showEmailFieldError && styles.inputWrapperError, !showEmailFieldError && touched.email && isEmailValid && styles.inputWrapperSuccess]}>
                <Ionicons name="mail-outline" size={20} color={showEmailFieldError ? colors.error : colors.iconSecondary} style={styles.inputIcon} />
                <TextInput 
                  style={styles.input} 
                  placeholder="Enter your email" 
                  placeholderTextColor={colors.textMuted}
                  value={email} 
                  onChangeText={(text) => setEmail((text || '').replace(/\s+/g, ''))} 
                  onBlur={() => setTouched(prev => ({ ...prev, email: true }))} 
                  keyboardType="email-address" 
                  autoCapitalize="none" 
                  autoCorrect={false} 
                />
                {!showEmailFieldError && touched.email && isEmailValid && <Ionicons name="checkmark-circle" size={20} color="#059669" />}
              </View>
              {touched.email && errors.email && !loginError ? (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={14} color="#DC2626" />
                  <Text style={styles.errorText}>{errors.email}</Text>
                </View>
              ) : null}
            </View>

            {/* Password Input */}
            <View style={[styles.inputContainer, styles.passwordInputContainer]}>
              <Text style={styles.label}>Password</Text>
              <View style={[styles.inputWrapper, showPasswordFieldError && styles.inputWrapperError, !showPasswordFieldError && touched.password && isPasswordValid && styles.inputWrapperSuccess]}>
                <Ionicons name="lock-closed-outline" size={20} color={showPasswordFieldError ? colors.error : colors.iconSecondary} style={styles.inputIcon} />
                <TextInput 
                  style={styles.input} 
                  placeholder="Enter your password" 
                  placeholderTextColor={colors.textMuted}
                  value={password} 
                  onChangeText={handlePasswordChange}
                  onBlur={() => setTouched(prev => ({ ...prev, password: true }))} 
                  secureTextEntry={!showPassword} 
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Ionicons name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.iconSecondary} />
                </TouchableOpacity>
              </View>
              {touched.password && errors.password && !loginError ? (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={14} color="#DC2626" />
                  <Text style={styles.errorText}>{errors.password}</Text>
                </View>
              ) : null}
            </View>

            {/* Email prefill only; authenticated sessions persist securely regardless. */}
            <View style={styles.optionsRow}>
              <TouchableOpacity
                style={styles.rememberOption}
                onPress={() => setRememberEmail((current) => !current)}
                accessibilityRole="checkbox"
                accessibilityLabel="Remember me"
                accessibilityState={{ checked: rememberEmail }}
              >
                <Ionicons
                  name={rememberEmail ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={rememberEmail ? colors.interactive : colors.textMuted}
                />
                <Text style={styles.rememberText}>Remember me</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.forgotPassword} onPress={() => router.push('/forgot-password')}>
                <Text style={styles.forgotPasswordText}>Forgot password?</Text>
              </TouchableOpacity>
            </View>


            {/* Sign In Button */}
            <TouchableOpacity 
              style={[styles.signInButton, (!isEmailValid || !isPasswordValid || isEmailLoading) && styles.signInButtonDisabled]} 
              onPress={handleLogin} 
              disabled={isLoading || isEmailLoading || !isEmailValid || !isPasswordValid}
            >
              {isEmailLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.signInButtonText}>Sign In</Text>}
            </TouchableOpacity>

          </View>

          {/* Divider */}
          <View style={styles.dividerContainer}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.divider} />
          </View>

          {/* Google Sign In - Using Firebase directly */}
          <TouchableOpacity 
            style={styles.googleButton} 
            onPress={handleGoogleLogin} 
            disabled={isGoogleLoading}
          >
            {isGoogleLoading ? (
              <ActivityIndicator color={colors.interactive} />
            ) : (
              <>
                <View style={styles.googleIconSlot}>
                  <Image
                    source={require('../assets/images/google-g-logo.png')}
                    style={styles.googleLogoImage}
                    resizeMode="contain"
                    accessibilityLabel="Google logo"
                  />
                </View>
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Tenant Notice */}
          <View style={styles.noticeContainer}>
            <Ionicons name="information-circle" size={18} color={colors.accent} />
            <Text style={styles.noticeText}>Only registered tenants can access this app. Contact the admin office if you need assistance.</Text>
          </View>

          {__DEV__ ? (
            <TouchableOpacity style={styles.debugButton} onPress={() => router.push('/debug/api-health')}>
              <Ionicons name="pulse-outline" size={17} color={colors.interactive} />
              <Text style={styles.debugButtonText}>Run API Diagnostics</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 32 },
  logoContainer: { alignItems: 'center', marginTop: 8, marginBottom: 2 },
  authLogo: { width: 132, height: 102 },
  title: { fontSize: 28, fontWeight: '700', color: c.text, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, color: c.textSecondary, textAlign: 'center', marginBottom: 32 },
  form: { width: '100%' },
  inputContainer: { marginBottom: 20 },
  passwordInputContainer: { marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: c.border, borderRadius: 12, backgroundColor: c.inputBg, paddingHorizontal: 16 },
  inputWrapperError: { borderColor: c.error, backgroundColor: c.errorBg },
  inputWrapperSuccess: { borderColor: c.success, backgroundColor: c.successBg },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: c.text },
  errorContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  errorText: { fontSize: 12, color: '#DC2626' },
  optionsRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12 },
  rememberOption: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  rememberText: { color: c.text, fontSize: 14, fontWeight: '500' },
  forgotPassword: { minHeight: 44, justifyContent: 'center', alignItems: 'flex-end', flexShrink: 0 },
  forgotPasswordText: { color: c.interactive, fontSize: 14, fontWeight: '600' },
  loginErrorContainer: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 20, gap: 10 },
  loginErrorText: { flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 18 },
  signInButton: {
    backgroundColor: c.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#0A1628', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.16, shadowRadius: 4 },
      android: { elevation: 3 },
      web: { boxShadow: '0 2px 8px rgba(10,22,40,0.18)' },
    }),
  },
  signInButtonDisabled: {
    backgroundColor: c.textMuted,
    ...Platform.select({
      ios: { shadowOpacity: 0 },
      android: { elevation: 0 },
      web: { boxShadow: 'none' },
    }),
  },
  signInButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  dividerContainer: { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
  divider: { flex: 1, height: 1, backgroundColor: c.border },
  dividerText: { paddingHorizontal: 16, color: c.textMuted, fontSize: 13 },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: c.border,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: c.surface,
    gap: 10,
  },
  googleIconSlot: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleLogoImage: { width: 18, height: 18 },
  googleButtonText: { color: c.text, fontSize: 15, fontWeight: '600' },
  noticeContainer: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: c.primaryLight, borderRadius: 12, padding: 16, marginTop: 24, gap: 10 },
  noticeText: { flex: 1, fontSize: 13, color: c.textSecondary, lineHeight: 18 },
  debugButton: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    borderRadius: 12,
    paddingVertical: 12,
  },
  debugButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: c.interactive,
  },
});
