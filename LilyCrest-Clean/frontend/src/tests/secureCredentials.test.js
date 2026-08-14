import AsyncStorage from '@react-native-async-storage/async-storage';

const mockSecureStore = {
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
};

jest.mock('expo-secure-store', () => mockSecureStore);

describe('SecureStore session migration', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();
    await AsyncStorage.clear();
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    mockSecureStore.setItemAsync.mockResolvedValue(undefined);
  });

  it('removes the AsyncStorage token only after SecureStore saves it', async () => {
    await AsyncStorage.setItem('session_token', 'legacy-token');
    const removeSpy = jest.spyOn(AsyncStorage, 'removeItem');
    const { getSessionToken } = require('../services/secureCredentials');
    await expect(getSessionToken()).resolves.toBe('legacy-token');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('session_token', 'legacy-token');
    expect(removeSpy).toHaveBeenCalledWith('session_token');
    expect(await AsyncStorage.getItem('session_token')).toBeNull();
  });

  it('retains the AsyncStorage token when SecureStore save fails', async () => {
    await AsyncStorage.setItem('session_token', 'legacy-token');
    mockSecureStore.setItemAsync.mockRejectedValue(new Error('secure storage unavailable'));
    const { getSessionToken } = require('../services/secureCredentials');
    await expect(getSessionToken()).resolves.toBeNull();
    expect(await AsyncStorage.getItem('session_token')).toBe('legacy-token');
  });
});

describe('"Remember Me" session persistence', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();
    await AsyncStorage.clear();
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    mockSecureStore.setItemAsync.mockResolvedValue(undefined);
    mockSecureStore.deleteItemAsync.mockResolvedValue(undefined);
  });

  it('remember=true persists the token to SecureStore (survives app kill)', async () => {
    const { setSessionToken } = require('../services/secureCredentials');
    await setSessionToken('token-remembered', { remember: true });
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('session_token', 'token-remembered');

    // Simulate an app kill: a fresh module load with no in-memory state,
    // but SecureStore (which is actually durable) still returns the token.
    jest.resetModules();
    mockSecureStore.getItemAsync.mockResolvedValue('token-remembered');
    const reloaded = require('../services/secureCredentials');
    await expect(reloaded.getSessionToken()).resolves.toBe('token-remembered');
  });

  it('remember=false keeps the token in memory only, never in SecureStore or AsyncStorage', async () => {
    const { setSessionToken, getSessionToken } = require('../services/secureCredentials');
    await setSessionToken('token-not-remembered', { remember: false });

    // Not persisted anywhere durable.
    expect(mockSecureStore.setItemAsync).not.toHaveBeenCalledWith('session_token', expect.anything());
    expect(await AsyncStorage.getItem('session_token')).toBeNull();

    // Still readable within the same app run (module not reloaded).
    await expect(getSessionToken()).resolves.toBe('token-not-remembered');
  });

  it('remember=false does not survive a simulated app kill (fresh module load)', async () => {
    const { setSessionToken } = require('../services/secureCredentials');
    await setSessionToken('token-not-remembered', { remember: false });

    // Simulate an app kill: fresh module instance, and SecureStore/AsyncStorage
    // (the only stores that would survive a real kill) have nothing stored.
    jest.resetModules();
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    const reloaded = require('../services/secureCredentials');
    await expect(reloaded.getSessionToken()).resolves.toBeNull();
  });

  it('remember=false clears any durable token left over from a prior remember=true login', async () => {
    const { setSessionToken } = require('../services/secureCredentials');
    await AsyncStorage.setItem('session_token', 'stale-legacy-token');
    await setSessionToken('token-not-remembered', { remember: false });
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('session_token');
    expect(await AsyncStorage.getItem('session_token')).toBeNull();
  });
});
