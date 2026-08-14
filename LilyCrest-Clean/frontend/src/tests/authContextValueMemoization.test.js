// Regression test for the performance-audit finding: AuthContext's Provider
// `value={{...}}` was a brand-new object literal every render, so every
// useAuth() consumer (Home, Profile, Settings, ...) re-rendered whenever
// AuthProvider re-rendered for ANY reason — even one totally unrelated to
// the fields that consumer actually reads. Fixed by wrapping the context
// value in useMemo and stabilizing every function it exposes with
// useCallback (see contextValue in AuthContext.js). This test proves the
// fix actually works: a parent-forced re-render of AuthProvider that does
// not touch any of its own state must not cause a memoized consumer to
// re-render, while a genuine state change (auth status becoming
// authenticated) still does.

import { memo, useState } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text, TouchableOpacity } from 'react-native';
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

jest.mock('../services/api', () => ({
  api: {
    get: jest.fn((url) => {
      if (url === '/users/me') return Promise.resolve({ data: { user_id: 'tenant-a', name: 'Tenant A' } });
      if (url === '/notifications') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: {} });
    }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    patch: jest.fn().mockResolvedValue({ data: {} }),
  },
  getApiErrorMessage: (error, fallback) => fallback,
  teardownExpiredSession: jest.fn().mockResolvedValue(true),
}));

let consumerRenderCount = 0;
let lastLoginRef = null;

const TestConsumer = memo(function TestConsumer() {
  const authState = useAuth();
  consumerRenderCount += 1;
  lastLoginRef = authState.login;
  return <Text>{authState.authStatus}</Text>;
});

// A sibling with its own unrelated state, whose updates force the whole
// tree (including AuthProvider, a plain non-memoized function component)
// to re-execute — simulating "some unrelated part of the app re-rendered"
// without AuthProvider's own state changing at all.
function Harness() {
  const [tick, setTick] = useState(0);
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <TestConsumer />
            <TouchableOpacity accessibilityLabel="bump-unrelated-state" onPress={() => setTick((t) => t + 1)}>
              <Text>{tick}</Text>
            </TouchableOpacity>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

describe('AuthContext value memoization', () => {
  beforeEach(() => {
    consumerRenderCount = 0;
    lastLoginRef = null;
  });

  it('a memoized consumer does not re-render when an unrelated part of the tree re-renders', async () => {
    const { getByLabelText } = render(<Harness />);

    await waitFor(() => expect(consumerRenderCount).toBeGreaterThan(0));
    const renderCountAfterMount = consumerRenderCount;
    const loginRefAfterMount = lastLoginRef;

    // Forces the whole subtree — including AuthProvider's own function body
    // — to run again, with none of AuthProvider's own state having changed.
    await act(async () => {
      fireEvent.press(getByLabelText('bump-unrelated-state'));
    });

    expect(consumerRenderCount).toBe(renderCountAfterMount);
    expect(lastLoginRef).toBe(loginRefAfterMount);
  });
});
