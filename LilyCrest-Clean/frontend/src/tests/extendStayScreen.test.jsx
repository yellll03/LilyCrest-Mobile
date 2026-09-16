import { AppState } from 'react-native';
import { publishCanonicalNotification } from '../services/canonicalEvents';
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
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
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

test('uses an available server duration when six months is not offered', async () => {
  const threeMonths = { months: 3, endDate: '2027-03-31', monthlyRent: 6500 };
  apiService.getCurrentStayExtension.mockResolvedValue({ data: { current, options: [threeMonths], canRequest: true } });
  const ui = render(<ExtendStayScreen />);
  await waitFor(() => expect(ui.getByText('March 31, 2027')).toBeTruthy());
  await act(async () => fireEvent.press(ui.getByLabelText('Submit request')));
  expect(apiService.createStayExtension).toHaveBeenCalledWith(expect.objectContaining({ months: 3, requestedEndDate: threeMonths.endDate, expectedMonthlyRent: 6500 }));
});

test('missing options shows guidance and cannot submit', async () => {
  apiService.getCurrentStayExtension.mockResolvedValue({ data: { current, canRequest: true } });
  const ui = render(<ExtendStayScreen />);
  await waitFor(() => expect(ui.getByText(/Extension options are unavailable/)).toBeTruthy());
  expect(ui.getByLabelText('Submit request')).toBeDisabled();
  expect(apiService.createStayExtension).not.toHaveBeenCalled();
});

test('approved extension needing signing links to Contract details', async () => {
  apiService.getCurrentStayExtension.mockResolvedValue({ data: { current, canRequest: false, request: { status: 'approved', fulfillmentState: 'awaiting_contract', months: 6 } } });
  const ui = render(<ExtendStayScreen />);
  await waitFor(() => expect(ui.getByLabelText('Open Contract')).toBeTruthy());
  expect(ui.queryByLabelText('Submit request')).toBeNull();
});

test('leaving while confirmation is pending does not submit later', async () => {
  let confirm;
  mockAlert.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
  const ui = render(<ExtendStayScreen />);
  await waitFor(() => expect(ui.getByLabelText('Submit request')).toBeTruthy());
  act(() => { fireEvent.press(ui.getByLabelText('Submit request')); });
  ui.unmount();
  await act(async () => confirm('Submit request'));
  expect(apiService.createStayExtension).not.toHaveBeenCalled();
});
test('pending request disables another request and displays its status', async () => {
  apiService.getCurrentStayExtension.mockResolvedValue({ data: { current, canRequest: false, request: { status: 'pending', months: 6, requestedEndDate: option.endDate } } });
  const screen = render(<ExtendStayScreen />);
  await waitFor(() => expect(screen.getByText('Pending Admin Review')).toBeTruthy());
  expect(screen.queryByLabelText('Submit request')).toBeNull();
});

test('foreground and extension notification refresh authoritative status', async () => {
  let foreground;
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_, callback) => { foreground = callback; return { remove: jest.fn() }; });
  const ui = render(<ExtendStayScreen />);
  await waitFor(() => expect(ui.getByText('Your current stay')).toBeTruthy());
  const before = apiService.getCurrentStayExtension.mock.calls.length;
  await act(async () => foreground('active'));
  expect(apiService.getCurrentStayExtension).toHaveBeenCalledTimes(before + 1);
  await act(async () => publishCanonicalNotification({ type: 'stay_extension', notification_id: 'extension-test-refresh' }));
  expect(apiService.getCurrentStayExtension).toHaveBeenCalledTimes(before + 2);
  await act(async () => publishCanonicalNotification({ type: 'renewal_effective', notification_id: 'extension-effective-refresh' }));
  expect(apiService.getCurrentStayExtension).toHaveBeenCalledTimes(before + 3);
  subscription.mockRestore();
});
test('accepted POST with lost response reconciles pending status before displaying success', async () => {
  apiService.createStayExtension.mockRejectedValue(new Error('timeout'));
  const ui = render(<ExtendStayScreen />);
  await waitFor(() => expect(ui.getByLabelText('Submit request')).toBeTruthy());
  apiService.getCurrentStayExtension.mockResolvedValue({ data: { current, canRequest: false, request: { _id: 'new-extension', stayId: current.stayId, monthlyRent: option.monthlyRent, status: 'pending', months: 6, createdAt: '2026-09-15', requestedEndDate: option.endDate } } });
  await act(async () => fireEvent.press(ui.getByLabelText('Submit request')));
  expect(ui.getByText('Pending Admin Review')).toBeTruthy();
  expect(mockAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Request submitted', type: 'success' }));
});

test('a newly observed rejected request is not reported as a recovered submission', async () => {
 apiService.createStayExtension.mockRejectedValue(new Error('timeout'));
 const ui = render(<ExtendStayScreen />);
 await waitFor(() => expect(ui.getByLabelText('Submit request')).toBeTruthy());
 apiService.getCurrentStayExtension.mockResolvedValue({ data: { current, canRequest: false, request: { status: 'rejected', months: 3, createdAt: '2026-09-14', requestedEndDate: '2027-03-31' } } });
 await act(async () => fireEvent.press(ui.getByLabelText('Submit request')));
 expect(mockAlert).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Request submitted' }));
});
