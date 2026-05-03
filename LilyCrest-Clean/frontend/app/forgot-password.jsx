import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../src/context/ThemeContext';
import { useToast } from '../src/context/ToastContext';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../src/config/firebase';

const validateEmail = (value) => {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return { valid: false, error: 'Email is required' };
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalized)) return { valid: false, error: 'Please enter a valid email address' };
  return { valid: true, error: '' };
};

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState({ email: '' });
  const [touched, setTouched] = useState({ email: false });

  useEffect(() => {
    if (!touched.email) return;
    setErrors({ email: validateEmail(email).error });
  }, [email, touched.email]);

  const handleResetPassword = async () => {
    const emailValidation = validateEmail(email);
    setTouched({ email: true });
    setErrors({ email: emailValidation.error });

    if (!emailValidation.valid) {
      return;
    }

    setIsLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
      setSent(true);
      showToast({
        type: 'success',
        title: 'Reset Link Sent',
        message: 'If your email is registered, we just sent you a reset link.',
      });
    } catch (err) {
      const code = err?.code;
      let message = 'Please try again in a moment.';
      if (code === 'auth/user-not-found' || code === 'auth/invalid-email') {
        message = 'No account found with that email address.';
      } else if (code === 'auth/too-many-requests') {
        message = 'Too many attempts. Please wait before trying again.';
      }
      showToast({
        type: 'error',
        title: 'Unable to Send Reset Link',
        message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const isEmailValid = validateEmail(email).valid;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={colors.text} /></TouchableOpacity>
          
          <View style={styles.iconContainer}><Ionicons name={sent ? 'mail-open' : 'lock-closed'} size={48} color="#D4682A" /></View>
          <Text style={styles.title}>{sent ? 'Check Your Email' : 'Forgot Password?'}</Text>
          <Text style={styles.subtitle}>{sent ? `We've sent a password reset link to ${email}` : 'Enter your email address and we\'ll send you a link to reset your password.'}</Text>

          {!sent ? (
            <>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Email Address</Text>
                <View style={[styles.inputWrapper, touched.email && errors.email ? styles.inputWrapperError : null, touched.email && !errors.email && isEmailValid ? styles.inputWrapperSuccess : null]}>
                  <Ionicons name="mail-outline" size={20} color={touched.email && errors.email ? '#EF4444' : '#9CA3AF'} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your email"
                    placeholderTextColor="#9CA3AF"
                    value={email}
                    onChangeText={(text) => setEmail((text || '').replace(/\s+/g, ''))}
                    onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {touched.email && !errors.email && isEmailValid ? (
                    <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                  ) : null}
                </View>
                {touched.email && errors.email ? (
                  <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle" size={14} color="#EF4444" />
                    <Text style={styles.errorText}>{errors.email}</Text>
                  </View>
                ) : null}
              </View>
              <TouchableOpacity
                style={[styles.resetButton, (!isEmailValid || isLoading) && styles.resetButtonDisabled]}
                onPress={handleResetPassword}
                disabled={isLoading || !isEmailValid}
              >
                {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.resetButtonText}>Send Reset Link</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.resetButton} onPress={() => router.push('/login')}><Text style={styles.resetButtonText}>Return to Login</Text></TouchableOpacity>
          )}

          <TouchableOpacity style={styles.backToLogin} onPress={() => router.push('/login')}>
            <Ionicons name="arrow-back" size={18} color="#D4682A" /><Text style={styles.backToLoginText}>Back to Login</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 24 },
  backButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center', marginBottom: 32 },
  iconContainer: { width: 80, height: 80, borderRadius: 24, backgroundColor: '#FDF6EC', justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '700', color: '#1E3A5F', textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 32, paddingHorizontal: 16 },
  inputContainer: { marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: '#1E3A5F', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12, backgroundColor: '#F8FAFC', paddingHorizontal: 16 },
  inputWrapperError: { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },
  inputWrapperSuccess: { borderColor: '#22C55E', backgroundColor: '#F0FDF4' },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: '#1F2937' },
  errorContainer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  errorText: { color: '#DC2626', fontSize: 12 },
  resetButton: { backgroundColor: '#1E3A5F', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginBottom: 16 },
  resetButtonDisabled: { backgroundColor: '#94A3B8' },
  resetButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  backToLogin: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  backToLoginText: { color: '#D4682A', fontSize: 15, fontWeight: '600' },
});
