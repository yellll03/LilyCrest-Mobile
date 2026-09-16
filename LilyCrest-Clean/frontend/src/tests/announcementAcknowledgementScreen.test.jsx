import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import AnnouncementsScreen from '../../app/(tabs)/announcements';
import { apiService } from '../services/api';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const mockLoad = jest.fn();
const mockAnnouncement = {
  announcement_id: 'ann_123', title: 'Updated house rules', content: 'Please review the new rules.',
  category: 'rules', created_at: '2026-09-15T08:00:00Z',
  requiresAcknowledgment: true, acknowledged: false,
};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({ announcementId: 'ann_123' }),
  useFocusEffect: (callback) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('../components/assistant/LilyAssistantFab', () => () => null);
jest.mock('../services/notifications', () => ({ resolveNotificationRoute: jest.fn() }));
jest.mock('../services/api', () => ({ apiService: {
  getAnnouncement: jest.fn(), markAnnouncementRead: jest.fn(), acknowledgeAnnouncement: jest.fn(),
} }));
jest.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ colors: require('../theme/tokens').LIGHT_COLORS }),
  useThemedStyles: (factory) => factory(require('../theme/tokens').LIGHT_COLORS, false),
}));
jest.mock('../hooks/useCanonicalAnnouncements', () => ({
  getCanonicalAnnouncementId: (item) => item?.announcement_id || '',
  MAX_ANNOUNCEMENT_DISMISS_IDS: 100,
  useCanonicalAnnouncements: () => ({
    announcements: [mockAnnouncement], hasLoadedOnce: true, refreshing: false,
    loadAnnouncements: mockLoad, dismissalInFlight: false,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  apiService.markAnnouncementRead.mockResolvedValue({ data: mockAnnouncement });
  apiService.getAnnouncement.mockResolvedValue({ data: mockAnnouncement });
  apiService.acknowledgeAnnouncement.mockResolvedValue({ data: {
    ...mockAnnouncement, acknowledged: true, acknowledgedAt: '2026-09-16T08:00:00Z',
  } });
});

it('opening details records a read and requires an explicit acknowledgement tap', async () => {
  const ui = render(<AnnouncementsScreen />);
  await waitFor(() => expect(apiService.markAnnouncementRead).toHaveBeenCalledWith('ann_123'));
  expect(ui.getByLabelText('Acknowledge')).toBeTruthy();
  expect(apiService.acknowledgeAnnouncement).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(ui.getByLabelText('Acknowledge')); });
  expect(apiService.acknowledgeAnnouncement).toHaveBeenCalledWith('ann_123');
  expect(ui.queryByLabelText('Acknowledge')).toBeNull();
  expect(ui.getByText(/^Acknowledged on/)).toBeTruthy();
  expect(mockLoad).toHaveBeenCalled();
});

it('locks duplicate taps and ignores an older detail response after confirmation', async () => {
  let completeRead, completeAck;
  apiService.markAnnouncementRead.mockImplementation(() => new Promise(resolve => { completeRead = resolve; }));
  apiService.acknowledgeAnnouncement.mockImplementation(() => new Promise(resolve => { completeAck = resolve; }));
  const ui = render(<AnnouncementsScreen />);
  await waitFor(() => expect(ui.getByLabelText('Acknowledge')).toBeTruthy());
  await act(async () => {
    const button = ui.getByLabelText('Acknowledge');
    fireEvent.press(button); fireEvent.press(button);
  });
  expect(apiService.acknowledgeAnnouncement).toHaveBeenCalledTimes(1);
  expect(ui.getByLabelText('Acknowledging...')).toBeDisabled();
  await act(async () => completeAck({ data: { ...mockAnnouncement, acknowledged: true } }));
  await act(async () => completeRead({ data: mockAnnouncement }));
  expect(ui.getByText('Acknowledged')).toBeTruthy();
  expect(ui.queryByLabelText('Acknowledge')).toBeNull();
});

it('shows a retryable failure without claiming acknowledgement', async () => {
  apiService.acknowledgeAnnouncement.mockRejectedValue(new Error('offline'));
  const ui = render(<AnnouncementsScreen />);
  await waitFor(() => expect(ui.getByLabelText('Acknowledge')).toBeTruthy());
  await act(async () => fireEvent.press(ui.getByLabelText('Acknowledge')));
  expect(ui.getByText(/couldn't confirm your acknowledgement/)).toBeTruthy();
  expect(ui.queryByText('Acknowledged')).toBeNull();
  expect(ui.getByLabelText('Acknowledge')).not.toBeDisabled();
  apiService.acknowledgeAnnouncement.mockResolvedValue({ data: { ...mockAnnouncement, acknowledged: true } });
  await act(async () => fireEvent.press(ui.getByLabelText('Acknowledge')));
  expect(ui.getByText('Acknowledged')).toBeTruthy();
});

it('closing during the confirmation read prevents a later acknowledgement write', async () => {
  let resolveRead;
  apiService.getAnnouncement.mockImplementation(() => new Promise(resolve => { resolveRead = resolve; }));
  const ui = render(<AnnouncementsScreen />);
  await waitFor(() => expect(ui.getByLabelText('Acknowledge')).toBeTruthy());
  act(() => { fireEvent.press(ui.getByLabelText('Acknowledge')); });
  act(() => { fireEvent.press(ui.getByLabelText('Close announcement')); });
  await act(async () => resolveRead({ data: mockAnnouncement }));
  expect(apiService.acknowledgeAnnouncement).not.toHaveBeenCalled();
});

it.each([
  { ...mockAnnouncement, requiresAcknowledgment: false },
  { ...mockAnnouncement, acknowledged: true },
])('does not offer acknowledgement for an announcement that needs no action', async (data) => {
  apiService.markAnnouncementRead.mockResolvedValue({ data });
  const ui = render(<AnnouncementsScreen />);
  await waitFor(() => expect(ui.queryByLabelText('Acknowledge')).toBeNull());
  expect(apiService.acknowledgeAnnouncement).not.toHaveBeenCalled();
});
