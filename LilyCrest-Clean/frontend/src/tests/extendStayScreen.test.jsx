import { AppState } from 'react-native';
import { publishCanonicalNotification, resetCanonicalEventDedupeForTests } from '../services/canonicalEvents';
/* global test */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ExtendStayScreen from '../../app/extend-stay';
import { apiService } from '../services/api';

const mockAlert = jest.fn();
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ canGoBack: () => true, back: jest.fn() }), useFocusEffect: (callback) => require('react').useEffect(callback, [callback]) }));
jest.mock('../context/ThemeContext', () => ({ useTheme: () => ({ colors: require('../theme/tokens').LIGHT_COLORS }) }));
jest.mock('../context/AlertContext', () => ({ useAlert: () => ({ showAlert: mockAlert }) }));
jest.mock('../services/api', () => ({ apiService: { getCurrentStayExtension: jest.fn(), createStayExtension: jest.fn() }, getApiErrorMessage: (error, fallback) => error.message || fallback }));
const current = { stayId: 'current-stay', room: '301', startDate: '2026-01-01', endDate: '2026-12-31' };
const option = { months: 6, endDate: '2027-06-30', monthlyRent: 6300 };
beforeEach(() => {
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: jest.fn() }));
  jest.clearAllMocks();
  apiService.getCurrentStayExtension.mockResolvedValue({ data: { current, options: [option], canRequest: true } });
  mockAlert.mockResolvedValue('Submit request');
  apiService.createStayExtension.mockResolvedValue({ data: {} });
});
test('shows current terms and submits intent only, guarding rapid duplicate taps', async () => {
  const screen = render(<ExtendStayScreen />);
  await waitFor(() => expect(screen.getByText('Your current stay')).toBeTruthy());
  expect(screen.getByText('December 31, 2026')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Reason'), 'Finishing my studies');
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Submit request'));
    fireEvent.press(screen.getByLabelText('Submit request'));
  });
  expect(apiService.createStayExtension).toHaveBeenCalledTimes(1);
  expect(apiService.createStayExtension).toHaveBeenCalledWith({ stayId: 'current-stay', months: 6, requestedEndDate: '2027-06-30', expectedMonthlyRent: 6300, reason: 'Finishing my studies', note: '' });
  expect(mockAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Request submitted', type: 'success' }));
});
test('cancelled confirmation does not submit a request', async () => {
  mockAlert.mockResolvedValue('Cancel');
  const screen = render(<ExtendStayScreen />);
  await waitFor(() => expect(screen.getByLabelText('Submit request')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByLabelText('Submit request')); });
  expect(apiService.createStayExtension).not.toHaveBeenCalled();
});
test('pending request disables another request and displays its status', async () => {
  apiService.getCurrentStayExtension.mockResolvedValue({ data: { current, canRequest: false, request: { status: 'pending', months: 6, requestedEndDate: option.endDate } } });
  const screen = render(<ExtendStayScreen />);
  await waitFor(() => expect(screen.getByText('Pending review')).toBeTruthy());
  expect(screen.queryByLabelText('Submit request')).toBeNull();
});

test('admin notification refreshes the extension decision and shows its rejection reason', async () => {
  resetCanonicalEventDedupeForTests();
  const screen = render(<ExtendStayScreen />);
  await waitFor(() => expect(screen.getByText('Your current stay')).toBeTruthy());
  apiService.getCurrentStayExtension.mockResolvedValue({ data: { current, canRequest: false, request: { status: 'rejected', months: 6, adminNote: 'Future bed hold', requestedEndDate: option.endDate } } });
  act(() => publishCanonicalNotification({ title: 'Stay Extension Rejected', data: { event_key: 'reject-1', screen: 'extend-stay' } }));
  await waitFor(() => expect(screen.getByText('Future bed hold')).toBeTruthy());
});

test('resume refreshes acknowledgement without representing it as approval', async () => {
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  const screen = render(<ExtendStayScreen />);
  await waitFor(() => expect(screen.getByText('Your current stay')).toBeTruthy());
  apiService.getCurrentStayExtension.mockResolvedValue({ data: { current, canRequest: false, request: { status: 'pending', acknowledgedAt: '2026-09-13', months: 6, requestedEndDate: option.endDate } } });
  act(() => spy.mock.calls.find(([name]) => name === 'change')[1]('active'));
  await waitFor(() => expect(screen.getByText('Reviewed')).toBeTruthy()); screen.unmount(); spy.mockRestore();
});

test('approved future extension displays awaiting effective date', async () => {
  apiService.getCurrentStayExtension.mockResolvedValue({ data: { current, canRequest: false, request: { status: 'approved', fulfillmentState: 'awaiting_effective_date', months: 6, requestedEndDate: option.endDate } } });
  const screen = render(<ExtendStayScreen />);
  await waitFor(() => expect(screen.getByText('awaiting effective date')).toBeTruthy());
  expect(screen.getByText('Approved')).toBeTruthy();
});

test('lost submission response is reconciled from the server without creating a duplicate', async () => {
  const screen = render(<ExtendStayScreen />);
  await waitFor(() => expect(screen.getByLabelText('Submit request')).toBeTruthy());
  apiService.createStayExtension.mockRejectedValueOnce(new Error('Network lost after commit'));
  apiService.getCurrentStayExtension.mockResolvedValue({ data: { current, canRequest: false, request: { stayId: current.stayId, status: 'pending', months: 6, requestedEndDate: option.endDate } } });
  await act(async () => { fireEvent.press(screen.getByLabelText('Submit request')); });
  expect(apiService.createStayExtension).toHaveBeenCalledTimes(1);
  expect(mockAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Request received', type: 'success' }));
  expect(screen.queryByLabelText('Submit request')).toBeNull();
});
