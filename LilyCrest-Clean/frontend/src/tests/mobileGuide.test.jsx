/* global test */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MobileGuideProvider, useMobileGuide } from '../context/MobileGuideProvider';
import { mobileGuideKey } from '../config/mobileGuide';
import { Modal, Text } from 'react-native';
let mockAccount = 'tenant-a';
const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
let mockCanDismiss = false;
let mockPathname = '/home';
let mockSegments = ['(tabs)', 'home'];
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace, canDismiss: () => mockCanDismiss, dismissAll: mockDismissAll }), usePathname: () => mockPathname, useSegments: () => mockSegments }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { user_id: mockAccount }, authReady: true, authStatus: mockAccount ? 'authenticated' : 'anonymous' }) }));
jest.mock('../context/ThemeContext', () => ({ useTheme: () => ({ colors: require('../theme/tokens').DARK_COLORS }) }));
function Replay() { const { replay } = useMobileGuide(); return <Text onPress={replay}>Replay</Text>; }
beforeEach(async () => { mockAccount = 'tenant-a'; mockCanDismiss = false; mockPathname = '/home'; mockSegments = ['(tabs)', 'home']; jest.clearAllMocks(); await AsyncStorage.clear(); });
test('first login offers guide and Skip persists only for the account', async () => {
 const ui = render(<MobileGuideProvider><Replay /></MobileGuideProvider>);
 await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
 await act(async () => fireEvent.press(ui.getByLabelText('Skip')));
 expect(await AsyncStorage.getItem(mobileGuideKey('tenant-a'))).toBe('completed');
 expect(await AsyncStorage.getItem(mobileGuideKey('tenant-b'))).toBeNull();
});
test('Finish persists, Back navigates, replay starts again', async () => {
 const ui = render(<MobileGuideProvider><Replay /></MobileGuideProvider>);
 await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
 fireEvent.press(ui.getByLabelText('Next')); expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)/billing');
 fireEvent.press(ui.getByLabelText('Back')); expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)/home');
 for (let i = 0; i < 5; i++) fireEvent.press(ui.getByLabelText('Next'));
 expect(ui.getByText('Profile, Contract & Extend Stay')).toBeTruthy();
 await act(async () => fireEvent.press(ui.getByLabelText('Finish')));
 expect(await AsyncStorage.getItem(mobileGuideKey('tenant-a'))).toBe('completed');
 fireEvent.press(ui.getByText('Replay')); expect(ui.getByText('Home')).toBeTruthy();
});
test('completed account is skipped but another tenant receives guide', async () => {
 await AsyncStorage.setItem(mobileGuideKey('tenant-a'), 'completed');
 const ui = render(<MobileGuideProvider><Replay /></MobileGuideProvider>);
 await act(async () => {}); expect(ui.queryByText('Home')).toBeNull();
 mockAccount = 'tenant-b'; ui.rerender(<MobileGuideProvider><Replay /></MobileGuideProvider>);
 await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
});
test('version upgrade uses a new account key', () => expect(mobileGuideKey('tenant-a', 2)).not.toBe(mobileGuideKey('tenant-a', 1)));

test('Android Back steps backward and dismissing the first card persists Skip', async () => {
 const ui = render(<MobileGuideProvider><Replay /></MobileGuideProvider>);
 await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
 fireEvent.press(ui.getByLabelText('Next'));
 await act(async () => ui.UNSAFE_getByType(Modal).props.onRequestClose());
 expect(ui.getByText('Home')).toBeTruthy();
 await act(async () => ui.UNSAFE_getByType(Modal).props.onRequestClose());
 expect(await AsyncStorage.getItem(mobileGuideKey('tenant-a'))).toBe('completed');
});
test('older guide completion does not suppress the current guide', async () => {
 await AsyncStorage.setItem(mobileGuideKey('tenant-a', 0), 'completed');
 const ui = render(<MobileGuideProvider><Replay /></MobileGuideProvider>);
 await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
 expect(ui.UNSAFE_getByType(Modal).props.animationType).toBe('none');
});

test('a late initial storage read cannot reopen a skipped replay', async () => {
 let resolveRead;
 AsyncStorage.getItem.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
 const ui = render(<MobileGuideProvider><Replay /></MobileGuideProvider>);
 fireEvent.press(ui.getByText('Replay'));
 await act(async () => fireEvent.press(ui.getByLabelText('Skip')));
 await act(async () => resolveRead(null));
 expect(ui.queryByText('Home')).toBeNull();
});
test('an old account pending save cannot disable the next account guide', async () => {
 const ui = render(<MobileGuideProvider><Replay /></MobileGuideProvider>);
 await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
 let resolveSave;
 AsyncStorage.setItem.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
 fireEvent.press(ui.getByLabelText('Skip'));
 mockAccount = 'tenant-b'; ui.rerender(<MobileGuideProvider><Replay /></MobileGuideProvider>);
 await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
 expect(ui.getByLabelText('Skip').props.accessibilityState.disabled).toBe(false);
 await act(async () => fireEvent.press(ui.getByLabelText('Skip')));
 expect(await AsyncStorage.getItem(mobileGuideKey('tenant-b'))).toBe('completed');
 await act(async () => resolveSave());
 expect(ui.queryByText('Home')).toBeNull();
});
test('collapsed authenticated Home pathname still starts the guide', async () => {
 mockPathname = '/';
 const ui = render(<MobileGuideProvider><Replay /></MobileGuideProvider>);
 await waitFor(() => expect(ui.getByText('Home')).toBeTruthy());
});

test('Settings replay clears its parent stack before restoring Home', async () => {
 await AsyncStorage.setItem(mobileGuideKey('tenant-a'), 'completed');
 mockPathname = '/settings'; mockSegments = ['settings']; mockCanDismiss = true;
 const ui = render(<MobileGuideProvider><Replay /></MobileGuideProvider>);
 await act(async () => {});
 fireEvent.press(ui.getByText('Replay'));
 expect(mockDismissAll).toHaveBeenCalledTimes(1);
 expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)/home');
});
