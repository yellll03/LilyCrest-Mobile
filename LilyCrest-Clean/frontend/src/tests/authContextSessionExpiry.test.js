// Behavioral test for AuthContext's forced-session-expiry cleanup: renders the
// real AuthProvider (wrapped in the real ToastProvider) with its external
// dependencies mocked, then drives it through the real sessionEvents pub/sub —
// not source-text grepping. Verifies the synchronous dedup guard and cleanup
// parity described in the pre-Phase-3 hardening pass.

import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';
import { ToastProvider } from '../context/ToastContext';
import { emitSessionExpired } from '../services/sessionEvents';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/(tabs)/home',
}));

jest.mock('../config/firebase', () => ({
  auth: { signOut: jest.fn().mockResolvedValue() },
  getFreshIdToken: jest.fn().mockResolvedValue(null),
  subscribeToAuthState: (cb) => {
    cb({ uid: 'firebase-uid' });
    return () => {};
  },
}));

jest.mock('../services/documentManager', () => ({
  clearDocumentCache: jest.fn().mockResolvedValue(),
}));

jest.mock('../services/notifications', () => ({
  arePushNotificationsEnabled: jest.fn().mockResolvedValue(false),
  clearLastNotificationResponse: jest.fn().mockResolvedValue(),
  getLastNotificationResponseData: jest.fn().mockResolvedValue(null),
  getStoredPushToken: jest.fn().mockResolvedValue('device-push-token-abc'),
  initializeNotificationHandler: jest.fn(),
  registerForPushNotifications: jest.fn().mockResolvedValue(null),
  requestPushPermissionOnFirstLaunch: jest.fn().mockResolvedValue(),
  resolveNotificationRoute: jest.fn(() => '/(tabs)/announcements'),
  savePushTokenToServer: jest.fn().mockResolvedValue(),
  setupNotificationListeners: jest.fn(() => () => {}),
  subscribeToPushTokenChanges: jest.fn(() => () => {}),
}));

jest.mock('../services/secureCredentials', () => ({
  clearCredentials: jest.fn().mockResolvedValue(),
  getSessionToken: jest.fn().mockResolvedValue('valid-session-token'),
  migrateLegacyCredentials: jest.fn().mockResolvedValue(),
  removeSessionToken: jest.fn().mockResolvedValue(),
  setSessionToken: jest.fn().mockResolvedValue(),
}));

jest.mock('../services/api', () => ({
  api: {
    get: jest.fn((url) => {
      if (url === '/users/me') {
        return Promise.resolve({ data: { user_id: 'tenant-a', name: 'Tenant A', email: 'a@example.com' } });
      }
      if (url === '/notifications') {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: {} });
    }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    patch: jest.fn().mockResolvedValue({ data: {} }),
  },
  getApiErrorMessage: (error, fallback) => fallback,
  getConfirmedSessionInvalidation: (error) => {
    const code = error?.response?.data?.code;
    if (code === 'ACCOUNT_INACTIVE') return 'account_inactive';
    if (code === 'SESSION_EXPIRED') return 'session_expired';
    if (code === 'SESSION_REVOKED') return 'session_invalid';
    return null;
  },
  teardownExpiredSession: jest.fn().mockResolvedValue(true),
}));

const { clearCredentials } = require('../services/secureCredentials');
const { clearDocumentCache } = require('../services/documentManager');
const { getStoredPushToken } = require('../services/notifications');
const { teardownExpiredSession } = require('../services/api');
const { auth } = require('../config/firebase');

function TestConsumer({ onRender }) {
  const authState = useAuth();
  onRender(authState);
  return <Text>{authState.authStatus}</Text>;
}

