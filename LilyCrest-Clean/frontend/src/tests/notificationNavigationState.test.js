/* global test */
import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';
import { ToastProvider } from '../context/ToastContext';

const mockNavigate = jest.fn();
const mockRouter = { navigate: mockNavigate, push: jest.fn(), replace: jest.fn() };
let mockPathname = '/';
let mockSegments = [];
let mockNotificationResponseHandler;

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
  useSegments: () => mockSegments,
}));

jest.mock('../config/firebase', () => ({
  auth: { signOut: jest.fn().mockResolvedValue() },
  getFreshIdToken: jest.fn().mockResolvedValue(null),
  subscribeToAuthState: (callback) => {
    callback(null);
    return () => {};
  },
}));

jest.mock('../services/documentManager', () => ({
  clearDocumentCache: jest.fn().mockResolvedValue(),
}));

const mockNotificationData = {
  type: 'contract_document_ready',
  contract_id: 'contract-1',
};
const mockNotificationInteraction = {
  data: mockNotificationData,
  responseId: 'notification-1:default',
};
const mockDestination = {
  pathname: '/contract-viewer',
  params: { contractId: 'contract-1' },
};

jest.mock('../services/notifications', () => ({
  arePushNotificationsEnabled: jest.fn().mockResolvedValue(false),
  clearLastNotificationResponse: jest.fn().mockResolvedValue(),
  getLastNotificationResponseData: jest.fn(() => Promise.resolve(mockNotificationInteraction)),
  getStoredPushToken: jest.fn().mockResolvedValue(null),
  initializeNotificationHandler: jest.fn(),
  registerForPushNotifications: jest.fn().mockResolvedValue(null),
  requestPushPermissionOnFirstLaunch: jest.fn().mockResolvedValue(),
  resolveNotificationRoute: jest.fn(() => mockDestination),
  savePushTokenToServer: jest.fn().mockResolvedValue(),
  setupNotificationListeners: jest.fn((_received, response) => {
    mockNotificationResponseHandler = response;
    return () => {};
  }),
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
        return Promise.resolve({ data: { user_id: 'tenant-1', email: 'tenant@example.com' } });
      }
      if (url === '/notifications') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: {} });
    }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    patch: jest.fn().mockResolvedValue({ data: {} }),
  },
  getApiErrorMessage: (_error, fallback) => fallback,
  getConfirmedSessionInvalidation: jest.fn(() => null),
  teardownExpiredSession: jest.fn().mockResolvedValue(true),
}));

function Harness() {
  const { authStatus } = useAuth();
  return <Text>{authStatus}</Text>;
}

const authTree = () => (
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 320, height: 640 },
      insets: { top: 0, left: 0, right: 0, bottom: 0 },
    }}
  >
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  </SafeAreaProvider>
);

describe('notification navigation state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = '/';
    mockSegments = [];
    mockNotificationResponseHandler = undefined;
  });

  test('cold-start notification waits for Home and repeated delivery does not duplicate the route', async () => {
    const view = render(authTree());
    await waitFor(() => expect(view.getByText('authenticated')).toBeTruthy());

    expect(mockNavigate).not.toHaveBeenCalled();

    mockPathname = '/home';
    mockSegments = ['(tabs)', 'home'];
    view.rerender(authTree());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(mockDestination));
    expect(mockNavigate).toHaveBeenCalledTimes(1);

    await act(async () => {
      mockNotificationResponseHandler(mockNotificationInteraction);
      mockNotificationResponseHandler(mockNotificationInteraction);
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).not.toHaveBeenCalled();
  }, 15000);
});
