import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AnnouncementsScreen from '../../app/(tabs)/announcements';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (cb) => { require('react').useEffect(cb, []); },
}));

const mockClearNotificationUnread = jest.fn().mockResolvedValue();

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ clearNotificationUnread: (...args) => mockClearNotificationUnread(...args) }),
}));

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

const mockGetAnnouncements = jest.fn();

jest.mock('../services/api', () => ({
  apiService: { getAnnouncements: (...args) => mockGetAnnouncements(...args) },
  getApiErrorMessage: (_error, fallback) => fallback,
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
  mockGetAnnouncements.mockResolvedValue({ data });
  const screen = render(<AnnouncementsScreen />);
  if (data.length) await waitFor(() => expect(screen.getByText(data[0].title)).toBeTruthy());
  else await waitFor(() => expect(screen.getByText('No notifications yet')).toBeTruthy());
  return screen;
}

function openFilters(screen, activeCount = 0) {
  const label = activeCount
    ? `Open notification filters, ${activeCount} active`
    : 'Open notification filters';
  fireEvent.press(screen.getByLabelText(label));
}

describe('Notifications screen compact filter UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClearNotificationUnread.mockResolvedValue();
  });

  it('shows a compact toolbar and applies category-plus-priority filters without marking reads', async () => {
    const screen = await renderLoaded();
    expect(screen.getByLabelText('Open notification filters')).toBeTruthy();
    expect(screen.getByLabelText('Sort order: Newest')).toBeTruthy();
    expect(screen.getByLabelText('Refresh notifications')).toBeTruthy();
    expect(screen.queryByText('Filter Notifications')).toBeNull();

    await waitFor(() => expect(mockClearNotificationUnread).toHaveBeenCalledTimes(1));
    mockClearNotificationUnread.mockClear();

    openFilters(screen);
    fireEvent.press(screen.getByLabelText('Security, 2 notifications'));
    fireEvent.press(screen.getByLabelText('Urgent priority, 1 notification'));
    fireEvent.press(screen.getByLabelText('Apply notification filters'));

    expect(screen.getByText('Security urgent')).toBeTruthy();
    expect(screen.queryByText('Security normal')).toBeNull();
    expect(screen.queryByText('General urgent')).toBeNull();
    expect(screen.getByLabelText('Open notification filters, 2 active')).toBeTruthy();
    expect(mockClearNotificationUnread).not.toHaveBeenCalled();
  });

  it('resets applied filters to All and preserves urgency as a separate count dimension', async () => {
    const screen = await renderLoaded();
    openFilters(screen);

    expect(screen.getByLabelText('All, 4 notifications')).toBeTruthy();
    expect(screen.getByLabelText('Security, 2 notifications')).toBeTruthy();
    expect(screen.getByLabelText('Urgent priority, 2 notifications')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Security, 2 notifications'));
    expect(screen.getByLabelText('Urgent priority, 1 notification')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Urgent priority, 1 notification'));
    expect(screen.getByLabelText('All, 2 notifications')).toBeTruthy();
    expect(screen.getByLabelText('Security, 1 notification')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Apply notification filters'));

    openFilters(screen, 2);
    fireEvent.press(screen.getByLabelText('Reset notification filters'));
    fireEvent.press(screen.getByLabelText('Apply notification filters'));
    FIXTURE.forEach((item) => expect(screen.getByText(item.title)).toBeTruthy());
    expect(screen.getByLabelText('Open notification filters')).toBeTruthy();
  });

  it('sorts newest and oldest while keeping the source list immutable', async () => {
    const screen = await renderLoaded();
    expect(screen.getAllByLabelText(/^Notification: /)[0].props.accessibilityLabel).toBe('Notification: Event low');

    fireEvent.press(screen.getByLabelText('Sort order: Newest'));
    expect(screen.getAllByLabelText(/^Notification: /)[0].props.accessibilityLabel).toBe('Notification: Security normal');
    expect(FIXTURE.map((item) => item.announcement_id)).toEqual([
      'security-urgent', 'security-normal', 'general-urgent', 'event-low',
    ]);
  });

  it('distinguishes an empty inbox from filters with zero matches and offers Clear filters', async () => {
    const emptyScreen = await renderLoaded([]);
    expect(emptyScreen.getByText('Updates from LilyCrest will appear here.')).toBeTruthy();
    emptyScreen.unmount();

    const screen = await renderLoaded();
    openFilters(screen);
    fireEvent.press(screen.getByLabelText('Event, 1 notification'));
    fireEvent.press(screen.getByLabelText('Urgent priority, 0 notifications'));
    fireEvent.press(screen.getByLabelText('Apply notification filters'));

    expect(screen.getByText('No notifications match these filters')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Clear notification filters'));
    expect(screen.getByText('Security urgent')).toBeTruthy();
  });

  it('guards concurrent refreshes and replaces data without duplicating cards', async () => {
    const screen = await renderLoaded();
    let resolveRefresh;
    mockGetAnnouncements.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));

    const refreshButton = screen.getByLabelText('Refresh notifications');
    fireEvent.press(refreshButton);
    fireEvent.press(refreshButton);
    expect(mockGetAnnouncements).toHaveBeenCalledTimes(2);

    resolveRefresh({ data: FIXTURE });
    await waitFor(() => expect(screen.getAllByLabelText(/^Notification: /)).toHaveLength(4));
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
    mockGetAnnouncements.mockRejectedValueOnce(new Error('offline'));
    fireEvent.press(screen.getByLabelText('Refresh notifications'));

    await waitFor(() => expect(screen.getByLabelText('Retry loading notifications')).toBeTruthy());
    expect(screen.getAllByLabelText(/^Notification: /)).toHaveLength(4);

    mockGetAnnouncements.mockResolvedValueOnce({ data: FIXTURE });
    fireEvent.press(screen.getByLabelText('Retry loading notifications'));
    await waitFor(() => expect(screen.queryByLabelText('Retry loading notifications')).toBeNull());
    expect(screen.getAllByLabelText(/^Notification: /)).toHaveLength(4);
  });
});
