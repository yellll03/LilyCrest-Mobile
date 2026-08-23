import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/context/AuthContext';
import { useTheme } from '../src/context/ThemeContext';
import { useAlert } from '../src/context/AlertContext';
import { apiService } from '../src/services/api';
import { clearCredentials } from '../src/services/secureCredentials';
import {
  blockPasswordWhitespaceInput,
  getStrongPasswordChecks,
  NEW_PASSWORD_MAX_LENGTH,
  PASSWORD_WHITESPACE_MESSAGE,
  validateStrongPassword,
} from '../src/utils/passwordValidation';
import { classifyChangePasswordError } from '../src/utils/authStability';
import { safeBack } from '../src/utils/navigation';
import { ScreenHeader } from '../src/components/ui/LilycrestUI';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { showAlert } = useAlert();
  const { logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({ current: false, new: false, confirm: false });
  const submitInFlight = useRef(false);

  const passwordChecks = useMemo(() => getStrongPasswordChecks(newPassword), [newPassword]);
  const isPasswordValid = validateStrongPassword(newPassword, { requiredMessage: 'New password is required' }).valid;
  const isSameAsCurrent = Boolean(currentPassword) && currentPassword === newPassword;
  const doPasswordsMatch = Boolean(confirmPassword) && newPassword === confirmPassword;
  const canSubmit = Boolean(currentPassword) && Boolean(confirmPassword) && isPasswordValid && doPasswordsMatch && !isSameAsCurrent;

  const validateCurrentPassword = (password) => {
    if (!password) return 'Current password is required';
    return '';
  };

  useEffect(() => {
    const nextErrors = {};

    if (touched.current) {
      nextErrors.current = validateCurrentPassword(currentPassword);
    }

    if (touched.new) {
      if (!newPassword) nextErrors.new = 'New password is required';
      else if (!isPasswordValid) nextErrors.new = validateStrongPassword(newPassword, { requiredMessage: 'New password is required' }).error;
      else if (isSameAsCurrent) nextErrors.new = 'Your new password must be different from your current password.';
      else nextErrors.new = '';
    }

    if (touched.confirm) {
      if (!confirmPassword) nextErrors.confirm = 'Please confirm your new password';
      else if (/\s/.test(confirmPassword)) nextErrors.confirm = PASSWORD_WHITESPACE_MESSAGE;
      else if (!doPasswordsMatch) nextErrors.confirm = 'Passwords do not match';
      else nextErrors.confirm = '';
    }

    setErrors((prev) => ({ ...prev, ...nextErrors }));
  }, [confirmPassword, currentPassword, doPasswordsMatch, isPasswordValid, isSameAsCurrent, newPassword, touched]);

  const handleChangePassword = async () => {
    if (submitInFlight.current) return;
    const nextErrors = {
      current: validateCurrentPassword(currentPassword),
      new: !newPassword
        ? 'New password is required'
        : !isPasswordValid
          ? validateStrongPassword(newPassword, { requiredMessage: 'New password is required' }).error
          : isSameAsCurrent
            ? 'Your new password must be different from your current password.'
            : '',
      confirm: !confirmPassword
        ? 'Please confirm your new password'
        : /\s/.test(confirmPassword)
          ? PASSWORD_WHITESPACE_MESSAGE
        : !doPasswordsMatch
          ? 'Passwords do not match'
          : '',
    };

    setTouched({ current: true, new: true, confirm: true });
    setErrors(nextErrors);

    if (nextErrors.current || nextErrors.new || nextErrors.confirm) {
      return;
    }
    
    submitInFlight.current = true;
    setIsLoading(true);
    try {
      await apiService.changePassword(currentPassword, newPassword, {
        notifyApp: true,
        notifyEmail: true,
      });

      // Clear pending and retired local-auth state since the password changed.
      // Isolated: a Keychain/SecureStore failure must not surface as a "change password failed" error.
      try {
        await clearCredentials();
      } catch (credError) {
        console.warn('[ChangePassword] clearCredentials failed:', credError);
      }

      // Show premium styled alert then force re-login
      showAlert({
        title: 'Password Changed Successfully',
        message: 'Your password has been updated. For your security, you will be signed out and need to log in again with your new password.\n\nA confirmation email has also been sent to your registered address.',
        type: 'success',
        buttons: [{
          text: 'Sign In Again',
          onPress: async () => {
            try {
              await logout();
            } catch (logoutError) {
              console.warn('[ChangePassword] logout failed (session may already be expired):', logoutError);
            }
            router.replace('/login');
          },
        }],
      });
    } catch (error) {
      const { type, message } = classifyChangePasswordError(error);
      showAlert({
        title: type === 'validation' ? 'Validation Error' : 'Error',
        message,
        type: type === 'validation' ? 'warning' : 'error',
      });
    } finally {
      submitInFlight.current = false;
      setIsLoading(false);
    }
  };

  const handlePasswordFieldChange = (field, value) => {
    if (field === 'current') {
      setCurrentPassword(value);
      return;
    }
    const currentValue = field === 'current' ? currentPassword : field === 'new' ? newPassword : confirmPassword;
    const { value: nextValue, blocked } = blockPasswordWhitespaceInput(value, currentValue);

    if (blocked) {
      setTouched((prev) => ({ ...prev, [field]: true }));
      setErrors((prev) => ({ ...prev, [field]: PASSWORD_WHITESPACE_MESSAGE }));
      return;
    }

    if (field === 'new') setNewPassword(nextValue);
    if (field === 'confirm') setConfirmPassword(nextValue);
  };

  const styles = createStyles(colors);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader strong title="Change Password" subtitle="Secure your Lilycrest account" onBack={() => safeBack(router, '/login')} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.iconContainer}>
            <Ionicons name="lock-closed" size={40} color="#0A1628" />
          </View>
          
          <Text style={styles.title}>Update Your Password</Text>
          <Text style={styles.subtitle}>For security, please enter your current password before setting a new one.</Text>

          {/* Current Password */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Current Password</Text>
            <View style={[styles.inputWrapper, errors.current && styles.inputError]}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Enter current password"
                placeholderTextColor={colors.textMuted}
                value={currentPassword}
                onChangeText={(value) => handlePasswordFieldChange('current', value)}
                onBlur={() => setTouched((prev) => ({ ...prev, current: true }))}
                secureTextEntry={!showCurrentPassword}
              />
              <TouchableOpacity onPress={() => setShowCurrentPassword(!showCurrentPassword)}>
                <Ionicons name={showCurrentPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {errors.current && <Text style={styles.errorText}>{errors.current}</Text>}
          </View>

          {/* New Password */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>New Password</Text>
            <View style={[styles.inputWrapper, errors.new && styles.inputError]}>
              <Ionicons name="lock-open-outline" size={20} color={colors.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Enter new password"
                placeholderTextColor={colors.textMuted}
                value={newPassword}
                onChangeText={(value) => handlePasswordFieldChange('new', value)}
                onBlur={() => setTouched((prev) => ({ ...prev, new: true }))}
                secureTextEntry={!showNewPassword}
                maxLength={NEW_PASSWORD_MAX_LENGTH}
              />
              <TouchableOpacity onPress={() => setShowNewPassword(!showNewPassword)}>
                <Ionicons name={showNewPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {errors.new && <Text style={styles.errorText}>{errors.new}</Text>}
            
            {/* Password Requirements */}
            <View style={styles.requirementsContainer}>
              <View style={styles.requirementRow}>
                <Ionicons name={passwordChecks.length ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={passwordChecks.length ? '#059669' : colors.textMuted} />
                <Text style={[styles.requirementText, passwordChecks.length && styles.requirementMet]}>At least 8 characters</Text>
              </View>
              <View style={styles.requirementRow}>
                <Ionicons name={passwordChecks.uppercase ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={passwordChecks.uppercase ? '#059669' : colors.textMuted} />
                <Text style={[styles.requirementText, passwordChecks.uppercase && styles.requirementMet]}>One uppercase letter</Text>
              </View>
              <View style={styles.requirementRow}>
                <Ionicons name={passwordChecks.lowercase ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={passwordChecks.lowercase ? '#059669' : colors.textMuted} />
                <Text style={[styles.requirementText, passwordChecks.lowercase && styles.requirementMet]}>One lowercase letter</Text>
              </View>
              <View style={styles.requirementRow}>
                <Ionicons name={passwordChecks.number ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={passwordChecks.number ? '#059669' : colors.textMuted} />
                <Text style={[styles.requirementText, passwordChecks.number && styles.requirementMet]}>One number</Text>
              </View>
              <View style={styles.requirementRow}>
                <Ionicons name={passwordChecks.special ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={passwordChecks.special ? '#059669' : colors.textMuted} />
                <Text style={[styles.requirementText, passwordChecks.special && styles.requirementMet]}>One special character (!@#$%^&*...)</Text>
              </View>
            </View>
          </View>

          {/* Confirm Password */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Confirm New Password</Text>
            <View style={[styles.inputWrapper, errors.confirm && styles.inputError]}>
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Confirm new password"
                placeholderTextColor={colors.textMuted}
                value={confirmPassword}
                onChangeText={(value) => handlePasswordFieldChange('confirm', value)}
                onBlur={() => setTouched((prev) => ({ ...prev, confirm: true }))}
                secureTextEntry={!showConfirmPassword}
                maxLength={NEW_PASSWORD_MAX_LENGTH}
              />
              <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {errors.confirm && <Text style={styles.errorText}>{errors.confirm}</Text>}
            {confirmPassword && doPasswordsMatch && !errors.confirm && (
              <View style={styles.matchIndicator}>
                <Ionicons name="checkmark-circle" size={16} color="#059669" />
                <Text style={styles.matchText}>Passwords match</Text>
              </View>
            )}
          </View>

          <TouchableOpacity 
            style={[styles.updateButton, (!canSubmit || isLoading) && styles.updateButtonDisabled]} 
            onPress={handleChangePassword}
            disabled={isLoading || !canSubmit}
          >
            {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.updateButtonText}>Update Password</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 24 },
  iconContainer: { width: 80, height: 80, borderRadius: 12, backgroundColor: colors.accentSubtle, justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 24, borderWidth: 1, borderColor: colors.accentLight },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 32 },
  inputContainer: { marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.inputBg, paddingHorizontal: 16, gap: 12 },
  inputError: { borderColor: '#DC2626' },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: colors.text },
  errorText: { fontSize: 12, color: '#DC2626', marginTop: 6 },
  requirementsContainer: { marginTop: 12, gap: 6 },
  requirementRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  requirementText: { fontSize: 13, color: colors.textMuted },
  requirementMet: { color: '#059669' },
  matchIndicator: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 },
  matchText: { fontSize: 13, color: '#059669' },
  updateButton: { backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 8, alignItems: 'center', marginTop: 16 },
  updateButtonDisabled: { backgroundColor: colors.textMuted },
  updateButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
