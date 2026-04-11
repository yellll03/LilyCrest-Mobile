/**
 * Secure Credential Storage for Biometric Login
 *
 * Uses expo-secure-store (OS keychain) to store encrypted email/password.
 * These credentials are used by biometric login to authenticate a fresh
 * session even after the old session token expires.
 *
 * Data is hardware-encrypted via iOS Keychain / Android Keystore.
 */

import { Platform } from 'react-native';

// Lazy-load expo-secure-store — may not be available in Expo Go
let SecureStore = null;
try {
  SecureStore = require('expo-secure-store');
} catch (_) {
  console.warn('[SecureCredentials] expo-secure-store not available');
}

const KEYS = {
  email: 'lilycrest_bio_email',
  password: 'lilycrest_bio_pass',
  stored: 'lilycrest_bio_stored', // flag in AsyncStorage for fast checks
};

/**
 * Store login credentials securely for biometric use.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<boolean>}
 */
export async function saveCredentials(email, password) {
  if (!SecureStore || Platform.OS === 'web') return false;
  try {
    await SecureStore.setItemAsync(KEYS.email, email);
    await SecureStore.setItemAsync(KEYS.password, password);

    // Set a plain flag in AsyncStorage for fast "do we have creds?" checks
    // (SecureStore reads can be slow on some devices)
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    await AsyncStorage.setItem(KEYS.stored, 'true');

    console.log('[SecureCredentials] Credentials saved to secure store');
    return true;
  } catch (err) {
    console.warn('[SecureCredentials] Failed to save:', err?.message);
    return false;
  }
}

/**
 * Retrieve stored credentials.
 * @returns {Promise<{ email: string, password: string } | null>}
 */
export async function getCredentials() {
  if (!SecureStore || Platform.OS === 'web') return null;
  try {
    const email = await SecureStore.getItemAsync(KEYS.email);
    const password = await SecureStore.getItemAsync(KEYS.password);
    if (!email || !password) return null;
    return { email, password };
  } catch (err) {
    console.warn('[SecureCredentials] Failed to retrieve:', err?.message);
    return null;
  }
}

/**
 * Clear all stored credentials (used on logout, password change, or biometric disable).
 * @returns {Promise<void>}
 */
export async function clearCredentials() {
  try {
    if (SecureStore && Platform.OS !== 'web') {
      await SecureStore.deleteItemAsync(KEYS.email).catch(() => {});
      await SecureStore.deleteItemAsync(KEYS.password).catch(() => {});
    }
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    await AsyncStorage.removeItem(KEYS.stored).catch(() => {});
    console.log('[SecureCredentials] Credentials cleared');
  } catch (err) {
    console.warn('[SecureCredentials] Failed to clear:', err?.message);
  }
}

/**
 * Fast check: do we have stored biometric credentials?
 * Uses the AsyncStorage flag for speed (avoids SecureStore read).
 * @returns {Promise<boolean>}
 */
export async function hasStoredCredentials() {
  if (!SecureStore || Platform.OS === 'web') return false;
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const flag = await AsyncStorage.getItem(KEYS.stored);
    return flag === 'true';
  } catch (_) {
    return false;
  }
}
