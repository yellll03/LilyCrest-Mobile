// Regression test for the performance-audit finding: announcements.jsx
// rendered its list via an unbounded ScrollView + .map(), with no
// virtualization — every announcement's card mounted at once regardless of
// list length. Migrated to FlatList while preserving refresh behavior,
// empty state, and navigation into the detail sheet. Renders the real
// screen with only its data dependencies mocked — not a source-string
// assertion.
//
// The screen's data source is the dedicated useCanonicalAnnouncements()
// hook (GET /announcements only — Home's notification bell stays on its own
// AuthContext-owned /notifications feed, see homeNotificationCanonicalState.test.js).
// This file's mock models that hook as a tiny external store so tests can
// push new announcement lists and have the screen re-render, exactly like a
// real hook state change would.

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import AnnouncementsScreen from '../../app/(tabs)/announcements';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (cb) => { require('react').useEffect(cb, []); },
}));

const mockLoadAnnouncements = jest.fn();
const mockDismissAnnouncements = jest.fn();
let mockStoreState = { announcements: [] };
let mockStoreListeners = [];
function setStoreAnnouncements(announcements) {
  mockStoreState = { announcements };
  mockStoreListeners.forEach((listener) => listener());
}

jest.mock('../../src/hooks/useCanonicalAnnouncements', () => {
  const React = require('react');
  return {
    MAX_ANNOUNCEMENT_DISMISS_IDS: 100,
    getCanonicalAnnouncementId: (item) => String(item?.announcement_id || '').trim(),
    useCanonicalAnnouncements: () => {
      const [, forceRender] = React.useState(0);
      React.useEffect(() => {
        const listener = () => forceRender((tick) => tick + 1);
        mockStoreListeners.push(listener);
        return () => { mockStoreListeners = mockStoreListeners.filter((l) => l !== listener); };
      }, []);
      const loadAnnouncements = React.useCallback((...args) => mockLoadAnnouncements(...args), []);
      const dismissAnnouncements = React.useCallback((...args) => mockDismissAnnouncements(...args), []);
      return {
        announcements: mockStoreState.announcements,
        hasLoadedOnce: mockStoreState.hasLoadedOnce ?? true,
        refreshing: false,
        fetchError: mockStoreState.fetchError ?? null,
        submittingIds: new Set(),
        dismissalInFlight: false,
        loadAnnouncements,
        dismissAnnouncements,
      };
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
    mockStoreState = { announcements: [], hasLoadedOnce: true, fetchError: null };
  });

  it('renders the list through FlatList, not a plain ScrollView + map', async () => {
    setStoreAnnouncements([announcement()]);
    const { UNSAFE_getByType, getByText } = render(<AnnouncementsScreen />);
    await waitFor(() => expect(getByText('Water interruption tomorrow')).toBeTruthy());
    expect(UNSAFE_getByType(FlatList)).toBeTruthy();
  });

  it('shows the empty state when there are no announcements', async () => {
    setStoreAnnouncements([]);
    const { getByText } = render(<AnnouncementsScreen />);
    await waitFor(() => expect(getByText('No announcements yet')).toBeTruthy());
  });

  it('shows a safe error banner instead of crashing when the fetch fails', async () => {
    mockStoreState = { announcements: [], hasLoadedOnce: true, fetchError: 'Unable to load announcements. Pull down to refresh.' };
    const { getByText } = render(<AnnouncementsScreen />);
    await waitFor(() => expect(getByText('Could not load announcements')).toBeTruthy());
  });

  it('tapping an announcement opens its detail sheet with the full content', async () => {
    setStoreAnnouncements([announcement({ title: 'Tap me' })]);
    const { getByText, getAllByText } = render(<AnnouncementsScreen />);
    await waitFor(() => expect(getByText('Tap me')).toBeTruthy());

    fireEvent.press(getByText('Tap me'));
    // The card title and the modal's title both render "Tap me" once opened.
    await waitFor(() => expect(getAllByText('Tap me').length).toBeGreaterThanOrEqual(2));
  });
});
