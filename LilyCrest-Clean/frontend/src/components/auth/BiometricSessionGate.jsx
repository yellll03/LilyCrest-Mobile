import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { hasStoredCredentials } from '../../services/secureCredentials';
import {
  BIOMETRIC_ACCESS_STATE,
  classifyBiometricCapability,
  classifyBiometricResult,
  shouldBypassBiometricGate,
} from '../../utils/biometricAccess';
import { resetToLogin } from '../../utils/navigation';

const COPY = {
  [BIOMETRIC_ACCESS_STATE.CHECKING]: {
    title: 'Securing your session',
    message: 'Checking Face ID protection for this authorized session.',
  },
  [BIOMETRIC_ACCESS_STATE.LOCKED]: {
    title: 'LilyCrest is locked',
    message: 'Use Face ID to reopen your authorized LilyCrest session.',
  },
  [BIOMETRIC_ACCESS_STATE.PROMPTING]: {
    title: 'Waiting for Face ID',
    message: 'Complete the Face ID prompt to unlock LilyCrest.',
  },
  [BIOMETRIC_ACCESS_STATE.CANCELLED]: {
    title: 'Face ID was cancelled',
    message: 'Your LilyCrest session is still protected. Retry Face ID or sign in another way.',
  },
  [BIOMETRIC_ACCESS_STATE.FAILED]: {
    title: 'Face ID did not match',
    message: 'Your session remains locked. Try again or use your email or Google account.',
  },
  [BIOMETRIC_ACCESS_STATE.LOCKED_OUT]: {
    title: 'Face ID is temporarily locked',
    message: 'Use your normal LilyCrest sign-in while Face ID is unavailable.',
  },
  [BIOMETRIC_ACCESS_STATE.UNSUPPORTED]: {
    title: 'Face ID is unavailable',
    message: 'This device cannot use Face ID right now. Continue with email or Google sign-in.',
  },
  [BIOMETRIC_ACCESS_STATE.UNENROLLED]: {
    title: 'Face ID is not enrolled',
    message: 'Set up Face ID in iOS Settings, or continue with normal LilyCrest sign-in.',
  },
  [BIOMETRIC_ACCESS_STATE.INVALIDATED]: {
    title: 'Face ID protection changed',
    message: 'Your protected local access state is no longer valid. Please sign in again.',
  },
};

