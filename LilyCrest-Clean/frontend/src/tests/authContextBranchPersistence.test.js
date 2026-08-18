// Regression test for the device-proven "Profile Branch missing" bug:
// resolveTenantBranch (backend/services/branchLocation.service.js) can
// transiently fail to resolve a tenant's branch, and buildTenantProfile
// silently degrades to `branch: null` in that case rather than failing the
// whole /users/me response. Profile re-fetches /users/me on every focus via
// updateUser(); session hydration and checkAuth() also replace `user` from a
// fresh /users/me call. None of those call sites may let a transient null
// regress a branch value already established this session — every screen
// (Profile, Home/Dashboard) renders the same shared `user.branch`, so a
// regression in one screen's fetch silently breaks the others too.

import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';
import { ToastProvider } from '../context/ToastContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/(tabs)/home',
}));

jest.mock('../config/firebase', () => ({
  auth: { signOut: jest.fn().mockResolvedValue() },
  getFreshIdToken: jest.fn().mockResolvedValue(null),
  subscribeToAuthState: (cb) => {
    cb({ uid: 'firebase-uid', displayName: 'Stale Firebase Name', photoURL: 'https://example.test/stale-firebase.jpg' });
    return () => {};
  },
}));

jest.mock('../services/documentManager', () => ({
  clearDocumentCache: jest.fn().mockResolvedValue(),
}));

let mockSessionToken = 'valid-session-token';

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
  getSessionToken: jest.fn(() => Promise.resolve(mockSessionToken)),
  migrateLegacyCredentials: jest.fn().mockResolvedValue(),
  removeSessionToken: jest.fn().mockResolvedValue(),
  setSessionToken: jest.fn().mockResolvedValue(),
}));

const GOOD_BRANCH = {
  branchId: 'BRANCH_GUADALUPE', branchCode: 'guadalupe', branchName: 'Guadalupe',
  branchAddress: '123 Guadalupe St', latitude: 14.5, longitude: 121.0,
  googleMapsUrl: 'https://maps.google.com/?q=guadalupe', isActive: true,
};

let mockUsersMeResponse;
let mockUsersMeError;

