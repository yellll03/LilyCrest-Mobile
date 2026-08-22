import AsyncStorage from '@react-native-async-storage/async-storage';

const secureValues = new Map();
const mockSecureStore = {
  getItemAsync: jest.fn((key) => Promise.resolve(secureValues.get(key) || null)),
  setItemAsync: jest.fn((key, value) => {
    secureValues.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key) => {
    secureValues.delete(key);
    return Promise.resolve();
  }),
};

jest.mock('expo-secure-store', () => mockSecureStore);

const BUNDLE_KEY = 'lilycrest_session_credentials_v2';

describe('secure session persistence', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();
    secureValues.clear();
    await AsyncStorage.clear();
    mockSecureStore.getItemAsync.mockImplementation((key) => Promise.resolve(secureValues.get(key) || null));
    mockSecureStore.setItemAsync.mockImplementation((key, value) => {
      secureValues.set(key, value);
      return Promise.resolve();
    });
    mockSecureStore.deleteItemAsync.mockImplementation((key) => {
      secureValues.delete(key);
      return Promise.resolve();
    });
  });

  it('migrates a legacy AsyncStorage bearer token into SecureStore before deleting plaintext', async () => {
    await AsyncStorage.setItem('session_token', 'legacy-token');
    const { getSessionToken } = require('../services/secureCredentials');

    await expect(getSessionToken()).resolves.toBe('legacy-token');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      BUNDLE_KEY,
      expect.stringContaining('legacy-token'),
    );
    expect(await AsyncStorage.getItem('session_token')).toBeNull();
  });

  it('deletes the legacy plaintext token if secure migration fails rather than using insecure storage', async () => {
    await AsyncStorage.setItem('session_token', 'legacy-token');
    mockSecureStore.setItemAsync.mockRejectedValue(new Error('secure storage unavailable'));
    const { getSessionToken } = require('../services/secureCredentials');

    await expect(getSessionToken()).resolves.toBeNull();
    expect(await AsyncStorage.getItem('session_token')).toBeNull();
  });

  it('stores access and refresh credentials together in SecureStore and survives an app kill', async () => {
    const expiresAt = new Date(Date.now() + 60000).toISOString();
    const first = require('../services/secureCredentials');
    await first.setSessionToken('access-token', {
      refreshToken: 'refresh-token',
      expiresAt,
      refreshExpiresAt: expiresAt,
    });

    expect(await AsyncStorage.getItem('session_token')).toBeNull();
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(BUNDLE_KEY, expect.any(String));

    jest.resetModules();
    const reopened = require('../services/secureCredentials');
    await expect(reopened.getSessionCredentials()).resolves.toEqual({
      sessionToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt,
      refreshExpiresAt: expiresAt,
    });
  });

  it('ignores the legacy remember=false option and still survives an app kill', async () => {
    const first = require('../services/secureCredentials');
    await first.setSessionToken('ordinary-login-token', { remember: false });

    jest.resetModules();
    const reopened = require('../services/secureCredentials');
    await expect(reopened.getSessionToken()).resolves.toBe('ordinary-login-token');
  });

  it('explicit logout removes both current and legacy secure credentials', async () => {
    const credentials = require('../services/secureCredentials');
    await credentials.setSessionToken('access-token', { refreshToken: 'refresh-token' });
    secureValues.set('session_token', 'old-token');

    await credentials.removeSessionToken();

    expect(secureValues.has(BUNDLE_KEY)).toBe(false);
    expect(secureValues.has('session_token')).toBe(false);
    await expect(credentials.getSessionToken()).resolves.toBeNull();
  });
});
