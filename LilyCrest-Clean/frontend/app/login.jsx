import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { useAlert } from '../src/context/AlertContext';
import { useAuth } from '../src/context/AuthContext';
import { useTheme, useThemedStyles } from '../src/context/ThemeContext';
import { clearCredentials, getCredentials, hasStoredCredentials, saveCredentials } from '../src/services/secureCredentials';
import { blockPasswordWhitespaceInput, validateLoginPassword } from '../src/utils/passwordValidation';

/* cspell:words creds prefs lilycrest wordmark */

// Validation helpers
const validateEmail = (email) => {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return { valid: false, error: 'Email is required' };
  if (normalized.length > 254) return { valid: false, error: 'Email address is too long' };
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalized)) return { valid: false, error: 'Please enter a valid email address' };
  return { valid: true, error: '' };
};

export default function LoginScreen() {
  const router = useRouter();
  const { loginWithEmail, signInWithGoogle, isLoading } = useAuth();
  const { signInWithGoogle: googleSignIn } = useGoogleSignIn();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { showAlert } = useAlert();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });
  const [touched, setTouched] = useState({ email: false, password: false });
  // loginError: { message: string, type: 'credentials' | 'access' | 'ratelimit' | 'network' }
  const [loginError, setLoginError] = useState(null);
  const [rememberMe, setRememberMe] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricType, setBiometricType] = useState('Biometric');
  const [canUseBiometric, setCanUseBiometric] = useState(false);

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
    const { value, blocked } = blockPasswordWhitespaceInput(nextValue, password);
    if (blocked) {
      setTouched((prev) => ({ ...prev, password: true }));
      setErrors((prev) => ({ ...prev, password: validateLoginPassword(nextValue).error }));
      return;
    }

    setPassword(value);
  };

  // Load remember-me preference and biometric eligibility
  useEffect(() => {
    const init = async () => {
      try {
        const savedRemember = await AsyncStorage.getItem('remember_me');
        const savedEmail = await AsyncStorage.getItem('last_email');
        const bioSetting = await AsyncStorage.getItem('biometricLogin');
        const prefersRemember = savedRemember === 'true';
        const isBioEnabled = bioSetting === 'true';
        if (prefersRemember) setRememberMe(true);
        if (savedEmail && validateEmail(savedEmail).valid) setEmail(savedEmail);

        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        const available = hasHardware && isEnrolled;
        setBiometricAvailable(available);
        setBiometricEnabled(isBioEnabled);

        // Use generic "Biometrics" label (covers fingerprint, face, PIN)
        if (available) {
          setBiometricType('Biometrics');
        }

        // Biometric login requires: hardware + enrolled + biometric enabled + stored credentials
        const hasCreds = await hasStoredCredentials();
        setCanUseBiometric(available && isBioEnabled && hasCreds);
      } catch (err) {
        console.warn('Init login prefs failed:', err?.message);
      }
    };
    init();
  }, []);



  const handleLogin = async () => {
    const emailValidation = validateEmail(email);
    const passwordValidation = validateLoginPassword(password);

    setTouched({ email: true, password: true });
    setErrors({ email: emailValidation.error, password: passwordValidation.error });

    if (!emailValidation.valid || !passwordValidation.valid) return;

    setIsEmailLoading(true);
    setLoginError(null);
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password;

    try {
      const result = await loginWithEmail(normalizedEmail, normalizedPassword);

      // OTP required — credentials were valid, navigate to verification screen
      if (result.otpRequired) {
        router.push({
          pathname: '/otp-verify',
          params: {
            otp_token: result.otpToken,
            masked_email: result.maskedEmail,
            remember_me: rememberMe ? 'true' : 'false',
            email: normalizedEmail,
            password: normalizedPassword,
          },
        });
        return;
      }

      if (!result.success) {
        const { status } = result;
        if (status === 400) {
          setLoginError({ message: result.error, type: 'credentials' });
        } else if (status === 401) {
          setLoginError({ message: result.error, type: 'credentials' });
        } else if (status === 403) {
          setLoginError({ message: result.error, type: 'access' });
        } else if (status === 429) {
          setLoginError({ message: result.error, type: 'ratelimit' });
        } else if (status === 500) {
          setLoginError({ message: result.error, type: 'network' });
        } else if (status === 0) {
          setLoginError({ message: result.error, type: 'network' });
        } else {
          setLoginError({ message: result.error, type: 'credentials' });
        }
        setErrors({ email: '', password: '' });
        setTouched({ email: false, password: false });
        return;
      }

      // Persist remember-me email preference
      await AsyncStorage.setItem('remember_me', rememberMe ? 'true' : 'false');
      if (rememberMe) {
        await AsyncStorage.setItem('last_email', normalizedEmail);
      } else {
        await AsyncStorage.removeItem('last_email');
      }

      // Handle biometric credential storage
      if (biometricAvailable) {
        const bioSetting = await AsyncStorage.getItem('biometricLogin');
        if (bioSetting === 'true') {
          // Biometric was previously enabled — refresh stored credentials silently
          // (covers password-change scenario where old credentials were cleared)
          await saveCredentials(normalizedEmail, normalizedPassword);
          setCanUseBiometric(true);
          router.replace('/(tabs)/home');
        } else {
          // First time on this device — offer to enable biometric login
          showAlert({
            title: 'Enable Biometric Login',
            message: `Sign in faster next time using ${biometricType}.`,
            type: 'info',
            icon: 'finger-print',
            buttons: [
              {
                text: 'Not Now',
                style: 'cancel',
                onPress: () => router.replace('/(tabs)/home'),
              },
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
                      await saveCredentials(normalizedEmail, normalizedPassword);
                      await AsyncStorage.setItem('biometricLogin', 'true');
                      setCanUseBiometric(true);
                    }
                  } catch (_) {}
                  router.replace('/(tabs)/home');
                },
              },
            ],
          });
        }
      } else {
        router.replace('/(tabs)/home');
      }
    } catch (error) {
      console.error('Login error:', error);
      setLoginError({ message: 'An unexpected error occurred. Please try again.', type: 'network' });
    } finally {
      setIsEmailLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    setLoginError(null);

    try {
      const result = await googleSignIn();
      const { success, cancelled, error: resultError } = result;

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
        const { success: backendSuccess, status, error: backendError } = backendResult;

        if (backendSuccess) {
          await AsyncStorage.setItem('remember_me', rememberMe ? 'true' : 'false');
          router.replace('/(tabs)/home');
        } else {
          const type = status === 403 ? 'access' : 'credentials';
          setLoginError({ message: backendError || 'Failed to create session.', type });
        }
      } else if (cancelled) {
        // User deliberately cancelled — not an error
      } else {
        setLoginError({ message: resultError || 'Google sign-in failed. Please try again.', type: 'credentials' });
      }
    } catch (error) {
      console.error('Google login error:', error);
      setLoginError({ message: 'Google sign-in failed. Please try again or use email/password.', type: 'network' });
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    setLoginError(null);
    if (!canUseBiometric) {
      setLoginError({ message: 'Biometric login unavailable. Please sign in with email instead.', type: 'network' });
      return;
    }

    setIsBiometricLoading(true);
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        setLoginError({ message: 'Biometric authentication is not available on this device.', type: 'network' });
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Sign in to LilyCrest',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      if (!result.success) {
        setLoginError({ message: 'Biometric verification failed. Please try again.', type: 'credentials' });
        return;
      }

      const creds = await getCredentials();
      if (!creds) {
        setLoginError({ message: 'Stored credentials not found. Please sign in with your password to re-enable biometric login.', type: 'access' });
        setCanUseBiometric(false);
        return;
      }

      const loginResult = await loginWithEmail(creds.email, creds.password, { biometricLogin: true });
      if (!loginResult.success) {
        if (loginResult.status === 401 || loginResult.status === 400) {
          await clearCredentials();
          setCanUseBiometric(false);
          setLoginError({ message: 'Your password was changed. Please sign in with your new password to re-enable biometric login.', type: 'access' });
        } else {
          setLoginError({ message: loginResult.error || 'Sign-in failed. Please try again.', type: 'credentials' });
        }
        return;
      }

      await AsyncStorage.setItem('remember_me', 'true');
      await AsyncStorage.setItem('last_email', creds.email);
      router.replace('/(tabs)/home');
    } catch (error) {
      console.error('Biometric login error:', error);
      setLoginError({ message: 'Biometric sign-in failed. Please use email or Google.', type: 'network' });
    } finally {
      setIsBiometricLoading(false);
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
          {/* Back Button */}
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>

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
              credentials: { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B', icon: 'lock-closed', iconColor: '#EF4444' },
              access:      { bg: '#FFF7ED', border: '#FED7AA', text: '#92400E', icon: 'shield-checkmark', iconColor: '#F97316' },
              ratelimit:   { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E', icon: 'time', iconColor: '#F59E0B' },
              network:     { bg: '#F0F9FF', border: '#BAE6FD', text: '#0C4A6E', icon: 'wifi', iconColor: '#0EA5E9' },
            }[loginError.type] || { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B', icon: 'alert-circle', iconColor: '#EF4444' };
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
                <Ionicons name="mail-outline" size={20} color={showEmailFieldError ? '#EF4444' : '#9CA3AF'} style={styles.inputIcon} />
                <TextInput 
                  style={styles.input} 
                  placeholder="Enter your email" 
                  placeholderTextColor="#9CA3AF" 
                  value={email} 
                  onChangeText={(text) => setEmail((text || '').replace(/\s+/g, ''))} 
                  onBlur={() => setTouched(prev => ({ ...prev, email: true }))} 
                  keyboardType="email-address" 
                  autoCapitalize="none" 
                  autoCorrect={false} 
                />
                {!showEmailFieldError && touched.email && isEmailValid && <Ionicons name="checkmark-circle" size={20} color="#22C55E" />}
              </View>
              {touched.email && errors.email && !loginError ? (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={14} color="#EF4444" />
                  <Text style={styles.errorText}>{errors.email}</Text>
                </View>
              ) : null}
            </View>

            {/* Password Input */}
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Password</Text>
              <View style={[styles.inputWrapper, showPasswordFieldError && styles.inputWrapperError, !showPasswordFieldError && touched.password && isPasswordValid && styles.inputWrapperSuccess]}>
                <Ionicons name="lock-closed-outline" size={20} color={showPasswordFieldError ? '#EF4444' : '#9CA3AF'} style={styles.inputIcon} />
                <TextInput 
                  style={styles.input} 
                  placeholder="Enter your password" 
                  placeholderTextColor="#9CA3AF" 
                  value={password} 
                  onChangeText={handlePasswordChange}
                  onBlur={() => setTouched(prev => ({ ...prev, password: true }))} 
                  secureTextEntry={!showPassword} 
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
              {touched.password && errors.password && !loginError ? (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={14} color="#EF4444" />
                  <Text style={styles.errorText}>{errors.password}</Text>
                </View>
              ) : null}
            </View>

            {/* Remember Me + Forgot Password */}
            <View style={styles.optionsRow}>
              <TouchableOpacity style={styles.rememberRow} onPress={async () => {
                const next = !rememberMe;
                setRememberMe(next);
                await AsyncStorage.setItem('remember_me', next ? 'true' : 'false');
              }}>
                <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                  {rememberMe ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
                </View>
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

            {/* Biometric Sign-In */}
            {canUseBiometric ? (
              <TouchableOpacity
                style={[styles.biometricButton, isBiometricLoading && styles.signInButtonDisabled]}
                onPress={handleBiometricLogin}
                disabled={isBiometricLoading}
              >
                {isBiometricLoading ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <>
                    <Ionicons name="finger-print" size={20} color={colors.accent} />
                    <Text style={styles.biometricText}>Sign in with {biometricType}</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : biometricAvailable ? (
              <View style={styles.biometricHintRow}>
                <Ionicons name="finger-print" size={16} color="#9CA3AF" />
                <Text style={styles.biometricHintText}>
                  {biometricEnabled
                    ? `${biometricType} is enabled — sign in once to activate it.`
                    : `${biometricType} available — enable it in Settings.`
                  }
                </Text>
              </View>
            ) : null}
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
              <ActivityIndicator color={colors.primary} />
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (c, dark) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 32 },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: c.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
      android: { elevation: 2 },
      web: { boxShadow: '0 2px 6px rgba(0,0,0,0.08)' },
    }),
  },
  logoContainer: { alignItems: 'center', marginTop: 8, marginBottom: 2 },
  authLogo: { width: 132, height: 102 },
  title: { fontSize: 28, fontWeight: '700', color: c.text, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, color: c.textSecondary, textAlign: 'center', marginBottom: 32 },
  form: { width: '100%' },
  inputContainer: { marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: c.border, borderRadius: 12, backgroundColor: c.inputBg, paddingHorizontal: 16 },
  inputWrapperError: { borderColor: '#EF4444', backgroundColor: dark ? 'rgba(239,68,68,0.1)' : '#FEF2F2' },
  inputWrapperSuccess: { borderColor: '#22C55E', backgroundColor: dark ? 'rgba(34,197,94,0.1)' : '#F0FDF4' },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: c.text },
  errorContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  errorText: { fontSize: 12, color: '#EF4444' },
  optionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: c.border, justifyContent: 'center', alignItems: 'center', backgroundColor: c.inputBg },
  checkboxChecked: { backgroundColor: c.accent, borderColor: c.accent },
  rememberText: { color: c.text, fontWeight: '600' },
  forgotPassword: { alignSelf: 'flex-end' },
  forgotPasswordText: { color: c.primary, fontSize: 14, fontWeight: '600' },
  loginErrorContainer: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 20, gap: 10 },
  loginErrorText: { flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 18 },
  signInButton: {
    backgroundColor: c.accent,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: c.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
      android: { elevation: 4 },
      web: { boxShadow: '0 4px 12px rgba(0,0,0,0.2)' },
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
  biometricButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: c.border, borderRadius: 12, paddingVertical: 12, backgroundColor: c.inputBg, marginTop: 12 },
  biometricText: { color: c.text, fontSize: 14, fontWeight: '600' },
  biometricHintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 8 },
  biometricHintText: { fontSize: 12, color: c.textMuted, flex: 1 },
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
});
