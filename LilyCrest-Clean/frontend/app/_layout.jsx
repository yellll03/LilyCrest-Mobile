import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AlertProvider } from '../src/context/AlertContext';
import { AuthProvider } from '../src/context/AuthContext';
import { ThemeProvider, useTheme } from '../src/context/ThemeContext';

SplashScreen.preventAutoHideAsync();

// ── Global font defaults ──
// Sets a formal, clean font and slightly bigger base size across the entire app
const globalFontFamily = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: '"Inter", "Segoe UI", "Roboto", "Helvetica Neue", sans-serif',
  default: 'System',
});

// Apply font family globally (no fontSize override — components set their own)
if (Text.defaultProps == null) Text.defaultProps = {};
Text.defaultProps.style = {
  ...(Text.defaultProps.style || {}),
  fontFamily: globalFontFamily,
};

if (TextInput.defaultProps == null) TextInput.defaultProps = {};
TextInput.defaultProps.style = {
  ...(TextInput.defaultProps.style || {}),
  fontFamily: globalFontFamily,
};

function LayoutContent() {
  const { isDarkMode, colors, isLoading } = useTheme();

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync();
  }, [isLoading]);

  if (isLoading) return null;

  return (
    <>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} backgroundColor={colors.headerBg} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="change-password" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="auth-callback" />
        <Stack.Screen name="documents" options={{ presentation: 'modal' }} />
        <Stack.Screen name="my-documents" />
        <Stack.Screen name="house-rules" />
        <Stack.Screen name="billing-history" />
        <Stack.Screen name="bill-details" />
        <Stack.Screen name="payment" />
        <Stack.Screen name="payment-success" />
        <Stack.Screen name="payment-cancel" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="about" />
        <Stack.Screen name="privacy-policy" />
        <Stack.Screen name="terms-of-service" />
      </Stack>
    </>
  );
}

// Error boundary — prevents white-screen crashes
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: 24 }}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#1E3A5F', marginBottom: 8 }}>Something went wrong</Text>
          <Text style={{ fontSize: 14, color: '#6B7280', textAlign: 'center', marginBottom: 20 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <Text
            style={{ fontSize: 15, fontWeight: '600', color: '#D4682A' }}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            Tap to Retry
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <ThemeProvider>
          <AlertProvider>
            <AuthProvider>
              <LayoutContent />
            </AuthProvider>
          </AlertProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

