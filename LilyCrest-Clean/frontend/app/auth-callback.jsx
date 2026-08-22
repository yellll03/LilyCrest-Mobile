import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../src/context/AuthContext';
import { useTheme } from '../src/context/ThemeContext';
import { resetToHome, resetToLogin } from '../src/utils/navigation';

// Legacy auth callback — redirects to login screen
// (Native Google Sign-In no longer uses web redirect)
export default function AuthCallbackScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { authStatus } = useAuth();

  useEffect(() => {
    if (authStatus === 'authenticated') {
      resetToHome(router);
    } else if (authStatus === 'unauthenticated') {
      resetToLogin(router);
    }
  }, [authStatus, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.text}>Redirecting...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF' },
  text: { marginTop: 16, fontSize: 16, color: '#6B7280' },
});
