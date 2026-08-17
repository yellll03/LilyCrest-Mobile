// Regression test for the performance-audit finding: announcements.jsx
// rendered its list via an unbounded ScrollView + .map(), with no
// virtualization — every announcement's card mounted at once regardless of
// list length. Migrated to FlatList while preserving refresh behavior,
// empty state, and navigation into the detail sheet. Renders the real
// screen with only its data dependencies mocked — not a source-string
// assertion.
//
// The screen's data source later moved from an independent GET
// /announcements fetch to AuthContext's already-unified `notifications`
// feed (see notificationsFilterUi.test.js for the fuller mock/rationale);
// this file's mock was updated to match, keeping its own focus on
// virtualization/empty/error/tap behavior.

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import AnnouncementsScreen from '../../app/(tabs)/announcements';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (cb) => { require('react').useEffect(cb, []); },
}));

const mockClearNotificationUnread = jest.fn().mockResolvedValue();
const mockRefreshNotifications = jest.fn();
let mockAuthStoreState = { notifications: [] };
let mockAuthStoreListeners = [];
function setAuthStoreNotifications(notifications) {
  mockAuthStoreState = { notifications };
  mockAuthStoreListeners.forEach((listener) => listener());
}

jest.mock('../context/AuthContext', () => {
  const React = require('react');
  return {
    useAuth: () => {
      const [, forceRender] = React.useState(0);
      React.useEffect(() => {
        const listener = () => forceRender((tick) => tick + 1);
        mockAuthStoreListeners.push(listener);
        return () => { mockAuthStoreListeners = mockAuthStoreListeners.filter((l) => l !== listener); };
      }, []);
      const refreshNotifications = React.useCallback((...args) => mockRefreshNotifications(...args), []);
      const clearNotificationUnread = React.useCallback((...args) => mockClearNotificationUnread(...args), []);
      return { notifications: mockAuthStoreState.notifications, refreshNotifications, clearNotificationUnread };
    },
  };
});

jest.mock('../context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff', text: '#000', textSecondary: '#666', textMuted: '#999',
      surface: '#f5f5f5', surfaceSecondary: '#eee', border: '#ddd', accent: '#204B7E', primary: '#204B7E',
    },
  }),
  useThemedStyles: (fn) => fn({
    background: '#fff', text: '#000', textSecondary: '#666', textMuted: '#999',
    surface: '#f5f5f5', surfaceSecondary: '#eee', border: '#ddd', accent: '#204B7E', primary: '#204B7E',
  }, false),
}));

jest.mock('../context/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('../services/notifications', () => ({
  resolveNotificationRoute: jest.fn(() => '/survey-form'),
}));

function announcement(overrides = {}) {
  return {
    announcement_id: 'ann-1',
    title: 'Water interruption tomorrow',
    content: 'Please store water in advance.',
    category: 'Announcement',
    priority: 'normal',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('announcements list virtualization and behavior (regression)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClearNotificationUnread.mockResolvedValue();
    setAuthStoreNotifications([]);
  });

  it('renders the list through FlatList, not a plain ScrollView + map', async () => {
    mockRefreshNotifications.mockImplementation(async () => { setAuthStoreNotifications([announcement()]); return true; });
    const { UNSAFE_getByType, getByText } = render(<AnnouncementsScreen />);
    await waitFor(() => expect(getByText('Water interruption tomorrow')).toBeTruthy());
    expect(UNSAFE_getByType(FlatList)).toBeTruthy();
  });

  it('shows the empty state when there are no announcements', async () => {
    mockRefreshNotifications.mockImplementation(async () => { setAuthStoreNotifications([]); return true; });
    const { getByText } = render(<AnnouncementsScreen />);
    await waitFor(() => expect(getByText('No notifications yet')).toBeTruthy());
  });

  it('shows a safe error banner instead of crashing when the fetch fails', async () => {
    mockRefreshNotifications.mockImplementation(async () => false);
    const { getByText } = render(<AnnouncementsScreen />);
    await waitFor(() => expect(getByText('Could not load notifications')).toBeTruthy());
  });

  it('tapping an announcement opens its detail sheet with the full content', async () => {
    mockRefreshNotifications.mockImplementation(async () => { setAuthStoreNotifications([announcement({ title: 'Tap me' })]); return true; });
    const { getByText, getAllByText } = render(<AnnouncementsScreen />);
    await waitFor(() => expect(getByText('Tap me')).toBeTruthy());

    fireEvent.press(getByText('Tap me'));
    // The card title and the modal's title both render "Tap me" once opened.
    await waitFor(() => expect(getAllByText('Tap me').length).toBeGreaterThanOrEqual(2));
  });
});
