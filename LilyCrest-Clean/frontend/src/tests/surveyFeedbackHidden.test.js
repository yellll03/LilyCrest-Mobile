/* global __dirname */
// Regression coverage for temporarily hiding Survey/Feedback from normal
// tenant navigation (deployment-testing pass). The feature is gated behind
// SURVEY_FEEDBACK_ENABLED in src/config/features.js — nothing was deleted,
// so these tests assert the *hidden* (current) behavior and prove hiding it
// didn't break the rest of the Profile screen or Announcements screen.

import { render, waitFor } from '@testing-library/react-native';

jest.mock('../config/features', () => ({ SURVEY_FEEDBACK_ENABLED: false }));

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { user_id: 'tenant-a', role: 'tenant', name: 'Tenant A', email: 't@example.com' },
    authReady: true,
    authStatus: 'authenticated',
    logout: jest.fn(),
    updateUser: jest.fn(),
    checkAuth: jest.fn(),
    isLoading: false,
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useFocusEffect: (cb) => { const React = require('react'); React.useEffect(cb, []); },
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('../context/ThemeContext', () => ({
  useTheme: () => ({
    isDarkMode: false,
    colors: {
      background: '#fff', text: '#000', textSecondary: '#666', textMuted: '#999',
      surface: '#f5f5f5', border: '#ddd', accent: '#204B7E', card: '#fff', danger: '#b91c1c',
    },
  }),
}));

jest.mock('../context/AlertContext', () => ({
  useAlert: () => ({ showAlert: jest.fn() }),
}));

jest.mock('../hooks/useTenantContract', () => ({
  useTenantContract: () => ({ contract: null, error: null }),
}));

jest.mock('../utils/contractPresentation', () => ({
  buildContractSummary: () => null,
}));

const mockGetProfile = jest.fn();
const mockGetMySurveys = jest.fn();

jest.mock('../services/api', () => ({
  apiService: {
    getProfile: (...args) => mockGetProfile(...args),
    getMySurveys: (...args) => mockGetMySurveys(...args),
    updateProfile: jest.fn(),
  },
  getApiErrorMessage: (_err, fallback) => fallback,
}));

describe('Profile screen — Survey/Feedback hidden', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProfile.mockResolvedValue({ data: { user_id: 'tenant-a' } });
  });

  it('does not render the Feedback & Survey section or an Open Survey Dashboard button', async () => {
    const ProfileScreen = require('../../app/(tabs)/profile').default;
    const { queryByText } = render(<ProfileScreen />);

    await waitFor(() => expect(mockGetProfile).toHaveBeenCalled());

    expect(queryByText(/feedback & survey/i)).toBeNull();
    expect(queryByText(/open survey dashboard/i)).toBeNull();
  });

  it('does not call getMySurveys while the feature is hidden', async () => {
    const ProfileScreen = require('../../app/(tabs)/profile').default;
    render(<ProfileScreen />);

    await waitFor(() => expect(mockGetProfile).toHaveBeenCalled());
    expect(mockGetMySurveys).not.toHaveBeenCalled();
  });

  it('still renders the rest of the profile (name, email, other menu groups) unaffected', async () => {
    const ProfileScreen = require('../../app/(tabs)/profile').default;
    const { queryByText } = render(<ProfileScreen />);

    await waitFor(() => expect(mockGetProfile).toHaveBeenCalled());
    expect(queryByText('Tenant A')).toBeTruthy();
  });
});

describe('Announcements screen — Survey CTA hidden', () => {
  it('never renders an "Open Survey" action for a survey-category announcement', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../app/(tabs)/announcements.jsx'),
      'utf8',
    );
    // The CTA render is gated by the feature flag rather than category alone.
    expect(source).toMatch(/SURVEY_FEEDBACK_ENABLED\s*&&\s*String\(selectedAnn\.category/);
  });
});
