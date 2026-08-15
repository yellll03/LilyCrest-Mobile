// Regression test for the performance-audit finding: announcements.jsx
// rendered its list via an unbounded ScrollView + .map(), with no
// virtualization — every announcement's card mounted at once regardless of
// list length. Migrated to FlatList while preserving refresh behavior,
// empty state, and navigation into the detail sheet. Renders the real
// screen with only its data dependencies mocked — not a source-string
// assertion.

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import AnnouncementsScreen from '../../app/(tabs)/announcements';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (cb) => { require('react').useEffect(cb, []); },
}));

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ clearNotificationUnread: jest.fn().mockResolvedValue() }),
}));

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

const mockGetAnnouncements = jest.fn();

jest.mock('../services/api', () => ({
  apiService: { getAnnouncements: (...args) => mockGetAnnouncements(...args) },
  getApiErrorMessage: (error, fallback) => fallback,
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
  beforeEach(() => jest.clearAllMocks());

  it('renders the list through FlatList, not a plain ScrollView + map', async () => {
    mockGetAnnouncements.mockResolvedValue({ data: [announcement()] });
    const { UNSAFE_getByType, getByText } = render(<AnnouncementsScreen />);
    await waitFor(() => expect(getByText('Water interruption tomorrow')).toBeTruthy());
    expect(UNSAFE_getByType(FlatList)).toBeTruthy();
  });

  it('shows the empty state when there are no announcements', async () => {
    mockGetAnnouncements.mockResolvedValue({ data: [] });
    const { getByText } = render(<AnnouncementsScreen />);
    await waitFor(() => expect(getByText('No notifications yet')).toBeTruthy());
  });

  it('shows a safe error banner instead of crashing when the fetch fails', async () => {
    mockGetAnnouncements.mockRejectedValue(new Error('network down'));
    const { getByText } = render(<AnnouncementsScreen />);
    await waitFor(() => expect(getByText('Could not load notifications')).toBeTruthy());
  });

  it('tapping an announcement opens its detail sheet with the full content', async () => {
    mockGetAnnouncements.mockResolvedValue({ data: [announcement({ title: 'Tap me' })] });
    const { getByText, getAllByText } = render(<AnnouncementsScreen />);
    await waitFor(() => expect(getByText('Tap me')).toBeTruthy());

    fireEvent.press(getByText('Tap me'));
    // The card title and the modal's title both render "Tap me" once opened.
    await waitFor(() => expect(getAllByText('Tap me').length).toBeGreaterThanOrEqual(2));
  });
});
