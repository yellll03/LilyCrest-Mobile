// Regression test for the notification-architecture consolidation: the tab
// badge, header bell badge, and notification sheet used to each derive their
// own unread count independently (two from a client-local AsyncStorage
// "last seen" timestamp, one from a count that itself never reflected the
// backend's real per-notification `read` field). AuthContext is now the one
// shared source of truth (notifications/notificationUnreadCount/
// markNotificationRead/clearNotificationUnread/refreshNotifications) that
// every surface reads from — this test drives the real AuthProvider (not a
// mock) through that state machine.

import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';
import { ToastProvider } from '../context/ToastContext';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/(tabs)/home',
  useSegments: () => ['(tabs)', 'home'],
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
  getSessionToken: jest.fn().mockResolvedValue('valid-session-token'),
  migrateLegacyCredentials: jest.fn().mockResolvedValue(),
  removeSessionToken: jest.fn().mockResolvedValue(),
  setSessionToken: jest.fn().mockResolvedValue(),
}));

const NOTIFICATIONS_FIXTURE = [
  { notification_id: 'n-unread', title: 'Unread one', body: 'x', read: false, created_at: '2026-08-01T00:00:00.000Z' },
  { notification_id: 'n-read', title: 'Already read', body: 'x', read: true, created_at: '2026-08-01T00:00:00.000Z' },
];

const mockGet = jest.fn();
const mockPatch = jest.fn();

jest.mock('../services/api', () => ({
  api: {
    get: (...args) => mockGet(...args),
    post: jest.fn().mockResolvedValue({ data: {} }),
    patch: (...args) => mockPatch(...args),
  },
  getApiErrorMessage: (error, fallback) => fallback,
  getConfirmedSessionInvalidation: jest.fn(() => null),
  teardownExpiredSession: jest.fn().mockResolvedValue(true),
}));

function TestConsumer({ onRender }) {
  const authState = useAuth();
  onRender(authState);
  return <Text>{authState.notificationUnreadCount}</Text>;
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

describe('notification sync — single source of truth (regression)', () => {
  let latest;
  const capture = (state) => { latest = state; };

  beforeEach(() => {
    jest.clearAllMocks();
    latest = null;
    mockGet.mockImplementation((url) => {
      if (url === '/users/me') return Promise.resolve({ data: { user_id: 'tenant-a', name: 'Tenant A', email: 'a@example.com', role: 'tenant' } });
      if (url === '/notifications') return Promise.resolve({ data: NOTIFICATIONS_FIXTURE });
      return Promise.resolve({ data: {} });
    });
    mockPatch.mockResolvedValue({ data: {} });
  });

  it('derives unread count from the backend read field, not a client-local timestamp', async () => {
    renderAuth(capture);
    await waitFor(() => expect(latest.notificationUnreadCount).toBe(1));
    expect(latest.notifications).toHaveLength(2);
  });

  it('counts canonical Phase 2 module events from the shared backend feed in the Home badge', async () => {
    const phase2Events = [
      { notification_id: 'contract-1', type: 'contract_document_ready', read: false },
      { notification_id: 'chat-1', type: 'chat_reply', read: false },
      { notification_id: 'bill-1', type: 'bill_generated', read: false },
      { notification_id: 'maintenance-1', type: 'maintenance_update', read: false },
    ];
    mockGet.mockImplementation((url) => {
      if (url === '/users/me') return Promise.resolve({ data: { user_id: 'tenant-a', name: 'Tenant A', email: 'a@example.com', role: 'tenant' } });
      if (url === '/notifications') return Promise.resolve({ data: phase2Events });
      return Promise.resolve({ data: {} });
    });

    renderAuth(capture);
    await waitFor(() => expect(latest.notificationUnreadCount).toBe(4));
    expect(latest.notifications.map((item) => item.type)).toEqual([
      'contract_document_ready',
      'chat_reply',
      'bill_generated',
      'maintenance_update',
    ]);
  });

  it('markNotificationRead optimistically marks the row read and calls the per-item backend endpoint', async () => {
    renderAuth(capture);
    await waitFor(() => expect(latest.notificationUnreadCount).toBe(1));

    await act(async () => {
      await latest.markNotificationRead('n-unread');
    });

    expect(latest.notificationUnreadCount).toBe(0);
    expect(latest.notifications.find((n) => n.notification_id === 'n-unread').read).toBe(true);
    expect(mockPatch).toHaveBeenCalledWith(expect.stringContaining('/notifications/n-unread/read'));
  });

  it('markNotificationRead rolls back to the exact prior state if the backend call fails', async () => {
    renderAuth(capture);
    await waitFor(() => expect(latest.notificationUnreadCount).toBe(1));
    mockPatch.mockRejectedValueOnce(new Error('network down'));

    await act(async () => {
      await latest.markNotificationRead('n-unread');
    });

    expect(latest.notificationUnreadCount).toBe(1);
    expect(latest.notifications.find((n) => n.notification_id === 'n-unread').read).toBe(false);
  });

  it('clearNotificationUnread (mark all) zeroes the count and marks every row read', async () => {
    renderAuth(capture);
    await waitFor(() => expect(latest.notificationUnreadCount).toBe(1));

    await act(async () => {
      await latest.clearNotificationUnread();
    });

    expect(latest.notificationUnreadCount).toBe(0);
    expect(latest.notifications.every((n) => n.read === true)).toBe(true);
    expect(mockPatch).toHaveBeenCalledWith('/notifications/read-all');
  });

  it('clearNotificationUnread rolls back every row if the backend call fails', async () => {
    renderAuth(capture);
    await waitFor(() => expect(latest.notificationUnreadCount).toBe(1));
    mockPatch.mockRejectedValueOnce(new Error('network down'));

    await act(async () => {
      await latest.clearNotificationUnread();
    });

    expect(latest.notificationUnreadCount).toBe(1);
    expect(latest.notifications.find((n) => n.notification_id === 'n-unread').read).toBe(false);
  });

  it('clearNotificationUnread is a no-op when nothing is unread (no needless backend call)', async () => {
    mockGet.mockImplementation((url) => {
      if (url === '/users/me') return Promise.resolve({ data: { user_id: 'tenant-a', name: 'Tenant A', email: 'a@example.com', role: 'tenant' } });
      if (url === '/notifications') return Promise.resolve({ data: [{ notification_id: 'n-read', read: true, created_at: '2026-08-01T00:00:00.000Z' }] });
      return Promise.resolve({ data: {} });
    });
    renderAuth(capture);
    await waitFor(() => expect(latest.notificationUnreadCount).toBe(0));

    await act(async () => {
      await latest.clearNotificationUnread();
    });

    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('zero notifications renders a clean zero count, not a negative or NaN', async () => {
    mockGet.mockImplementation((url) => {
      if (url === '/users/me') return Promise.resolve({ data: { user_id: 'tenant-a', name: 'Tenant A', email: 'a@example.com', role: 'tenant' } });
      if (url === '/notifications') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: {} });
    });
    renderAuth(capture);
    await waitFor(() => expect(latest.notificationUnreadCount).toBe(0));
    expect(latest.notifications).toEqual([]);
    expect(Number.isNaN(latest.notificationUnreadCount)).toBe(false);
  });
});
