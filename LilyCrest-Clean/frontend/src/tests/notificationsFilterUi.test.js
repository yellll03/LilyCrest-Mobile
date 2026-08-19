import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AnnouncementsScreen from '../../app/(tabs)/announcements';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb) => { require('react').useEffect(cb, []); },
}));

// The Announcements screen sources its list from the dedicated
// useCanonicalAnnouncements() hook (GET /announcements only) — Home's bell
// stays on AuthContext's separate /notifications feed, and never appears
// here (see homeNotificationCanonicalState.test.js and
// canonicalAnnouncements.test.js for that isolation and the dismiss/bulk
// contract respectively). This mock models the hook as a tiny external
// store so tests can push new announcement lists and have the screen
// re-render, exactly like a real hook state change would.
const mockLoadAnnouncements = jest.fn();
const mockDismissAnnouncements = jest.fn();
let mockStoreState = { announcements: [] };
let mockStoreListeners = [];
function setStoreAnnouncements(announcements) {
  mockStoreState = { ...mockStoreState, announcements };
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
      // Referentially stable across re-renders (useCallback with empty deps),
      // matching the real hook — a fresh function identity every render
      // would break the screen's own useCallback memoization and cause
      // effects depending on it to re-fire on every unrelated re-render.
      const loadAnnouncements = React.useCallback((...args) => mockLoadAnnouncements(...args), []);
      const dismissAnnouncements = React.useCallback((...args) => mockDismissAnnouncements(...args), []);
      return {
        announcements: mockStoreState.announcements,
        hasLoadedOnce: mockStoreState.hasLoadedOnce ?? true,
        refreshing: mockStoreState.refreshing ?? false,
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
      background: '#fff', text: '#000', textSecondary: '#666', textMuted: '#777',
      surface: '#fff', surfaceSecondary: '#eee', border: '#ddd', accent: '#204B7E', primary: '#204B7E',
    },
  }),
  useThemedStyles: (fn) => fn({
    background: '#fff', text: '#000', textSecondary: '#666', textMuted: '#777',
    surface: '#fff', surfaceSecondary: '#eee', border: '#ddd', accent: '#204B7E', primary: '#204B7E',
  }, false),
}));

jest.mock('../context/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('../services/notifications', () => ({
  resolveNotificationRoute: jest.fn(() => '/survey-form'),
}));

const FIXTURE = [
  {
    announcement_id: 'security-urgent', title: 'Security urgent', content: 'Security update.',
    category: 'Security', priority: 'high', created_at: '2026-08-03T00:00:00.000Z',
  },
  {
    announcement_id: 'security-normal', title: 'Security normal', content: 'Routine security update.',
    category: 'security', priority: 'normal', created_at: '2026-08-01T00:00:00.000Z',
  },
  {
    announcement_id: 'general-urgent', title: 'General urgent', content: 'Urgent general update.',
    category: 'General', priority: 'normal', is_urgent: true, created_at: '2026-08-02T00:00:00.000Z',
  },
  {
    announcement_id: 'event-low', title: 'Event low', content: 'Community event update.',
    category: 'Event', priority: 'low', created_at: '2026-08-04T00:00:00.000Z',
  },
];

async function renderLoaded(data = FIXTURE) {
  setStoreAnnouncements(data);
  const screen = render(<AnnouncementsScreen />);
  if (data.length) await waitFor(() => expect(screen.getByText(data[0].title)).toBeTruthy());
  else await waitFor(() => expect(screen.getByText('No announcements yet')).toBeTruthy());
  return screen;
}

function openFilters(screen, activeCount = 0) {
  const label = activeCount
    ? `Open announcement filters, ${activeCount} active`
    : 'Open announcement filters';
  fireEvent.press(screen.getByLabelText(label));
}

