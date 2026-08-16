import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AnnouncementsScreen from '../../app/(tabs)/announcements';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (cb) => { require('react').useEffect(cb, []); },
}));

// The Notifications screen now sources its unified feed directly from
// AuthContext (the backend already merges personal notifications +
// announcements — see services/mobileNotificationBridge.js), instead of
// fetching /announcements independently. This mock models AuthContext as a
// tiny external store so tests can push new `notifications` and have the
// screen re-render, exactly like a real context value change would.
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
      // Referentially stable across re-renders, matching the real
      // AuthContext (useCallback with empty deps) — a fresh function
      // identity every render would break the screen's own useCallback
      // memoization (loadFeed depends on refreshNotifications) and cause
      // its mount effect to re-fire on every unrelated re-render.
      const refreshNotifications = React.useCallback((...args) => mockRefreshNotifications(...args), []);
      const clearNotificationUnread = React.useCallback((...args) => mockClearNotificationUnread(...args), []);
      return {
        notifications: mockAuthStoreState.notifications,
        refreshNotifications,
        clearNotificationUnread,
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
  mockRefreshNotifications.mockImplementation(async () => {
    setAuthStoreNotifications(data);
    return true;
  });
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
    setAuthStoreNotifications([]);
  });

  it('shows a compact toolbar and applies category-plus-priority filters instantly, without marking reads', async () => {
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

    // No separate Apply step — the list updates the instant each option is tapped.
    expect(screen.getByText('Security urgent')).toBeTruthy();
    expect(screen.queryByText('Security normal')).toBeNull();
    expect(screen.queryByText('General urgent')).toBeNull();
    expect(screen.getByLabelText('Open notification filters, 2 active')).toBeTruthy();
    expect(mockClearNotificationUnread).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Done filtering notifications'));
    expect(screen.queryByText('Filter Notifications')).toBeNull();
  });

  it('resets filters to All instantly and preserves urgency as a separate count dimension', async () => {
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
    fireEvent.press(screen.getByLabelText('Done filtering notifications'));
    expect(screen.getByLabelText('Open notification filters, 2 active')).toBeTruthy();

    openFilters(screen, 2);
    fireEvent.press(screen.getByLabelText('Reset notification filters'));
    FIXTURE.forEach((item) => expect(screen.getByText(item.title)).toBeTruthy());
    expect(screen.getByLabelText('All, 4 notifications')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Done filtering notifications'));
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
    fireEvent.press(screen.getByLabelText('Done filtering notifications'));

    expect(screen.getByText('No notifications match these filters')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Clear notification filters'));
    expect(screen.getByText('Security urgent')).toBeTruthy();
  });

  it('guards concurrent refreshes and replaces data without duplicating cards', async () => {
    const screen = await renderLoaded();
    // Isolate the count to just the two presses below — mount/focus already
    // triggered their own (guarded) load before this point.
    mockRefreshNotifications.mockClear();
    let resolveRefresh;
    mockRefreshNotifications.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));

    const refreshButton = screen.getByLabelText('Refresh notifications');
    fireEvent.press(refreshButton);
    fireEvent.press(refreshButton);
    // The in-flight guard (fetchInFlightRef in the screen) coalesces the
    // second press into the still-pending first request rather than firing
    // a second network call.
    expect(mockRefreshNotifications).toHaveBeenCalledTimes(1);

    resolveRefresh(true);
    setAuthStoreNotifications(FIXTURE);
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
    mockRefreshNotifications.mockImplementationOnce(async () => false);
    fireEvent.press(screen.getByLabelText('Refresh notifications'));

    await waitFor(() => expect(screen.getByLabelText('Retry loading notifications')).toBeTruthy());
    expect(screen.getAllByLabelText(/^Notification: /)).toHaveLength(4);

    mockRefreshNotifications.mockImplementationOnce(async () => {
      setAuthStoreNotifications(FIXTURE);
      return true;
    });
    fireEvent.press(screen.getByLabelText('Retry loading notifications'));
    await waitFor(() => expect(screen.queryByLabelText('Retry loading notifications')).toBeNull());
    expect(screen.getAllByLabelText(/^Notification: /)).toHaveLength(4);
  });
});

// Regression coverage for the notification-UI reconciliation task: a
// personal bill notification (from the merged /notifications feed, not
// /announcements) must render in this same screen and offer a "View Bill"
// action that navigates via the same resolveNotificationRoute() used for OS
// push taps — never a client-invented route or a client-supplied bill id
// beyond what the server already attached to the notification.
describe('Notifications screen — personal (bill) notifications', () => {
  const { resolveNotificationRoute } = require('../services/notifications');

  beforeEach(() => {
    jest.clearAllMocks();
    mockClearNotificationUnread.mockResolvedValue();
    setAuthStoreNotifications([]);
  });

  const BILL_NOTIFICATION = {
    notification_id: 'n-bill-1',
    title: 'New Bill Available',
    content: 'Your rent bill for August 2026 is now available.',
    category: 'billing',
    priority: 'normal',
    created_at: '2026-08-16T10:00:00.000Z',
    billing_id: 'bill-abc123',
    type: 'bill_generated',
    read: false,
  };

  it('renders a personal bill notification alongside announcements, newest first', async () => {
    const screen = await renderLoaded([BILL_NOTIFICATION, FIXTURE[1]]);
    expect(screen.getByText('New Bill Available')).toBeTruthy();
    expect(screen.getByText('Security normal')).toBeTruthy();
    // BILL_NOTIFICATION (2026-08-16) is newer than FIXTURE[1] (2026-08-01).
    expect(screen.getAllByLabelText(/^Notification: /)[0].props.accessibilityLabel).toBe('Notification: New Bill Available');
  });

  it('tapping a bill notification opens the detail sheet with a View Bill action that navigates via resolveNotificationRoute using the server-supplied billing_id', async () => {
    const screen = await renderLoaded([BILL_NOTIFICATION]);
    fireEvent.press(screen.getByLabelText('Notification: New Bill Available'));
    const viewBillButton = screen.getByLabelText('View bill');
    expect(viewBillButton).toBeTruthy();

    fireEvent.press(viewBillButton);
    expect(resolveNotificationRoute).toHaveBeenCalledWith({ screen: 'billing', billing_id: 'bill-abc123' });
  });

  it('a billing-category item with no billing_id does not offer a View Bill action (no fabricated navigation)', async () => {
    const screen = await renderLoaded([{ ...BILL_NOTIFICATION, billing_id: '' }]);
    fireEvent.press(screen.getByLabelText('Notification: New Bill Available'));
    expect(screen.queryByLabelText('View bill')).toBeNull();
  });

  it('an announcement item never shows the billing action, even if content mentions billing', async () => {
    const screen = await renderLoaded([FIXTURE[0]]);
    fireEvent.press(screen.getByLabelText('Notification: Security urgent'));
    expect(screen.queryByLabelText('View bill')).toBeNull();
  });
});
