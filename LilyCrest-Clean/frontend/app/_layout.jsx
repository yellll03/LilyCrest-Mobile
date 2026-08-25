import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
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

function StartupOverlay({ onFinish }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spinAnimation = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    // This overlay only ever mounts once real readiness (auth restoration +
    // theme) is already true — see LayoutContent's startupReady gate below,
    // which renders a blank placeholder (not this component) until then. So
    // there is nothing left to wait for here: the fade is a brief branded
    // handoff, not an artificial hold. Previously this also carried a fixed
    // 700ms Animated.delay before the fade even started, adding a flat
    // ~950ms floor to every launch regardless of how fast startup actually
    // was.
    const exitAnimation = Animated.timing(opacity, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });

    spinAnimation.start();
    exitAnimation.start(({ finished }) => {
      spinAnimation.stop();
      if (finished) onFinish(true);
    });

    return () => {
      spinAnimation.stop();
      exitAnimation.stop();
    };
  }, [onFinish, opacity, rotation]);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      accessibilityViewIsModal
      style={[startupStyles.overlay, { opacity }]}
      testID="startup-loading-overlay"
    >
      <StatusBar style="light" backgroundColor="#000000" />
      <Image
        source={require('../assets/images/splash-image.png')}
        style={startupStyles.logo}
        resizeMode="contain"
        accessibilityLabel="LilyCrest Residences"
      />
      <Animated.View
        accessibilityLabel="Loading LilyCrest"
        accessibilityRole="progressbar"
        style={[startupStyles.spinner, { transform: [{ rotate: spin }] }]}
      />
    </Animated.View>
  );
}

const startupStyles = StyleSheet.create({
  placeholder: {
    flex: 1,
    backgroundColor: '#000000',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    // Keep the branded handoff above application content while session
    // restoration finishes.
    zIndex: 3000,
    elevation: 3000,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  logo: {
    width: 200,
    height: 200,
  },
  spinner: {
    width: 28,
    height: 28,
    marginTop: 22,
    borderWidth: 2.5,
    borderRadius: 14,
    borderColor: 'rgba(212, 175, 55, 0.25)',
    borderTopColor: '#D4AF37',
  },
});

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
  const [startupComplete, setStartupComplete] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  // An anchored Home tab can have the collapsed pathname "/". Its group
  // segment still marks it as authenticated application content.
  const protectedPath = isProtectedPath(pathname) || segments.includes('(tabs)');
  const authenticatedAuthPath = authStatus === 'authenticated' && isAuthenticationPath(pathname, segments);
  const unauthenticatedProtectedPath = authStatus === 'unauthenticated' && protectedPath;
  const redirectPending = authenticatedAuthPath || unauthenticatedProtectedPath;
  const startupReady = !isLoading && authReady && !redirectPending;

  useEffect(() => {
    if (startupReady && !startupComplete) SplashScreen.hideAsync().catch(() => {});
  }, [startupComplete, startupReady]);

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

  if (!startupReady && !startupComplete) {
    return <View style={startupStyles.placeholder} />;
  }

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
        <Stack.Screen name="outstanding-balance" />
        <Stack.Screen name="bill-details" />
        <Stack.Screen name="payment" />
        <Stack.Screen name="payment-success" />
        <Stack.Screen name="payment-cancel" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="about" />
        <Stack.Screen name="privacy-policy" />
        <Stack.Screen name="terms-of-service" />
        <Stack.Screen name="debug/api-health" />
      </Stack>
      {!startupComplete ? <StartupOverlay onFinish={setStartupComplete} /> : null}
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
        <ErrorFallback
          error={this.state.error}
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      );
    }
    return this.props.children;
  }
}

function ErrorFallback({ error, onRetry }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, padding: 24 }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.heading, marginBottom: 8 }}>Something went wrong</Text>
      <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 20 }}>
        {error?.message || 'An unexpected error occurred.'}
      </Text>
      <Text style={{ fontSize: 15, fontWeight: '600', color: colors.interactive }} onPress={onRetry}>
        Tap to Retry
      </Text>
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <ErrorBoundary>
          <AlertProvider>
            <ToastProvider>
              <AuthProvider>
                <LayoutContent />
              </AuthProvider>
            </ToastProvider>
          </AlertProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
