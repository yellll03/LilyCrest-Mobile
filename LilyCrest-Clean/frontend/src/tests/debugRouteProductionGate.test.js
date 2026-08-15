// Regression test: the API health debug screen (frontend/app/debug/api-health.jsx)
// dumps live API base URLs, auth-token presence, and raw response bodies. It
// was reachable in a production build via deep link / direct URL / a stale
// notification because Expo Router registered the Stack.Screen unconditionally
// and '/debug' was listed in _layout.jsx's PUBLIC_ROUTE_PREFIXES with no
// __DEV__ check anywhere in the screen itself — only the login screen's entry
// button was gated. The screen must now refuse to render and redirect away
// whenever __DEV__ is false, independent of how it was reached.

import { render, waitFor } from '@testing-library/react-native';
import ApiHealthDebugScreen from '../../app/debug/api-health';

jest.mock('../../src/config/api', () => ({ API_BASE_URL: 'https://api.lilycrest.space', MOBILE_API_BASE_URL: 'https://api.lilycrest.space' }));
jest.mock('../../src/context/ThemeContext', () => ({
  useTheme: () => ({ colors: { background: '#fff', text: '#000', textSecondary: '#666', border: '#ddd', accent: '#204B7E' }, isDarkMode: false }),
}));
jest.mock('../../src/utils/mobileDiagnostics', () => ({ runFullApiDiagnostics: jest.fn().mockResolvedValue([]) }));
jest.mock('../../src/utils/navigation', () => ({ safeBack: jest.fn() }));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));

describe('Debug API health screen — production gate (regression)', () => {
  const originalDev = global.__DEV__;

  afterEach(() => {
    global.__DEV__ = originalDev;
    jest.clearAllMocks();
  });

  it('renders nothing and redirects to /login when __DEV__ is false', async () => {
    global.__DEV__ = false;

    const { queryByText, toJSON } = render(<ApiHealthDebugScreen />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(toJSON()).toBeNull();
    expect(queryByText(/API Diagnostics/i)).toBeNull();
  });

  it('renders the diagnostics screen when __DEV__ is true', async () => {
    global.__DEV__ = true;

    const { queryByText } = render(<ApiHealthDebugScreen />);

    await waitFor(() => expect(queryByText(/API Diagnostics/i)).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
