import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../src/context/AuthContext';
import { useTheme } from '../src/context/ThemeContext';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { processSessionId } = useAuth();
  const { colors } = useTheme();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const sessionId = params.session_id;
        if (sessionId) {
          const success = await processSessionId(sessionId);
          if (success) {
            router.replace('/(tabs)/home');
          } else {
            router.replace('/login');
          }
        } else {
          router.replace('/login');
        }
      } catch (error) {
        console.error('Auth callback error:', error);
        router.replace('/login');
      }
    };
    handleCallback();
  }, [params.session_id]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.text}>Signing you in...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF' },
  text: { marginTop: 16, fontSize: 16, color: '#6B7280' },
});