jest.mock('../services/api', () => ({
  api: {
    get: jest.fn((url) => {
      if (url === '/users/me') {
        if (mockUsersMeError) return Promise.reject(mockUsersMeError);
        return Promise.resolve(mockUsersMeResponse);
      }
      if (url === '/notifications') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: {} });
    }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    patch: jest.fn().mockResolvedValue({ data: {} }),
  },
  getApiErrorMessage: (error, fallback) => fallback,
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

describe('AuthContext branch persistence across profile refreshes (regression)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockSessionToken = 'valid-session-token';
    mockUsersMeError = null;
    mockUsersMeResponse = { data: { user_id: 'tenant-a', name: 'Tenant A', branch: GOOD_BRANCH } };
  });

  it('successful hydration replaces stale AsyncStorage/default/Firebase profile values with /users/me', async () => {
    await AsyncStorage.setItem('session_user', JSON.stringify({
      user_id: 'tenant-a',
      name: 'Stale Cached Name',
      picture: 'file:///cache/stale.jpg',
      staleOnlyField: 'must-not-survive',
    }));
    mockUsersMeResponse = { data: {
      user_id: 'tenant-a',
      name: 'Canonical Backend Name',
      picture: 'https://example.test/canonical.jpg',
      branch: GOOD_BRANCH,
    } };
    let latest;
    renderAuth((state) => { latest = state; });

    await waitFor(() => expect(latest.authStatus).toBe('authenticated'));
    expect(latest.user.name).toBe('Canonical Backend Name');
    expect(latest.user.picture).toBe('https://example.test/canonical.jpg');
    expect(latest.user.staleOnlyField).toBeUndefined();
  });

  it('updateUser replaces stale cached fields when given a complete canonical profile response', async () => {
    mockUsersMeResponse = { data: {
      user_id: 'tenant-a', name: 'Old Canonical Name', picture: 'https://example.test/old.jpg', branch: GOOD_BRANCH,
    } };
    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.authStatus).toBe('authenticated'));

    act(() => {
      latest.updateUser({ user_id: 'tenant-a', name: 'Fresh Canonical Name', branch: GOOD_BRANCH });
    });
    await waitFor(() => expect(latest.user.name).toBe('Fresh Canonical Name'));
    expect(latest.user.picture).toBeUndefined();
  });

  it('logout clears local session state and a new provider/login hydrates the saved backend profile again', async () => {
    const savedProfile = {
      user_id: 'tenant-a', name: 'Saved Backend Name', phone: '+639171234567',
      picture: 'https://example.test/saved.jpg', branch: GOOD_BRANCH,
    };
    mockUsersMeResponse = { data: savedProfile };
    let firstSession;
    const firstRender = renderAuth((state) => { firstSession = state; });
    await waitFor(() => expect(firstSession.authStatus).toBe('authenticated'));

    await act(async () => { await firstSession.logout(); });
    expect(firstSession.user).toBeNull();
    expect(await AsyncStorage.getItem('session_user')).toBeNull();
    firstRender.unmount();

    // Simulate a newly authenticated process/session. The only profile input
    // is a fresh /users/me response; the cache destroyed by logout is absent.
    mockSessionToken = 'new-valid-session-token';
    let secondSession;
    renderAuth((state) => { secondSession = state; });
    await waitFor(() => expect(secondSession.authStatus).toBe('authenticated'));
    expect(secondSession.user).toEqual(savedProfile);
  });

  it('updateUser does not regress a known branch when a later profile fetch resolves branch: null', async () => {
    let latest;
    renderAuth((state) => { latest = state; });

    await waitFor(() => expect(latest.authStatus).toBe('authenticated'));
    expect(latest.user?.branch?.branchName).toBe('Guadalupe');

    // Simulates Profile's fetchProfile() landing a transient
    // resolveTenantBranch failure (branch: null) on a later /users/me call —
    // the same shape buildTenantProfile emits when it silently swallows a
    // BRANCH_ASSIGNMENT_MISSING/INCOMPLETE/INACTIVE error.
    act(() => {
      latest.updateUser({ user_id: 'tenant-a', name: 'Tenant A', branch: null });
    });

    await waitFor(() => expect(latest.user?.branch?.branchName).toBe('Guadalupe'));
  });

  it('updateUser still applies a genuinely new branch value (not sticky forever)', async () => {
    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.authStatus).toBe('authenticated'));

    const NEW_BRANCH = { ...GOOD_BRANCH, branchName: 'Gil Puyat', branchCode: 'gil-puyat' };
    act(() => {
      latest.updateUser({ user_id: 'tenant-a', name: 'Tenant A', branch: NEW_BRANCH });
    });

    await waitFor(() => expect(latest.user?.branch?.branchName).toBe('Gil Puyat'));
  });

  it('checkAuth() does not regress a known branch when /users/me transiently resolves branch: null', async () => {
    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.authStatus).toBe('authenticated'));
    expect(latest.user?.branch?.branchName).toBe('Guadalupe');

    mockUsersMeResponse = { data: { user_id: 'tenant-a', name: 'Tenant A', branch: null } };
    await act(async () => {
      await latest.checkAuth();
    });

    expect(latest.user?.branch?.branchName).toBe('Guadalupe');
  });

  it('checkAuth() preserves the authenticated cached session on a timeout', async () => {
    const { clearCredentials } = require('../services/secureCredentials');
    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.authStatus).toBe('authenticated'));

    mockUsersMeError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    let result;
    await act(async () => {
      result = await latest.checkAuth();
    });

    expect(result).toEqual(expect.objectContaining({ authenticated: true, restoredFromCache: true, offline: true }));
    expect(latest.authStatus).toBe('authenticated');
    expect(latest.user?.user_id).toBe('tenant-a');
    expect(await AsyncStorage.getItem('session_user')).not.toBeNull();
    expect(clearCredentials).not.toHaveBeenCalled();
  });

  it('checkAuth() preserves the authenticated cached session on a server 5xx', async () => {
    const { clearCredentials } = require('../services/secureCredentials');
    let latest;
    renderAuth((state) => { latest = state; });
    await waitFor(() => expect(latest.authStatus).toBe('authenticated'));

    mockUsersMeError = { response: { status: 503 } };
    await act(async () => {
      await latest.checkAuth();
    });

    expect(latest.authStatus).toBe('authenticated');
    expect(latest.user?.user_id).toBe('tenant-a');
    expect(clearCredentials).not.toHaveBeenCalled();
  });
});
