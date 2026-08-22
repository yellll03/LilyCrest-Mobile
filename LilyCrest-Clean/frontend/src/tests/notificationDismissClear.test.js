// Behavioral test for AuthContext's dismissNotification()/clearNotifications():
// renders the real AuthProvider (same pattern as authContextSessionExpiry.test.js)
// and drives it through the real hooks — not source-text grepping. Verifies the
// optimistic-update/rollback contract and unread-count reconciliation described
// in AuthContext.js's own comments for these two functions.

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

const FIXTURE_NOTIFICATIONS = [
  { notification_id: 'n1', title: 'Bill released', read: false },
  { notification_id: 'n2', title: 'Announcement: pool closed', read: true },
];

const mockDelete = jest.fn();

jest.mock('../services/api', () => ({
  api: {
    get: jest.fn((url) => {
      if (url === '/users/me') {
        return Promise.resolve({ data: { user_id: 'tenant-a', name: 'Tenant A', email: 'a@example.com' } });
      }
      if (url === '/notifications') {
        return Promise.resolve({ data: FIXTURE_NOTIFICATIONS });
      }
      return Promise.resolve({ data: {} });
    }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    patch: jest.fn().mockResolvedValue({ data: {} }),
    delete: (...args) => mockDelete(...args),
  },
  getApiErrorMessage: (error, fallback) => fallback,
  getConfirmedSessionInvalidation: jest.fn(() => null),
  teardownExpiredSession: jest.fn().mockResolvedValue(true),
}));

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

describe('AuthContext notification dismiss/clear', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDelete.mockReset();
    mockDelete.mockResolvedValue({ data: { status: 'dismissed' } });
  });

  it('dismissNotification removes only the targeted item and decrements unread count when it was unread', async () => {
    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.notifications).toHaveLength(2));
    expect(latest.notificationUnreadCount).toBe(1);

    await act(async () => {
      await latest.dismissNotification('n1');
    });

    expect(mockDelete).toHaveBeenCalledWith('/notifications/n1');
    await waitFor(() => expect(latest.notifications.map((n) => n.notification_id)).toEqual(['n2']));
    expect(latest.notificationUnreadCount).toBe(0);
  });

  it('dismissNotification does not touch unread count when the dismissed item was already read', async () => {
    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.notifications).toHaveLength(2));

    await act(async () => {
      await latest.dismissNotification('n2');
    });

    await waitFor(() => expect(latest.notifications.map((n) => n.notification_id)).toEqual(['n1']));
    expect(latest.notificationUnreadCount).toBe(1);
  });

  it('a failed dismiss request restores the item and unread count instead of leaving it silently gone', async () => {
    mockDelete.mockRejectedValueOnce(new Error('network error'));
    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.notifications).toHaveLength(2));

    await act(async () => {
      await latest.dismissNotification('n1');
    });

    await waitFor(() => expect(latest.notifications).toHaveLength(2));
    expect(latest.notificationUnreadCount).toBe(1);
  });

  it('dismissing an id not present in the current list is a no-op (no request sent)', async () => {
    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.notifications).toHaveLength(2));

    await act(async () => {
      await latest.dismissNotification('does-not-exist');
    });

    expect(mockDelete).not.toHaveBeenCalled();
    expect(latest.notifications).toHaveLength(2);
  });

  it('clearNotifications empties the list, zeroes unread count, and calls the canonical clear endpoint', async () => {
    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.notifications).toHaveLength(2));

    await act(async () => {
      await latest.clearNotifications();
    });

    expect(mockDelete).toHaveBeenCalledWith('/notifications');
    await waitFor(() => expect(latest.notifications).toHaveLength(0));
    expect(latest.notificationUnreadCount).toBe(0);
  });

  it('a failed clear request restores the previous list and unread count', async () => {
    mockDelete.mockRejectedValueOnce(new Error('network error'));
    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.notifications).toHaveLength(2));

    await act(async () => {
      await latest.clearNotifications();
    });

    await waitFor(() => expect(latest.notifications).toHaveLength(2));
    expect(latest.notificationUnreadCount).toBe(1);
  });

  it('clearing an already-empty list is a no-op (no request sent)', async () => {
    const { api } = require('../services/api');
    api.get.mockImplementation((url) => (url === '/notifications'
      ? Promise.resolve({ data: [] })
      : Promise.resolve({ data: { user_id: 'tenant-a' } })));
    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.notifications).toHaveLength(0));

    await act(async () => {
      await latest.clearNotifications();
    });

    expect(mockDelete).not.toHaveBeenCalled();
  });
});