describe('Announcements screen compact filter UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreState = { announcements: [], hasLoadedOnce: true, refreshing: false, fetchError: null };
  });

  it('shows a compact toolbar and applies category-plus-priority filters instantly', async () => {
    const screen = await renderLoaded();
    expect(screen.getByLabelText('Open announcement filters')).toBeTruthy();
    expect(screen.getByLabelText('Sort order: Newest')).toBeTruthy();
    expect(screen.getByLabelText('Refresh announcements')).toBeTruthy();
    expect(screen.queryByText('Filter Announcements')).toBeNull();

    openFilters(screen);
    fireEvent.press(screen.getByLabelText('Security, 2 announcements'));
    fireEvent.press(screen.getByLabelText('Urgent priority, 1 announcement'));

    // No separate Apply step — the list updates the instant each option is tapped.
    expect(screen.getByText('Security urgent')).toBeTruthy();
    expect(screen.queryByText('Security normal')).toBeNull();
    expect(screen.queryByText('General urgent')).toBeNull();
    expect(screen.getByLabelText('Open announcement filters, 2 active')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Done filtering announcements'));
    expect(screen.queryByText('Filter Announcements')).toBeNull();
  });

  it('resets filters to All instantly and preserves urgency as a separate count dimension', async () => {
    const screen = await renderLoaded();
    openFilters(screen);

    expect(screen.getByLabelText('All, 4 announcements')).toBeTruthy();
    expect(screen.getByLabelText('Security, 2 announcements')).toBeTruthy();
    expect(screen.getByLabelText('Urgent priority, 2 announcements')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Security, 2 announcements'));
    expect(screen.getByLabelText('Urgent priority, 1 announcement')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Urgent priority, 1 announcement'));
    expect(screen.getByLabelText('All, 2 announcements')).toBeTruthy();
    expect(screen.getByLabelText('Security, 1 announcement')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Done filtering announcements'));
    expect(screen.getByLabelText('Open announcement filters, 2 active')).toBeTruthy();

    openFilters(screen, 2);
    fireEvent.press(screen.getByLabelText('Reset announcement filters'));
    FIXTURE.forEach((item) => expect(screen.getByText(item.title)).toBeTruthy());
    expect(screen.getByLabelText('All, 4 announcements')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Done filtering announcements'));
    expect(screen.getByLabelText('Open announcement filters')).toBeTruthy();
  });

  it('sorts newest and oldest while keeping the source list immutable', async () => {
    const screen = await renderLoaded();
    expect(screen.getAllByLabelText(/^Announcement: /)[0].props.accessibilityLabel).toBe('Announcement: Event low');

    fireEvent.press(screen.getByLabelText('Sort order: Newest'));
    expect(screen.getAllByLabelText(/^Announcement: /)[0].props.accessibilityLabel).toBe('Announcement: Security normal');
    expect(FIXTURE.map((item) => item.announcement_id)).toEqual([
      'security-urgent', 'security-normal', 'general-urgent', 'event-low',
    ]);
  });

  it('distinguishes an empty inbox from filters with zero matches and offers Clear filters', async () => {
    const emptyScreen = await renderLoaded([]);
    expect(emptyScreen.getByText('News and announcements from LilyCrest will appear here.')).toBeTruthy();
    emptyScreen.unmount();

    const screen = await renderLoaded();
    openFilters(screen);
    fireEvent.press(screen.getByLabelText('Event, 1 announcement'));
    fireEvent.press(screen.getByLabelText('Urgent priority, 0 announcements'));
    fireEvent.press(screen.getByLabelText('Done filtering announcements'));

    expect(screen.getByText('No announcements match these filters')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Clear announcement filters'));
    expect(screen.getByText('Security urgent')).toBeTruthy();
  });

  it('keeps long titles and bodies constrained in card preview layout', async () => {
    const longTitle = 'A very long notification title '.repeat(8).trim();
    const longBody = 'A long notification body intended to verify compact mobile rendering. '.repeat(8).trim();
    const screen = await renderLoaded([{
      ...FIXTURE[0], announcement_id: 'long', title: longTitle, content: longBody,
    }]);

    expect(screen.getByText(longTitle).props.numberOfLines).toBe(2);
    expect(screen.getByText(longBody).props.numberOfLines).toBe(3);
  });

  it('keeps the last successful list on refresh failure and exposes Retry', async () => {
    const screen = await renderLoaded();

    act(() => {
      mockStoreState = { ...mockStoreState, fetchError: 'Unable to load announcements. Pull down to refresh.' };
      mockStoreListeners.forEach((listener) => listener());
    });
    fireEvent.press(screen.getByLabelText('Refresh announcements'));

    await waitFor(() => expect(screen.getByLabelText('Retry loading announcements')).toBeTruthy());
    expect(screen.getAllByLabelText(/^Announcement: /)).toHaveLength(4);

    fireEvent.press(screen.getByLabelText('Retry loading announcements'));
    expect(mockLoadAnnouncements).toHaveBeenCalled();
    act(() => {
      mockStoreState = { ...mockStoreState, fetchError: null };
      mockStoreListeners.forEach((listener) => listener());
    });
    await waitFor(() => expect(screen.queryByLabelText('Retry loading announcements')).toBeNull());
    expect(screen.getAllByLabelText(/^Announcement: /)).toHaveLength(4);
  });
});
