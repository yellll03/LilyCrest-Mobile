// Regression test: category filter chips are admin-entered free text and
// used to be deduped/compared as exact strings, so "Security" and "security"
// (differently-cased but the same category) rendered as two separate chips
// instead of one, and chip labels showed whatever raw casing the backend
// happened to send (e.g. "event" lowercase next to "Security" capitalized).
// Renders the real screen with only its data dependencies mocked.

import { fireEvent, render, waitFor } from '@testing-library/react-native';
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
    announcement_id: `ann-${Math.random()}`,
    title: 'Sample update',
    content: 'Some content.',
    category: 'Announcement',
    priority: 'normal',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('notification filter categories — case-insensitive dedup (regression)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('collapses differently-cased category values into a single chip', async () => {
    mockGetAnnouncements.mockResolvedValue({
      data: [
        announcement({ category: 'Security', title: 'Security note 1' }),
        announcement({ category: 'security', title: 'Security note 2' }),
        announcement({ category: 'SECURITY', title: 'Security note 3' }),
      ],
    });

    const { getAllByLabelText, getAllByText, getByLabelText, queryAllByText } = render(<AnnouncementsScreen />);
    await waitFor(() => expect(getAllByText('Security note 1').length).toBeGreaterThan(0));
    fireEvent.press(getByLabelText('Open notification filters'));

    // Exactly one normalized Security filter option, never separate options
    // for the different backend casing variants.
    expect(getAllByLabelText(/^Security, /)).toHaveLength(1);
    expect(queryAllByText('Security').length).toBeGreaterThan(0);
    expect(queryAllByText('security').length).toBe(0);
    expect(queryAllByText('SECURITY').length).toBe(0);
  });

  it('shows a consistently capitalized chip label regardless of raw backend casing', async () => {
    mockGetAnnouncements.mockResolvedValue({
      data: [announcement({ category: 'event', title: 'Lower-cased category' })],
    });

    const { getByLabelText, getByText, getAllByText, queryAllByText } = render(<AnnouncementsScreen />);
    await waitFor(() => expect(getByText('Lower-cased category')).toBeTruthy());
    fireEvent.press(getByLabelText('Open notification filters'));

    // own category badge both use the same normalized label.
    expect(getByLabelText('Event, 1 notification')).toBeTruthy();
    // The sheet option and the card badge share the normalized label.
    expect(getAllByText('Event').length).toBeGreaterThanOrEqual(2);
    expect(queryAllByText('event').length).toBe(0);
  });
});
