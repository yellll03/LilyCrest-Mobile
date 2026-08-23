import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeEmail, validateEmail } from '../utils/authStability';

export const REMEMBER_EMAIL_KEY = 'rememberEmail';
export const REMEMBERED_EMAIL_KEY = 'rememberedEmail';

export async function clearRememberedEmail() {
  await AsyncStorage.multiRemove([REMEMBER_EMAIL_KEY, REMEMBERED_EMAIL_KEY]);
}

export async function loadRememberedEmail() {
  const [rememberEmailValue, rememberedEmailValue] = await Promise.all([
    AsyncStorage.getItem(REMEMBER_EMAIL_KEY),
    AsyncStorage.getItem(REMEMBERED_EMAIL_KEY),
  ]);
  const email = normalizeEmail(rememberedEmailValue || '');

  if (rememberEmailValue !== 'true' || !validateEmail(email).valid) {
    await clearRememberedEmail();
    return { rememberEmail: false, email: '' };
  }

  return { rememberEmail: true, email };
}

export async function saveRememberedEmail({ rememberEmail, email } = {}) {
  const normalizedEmail = normalizeEmail(email || '');
  if (!rememberEmail || !validateEmail(normalizedEmail).valid) {
    await clearRememberedEmail();
    return { rememberEmail: false, email: '' };
  }

  await AsyncStorage.multiSet([
    [REMEMBER_EMAIL_KEY, 'true'],
    [REMEMBERED_EMAIL_KEY, normalizedEmail],
  ]);
  return { rememberEmail: true, email: normalizedEmail };
}
