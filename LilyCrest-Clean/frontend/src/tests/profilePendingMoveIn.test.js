/* global test */
// Regression test: the mobile Profile screen used to derive a "Pending Move-in" /
// "Active Tenant" badge from `user.tenantStatus`, a field the backend never
// actually populates or returns (see backend/utils/normalizeUser.js
// CLIENT_VISIBLE_USER_FIELDS). Every tenant therefore saw "Pending Move-in"
// forever, even after an admin completed the real move-in / activation.
// There is no reliable authoritative "moved in" signal wired end-to-end yet,
// so the lifecycle badge was removed entirely rather than guessed at — a
// valid tenant account now just shows the normal Profile with no lifecycle
// messaging, regardless of scheduled moveInDate or reservation status.

import { render, waitFor } from '@testing-library/react-native';
import ProfileScreen from '../../app/(tabs)/profile';

let mockCurrentUser = null;

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockCurrentUser,
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
  useFocusEffect: (cb) => {
    const React = require('react');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    React.useEffect(cb, []);
  },
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

describe('Profile — Pending Move-in badge removed (regression)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProfile.mockResolvedValue({ data: { user_id: 'tenant-a' } });
    mockGetMySurveys.mockResolvedValue({ data: { surveys: [] } });
  });

  const cases = [
    ['scheduled moveInDate is in the future but tenantStatus/role implies an active tenant', {
      user_id: 'tenant-a', role: 'tenant', tenantStatus: undefined, moveInDate: '2099-01-01',
    }],
    ['scheduled moveInDate is today and tenant has not actually moved in', {
      user_id: 'tenant-a', role: 'tenant', moveInDate: new Date().toISOString(),
    }],
    ['scheduled moveInDate is in the past', {
      user_id: 'tenant-a', role: 'tenant', moveInDate: '2020-01-01',
    }],
    ['tenantStatus is explicitly "active"', {
      user_id: 'tenant-a', role: 'tenant', tenantStatus: 'active',
    }],
  ];

  test.each(cases)('does not render Pending Move-in or Active Tenant — %s', async (_label, user) => {
    mockCurrentUser = user;
    const { queryByText } = render(<ProfileScreen />);

    await waitFor(() => expect(mockGetProfile).toHaveBeenCalled());

    expect(queryByText(/pending move-in/i)).toBeNull();
    expect(queryByText(/active tenant/i)).toBeNull();
  });
});
