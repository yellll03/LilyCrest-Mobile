/* global test */
// Regression history: the mobile Profile screen once derived a
// "Pending Move-in" / "Active Tenant" badge from `user.tenantStatus` — a
// field the backend never populates — so every tenant saw "Pending Move-in"
// forever. That guessing was removed. The badge is now driven by
// src/utils/accountStatus.js `resolveAccountStatus`, which mirrors the
// backend's canonical contract (backend/utils/tenantEligibility.js):
//
//   * a well-formed serialized `user.accountStatus` object always wins;
//   * otherwise a live authenticated session with a server-owned
//     tenant/resident role resolves to "Active Tenant";
//   * explicit non-active server states (pending / suspended / inactive /
//     is_active:false) take precedence over that fallback;
//   * client-only lifecycle fields (tenantStatus, moveInDate, reservation
//     data) are never consulted.
//
// This test locks that behaviour: a verified tenant session shows
// "Active Tenant" even without a serialized accountStatus, while a future
// `moveInDate` or a stray `tenantStatus` never changes the verdict.

import { render, waitFor } from '@testing-library/react-native';
import ProfileScreen from '../../app/(tabs)/profile';

let mockCurrentUser = null;
let mockAuthStatus = 'authenticated';

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockCurrentUser,
    authReady: true,
    authStatus: mockAuthStatus,
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
      success: '#059669', successBg: '#ecfdf5', successText: '#065f46',
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

describe('Profile — account status badge from resolveAccountStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthStatus = 'authenticated';
    mockGetProfile.mockResolvedValue({ data: { user_id: 'tenant-a' } });
    mockGetMySurveys.mockResolvedValue({ data: { surveys: [] } });
  });

  test('a verified tenant session with no serialized accountStatus shows "Active Tenant"', async () => {
    mockCurrentUser = { user_id: 'tenant-a', role: 'tenant' };
    const { getByText, getByLabelText } = render(<ProfileScreen />);

    await waitFor(() => expect(mockGetProfile).toHaveBeenCalled());

    expect(getByText('Active Tenant')).toBeTruthy();
    expect(getByLabelText('Account status: Active Tenant')).toBeTruthy();
  });

  test('a richer serialized accountStatus object wins over the fallback', async () => {
    mockCurrentUser = {
      user_id: 'tenant-a',
      role: 'tenant',
      accountStatus: { code: 'active', label: 'Active Tenant · Unit 4B' },
    };
    const { getByText, queryByText } = render(<ProfileScreen />);

    await waitFor(() => expect(mockGetProfile).toHaveBeenCalled());

    expect(getByText('Active Tenant · Unit 4B')).toBeTruthy();
    expect(queryByText('Active Tenant')).toBeNull();
  });

  const noInferenceCases = [
    ['a future scheduled moveInDate does not downgrade the badge', {
      user_id: 'tenant-a', role: 'tenant', tenantStatus: 'pending', moveInDate: '2099-01-01',
    }],
    ['a moveInDate of today is ignored', {
      user_id: 'tenant-a', role: 'tenant', moveInDate: new Date().toISOString(),
    }],
    ['a past moveInDate is ignored', {
      user_id: 'tenant-a', role: 'tenant', moveInDate: '2020-01-01',
    }],
    ['a stray client tenantStatus is ignored', {
      user_id: 'tenant-a', role: 'tenant', tenantStatus: 'active',
    }],
  ];

  test.each(noInferenceCases)(
    'never renders "Pending Move-in" and keeps "Active Tenant" — %s',
    async (_label, user) => {
      mockCurrentUser = user;
      const { getByText, queryByText } = render(<ProfileScreen />);

      await waitFor(() => expect(mockGetProfile).toHaveBeenCalled());

      expect(queryByText(/pending move-in/i)).toBeNull();
      expect(getByText('Active Tenant')).toBeTruthy();
    },
  );

  test('an explicit non-active server state is shown instead of "Active Tenant"', async () => {
    mockCurrentUser = { user_id: 'tenant-a', role: 'tenant', status: 'suspended' };
    const { getByText, queryByText } = render(<ProfileScreen />);

    await waitFor(() => expect(mockGetProfile).toHaveBeenCalled());

    expect(getByText('Inactive Tenant')).toBeTruthy();
    expect(queryByText('Active Tenant')).toBeNull();
  });

  test('no badge is rendered for a non-tenant role', async () => {
    mockCurrentUser = { user_id: 'staff-a', role: 'admin' };
    mockGetProfile.mockResolvedValue({ data: { user_id: 'staff-a' } });
    const { queryByText } = render(<ProfileScreen />);

    await waitFor(() => expect(mockGetProfile).toHaveBeenCalled());

    expect(queryByText('Active Tenant')).toBeNull();
    expect(queryByText(/pending move-in/i)).toBeNull();
  });
});
