/* global test */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, RefreshControl } from 'react-native';
import RoomTransferScreen from '../../app/room-transfer';
import { apiService } from '../services/api';
import { publishCanonicalNotification, resetCanonicalEventDedupeForTests } from '../services/canonicalEvents';
const mockAlert = jest.fn();
let mockAuth;
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-transfer-request-123456' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ canGoBack: () => true, back: jest.fn(), push: jest.fn() }), useFocusEffect: callback => require('react').useEffect(callback, [callback]) }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/ThemeContext', () => ({ useTheme: () => ({ colors: require('../theme/tokens').LIGHT_COLORS }) }));
jest.mock('../context/AlertContext', () => ({ useAlert: () => ({ showAlert: mockAlert }) }));
jest.mock('../services/api', () => ({ apiService: { getCurrentRoomTransfer: jest.fn(), getRoomTransferPreferences: jest.fn(), createRoomTransferRequest: jest.fn(), cancelRoomTransferRequest: jest.fn() } }));
const eligible = { status: null, canRequest: true, currentRoom: { name: '301' }, currentBed: { label: 'A-L' } };
const key = 'room-transfer-submission:tenant-a';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function ready() {
  const ui = render(<RoomTransferScreen />);
  await waitFor(() => expect(ui.getByText('Request Room Transfer')).toBeTruthy());
  return ui;
}
function fill(ui) {
  fireEvent.press(ui.getByText('Private'));
  fireEvent.changeText(ui.getByPlaceholderText('Why would you like to transfer?'), 'Quiet study space');
}
beforeEach(async () => {
  jest.clearAllMocks();
  resetCanonicalEventDedupeForTests();
  await AsyncStorage.clear();
  mockAuth = { authReady: true, authStatus: 'authenticated', user: { user_id: 'tenant-a' } };
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  apiService.getCurrentRoomTransfer.mockResolvedValue({ data: eligible });
  apiService.getRoomTransferPreferences.mockResolvedValue({ data: { rooms: [] } });
  apiService.createRoomTransferRequest.mockResolvedValue({ data: {} });
  apiService.cancelRoomTransferRequest.mockResolvedValue({ data: {} });
  mockAlert.mockResolvedValue(undefined);
});
test('backend ineligibility blocks the form and does not fetch preferences', async () => {
  apiService.getCurrentRoomTransfer.mockResolvedValue({ data: { ...eligible, canRequest: false, eligibilityReason: 'Current lease needs review.' } });
  const ui = render(<RoomTransferScreen />);
  await waitFor(() => expect(ui.getByText('Current lease needs review.')).toBeTruthy());
  expect(ui.queryByText('Submit request')).toBeNull();
  expect(apiService.getRoomTransferPreferences).not.toHaveBeenCalled();
});
test('a failed preference fetch stays visible and blocks submission', async () => {
  apiService.getRoomTransferPreferences.mockRejectedValue(new Error('Network error'));
  const ui = render(<RoomTransferScreen />);
  await waitFor(() => expect(ui.getByText('Refresh available rooms')).toBeTruthy());
  expect(ui.queryByText('Submit request')).toBeNull();
});
test('rapid submit taps persist and transport one exact intent', async () => {
  const ui = await ready(); fill(ui);
  await act(async () => { fireEvent.press(ui.getByText('Submit request')); fireEvent.press(ui.getByText('Submit request')); });
  await waitFor(() => expect(apiService.createRoomTransferRequest).toHaveBeenCalledTimes(1));
  expect(apiService.createRoomTransferRequest).toHaveBeenCalledWith(expect.objectContaining({ clientRequestId: 'test-transfer-request-123456', reason: 'Quiet study space', preferredRoomType: 'private' }));
});
test('a lost response recovers a matching request after Admin already declined it', async () => {
  const ui = await ready(); fill(ui);
  apiService.createRoomTransferRequest.mockImplementationOnce(async request => {
    apiService.getCurrentRoomTransfer.mockResolvedValue({ data: { ...eligible, status: 'declined', request: { id: 'request-1', clientRequestId: request.clientRequestId, declineReason: 'Unavailable' } } });
    throw new Error('Network error');
  });
  await act(async () => fireEvent.press(ui.getByText('Submit request')));
  await waitFor(() => expect(ui.getByText('Declined')).toBeTruthy());
  expect(await AsyncStorage.getItem(key)).toBeNull();
  expect(mockAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Request received' }));
});
test('restart retains the request key and original payload for a safe retry', async () => {
  let ui = await ready(); fill(ui);
  apiService.createRoomTransferRequest.mockRejectedValueOnce(new Error('Network error'));
  await act(async () => fireEvent.press(ui.getByText('Submit request')));
  const saved = JSON.parse(await AsyncStorage.getItem(key));
  expect(saved.reason).toBe('Quiet study space');
  ui.unmount(); ui = await ready();
  expect(ui.getByPlaceholderText('Why would you like to transfer?').props.editable).toBe(false);
  await act(async () => fireEvent.press(ui.getByText('Submit request')));
  expect(apiService.createRoomTransferRequest.mock.calls[1][0]).toEqual(saved);
});
test('another account never restores the first account retry or stale lifecycle', async () => {
  await AsyncStorage.setItem(key, JSON.stringify({ clientRequestId: 'pending-request-123456', preferredRoomType: 'private', reason: 'Account A private note' }));
  const pending = deferred();
  apiService.getCurrentRoomTransfer.mockReturnValueOnce(pending.promise);
  const ui = render(<RoomTransferScreen />);
  mockAuth = { ...mockAuth, user: { user_id: 'tenant-b' } };
  ui.rerender(<RoomTransferScreen />);
  await waitFor(() => expect(ui.getByText('Request Room Transfer')).toBeTruthy());
  await act(async () => pending.resolve({ data: { ...eligible, currentRoom: { name: 'OLD ACCOUNT ROOM' } } }));
  expect(ui.queryByText(/OLD ACCOUNT ROOM/)).toBeNull();
  expect(ui.getByPlaceholderText('Why would you like to transfer?').props.value).toBe('');
  expect(await AsyncStorage.getItem(key)).not.toBeNull();
});
test('rapid cancellation taps open one confirmation and send one cancellation', async () => {
  const confirm = deferred();
  apiService.getCurrentRoomTransfer.mockResolvedValue({ data: { ...eligible, status: 'pending', canRequest: false, request: { id: 'request-1', canCancel: true } } });
  mockAlert.mockReturnValueOnce(confirm.promise);
  const ui = render(<RoomTransferScreen />);
  await waitFor(() => expect(ui.getByText('Cancel')).toBeTruthy());
  fireEvent.press(ui.getByText('Cancel')); fireEvent.press(ui.getByText('Cancel'));
  expect(mockAlert).toHaveBeenCalledTimes(1);
  await act(async () => confirm.resolve('Cancel request'));
  expect(apiService.cancelRoomTransferRequest).toHaveBeenCalledTimes(1);
});
test('a late confirmation after logout cannot cancel a request', async () => {
  const confirm = deferred();
  apiService.getCurrentRoomTransfer.mockResolvedValue({ data: { ...eligible, status: 'pending', canRequest: false, request: { id: 'request-1', canCancel: true } } });
  mockAlert.mockReturnValueOnce(confirm.promise);
  const ui = render(<RoomTransferScreen />);
  await waitFor(() => expect(ui.getByText('Cancel')).toBeTruthy());
  fireEvent.press(ui.getByText('Cancel'));
  mockAuth = { authReady: true, authStatus: 'unauthenticated', user: null }; ui.rerender(<RoomTransferScreen />);
  await act(async () => confirm.resolve('Cancel request'));
  expect(apiService.cancelRoomTransferRequest).not.toHaveBeenCalled();
});
test('pull refresh and a canonical decision refresh show the new room assignment', async () => {
  const ui = await ready();
  apiService.getCurrentRoomTransfer.mockResolvedValue({ data: { ...eligible, status: 'completed', currentRoom: { name: '402' }, currentBed: { label: 'B-U' } } });
  await act(async () => ui.UNSAFE_getByType(RefreshControl).props.onRefresh());
  expect(ui.getByText('Current room: 402 / B-U')).toBeTruthy();
  const count = apiService.getCurrentRoomTransfer.mock.calls.length;
  await act(async () => publishCanonicalNotification({ title: 'Room Transfer Completed', notification_id: 'decision-1' }));
  expect(apiService.getCurrentRoomTransfer).toHaveBeenCalledTimes(count + 1);
});
test('a malformed lifecycle fails closed', async () => {
  apiService.getCurrentRoomTransfer.mockResolvedValue({ data: {} });
  const ui = render(<RoomTransferScreen />);
  await waitFor(() => expect(ui.getByText('Retry')).toBeTruthy());
  expect(ui.queryByText('Submit request')).toBeNull();
});

test('a saved retry can reach server idempotency even after its preferred date passes', async () => {
  const saved = { clientRequestId: 'past-date-request-123456', preferredRoomType: 'private', reason: 'Original request', preferredTransferDate: '2020-01-01' };
  await AsyncStorage.setItem(key, JSON.stringify(saved));
  const ui = await ready();
  await act(async () => fireEvent.press(ui.getByText('Submit request')));
  expect(apiService.createRoomTransferRequest).toHaveBeenCalledWith(saved);
});
