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
import { useAuth } from '../src/context/AuthContext';
import { useTheme } from '../src/context/ThemeContext';
import { api } from '../src/services/api';

// Validation helpers
const validateEmail = (email) => {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return { valid: false, error: 'Email is required' };
  if (normalized.length > 254) return { valid: false, error: 'Email address is too long' };
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalized)) return { valid: false, error: 'Please enter a valid email address' };
  return { valid: true, error: '' };
};

const validatePassword = (password) => {
  const rawPassword = password || '';
  if (!rawPassword) return { valid: false, error: 'Password is required' };
  if (rawPassword.length > 128) return { valid: false, error: 'Password is too long' };
  if (rawPassword.length < 6) return { valid: false, error: 'Password must be at least 6 characters' };
  return { valid: true, error: '' };
};


export default function LoginScreen() {
  const router = useRouter();
  const { loginWithEmail, signInWithGoogle, logout, checkAuth, isLoading } = useAuth();
  const { signInWithGoogle: googleSignIn } = useGoogleSignIn();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });
  const [touched, setTouched] = useState({ email: false, password: false });
  const [loginError, setLoginError] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
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
      const passwordValidation = validatePassword(password);
      setErrors(prev => ({ ...prev, password: passwordValidation.error }));
    }
  }, [password, touched.password]);

  useEffect(() => {
    setLoginError('');
  }, [email, password]);

  // Load remember-me preference and biometric eligibility
  useEffect(() => {
    const init = async () => {
      try {
        const savedRemember = await AsyncStorage.getItem('remember_me');
        const savedEmail = await AsyncStorage.getItem('last_email');
        const token = await AsyncStorage.getItem('session_token');
        const bioSetting = await AsyncStorage.getItem('biometricLogin');
        const prefersRemember = savedRemember === 'true';
        const biometricEnabled = bioSetting === 'true';
        if (prefersRemember) setRememberMe(true);
        if (savedEmail && !email) setEmail(savedEmail);

        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        const available = hasHardware && isEnrolled;
        setBiometricAvailable(available);
        // Biometric login requires: hardware + enrolled + remember me + biometric setting enabled + valid token
        setCanUseBiometric(available && prefersRemember && biometricEnabled && !!token);
      } catch (err) {
        console.warn('Init login prefs failed:', err?.message);
      }
    };
    init();
  }, []);

  const verifyTenantSession = async () => {
    try {
      const response = await api.get('/auth/me');
      return { ok: true, user: response.data };
    } catch (error) {
      const status = error?.response?.status;
      if (status === 403) {
        return { ok: false, message: 'Access denied. This app is for registered tenants only.' };
      }
      if (status === 401) {
        return { ok: false, message: 'Session expired. Please sign in again.' };
      }
      return { ok: false, message: 'Unable to verify tenant status. Please try again.' };
    }
  };

  const updateBiometricEligibility = async (rememberOverride) => {
    try {
      const token = await AsyncStorage.getItem('session_token');
      const remember = rememberOverride != null
        ? rememberOverride
        : (await AsyncStorage.getItem('remember_me')) === 'true';
      const bioSetting = await AsyncStorage.getItem('biometricLogin');
      setCanUseBiometric(!!remember && bioSetting === 'true' && biometricAvailable && !!token);
    } catch (_e) {
      setCanUseBiometric(false);
    }
  };

  const handleLogin = async () => {
    const emailValidation = validateEmail(email);
    const passwordValidation = validatePassword(password);

    setTouched({ email: true, password: true });
    setErrors({ email: emailValidation.error, password: passwordValidation.error });

    if (!emailValidation.valid || !passwordValidation.valid) return;

    setIsEmailLoading(true);
    setLoginError('');
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password;

    try {
      // Authenticate with backend directly — it handles Firebase auth + tenant lookup
      const result = await loginWithEmail(normalizedEmail, normalizedPassword);
      if (!result.success) {
        const errMsg = result.error || 'Unable to sign in. Please try again.';
        setLoginError(errMsg);
        const errLower = errMsg.toLowerCase();
        if (errLower.includes('invalid email or password') || errLower.includes('password must be')) {
          setPassword('');
          setTouched({ email: true, password: true });
          setErrors((prev) => ({ ...prev, password: errMsg }));
        } else if (errLower.includes('not registered') || errLower.includes('access denied') || errLower.includes('inactive')) {
          // Tenant-specific errors — show as login-level error, don't mark password wrong
          setTouched({ email: true, password: true });
        }
        return;
      }


      // Persist remember-me preference
      await AsyncStorage.setItem('remember_me', rememberMe ? 'true' : 'false');
      if (rememberMe) {
        await AsyncStorage.setItem('last_email', normalizedEmail);
      } else {
        await AsyncStorage.removeItem('last_email');
      }
      await updateBiometricEligibility(rememberMe);

      router.replace('/(tabs)/home');
    } catch (error) {
      console.error('Login error:', error);
      setLoginError('An unexpected error occurred. Please try again.');
    } finally {
      setIsEmailLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    setLoginError('');
    
    try {
      // Use React Native-compatible Google Sign-In
      const result = await googleSignIn();
      
      if (result.success) {
        // Get fresh Firebase ID token (force refresh to ensure validity)
        const { getFreshIdToken } = await import('../src/config/firebase');
        const idToken = await getFreshIdToken(true);
        
        if (!idToken) {
          setLoginError('Failed to get authentication token. Please try again.');
          return;
        }
        
        // Send to our backend to create session
        const backendResult = await signInWithGoogle(idToken);
        
        if (backendResult.success) {
            const verified = await verifyTenantSession();
            if (!verified.ok) {
            await logout();
            setLoginError(verified.message);
            return;
            }
            await AsyncStorage.setItem('remember_me', rememberMe ? 'true' : 'false');
            await updateBiometricEligibility(rememberMe);
            router.replace('/(tabs)/home');
        } else {
          setLoginError(backendResult.error || 'Failed to create session');
        }
      } else if (result.cancelled) {
        // User deliberately cancelled — not an error, don't show anything
      } else {
        setLoginError(result.error || 'Google sign-in failed. Please try again.');
      }
    } catch (error) {
      console.error('Google login error:', error);
      setLoginError('Google sign-in failed. Please try again or use email/password.');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    setLoginError('');
    if (!canUseBiometric) {
      setLoginError('Biometric login unavailable. Please sign in with email instead.');
      return;
    }

    setIsBiometricLoading(true);
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        setLoginError('Biometric authentication is not available on this device.');
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Sign in with biometrics',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      if (!result.success) {
        setLoginError('Biometric authentication failed. Please try again.');
        return;
      }

      const verified = await verifyTenantSession();
      if (!verified.ok) {
        await logout();
        setLoginError(verified.message);
        return;
      }

      await checkAuth();
      router.replace('/(tabs)/home');
    } catch (error) {
      console.error('Biometric login error:', error);
      setLoginError('Biometric sign-in failed. Please use email or Google.');
    } finally {
      setIsBiometricLoading(false);
    }
  };

  const isEmailValid = validateEmail(email).valid;
  const isPasswordValid = validatePassword(password).valid;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Back Button */}
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#0f172a" />
          </TouchableOpacity>

          {/* Logo */}
          <View style={styles.logoContainer}>
            <Image
              source={require('../assets/images/logo-main.png')}
              style={styles.brandImage}
              resizeMode="contain"
              accessibilityLabel="LilyCrest logo"
            />
          </View>

          {/* Title */}
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Sign in to access your tenant portal</Text>

          {/* Form */}
          <View style={styles.form}>
            {/* Email Input */}
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Email Address</Text>
              <View style={[styles.inputWrapper, touched.email && errors.email && styles.inputWrapperError, touched.email && isEmailValid && styles.inputWrapperSuccess]}>
                <Ionicons name="mail-outline" size={20} color={touched.email && errors.email ? '#EF4444' : '#9CA3AF'} style={styles.inputIcon} />
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
                {touched.email && isEmailValid && <Ionicons name="checkmark-circle" size={20} color="#22C55E" />}
              </View>
              {touched.email && errors.email ? (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={14} color="#EF4444" />
                  <Text style={styles.errorText}>{errors.email}</Text>
                </View>
              ) : null}
            </View>

            {/* Password Input */}
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Password</Text>
              <View style={[styles.inputWrapper, touched.password && errors.password && styles.inputWrapperError, touched.password && isPasswordValid && styles.inputWrapperSuccess]}>
                <Ionicons name="lock-closed-outline" size={20} color={touched.password && errors.password ? '#EF4444' : '#9CA3AF'} style={styles.inputIcon} />
                <TextInput 
                  style={styles.input} 
                  placeholder="Enter your password" 
                  placeholderTextColor="#9CA3AF" 
                  value={password} 
                  onChangeText={setPassword} 
                  onBlur={() => setTouched(prev => ({ ...prev, password: true }))} 
                  secureTextEntry={!showPassword} 
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
              {touched.password && errors.password ? (
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
                updateBiometricEligibility(next);
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

            {/* Login Error */}
            {loginError ? (
              <View style={styles.loginErrorContainer}>
                <Ionicons name="alert-circle" size={18} color="#FFFFFF" />
                <Text style={styles.loginErrorText}>{loginError}</Text>
              </View>
            ) : null}

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
                    <Ionicons name="finger-print" size={18} color={colors.primary} />
                    <Text style={styles.biometricText}>Sign in with biometrics</Text>
                  </>
                )}
              </TouchableOpacity>
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
            <Ionicons name="information-circle" size={18} color="#D4682A" />
            <Text style={styles.noticeText}>Only registered tenants can access this app. Contact the admin office if you need assistance.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 32 },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    ...Platform.select({
      ios: { shadowColor: '#0f172a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 4 },
      android: { elevation: 3 },
      web: { boxShadow: '0 4px 10px rgba(15, 23, 42, 0.15)' },
    }),
  },
  logoContainer: { alignItems: 'center', marginTop: 24, marginBottom: 24 },
  brandImage: { width: 160, height: 120, marginBottom: 8 },
  logoText: { fontSize: 24, fontWeight: '700', color: '#1E3A5F' },
  title: { fontSize: 28, fontWeight: '700', color: '#1E3A5F', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#6B7280', textAlign: 'center', marginBottom: 32 },
  form: { width: '100%' },
  inputContainer: { marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#1E3A5F', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12, backgroundColor: '#F8FAFC', paddingHorizontal: 16 },
  inputWrapperError: { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },
  inputWrapperSuccess: { borderColor: '#22C55E', backgroundColor: '#F0FDF4' },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: '#1F2937' },
  errorContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  errorText: { fontSize: 12, color: '#EF4444' },
  optionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: '#94A3B8', justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF' },
  checkboxChecked: { backgroundColor: '#1E3A5F', borderColor: '#1E3A5F' },
  rememberText: { color: '#1E3A5F', fontWeight: '600' },
  forgotPassword: { alignSelf: 'flex-end' },
  forgotPasswordText: { color: '#D4682A', fontSize: 14, fontWeight: '600' },
  loginErrorContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EF4444', borderRadius: 10, padding: 12, marginBottom: 16, gap: 8 },
  loginErrorText: { flex: 1, color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  signInButton: { 
    backgroundColor: '#1E3A5F', 
    paddingVertical: 16, 
    borderRadius: 12, 
    alignItems: 'center', 
    ...Platform.select({ 
      ios: { shadowColor: '#1E3A5F', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 }, 
      android: { elevation: 4 }, 
      web: { boxShadow: '0 4px 12px rgba(30, 58, 95, 0.3)' } 
    }) 
  },
  signInButtonDisabled: { 
    backgroundColor: '#94A3B8', 
    ...Platform.select({ 
      ios: { shadowOpacity: 0 }, 
      android: { elevation: 0 }, 
      web: { boxShadow: 'none' } 
    }) 
  },
  signInButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  biometricButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12, paddingVertical: 12, backgroundColor: '#FFFFFF', marginTop: 12 },
  biometricText: { color: '#1E3A5F', fontSize: 14, fontWeight: '600' },
  dividerContainer: { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
  divider: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  dividerText: { paddingHorizontal: 16, color: '#9CA3AF', fontSize: 13 },
  googleButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    borderWidth: 1.5, 
    borderColor: '#E5E7EB', 
    borderRadius: 12, 
    paddingVertical: 14, 
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF', 
    gap: 10 
  },
  googleIconSlot: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleLogoImage: { width: 18, height: 18 },
  googleButtonText: { color: '#374151', fontSize: 15, fontWeight: '600' },
  noticeContainer: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#FDF6EC', borderRadius: 12, padding: 16, marginTop: 24, gap: 10 },
  noticeText: { flex: 1, fontSize: 13, color: '#8B6914', lineHeight: 18 },
});
