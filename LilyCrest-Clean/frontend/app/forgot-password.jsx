import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../src/context/ThemeContext';
import { api } from '../src/services/api';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleResetPassword = async () => {
    setError('');
    setSuccess('');
    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }
    setIsLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim().toLowerCase() });
      setSent(true);
      setSuccess('If your email is registered, we just sent you a reset link.');
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.message;
      setError(detail || 'Unable to send reset email. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

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
                <View style={styles.inputWrapper}>
                  <Ionicons name="mail-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                  <TextInput style={styles.input} placeholder="Enter your email" placeholderTextColor="#9CA3AF" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
                </View>
              </View>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {success ? <Text style={styles.successText}>{success}</Text> : null}
              <TouchableOpacity style={styles.resetButton} onPress={handleResetPassword} disabled={isLoading}>
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
    errorText: { color: '#DC2626', fontSize: 14, marginBottom: 12, textAlign: 'center' },
    successText: { color: '#16A34A', fontSize: 14, marginBottom: 12, textAlign: 'center' },
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
  inputIcon: { marginRight: 12 },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: '#1F2937' },
  resetButton: { backgroundColor: '#1E3A5F', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginBottom: 16 },
  resetButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  backToLogin: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  backToLoginText: { color: '#D4682A', fontSize: 15, fontWeight: '600' },
});