export default function BiometricSessionGate() {
  const { authReady, authStatus, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [accessState, setAccessState] = useState(BIOMETRIC_ACCESS_STATE.CHECKING);
  const [appState, setAppState] = useState(AppState.currentState);
  const firstTerminalAuthState = useRef(null);
  const autoPrompted = useRef(false);
  const lockOnActive = useRef(false);
  const authStatusRef = useRef(authStatus);
  authStatusRef.current = authStatus;

  const assessProtection = useCallback(async () => {
    try {
      const enabledForSession = await hasStoredCredentials();
      if (!enabledForSession) {
        setAccessState(BIOMETRIC_ACCESS_STATE.NOT_REQUIRED);
        return BIOMETRIC_ACCESS_STATE.NOT_REQUIRED;
      }

      const [hasHardware, isEnrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      const next = classifyBiometricCapability({ hasHardware, isEnrolled });
      setAccessState(next);
      return next;
    } catch (_error) {
      setAccessState(BIOMETRIC_ACCESS_STATE.INVALIDATED);
      return BIOMETRIC_ACCESS_STATE.INVALIDATED;
    }
  }, []);

  const requestUnlock = useCallback(async () => {
    if (accessState === BIOMETRIC_ACCESS_STATE.PROMPTING) return;

    try {
      const [hasHardware, isEnrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      const capability = classifyBiometricCapability({ hasHardware, isEnrolled });
      if (capability !== BIOMETRIC_ACCESS_STATE.LOCKED) {
        setAccessState(capability);
        return;
      }

      setAccessState(BIOMETRIC_ACCESS_STATE.PROMPTING);
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock LilyCrest',
        cancelLabel: 'Use another sign-in method',
        disableDeviceFallback: true,
      });
      setAccessState(classifyBiometricResult(result));
    } catch (_error) {
      setAccessState(BIOMETRIC_ACCESS_STATE.FAILED);
    }
  }, [accessState]);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      setAccessState(BIOMETRIC_ACCESS_STATE.NOT_REQUIRED);
      return;
    }
    if (!authReady || !['authenticated', 'unauthenticated'].includes(authStatus)) return;

    if (!firstTerminalAuthState.current) {
      firstTerminalAuthState.current = authStatus;
      if (authStatus === 'authenticated') {
        assessProtection();
      } else {
        setAccessState(BIOMETRIC_ACCESS_STATE.NOT_REQUIRED);
      }
      return;
    }

    if (authStatus === 'unauthenticated') {
      setAccessState(BIOMETRIC_ACCESS_STATE.NOT_REQUIRED);
      autoPrompted.current = false;
    }
    // A transition from unauthenticated -> authenticated is a fresh, explicit
    // login in this process. Keep it unlocked; backgrounding or a future cold
    // launch will apply the biometric gate if the tenant enabled it.
  }, [assessProtection, authReady, authStatus]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
      if (nextState === 'background' && authStatusRef.current === 'authenticated') {
        hasStoredCredentials().then((enabled) => {
          if (!enabled || authStatusRef.current !== 'authenticated') return;
          lockOnActive.current = true;
          autoPrompted.current = false;
          if (AppState.currentState === 'active') {
            lockOnActive.current = false;
            setAccessState(BIOMETRIC_ACCESS_STATE.LOCKED);
          }
        }).catch(() => {});
      }
      if (nextState === 'active' && lockOnActive.current && authStatusRef.current === 'authenticated') {
        lockOnActive.current = false;
        setAccessState(BIOMETRIC_ACCESS_STATE.LOCKED);
      }
    });
    return () => subscription.remove();
  }, []);

  const bypass = shouldBypassBiometricGate(pathname);
  useEffect(() => {
    if (bypass || appState !== 'active' || accessState !== BIOMETRIC_ACCESS_STATE.LOCKED || autoPrompted.current) return;
    autoPrompted.current = true;
    requestUnlock();
  }, [accessState, appState, bypass, requestUnlock]);

  if (Platform.OS !== 'ios'
    || authStatus !== 'authenticated'
    || bypass
    || [BIOMETRIC_ACCESS_STATE.NOT_REQUIRED, BIOMETRIC_ACCESS_STATE.UNLOCKED].includes(accessState)) {
    return null;
  }

  const content = COPY[accessState] || COPY[BIOMETRIC_ACCESS_STATE.INVALIDATED];
  const waiting = [BIOMETRIC_ACCESS_STATE.CHECKING, BIOMETRIC_ACCESS_STATE.PROMPTING].includes(accessState);
  const retryable = !waiting && ![BIOMETRIC_ACCESS_STATE.LOCKED_OUT, BIOMETRIC_ACCESS_STATE.UNSUPPORTED].includes(accessState);

  return (
    <View accessibilityViewIsModal style={styles.overlay} testID="biometric-session-gate">
      <View style={styles.iconWrap}>
        <Ionicons name="scan-outline" size={46} color="#D4AF37" />
      </View>
      <Text style={styles.title}>{content.title}</Text>
      <Text style={styles.message}>{content.message}</Text>
      {waiting ? <ActivityIndicator color="#D4AF37" size="large" style={styles.spinner} /> : null}
      {retryable ? (
        <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={requestUnlock}>
          <Text style={styles.primaryText}>Try Face ID</Text>
        </Pressable>
      ) : null}
      {!waiting ? (
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={async () => {
            await logout();
            resetToLogin(router);
          }}
        >
          <Text style={styles.secondaryText}>Use Email or Google</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2000,
    elevation: 2000,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#0A1628',
  },
  iconWrap: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(212,175,55,0.55)',
    backgroundColor: 'rgba(212,175,55,0.10)',
    marginBottom: 24,
  },
  title: { color: '#FFFFFF', fontSize: 25, fontWeight: '700', textAlign: 'center' },
  message: { color: '#CBD5E1', fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 10, maxWidth: 360 },
  spinner: { marginTop: 28 },
  primaryButton: { width: '100%', maxWidth: 360, marginTop: 28, paddingVertical: 15, borderRadius: 12, alignItems: 'center', backgroundColor: '#D4AF37' },
  primaryText: { color: '#0A1628', fontSize: 16, fontWeight: '700' },
  secondaryButton: { width: '100%', maxWidth: 360, marginTop: 12, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#64748B' },
  secondaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
