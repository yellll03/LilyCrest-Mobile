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
