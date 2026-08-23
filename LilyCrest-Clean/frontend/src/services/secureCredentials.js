/**
 * Secure session and pending OTP verification helpers.
 *
 * This module intentionally does not store raw passwords. Legacy password
 * and retired local-auth preference keys are deleted during migration.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;

let SecureStore = null;
try {
  SecureStore = require('expo-secure-store');
} catch (_) {
  console.warn('[SecureAuth] expo-secure-store not available');
}

const LEGACY_SESSION_TOKEN_KEY = 'session_token';
const SESSION_CREDENTIALS_KEY = 'lilycrest_session_credentials_v2';
const PENDING_LOGIN_KEY = 'lilycrest_pending_login';
const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;

const RETIRED_LOCAL_AUTH_KEYS = {
  email: 'lilycrest_bio_email',
  password: 'lilycrest_bio_pass',
  stored: 'lilycrest_bio_stored',
  setting: 'biometricLogin',
  session: 'lilycrest_bio_session_enabled',
};

let memoryPendingLogin = null;
let memorySessionCredentials = null;

function canUseSecureStore() {
  return Boolean(SecureStore) && Platform.OS !== 'web';
}

async function deleteSecureItem(key) {
  if (!canUseSecureStore()) return;
  await Promise.resolve(SecureStore.deleteItemAsync(key)).catch(() => {});
}

async function setSecureItem(key, value) {
  if (!canUseSecureStore()) {
    if (key === PENDING_LOGIN_KEY) memoryPendingLogin = value;
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getSecureItem(key) {
  if (!canUseSecureStore()) {
    return key === PENDING_LOGIN_KEY ? memoryPendingLogin : null;
  }
  return SecureStore.getItemAsync(key);
}

export async function migrateLegacyCredentials() {
  try {
    await Promise.all([
      deleteSecureItem(RETIRED_LOCAL_AUTH_KEYS.email),
      deleteSecureItem(RETIRED_LOCAL_AUTH_KEYS.password),
      AsyncStorage.removeItem(RETIRED_LOCAL_AUTH_KEYS.stored).catch(() => {}),
      AsyncStorage.removeItem(RETIRED_LOCAL_AUTH_KEYS.setting).catch(() => {}),
      AsyncStorage.removeItem(RETIRED_LOCAL_AUTH_KEYS.session).catch(() => {}),
      AsyncStorage.removeItem('remember_me').catch(() => {}),
    ]);
  } catch (err) {
    console.warn('[SecureAuth] Legacy credential cleanup failed:', err?.message);
  }
}

function normalizeSessionCredentials(value) {
  if (!value || typeof value !== 'object') return null;
  const sessionToken = typeof value.sessionToken === 'string' ? value.sessionToken.trim() : '';
  if (!sessionToken) return null;
  return {
    sessionToken,
    refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken.trim() : '',
    expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null,
    refreshExpiresAt: typeof value.refreshExpiresAt === 'string' ? value.refreshExpiresAt : null,
  };
}

async function readSecureSessionBundle() {
  if (!canUseSecureStore()) return memorySessionCredentials;
  const raw = await getSecureItem(SESSION_CREDENTIALS_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return normalizeSessionCredentials(JSON.parse(raw));
  } catch (_) {
    await deleteSecureItem(SESSION_CREDENTIALS_KEY);
    return null;
  }
}

export async function getSessionCredentials() {
  const current = await readSecureSessionBundle();
  if (current) return current;

  // One-time migration from the previous SecureStore token key, followed by
  // the older AsyncStorage key. New credentials are never written to ordinary
  // plaintext storage.
  let legacyToken = await getSecureItem(LEGACY_SESSION_TOKEN_KEY).catch(() => null);
  let migratedFromAsyncStorage = false;
  if (!legacyToken) {
    legacyToken = await AsyncStorage.getItem(LEGACY_SESSION_TOKEN_KEY).catch(() => null);
    migratedFromAsyncStorage = Boolean(legacyToken);
  }
  if (!legacyToken) return null;

  try {
    await setSessionToken(legacyToken);
    if (migratedFromAsyncStorage) {
      await AsyncStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
    }
    await deleteSecureItem(LEGACY_SESSION_TOKEN_KEY);
  } catch (error) {
    console.warn('[SecureAuth] Session token migration failed:', error?.message);
    if (migratedFromAsyncStorage) {
      await AsyncStorage.removeItem(LEGACY_SESSION_TOKEN_KEY).catch(() => {});
    }
    return null;
  }
  return readSecureSessionBundle();
}

export async function getSessionToken() {
  const credentials = await getSessionCredentials();
  return credentials?.sessionToken || null;
}

export async function setSessionToken(token, {
  refreshToken = '',
  expiresAt = null,
  refreshExpiresAt = null,
} = {}) {
  const normalized = typeof token === 'string' ? token.trim() : '';
  if (!normalized) return removeSessionToken();

  const credentials = normalizeSessionCredentials({
    sessionToken: normalized,
    refreshToken,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    refreshExpiresAt: refreshExpiresAt ? new Date(refreshExpiresAt).toISOString() : null,
  });
  if (!credentials) return removeSessionToken();

  if (!canUseSecureStore()) {
    // A platform without SecureStore gets only process-memory credentials.
    // Never downgrade bearer/refresh secrets into AsyncStorage plaintext.
    memorySessionCredentials = credentials;
    return;
  }

  await setSecureItem(SESSION_CREDENTIALS_KEY, JSON.stringify(credentials));
  memorySessionCredentials = null;
  await Promise.all([
    deleteSecureItem(LEGACY_SESSION_TOKEN_KEY),
    AsyncStorage.removeItem(LEGACY_SESSION_TOKEN_KEY).catch(() => {}),
  ]);
}

export async function removeSessionToken() {
  memorySessionCredentials = null;
  await Promise.all([
    deleteSecureItem(SESSION_CREDENTIALS_KEY),
    deleteSecureItem(LEGACY_SESSION_TOKEN_KEY),
    AsyncStorage.removeItem(LEGACY_SESSION_TOKEN_KEY).catch(() => {}),
  ]);
}

export async function savePendingLogin({ otpToken, email, maskedEmail, rememberEmail = false } = {}) {
  const token = typeof otpToken === 'string' ? otpToken.trim() : '';
  if (!token) return false;

  const payload = JSON.stringify({
    otpToken: token,
    email: typeof email === 'string' ? email.trim().toLowerCase() : '',
    maskedEmail: typeof maskedEmail === 'string' ? maskedEmail : '',
    rememberEmail: rememberEmail === true,
    createdAt: Date.now(),
  });

  await clearPendingLogin();
  await setSecureItem(PENDING_LOGIN_KEY, payload);
  return true;
}

export async function getPendingLogin() {
  const raw = await getSecureItem(PENDING_LOGIN_KEY).catch(() => null);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const createdAt = Number(parsed?.createdAt || 0);
    if (!createdAt || Date.now() - createdAt > PENDING_LOGIN_TTL_MS) {
      await clearPendingLogin();
      return null;
    }

    const otpToken = typeof parsed?.otpToken === 'string' ? parsed.otpToken.trim() : '';
    if (!otpToken) {
      await clearPendingLogin();
      return null;
    }

    return {
      otpToken,
      email: typeof parsed.email === 'string' ? parsed.email : '',
      maskedEmail: typeof parsed.maskedEmail === 'string' ? parsed.maskedEmail : '',
      rememberEmail: parsed.rememberEmail === true,
    };
  } catch (_) {
    await clearPendingLogin();
    return null;
  }
}

export async function clearPendingLogin() {
  memoryPendingLogin = null;
  await deleteSecureItem(PENDING_LOGIN_KEY);
}

export async function clearCredentials() {
  try {
    await Promise.all([
      migrateLegacyCredentials(),
      clearPendingLogin(),
    ]);
    if (IS_DEV) console.log('[SecureAuth] Pending and retired local-auth state cleared');
  } catch (err) {
    console.warn('[SecureAuth] Failed to clear pending/retired auth state:', err?.message);
  }
}
