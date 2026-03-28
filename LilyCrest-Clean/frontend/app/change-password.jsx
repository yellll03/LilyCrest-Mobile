import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/context/AuthContext';
import { useTheme } from '../src/context/ThemeContext';
import { apiService } from '../src/services/api';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { colors, isDarkMode } = useTheme();
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const validatePassword = (password) => {
    const checks = {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
    };
    return checks;
  };

  const passwordChecks = validatePassword(newPassword);
  const isPasswordValid = Object.values(passwordChecks).every(Boolean);

  const handleChangePassword = async () => {
    setErrors({});
    
    if (!currentPassword) {
      setErrors(prev => ({ ...prev, current: 'Current password is required' }));
      return;
    }
    if (!isPasswordValid) {
      setErrors(prev => ({ ...prev, new: 'Password does not meet requirements' }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrors(prev => ({ ...prev, confirm: 'Passwords do not match' }));
      return;
    }
    
    setIsLoading(true);
    try {
      await apiService.changePassword(currentPassword, newPassword, {
        notifyApp: true,
        notifyEmail: true,
      });
      
      Alert.alert(
        'Password Changed',
        'Your password has been updated successfully.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (error) {
      const message = error.response?.data?.detail || 'Failed to change password. Please try again.';
      Alert.alert('Error', message);
    } finally {
      setIsLoading(false);
    }
  };

  const styles = createStyles(colors, isDarkMode);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Change Password</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.iconContainer}>
            <Ionicons name="lock-closed" size={40} color="#D4682A" />
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
                onChangeText={setCurrentPassword}
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
                onChangeText={setNewPassword}
                secureTextEntry={!showNewPassword}
              />
              <TouchableOpacity onPress={() => setShowNewPassword(!showNewPassword)}>
                <Ionicons name={showNewPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {errors.new && <Text style={styles.errorText}>{errors.new}</Text>}
            
            {/* Password Requirements */}
            <View style={styles.requirementsContainer}>
              <View style={styles.requirementRow}>
                <Ionicons name={passwordChecks.length ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={passwordChecks.length ? '#22C55E' : colors.textMuted} />
                <Text style={[styles.requirementText, passwordChecks.length && styles.requirementMet]}>At least 8 characters</Text>
              </View>
              <View style={styles.requirementRow}>
                <Ionicons name={passwordChecks.uppercase ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={passwordChecks.uppercase ? '#22C55E' : colors.textMuted} />
                <Text style={[styles.requirementText, passwordChecks.uppercase && styles.requirementMet]}>One uppercase letter</Text>
              </View>
              <View style={styles.requirementRow}>
                <Ionicons name={passwordChecks.lowercase ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={passwordChecks.lowercase ? '#22C55E' : colors.textMuted} />
                <Text style={[styles.requirementText, passwordChecks.lowercase && styles.requirementMet]}>One lowercase letter</Text>
              </View>
              <View style={styles.requirementRow}>
                <Ionicons name={passwordChecks.number ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={passwordChecks.number ? '#22C55E' : colors.textMuted} />
                <Text style={[styles.requirementText, passwordChecks.number && styles.requirementMet]}>One number</Text>
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
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
              />
              <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {errors.confirm && <Text style={styles.errorText}>{errors.confirm}</Text>}
            {confirmPassword && newPassword === confirmPassword && (
              <View style={styles.matchIndicator}>
                <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
                <Text style={styles.matchText}>Passwords match</Text>
              </View>
            )}
          </View>

          <TouchableOpacity 
            style={[styles.updateButton, (!isPasswordValid || newPassword !== confirmPassword || !currentPassword) && styles.updateButtonDisabled]} 
            onPress={handleChangePassword}
            disabled={isLoading || !isPasswordValid || newPassword !== confirmPassword || !currentPassword}
          >
            {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.updateButtonText}>Update Password</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  backButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 24 },
  iconContainer: { width: 80, height: 80, borderRadius: 24, backgroundColor: isDarkMode ? 'rgba(212,148,42,0.2)' : '#FDF6EC', justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 24 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 32 },
  inputContainer: { marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.inputBg, paddingHorizontal: 16, gap: 12 },
  inputError: { borderColor: '#EF4444' },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: colors.text },
  errorText: { fontSize: 12, color: '#EF4444', marginTop: 6 },
  requirementsContainer: { marginTop: 12, gap: 6 },
  requirementRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  requirementText: { fontSize: 13, color: colors.textMuted },
  requirementMet: { color: '#22C55E' },
  matchIndicator: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 },
  matchText: { fontSize: 13, color: '#22C55E' },
  updateButton: { backgroundColor: colors.accent, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  updateButtonDisabled: { backgroundColor: colors.textMuted },
  updateButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
