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
import { useTheme, useThemedStyles } from '../src/context/ThemeContext';
import { useToast } from '../src/context/ToastContext';
import { api } from '../src/services/api';
import {
  blockPasswordWhitespaceInput,
  getStrongPasswordChecks,
  validateStrongPassword,
} from '../src/utils/passwordValidation';

const getResetErrors = ({ newPassword, confirmPassword, token }) => {
  const confirmValidation = validateStrongPassword(confirmPassword, { requiredMessage: 'Please confirm your new password.' });

  return {
    newPassword: validateStrongPassword(newPassword, { requiredMessage: 'New password is required.' }).error,
    confirmPassword: !confirmPassword
      ? 'Please confirm your new password.'
      : !confirmValidation.valid
        ? confirmValidation.error
        : newPassword !== confirmPassword
          ? 'Passwords do not match.'
          : '',
    token: token ? '' : 'Invalid reset link. Please request a new one.',
  };
};

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { token: rawToken } = useLocalSearchParams();
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  const normalizedToken = typeof token === 'string' ? token.trim() : '';
  const { showToast } = useToast();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({ newPassword: '', confirmPassword: '', token: '' });
  const [touched, setTouched] = useState({ newPassword: false, confirmPassword: false });
  const [requestError, setRequestError] = useState('');
  const [done, setDone] = useState(false);
  const passwordChecks = useMemo(() => getStrongPasswordChecks(newPassword), [newPassword]);

  const validationErrors = useMemo(
    () => getResetErrors({ newPassword, confirmPassword, token: normalizedToken }),
    [confirmPassword, newPassword, normalizedToken]
  );
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

  const handlePasswordFieldChange = (field, value) => {
    const currentValue = field === 'newPassword' ? newPassword : confirmPassword;
    const { value: nextValue, blocked } = blockPasswordWhitespaceInput(value, currentValue);

    if (blocked) {
      setTouched((prev) => ({ ...prev, [field]: true }));
      setErrors((prev) => ({
        ...prev,
        [field]: field === 'newPassword'
          ? validateStrongPassword(value, { requiredMessage: 'New password is required.' }).error
          : 'Password must not contain spaces.',
      }));
      return;
    }

    if (field === 'newPassword') setNewPassword(nextValue);
    if (field === 'confirmPassword') setConfirmPassword(nextValue);
  };

  const handleReset = async () => {
    setRequestError('');

    const nextErrors = getResetErrors({ newPassword, confirmPassword, token: normalizedToken });
    setTouched({ newPassword: true, confirmPassword: true });
    setErrors(nextErrors);

    if (nextErrors.newPassword || nextErrors.confirmPassword || nextErrors.token) {
      if (nextErrors.token) setRequestError(nextErrors.token);
      return;
    }

    setIsLoading(true);
    try {
      await api.post('/auth/reset-password', { token: normalizedToken, newPassword });
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

  const CHECKS = [
    { key: 'noWhitespace', label: 'No spaces' },
    { key: 'length',       label: '8+ characters' },
    { key: 'uppercase',    label: 'Uppercase letter' },
    { key: 'lowercase',    label: 'Lowercase letter' },
    { key: 'number',       label: 'Number' },
    { key: 'special',      label: 'Special character' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.iconBox}>
            <Ionicons name={done ? 'checkmark-circle' : 'key'} size={48} color={colors.primary} />
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
                <Text style={styles.label}>New Password</Text>
                <View style={[styles.inputRow, touched.newPassword && errors.newPassword ? styles.inputRowError : null, touched.newPassword && !errors.newPassword && newPassword.length >= 8 ? styles.inputRowSuccess : null]}>
                  <Ionicons name="lock-closed-outline" size={20} color={touched.newPassword && errors.newPassword ? '#EF4444' : '#9CA3AF'} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="At least 8 characters"
                    placeholderTextColor="#9CA3AF"
                    value={newPassword}
                    onChangeText={(value) => handlePasswordFieldChange('newPassword', value)}
                    onBlur={() => setTouched((prev) => ({ ...prev, newPassword: true }))}
                    secureTextEntry={!showNew}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => setShowNew(v => !v)} style={styles.eyeBtn}>
                    <Ionicons name={showNew ? 'eye-off-outline' : 'eye-outline'} size={20} color="#9CA3AF" />
                  </TouchableOpacity>
                </View>
                {touched.newPassword && errors.newPassword ? (
                  <View style={styles.errorRow}>
                    <Ionicons name="alert-circle" size={14} color="#EF4444" />
                    <Text style={styles.errorText}>{errors.newPassword}</Text>
                  </View>
                ) : null}

                <View style={styles.requirementsBox}>
                  {CHECKS.map(({ key, label }) => (
                    <View key={key} style={styles.requirementItem}>
                      <Ionicons
                        name={passwordChecks[key] ? 'checkmark-circle' : 'ellipse-outline'}
                        size={15}
                        color={passwordChecks[key] ? '#22C55E' : '#9CA3AF'}
                      />
                      <Text style={[styles.requirementText, passwordChecks[key] && styles.requirementMet]}>
                        {label}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Confirm Password</Text>
                <View style={[styles.inputRow, touched.confirmPassword && errors.confirmPassword ? styles.inputRowError : null, touched.confirmPassword && !errors.confirmPassword && confirmPassword ? styles.inputRowSuccess : null]}>
                  <Ionicons name="lock-closed-outline" size={20} color={touched.confirmPassword && errors.confirmPassword ? '#EF4444' : '#9CA3AF'} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Repeat your password"
                    placeholderTextColor="#9CA3AF"
                    value={confirmPassword}
                    onChangeText={(value) => handlePasswordFieldChange('confirmPassword', value)}
                    onBlur={() => setTouched((prev) => ({ ...prev, confirmPassword: true }))}
                    secureTextEntry={!showConfirm}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => setShowConfirm(v => !v)} style={styles.eyeBtn}>
                    <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={20} color="#9CA3AF" />
                  </TouchableOpacity>
                </View>
                {touched.confirmPassword && errors.confirmPassword ? (
                  <View style={styles.errorRow}>
                    <Ionicons name="alert-circle" size={14} color="#EF4444" />
                    <Text style={styles.errorText}>{errors.confirmPassword}</Text>
                  </View>
                ) : null}
              </View>

              {requestError ? (
                <View style={styles.requestErrorBox}>
                  <Ionicons name="alert-circle" size={16} color="#B91C1C" />
                  <Text style={styles.requestErrorText}>{requestError}</Text>
                </View>
              ) : null}

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
              <Ionicons name="refresh-outline" size={16} color={colors.primary} />
              <Text style={styles.linkText}>Request a new link</Text>
            </TouchableOpacity>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (c, dark) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: 24 },
  backButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.surfaceSecondary, justifyContent: 'center', alignItems: 'center', marginBottom: 32 },
  iconBox: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: c.primaryLight, justifyContent: 'center',
    alignItems: 'center', alignSelf: 'center', marginBottom: 24,
  },
  title: { fontSize: 28, fontWeight: '700', color: c.text, textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 15, color: c.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 32, paddingHorizontal: 16 },
  field: { marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: c.border,
    borderRadius: 12, backgroundColor: c.inputBg, paddingHorizontal: 16,
  },
  inputRowError: { borderColor: '#EF4444', backgroundColor: dark ? 'rgba(239,68,68,0.1)' : '#FEF2F2' },
  inputRowSuccess: { borderColor: '#22C55E', backgroundColor: dark ? 'rgba(34,197,94,0.1)' : '#F0FDF4' },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: c.text },
  eyeBtn: { padding: 4 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  errorText: { color: '#EF4444', fontSize: 12 },
  requirementsBox: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  requirementItem: { flexDirection: 'row', alignItems: 'center', gap: 5, width: '47%' },
  requirementText: { color: c.textMuted, fontSize: 12 },
  requirementMet: { color: '#22C55E', fontWeight: '600' },
  requestErrorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: dark ? 'rgba(239,68,68,0.1)' : '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 10, padding: 12, marginBottom: 16 },
  requestErrorText: { color: '#B91C1C', fontSize: 13, flex: 1 },
  primaryBtn: {
    backgroundColor: c.accent, paddingVertical: 16,
    borderRadius: 12, alignItems: 'center', marginBottom: 16,
  },
  primaryBtnDisabled: { backgroundColor: c.textMuted },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 4, paddingBottom: 12, marginTop: 'auto' },
  linkText: { color: c.primary, fontSize: 15, fontWeight: '600' },
});
