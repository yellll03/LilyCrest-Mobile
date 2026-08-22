// Behavioral test for AuthContext.signInWithGoogle's connect-failure retry
// (Phase 5.8A): renders the real AuthProvider with its external
// dependencies mocked, then drives signInWithGoogle through a connection-
// level failure followed by success, and separately through a real 4xx
// response. Verifies the retry fires only for connection failures (no
// error.response) and never for a response the server actually sent.

import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';
import { ToastProvider } from '../context/ToastContext';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/(tabs)/home',
}));

jest.mock('../config/firebase', () => ({
  auth: { signOut: jest.fn().mockResolvedValue() },
  getFreshIdToken: jest.fn().mockResolvedValue(null),
  subscribeToAuthState: (cb) => {
    cb(null);
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
  getStoredPushToken: jest.fn().mockResolvedValue(null),
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
  getSessionToken: jest.fn().mockResolvedValue(null),
  migrateLegacyCredentials: jest.fn().mockResolvedValue(),
  removeSessionToken: jest.fn().mockResolvedValue(),
  setSessionToken: jest.fn().mockResolvedValue(),
}));

const mockPost = jest.fn();
jest.mock('../services/api', () => ({
  api: {
    get: jest.fn((url) => {
      if (url === '/users/me') {
        return Promise.resolve({ data: { user_id: 'tenant-a', name: 'Tenant A', email: 'a@example.com', role: 'tenant' } });
      }
      return Promise.resolve({ data: {} });
    }),
    post: (...args) => mockPost(...args),
    patch: jest.fn().mockResolvedValue({ data: {} }),
  },
  getApiErrorMessage: (error, fallback) => fallback,
  getConfirmedSessionInvalidation: jest.fn(() => null),
  teardownExpiredSession: jest.fn().mockResolvedValue(true),
}));

function connectionTimeoutError() {
  // Mirrors what axios produces for a connect-level timeout: no
  // `response` was ever received.
  const error = new Error('timeout of 15000ms exceeded');
  error.code = 'ECONNABORTED';
  return error;
}

function serverRejectionError(status, detail) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status, data: { detail } };
  return error;
}

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

describe('AuthContext.signInWithGoogle connect-failure retry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPost.mockReset();
  });

  it('retries once after a connection-level failure and succeeds on the second attempt', async () => {
    mockPost
      .mockRejectedValueOnce(connectionTimeoutError())
      .mockResolvedValueOnce({
        data: {
          user: { user_id: 'tenant-a', role: 'tenant' },
          session_token: 'session_retry_success',
          refresh_token: 'refresh_retry_success',
          expires_at: '2026-08-29T00:00:00.000Z',
          refresh_expires_at: '2026-08-29T00:00:00.000Z',
        },
      });

    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.authReady).toBe(true));

    let result;
    await act(async () => {
      result = await latest.signInWithGoogle('firebase-id-token');
    });

    expect(result).toEqual({ success: true });
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost).toHaveBeenNthCalledWith(1, '/auth/google', { idToken: 'firebase-id-token' });
    expect(mockPost).toHaveBeenNthCalledWith(2, '/auth/google', { idToken: 'firebase-id-token' });
    const { setSessionToken } = require('../services/secureCredentials');
    expect(setSessionToken).toHaveBeenCalledWith('session_retry_success', {
      refreshToken: 'refresh_retry_success',
      expiresAt: '2026-08-29T00:00:00.000Z',
      refreshExpiresAt: '2026-08-29T00:00:00.000Z',
    });
  });

  it('does not retry when the server actually responded (e.g. 403)', async () => {
    mockPost.mockRejectedValueOnce(serverRejectionError(403, 'Access denied. Your account is not registered as an active tenant.'));

    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.authReady).toBe(true));

    let result;
    await act(async () => {
      result = await latest.signInWithGoogle('firebase-id-token');
    });

    expect(result).toEqual({
      success: false,
      error: 'Access denied. Your account is not registered as an active tenant.',
    });
    // A real server response must never trigger the connect-failure retry.
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('surfaces failure when both the original attempt and the retry hit connection failures', async () => {
    mockPost
      .mockRejectedValueOnce(connectionTimeoutError())
      .mockRejectedValueOnce(connectionTimeoutError());

    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.authReady).toBe(true));

    let result;
    await act(async () => {
      result = await latest.signInWithGoogle('firebase-id-token');
    });

    expect(result.success).toBe(false);
    // Exactly one retry — never a second, unbounded retry loop.
    expect(mockPost).toHaveBeenCalledTimes(2);
  });
});
