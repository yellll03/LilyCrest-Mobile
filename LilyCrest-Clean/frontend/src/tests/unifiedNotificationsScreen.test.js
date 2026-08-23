/* global test */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import NotificationsScreen from '../../app/notifications';

const mockPush = jest.fn();
const mockRefresh = jest.fn().mockResolvedValue(true);
const mockMarkRead = jest.fn().mockResolvedValue();
const mockMarkAllRead = jest.fn().mockResolvedValue();
const mockDismiss = jest.fn().mockResolvedValue(true);
const mockClear = jest.fn().mockResolvedValue();
const mockShowAlert = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true }),
}));

jest.mock('../context/AlertContext', () => ({
  useAlert: () => ({ showAlert: mockShowAlert }),
}));

const FIXTURE = [
  { notification_id: 'bill-1', type: 'bill_released', billing_id: 'billing-record', title: 'New bill', body: 'Your bill is ready.', read: false, created_at: '2026-08-24T01:00:00.000Z' },
  { notification_id: 'announcement-1', type: 'announcement', announcement_id: 'news-record', title: 'Branch notice', body: 'Water interruption.', read: true, created_at: '2026-08-24T00:00:00.000Z' },
];

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    notifications: FIXTURE,
    notificationUnreadCount: 1,
    refreshNotifications: mockRefresh,
    markNotificationRead: mockMarkRead,
    clearNotificationUnread: mockMarkAllRead,
    dismissNotification: mockDismiss,
    clearNotifications: mockClear,
  }),
}));

const mockColors = {
  background: '#fff', surface: '#fff', surfaceSecondary: '#eee', text: '#111', heading: '#000',
  textSecondary: '#555', textMuted: '#777', border: '#ddd', accent: '#D4AF37', accentHover: '#B9921F',
  accentSubtle: '#FBF7EA', interactive: '#0A1628', error: '#DC2626', errorBg: '#FEF2F2',
  errorText: '#991B1B', info: '#2563EB', infoBg: '#EFF6FF', warning: '#D97706', warningBg: '#FFFBEB',
  success: '#059669', successBg: '#ECFDF5', iconSecondary: '#555', headerBg: '#0A1628',
};

jest.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ colors: mockColors, isDarkMode: false }),
  useThemedStyles: (factory) => factory(mockColors, false),
}));

describe('Notifications unified screen behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefresh.mockResolvedValue(true);
  });

  test('renders mixed types and routes a billing item to bill details', async () => {
    const screen = render(<NotificationsScreen />);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(screen.getByText('New bill')).toBeTruthy();
    expect(screen.getByText('Branch notice')).toBeTruthy();

    fireEvent.press(screen.getByText('New bill'));

    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith('bill-1'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/bill-details', params: { billId: 'billing-record' } });
  });

  test('Unread filter, mark-all, dismiss, and clear use canonical AuthContext actions', async () => {
    mockShowAlert.mockResolvedValueOnce('Clear');
    const screen = render(<NotificationsScreen />);
    await waitFor(() => expect(screen.getByText('Branch notice')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('Show unread notifications'));
    expect(screen.getByText('New bill')).toBeTruthy();
    expect(screen.queryByText('Branch notice')).toBeNull();

    fireEvent.press(screen.getByLabelText('Mark all notifications read'));
    expect(mockMarkAllRead).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText('Dismiss notification'));
    expect(mockDismiss).toHaveBeenCalledWith('bill-1');

    fireEvent.press(screen.getByLabelText('Clear notifications'));
    await waitFor(() => expect(mockClear).toHaveBeenCalledTimes(1));
  });
});
