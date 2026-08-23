import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AlertProvider } from '../src/context/AlertContext';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { ThemeProvider, useTheme } from '../src/context/ThemeContext';
import { ToastProvider } from '../src/context/ToastContext';
import { clearDocumentCacheIfStaleBuild, evictStaleDocumentCache } from '../src/services/documentManager';
import {
  isAuthenticationPath,
  resetToHome,
  resetToLogin,
} from '../src/utils/navigation';

const IS_STAGING = process.env.EXPO_PUBLIC_DEPLOYMENT_ENV === 'staging';

SplashScreen.preventAutoHideAsync();

// When the app is opened through a deep link, Expo Router seeds the root stack
// with the authenticated tabs (whose initial route is Home) before presenting
// the linked screen. This gives a validated deep link a deterministic Back
// destination instead of making Login/onboarding its accidental parent.
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

const PUBLIC_ROUTE_PREFIXES = [
  '/',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/otp-verify',
  '/auth-callback',
  '/about',
  '/privacy-policy',
  '/terms-of-service',
  '/house-rules',
  '/debug',
];

function isProtectedPath(pathname = '/') {
  if (!pathname || pathname === '/') return false;
  return !PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

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
  const { authReady, authStatus } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  // An anchored Home tab can have the collapsed pathname "/". Its group
  // segment still marks it as authenticated application content.
  const protectedPath = isProtectedPath(pathname) || segments.includes('(tabs)');
  const preLoginEntryPath = pathname === '/' && !segments.includes('(tabs)');
  const authenticatedAuthPath = authStatus === 'authenticated' && isAuthenticationPath(pathname, segments);
  const unauthenticatedProtectedPath = authStatus === 'unauthenticated' && protectedPath;

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync().catch(() => {});
  }, [isLoading]);

  useEffect(() => {
    clearDocumentCacheIfStaleBuild()
      .then(() => evictStaleDocumentCache())
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (authenticatedAuthPath) {
      resetToHome(router);
      return;
    }
    if (unauthenticatedProtectedPath) {
      resetToLogin(router);
    }
  }, [authReady, authenticatedAuthPath, router, unauthenticatedProtectedPath]);

  if (isLoading || (!authReady && !preLoginEntryPath) || authenticatedAuthPath || unauthenticatedProtectedPath) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} backgroundColor={colors.headerBg} />
      {IS_STAGING ? (
        <View style={{ backgroundColor: '#B91C1C', paddingVertical: 4, alignItems: 'center' }}>
          <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }}>
            STAGING · SYNTHETIC QA DATA ONLY
          </Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
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
          <Stack.Screen name="reset-password" />
          <Stack.Screen name="change-password" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="auth-callback" />
          <Stack.Screen name="otp-verify" />
          <Stack.Screen name="documents" options={{ presentation: 'modal' }} />
          <Stack.Screen name="my-documents" />
          <Stack.Screen name="surveys" />
          <Stack.Screen name="survey-form" />
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
          <Stack.Screen name="debug/api-health" />
        </Stack>
      </View>
    </View>
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
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 24 }}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#0A1628', marginBottom: 8 }}>Something went wrong</Text>
          <Text style={{ fontSize: 14, color: '#4B5563', textAlign: 'center', marginBottom: 20 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <Text
            style={{ fontSize: 15, fontWeight: '600', color: '#0A1628' }}
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
            <ToastProvider>
              <AuthProvider>
                <LayoutContent />
              </AuthProvider>
            </ToastProvider>
          </AlertProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
