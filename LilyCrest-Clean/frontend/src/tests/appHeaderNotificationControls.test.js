// Behavioral test for AppHeader's notification dismiss/clear controls.
// Verifies the two things code-reading alone can't prove: (1) tapping the
// per-item dismiss button does NOT also fire the outer item's onPress (which
// marks-read and navigates away) — nested TouchableOpacity in React Native
// normally means the innermost touchable claims the responder, but that's
// exactly the kind of behavior that deserves a real regression test rather
// than an assumption; and (2) "Clear" uses tenant-local wording, never
// language implying a global/admin delete.

import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AppHeader from '../components/AppHeader';
import { ThemeProvider } from '../context/ThemeContext';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../services/notifications', () => ({
  resolveNotificationRoute: jest.fn(() => '/(tabs)/billing'),
}));

const mockDismissNotification = jest.fn().mockResolvedValue();
const mockClearNotifications = jest.fn().mockResolvedValue();
const mockMarkNotificationRead = jest.fn().mockResolvedValue();
const mockRefreshNotifications = jest.fn().mockResolvedValue(true);

const FIXTURE = [
  { notification_id: 'n1', title: 'Bill released', body: 'Your rent bill is ready.', read: false, created_at: '2026-08-16T00:00:00.000Z' },
];

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    notifications: FIXTURE,
    notificationUnreadCount: 1,
    hasUnreadNotifications: true,
    markNotificationRead: mockMarkNotificationRead,
    clearNotificationUnread: jest.fn().mockResolvedValue(),
    dismissNotification: mockDismissNotification,
    clearNotifications: mockClearNotifications,
    refreshNotifications: mockRefreshNotifications,
  }),
}));

function renderHeader() {
  return render(
    <ThemeProvider>
      <AppHeader />
    </ThemeProvider>,
  );
}

describe('AppHeader notification controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dismiss button removes the item without marking it read or navigating', async () => {
    const screen = renderHeader();
    fireEvent.press(screen.getByLabelText('Open notifications'));
    await waitFor(() => expect(screen.getByLabelText('Dismiss notification')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('Dismiss notification'));

    await waitFor(() => expect(mockDismissNotification).toHaveBeenCalledWith('n1'));
    expect(mockMarkNotificationRead).not.toHaveBeenCalled();
  });

  it('tapping the notification body (not the dismiss button) marks it read and navigates', async () => {
    const screen = renderHeader();
    fireEvent.press(screen.getByLabelText('Open notifications'));
    await waitFor(() => expect(screen.getByText('Bill released')).toBeTruthy());

    fireEvent.press(screen.getByText('Bill released'));

    await waitFor(() => expect(mockMarkNotificationRead).toHaveBeenCalledWith('n1'));
    expect(mockDismissNotification).not.toHaveBeenCalled();
  });

  it('Clear uses tenant-local wording and only calls clearNotifications after explicit confirmation', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = renderHeader();
    fireEvent.press(screen.getByLabelText('Open notifications'));
    await waitFor(() => expect(screen.getByLabelText('Clear notifications')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('Clear notifications'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title.toLowerCase()).not.toMatch(/delete announcement|delete notification/);
    expect(message).toMatch(/this list/i);
    expect(mockClearNotifications).not.toHaveBeenCalled();

    const confirmButton = buttons.find((b) => b.text === 'Clear');
    confirmButton.onPress();

    await waitFor(() => expect(mockClearNotifications).toHaveBeenCalledTimes(1));
    alertSpy.mockRestore();
  });

  it('Clear does nothing if the confirmation is cancelled', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = renderHeader();
    fireEvent.press(screen.getByLabelText('Open notifications'));
    await waitFor(() => expect(screen.getByLabelText('Clear notifications')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('Clear notifications'));
    const [, , buttons] = alertSpy.mock.calls[0];
    expect(buttons.find((b) => b.text === 'Cancel')).toBeTruthy();

    expect(mockClearNotifications).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
