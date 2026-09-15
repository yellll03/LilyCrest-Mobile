/* global test */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Modal, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MobileGuideProvider, useMobileGuide } from '../context/MobileGuideProvider';

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderGuide() {
  return render(
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <MobileGuideProvider><Replay /></MobileGuideProvider>
    </SafeAreaProvider>,
  );
}

let mockUser = { user_id: 'tenant-a', tenantOnboardingSeen: false };
let mockAuthReady = true;
let mockAuthStatus = 'authenticated';
const mockUpdateUser = jest.fn((data) => { mockUser = data; });
const mockMarkSeen = jest.fn(() => Promise.resolve({ data: { user_id: mockUser.user_id, tenantOnboardingSeen: true } }));

const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
let mockCanDismiss = false;
let mockPathname = '/home';
let mockSegments = ['(tabs)', 'home'];

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, canDismiss: () => mockCanDismiss, dismissAll: mockDismissAll }),
  usePathname: () => mockPathname,
  useSegments: () => mockSegments,
}));
jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, authReady: mockAuthReady, authStatus: mockAuthStatus, updateUser: mockUpdateUser }),
}));
jest.mock('../context/ThemeContext', () => ({ useTheme: () => ({ colors: require('../theme/tokens').DARK_COLORS, isDarkMode: true }) }));
jest.mock('../services/api', () => ({ apiService: { markTenantGuideSeen: (...args) => mockMarkSeen(...args) } }));

function Replay() {
  const { replay } = useMobileGuide();
  return <Text onPress={replay}>Replay</Text>;
}

beforeEach(() => {
  mockUser = { user_id: 'tenant-a', tenantOnboardingSeen: false };
  mockAuthReady = true;
  mockAuthStatus = 'authenticated';
  mockCanDismiss = false;
  mockPathname = '/home';
  mockSegments = ['(tabs)', 'home'];
  jest.clearAllMocks();
  mockMarkSeen.mockImplementation(() => Promise.resolve({ data: { user_id: mockUser.user_id, tenantOnboardingSeen: true } }));
});

test('a first-time active tenant on Home is shown the guide starting at Home', async () => {
  const ui = renderGuide();
  await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
});

test('an account that has already seen the guide is never shown it', async () => {
  mockUser = { user_id: 'tenant-a', tenantOnboardingSeen: true };
  const ui = renderGuide();
  await act(async () => {});
  expect(ui.queryByText('Home')).toBeNull();
});

test('auth still loading (not yet authenticated) never shows the guide, even on Home', async () => {
  mockAuthReady = false;
  mockAuthStatus = 'initializing';
  const ui = renderGuide();
  await act(async () => {});
  expect(ui.queryByText('Home')).toBeNull();
});

test('an unknown onboarding state (e.g. stale offline profile) fails closed and does not show the guide', async () => {
  mockUser = { user_id: 'tenant-a' }; // tenantOnboardingSeen missing, not explicitly false
  const ui = renderGuide();
  await act(async () => {});
  expect(ui.queryByText('Home')).toBeNull();
});

test('Skip persists to the server and returns to Home; Next/Finish walk through all steps', async () => {
  const ui = renderGuide();
  await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
  fireEvent.press(ui.getByLabelText('Next'));
  expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)/billing');
  fireEvent.press(ui.getByLabelText('Back'));
  expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)/home');
  for (let i = 0; i < 5; i++) fireEvent.press(ui.getByLabelText('Next'));
  expect(ui.getByText('Profile, Contract & Extend Stay')).toBeTruthy();
  await act(async () => fireEvent.press(ui.getByLabelText('Finish')));
  expect(mockMarkSeen).toHaveBeenCalledTimes(1);
  expect(mockUpdateUser).toHaveBeenCalledWith(expect.objectContaining({ tenantOnboardingSeen: true }));
  fireEvent.press(ui.getByText('Replay'));
  expect(ui.getByText('Home')).toBeTruthy();
});

test('Skip on the first card persists completion for this account only', async () => {
  const ui = renderGuide();
  await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
  await act(async () => fireEvent.press(ui.getByLabelText('Skip')));
  expect(mockMarkSeen).toHaveBeenCalledTimes(1);
  expect(ui.queryByText('Home')).toBeNull();
});

test('a failed save shows an error, does not close the guide, and does not report completion', async () => {
  mockMarkSeen.mockImplementation(() => Promise.reject(new Error('network down')));
  const ui = renderGuide();
  await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
  await act(async () => fireEvent.press(ui.getByLabelText('Skip')));
  expect(ui.getByText('Could not save your guide preference. Please try again.')).toBeTruthy();
  expect(ui.getByText('Home')).toBeTruthy(); // still open — user can retry
  expect(mockUpdateUser).not.toHaveBeenCalled();
});

test('Android Back steps backward, then dismissing the first card persists Skip', async () => {
  const ui = renderGuide();
  await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
  fireEvent.press(ui.getByLabelText('Next'));
  await act(async () => ui.UNSAFE_getByType(Modal).props.onRequestClose());
  expect(ui.getByText('Home')).toBeTruthy();
  await act(async () => ui.UNSAFE_getByType(Modal).props.onRequestClose());
  expect(mockMarkSeen).toHaveBeenCalledTimes(1);
});

test('collapsed authenticated Home pathname still starts the guide', async () => {
  mockPathname = '/';
  const ui = renderGuide();
  await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
});

test('an in-flight save for one account cannot mark a different account as seen', async () => {
  let resolveSave;
  mockMarkSeen.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
  const ui = renderGuide();
  await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
  fireEvent.press(ui.getByLabelText('Skip'));

  mockUser = { user_id: 'tenant-b', tenantOnboardingSeen: false };
  ui.rerender(<SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}><MobileGuideProvider><Replay /></MobileGuideProvider></SafeAreaProvider>);
  await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());

  await act(async () => resolveSave({ data: { user_id: 'tenant-a', tenantOnboardingSeen: true } }));
  // tenant-b's guide must still be open — the delayed tenant-a response must not touch it.
  expect(ui.getByText('Home')).toBeTruthy();
});

test('Settings replay clears its parent stack before restoring Home', async () => {
  mockUser = { user_id: 'tenant-a', tenantOnboardingSeen: true };
  mockPathname = '/settings';
  mockSegments = ['settings'];
  mockCanDismiss = true;
  const ui = renderGuide();
  await act(async () => {});
  fireEvent.press(ui.getByText('Replay'));
  expect(mockDismissAll).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)/home');
});

test('opening the guide manually via replay does not reset the server-side seen flag', async () => {
  mockUser = { user_id: 'tenant-a', tenantOnboardingSeen: true };
  const ui = renderGuide();
  await act(async () => {});
  fireEvent.press(ui.getByText('Replay'));
  await act(async () => {});
  expect(mockMarkSeen).not.toHaveBeenCalled();
});