function renderAuth(onRender) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <TestConsumer onRender={onRender} />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe('AuthContext forced session-expiry cleanup (behavioral)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getStoredPushToken.mockResolvedValue('device-push-token-abc');
  });

  it('email/OTP login persists the same secure refreshable session shape as Google login', async () => {
    const { api } = require('../services/api');
    const { setSessionToken } = require('../services/secureCredentials');
    api.post.mockResolvedValueOnce({
      data: {
        user: { user_id: 'tenant-a', name: 'Tenant A', role: 'tenant' },
        session_token: 'otp-access-token',
        refresh_token: 'otp-refresh-token',
        expires_at: '2026-08-29T00:00:00.000Z',
        refresh_expires_at: '2026-08-29T00:00:00.000Z',
      },
    });

    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.authStatus).toBe('authenticated'));

    let result;
    await act(async () => {
      result = await latest.verifyLoginOtp('pending-otp-token', '123456');
    });

    expect(result).toEqual({ success: true });
    expect(setSessionToken).toHaveBeenCalledWith('otp-access-token', {
      refreshToken: 'otp-refresh-token',
      expiresAt: '2026-08-29T00:00:00.000Z',
      refreshExpiresAt: '2026-08-29T00:00:00.000Z',
    });
    expect(latest.authStatus).toBe('authenticated');
    expect(latest.sessionState).toBe('online');
  });

  it('a single forced expiry clears user, sets unauthenticated, and runs full cleanup parity', async () => {
    let latest;
    renderAuth((state) => { latest = state; });

    await waitFor(() => expect(latest.authStatus).toBe('authenticated'));
    expect(latest.user?.user_id).toBe('tenant-a');

    await act(async () => {
      emitSessionExpired('refresh_failed', { expiredToken: 'dead-token-xyz' });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(latest.authStatus).toBe('unauthenticated'));
    expect(latest.user).toBe(null);

    await waitFor(() => expect(clearCredentials).toHaveBeenCalledTimes(1));
    expect(clearDocumentCache).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(teardownExpiredSession).toHaveBeenCalledWith('dead-token-xyz', 'device-push-token-abc');
  });

  it('five near-simultaneous forced-expiry events run cleanup exactly once', async () => {
    let latest;
    renderAuth((state) => { latest = state; });

    await waitFor(() => expect(latest.authStatus).toBe('authenticated'));

    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        emitSessionExpired('refresh_failed', { expiredToken: `dead-token-${i}` });
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(latest.authStatus).toBe('unauthenticated'));

    await waitFor(() => expect(clearCredentials).toHaveBeenCalledTimes(1));
    expect(clearDocumentCache).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    // Assert the teardown call ran exactly once across all 5 near-simultaneous
    // expiry events, not zero or many.
    expect(teardownExpiredSession).toHaveBeenCalledTimes(1);
  });

  it('the dedup guard resets after a successful re-login, so a later genuine expiry is handled again (not permanently suppressed)', async () => {
    const { api } = require('../services/api');
    let latest;
    renderAuth((state) => { latest = state; });

    await waitFor(() => expect(latest.authStatus).toBe('authenticated'));

    await act(async () => {
      emitSessionExpired('refresh_failed', { expiredToken: 'dead-token-1' });
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(latest.authStatus).toBe('unauthenticated'));
    await waitFor(() => expect(clearCredentials).toHaveBeenCalledTimes(1));

    // Tenant logs back in successfully.
    api.post.mockResolvedValueOnce({
      data: {
        user: { user_id: 'tenant-a', name: 'Tenant A' },
        session_token: 'fresh-session-token',
        refresh_token: 'fresh-refresh-token',
        expires_at: '2026-08-29T00:00:00.000Z',
        refresh_expires_at: '2026-08-29T00:00:00.000Z',
      },
    });
    await act(async () => {
      await latest.login('a@example.com', 'correct-password');
    });
    await waitFor(() => expect(latest.authStatus).toBe('authenticated'));

    // A second, later genuine expiry must be handled again, not swallowed by a
    // stale "already handled" flag from the first expiry.
    await act(async () => {
      emitSessionExpired('refresh_failed', { expiredToken: 'dead-token-2' });
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(latest.authStatus).toBe('unauthenticated'));
    await waitFor(() => expect(clearCredentials).toHaveBeenCalledTimes(2));
    expect(teardownExpiredSession).toHaveBeenCalledTimes(2);
  });

  it('a forced-expiry event while already unauthenticated is a no-op (no duplicate cleanup)', async () => {
    let latest;
    const { getSessionToken } = require('../services/secureCredentials');
    getSessionToken.mockResolvedValueOnce(null);
    renderAuth((state) => { latest = state; });

    await waitFor(() => expect(latest.authStatus).toBe('unauthenticated'));

    await act(async () => {
      emitSessionExpired('refresh_failed', { expiredToken: 'irrelevant' });
      await Promise.resolve();
    });

    expect(clearCredentials).not.toHaveBeenCalled();
    expect(clearDocumentCache).not.toHaveBeenCalled();
    expect(teardownExpiredSession).not.toHaveBeenCalled();
  });
});
