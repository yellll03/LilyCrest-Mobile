import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
import { useToast } from '../src/context/ToastContext';
import { api } from '../src/services/api';

const getResetErrors = ({ newPassword, confirmPassword, token }) => ({
  newPassword: !newPassword
    ? 'New password is required.'
    : newPassword.length < 8
      ? 'Password must be at least 8 characters.'
      : '',
  confirmPassword: !confirmPassword
    ? 'Please confirm your new password.'
    : newPassword !== confirmPassword
      ? 'Passwords do not match.'
      : '',
  token: token ? '' : 'Invalid reset link. Please request a new one.',
});

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams();
  const { showToast } = useToast();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({ newPassword: '', confirmPassword: '', token: '' });
  const [touched, setTouched] = useState({ newPassword: false, confirmPassword: false });
  const [requestError, setRequestError] = useState('');
  const [done, setDone] = useState(false);

  const validationErrors = useMemo(() => getResetErrors({ newPassword, confirmPassword, token }), [confirmPassword, newPassword, token]);
  const isFormValid = !validationErrors.newPassword && !validationErrors.confirmPassword && !validationErrors.token;

  useEffect(() => {
    if (!touched.newPassword && !touched.confirmPassword) return;

    setErrors((prev) => ({
      ...prev,
      newPassword: touched.newPassword ? validationErrors.newPassword : prev.newPassword,
      confirmPassword: touched.confirmPassword ? validationErrors.confirmPassword : prev.confirmPassword,
      token: validationErrors.token,
    }));
  }, [touched, validationErrors]);

  useEffect(() => {
    if (!validationErrors.token) return;
    setRequestError(validationErrors.token);
  }, [validationErrors.token]);

  const handleReset = async () => {
    setRequestError('');

    const nextErrors = getResetErrors({ newPassword, confirmPassword, token });
    setTouched({ newPassword: true, confirmPassword: true });
    setErrors(nextErrors);

    if (nextErrors.newPassword || nextErrors.confirmPassword || nextErrors.token) {
      if (nextErrors.token) setRequestError(nextErrors.token);
      return;
    }

    setIsLoading(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword });
      setDone(true);
      showToast({
        type: 'success',
        title: 'Password Updated',
        message: 'Your password has been reset successfully. You can now sign in.',
      });
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.message;
      setRequestError(detail || 'Failed to reset password. Please try again.');
      showToast({
        type: 'error',
        title: 'Reset Failed',
        message: detail || 'Please request a new reset link and try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          <View style={styles.iconBox}>
            <Ionicons name={done ? 'checkmark-circle' : 'key'} size={48} color="#D4682A" />
          </View>

          <Text style={styles.title}>{done ? 'Password Reset!' : 'Set New Password'}</Text>
          <Text style={styles.subtitle}>
            {done
              ? 'Your password has been updated. You can now log in with your new password.'
              : 'Enter and confirm your new password below.'}
          </Text>

          {!done ? (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>NEW PASSWORD</Text>
                <View style={[styles.inputRow, touched.newPassword && errors.newPassword ? styles.inputRowError : null, touched.newPassword && !errors.newPassword && newPassword.length >= 8 ? styles.inputRowSuccess : null]}>
                  <Ionicons name="lock-closed-outline" size={20} color={touched.newPassword && errors.newPassword ? '#EF4444' : '#9CA3AF'} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="At least 8 characters"
                    placeholderTextColor="#9CA3AF"
                    value={newPassword}
                    onChangeText={(value) => setNewPassword(value)}
                    onBlur={() => setTouched((prev) => ({ ...prev, newPassword: true }))}
                    secureTextEntry={!showNew}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => setShowNew(v => !v)} style={styles.eyeBtn}>
                    <Ionicons name={showNew ? 'eye-off-outline' : 'eye-outline'} size={20} color="#9CA3AF" />
                  </TouchableOpacity>
                </View>
                {touched.newPassword && errors.newPassword ? <Text style={styles.errorText}>{errors.newPassword}</Text> : null}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>CONFIRM PASSWORD</Text>
                <View style={[styles.inputRow, touched.confirmPassword && errors.confirmPassword ? styles.inputRowError : null, touched.confirmPassword && !errors.confirmPassword && confirmPassword ? styles.inputRowSuccess : null]}>
                  <Ionicons name="lock-closed-outline" size={20} color={touched.confirmPassword && errors.confirmPassword ? '#EF4444' : '#9CA3AF'} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Repeat your password"
                    placeholderTextColor="#9CA3AF"
                    value={confirmPassword}
                    onChangeText={(value) => setConfirmPassword(value)}
                    onBlur={() => setTouched((prev) => ({ ...prev, confirmPassword: true }))}
                    secureTextEntry={!showConfirm}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => setShowConfirm(v => !v)} style={styles.eyeBtn}>
                    <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={20} color="#9CA3AF" />
                  </TouchableOpacity>
                </View>
                {touched.confirmPassword && errors.confirmPassword ? <Text style={styles.errorText}>{errors.confirmPassword}</Text> : null}
              </View>

              {requestError ? <Text style={styles.requestErrorText}>{requestError}</Text> : null}

              <TouchableOpacity
                style={[styles.primaryBtn, (!isFormValid || isLoading) && styles.primaryBtnDisabled]}
                onPress={handleReset}
                disabled={isLoading || !isFormValid}
              >
                {isLoading
                  ? <ActivityIndicator color="#FFFFFF" />
                  : <Text style={styles.primaryBtnText}>Reset Password</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/login')}>
              <Text style={styles.primaryBtnText}>Go to Login</Text>
            </TouchableOpacity>
          )}

          {!done && (
            <TouchableOpacity style={styles.linkRow} onPress={() => router.replace('/forgot-password')}>
              <Ionicons name="refresh-outline" size={16} color="#D4682A" />
              <Text style={styles.linkText}>Request a new link</Text>
            </TouchableOpacity>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: 24 },
  iconBox: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: '#FDF6EC', justifyContent: 'center',
    alignItems: 'center', alignSelf: 'center', marginBottom: 24, marginTop: 16,
  },
  title: { fontSize: 28, fontWeight: '700', color: '#1E3A5F', textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 32, paddingHorizontal: 12 },
  field: { marginBottom: 20 },
  label: { fontSize: 12, fontWeight: '600', color: '#1E3A5F', marginBottom: 8, letterSpacing: 0.5 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#E5E7EB',
    borderRadius: 12, backgroundColor: '#F8FAFC', paddingHorizontal: 14,
  },
  inputRowError: { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },
  inputRowSuccess: { borderColor: '#22C55E', backgroundColor: '#F0FDF4' },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: '#1F2937' },
  eyeBtn: { padding: 4 },
  errorText: { color: '#DC2626', fontSize: 12, marginTop: 6 },
  requestErrorText: { color: '#DC2626', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: '#1E3A5F', paddingVertical: 16,
    borderRadius: 12, alignItems: 'center', marginBottom: 16,
  },
  primaryBtnDisabled: { backgroundColor: '#94A3B8' },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  linkText: { color: '#D4682A', fontSize: 14, fontWeight: '600' },
});
