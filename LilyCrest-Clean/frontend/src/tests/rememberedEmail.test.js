/* global test */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadRememberedEmail,
  REMEMBERED_EMAIL_KEY,
  REMEMBER_EMAIL_KEY,
  saveRememberedEmail,
} from '../services/rememberedEmail';

describe('Remember me email preference', () => {
  beforeEach(() => AsyncStorage.clear());

  test('enabled stores only the normalized email preference', async () => {
    await saveRememberedEmail({ rememberEmail: true, email: ' Tenant@Example.COM ' });

    expect(await AsyncStorage.getItem(REMEMBER_EMAIL_KEY)).toBe('true');
    expect(await AsyncStorage.getItem(REMEMBERED_EMAIL_KEY)).toBe('tenant@example.com');
    expect(await loadRememberedEmail()).toEqual({
      rememberEmail: true,
      email: 'tenant@example.com',
    });
    expect(await AsyncStorage.getItem('password')).toBeNull();
    expect(await AsyncStorage.getItem('otpCode')).toBeNull();
  });

  test('disabled deletes any previously remembered email', async () => {
    await saveRememberedEmail({ rememberEmail: true, email: 'tenant@example.com' });
    await saveRememberedEmail({ rememberEmail: false, email: 'tenant@example.com' });

    expect(await AsyncStorage.getItem(REMEMBER_EMAIL_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(REMEMBERED_EMAIL_KEY)).toBeNull();
    expect(await loadRememberedEmail()).toEqual({ rememberEmail: false, email: '' });
  });

  test('a stale email without an enabled flag is not prefilled', async () => {
    await AsyncStorage.setItem(REMEMBERED_EMAIL_KEY, 'stale@example.com');

    expect(await loadRememberedEmail()).toEqual({ rememberEmail: false, email: '' });
    expect(await AsyncStorage.getItem(REMEMBERED_EMAIL_KEY)).toBeNull();
  });
});
