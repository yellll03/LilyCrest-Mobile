// Firebase configuration for LilyCrest Tenant Portal
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
    browserLocalPersistence,
    getAuth,
    getReactNativePersistence,
    initializeAuth,
    onAuthStateChanged
} from 'firebase/auth';
import { Platform } from 'react-native';

const ENV = {
  FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '',
  FIREBASE_WEB_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_WEB_API_KEY || '',
  FIREBASE_ANDROID_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_ANDROID_API_KEY || '',
  FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '',
  FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  FIREBASE_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  FIREBASE_WEB_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_WEB_APP_ID || '',
  FIREBASE_ANDROID_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID || '',
  FIREBASE_MEASUREMENT_ID: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || '',
  GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
  GOOGLE_ANDROID_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
};

function requiredEnv(label, value, fallback = '') {
  const resolved = value || fallback;
  if (!resolved) {
    console.warn(`Missing env var: ${label}`);
  }
  return resolved;
}

const firebaseWebApiKey = requiredEnv(
  'EXPO_PUBLIC_FIREBASE_WEB_API_KEY',
  ENV.FIREBASE_WEB_API_KEY,
  ENV.FIREBASE_API_KEY,
);

const firebaseAndroidApiKey = requiredEnv(
  'EXPO_PUBLIC_FIREBASE_ANDROID_API_KEY',
  ENV.FIREBASE_ANDROID_API_KEY,
  ENV.FIREBASE_API_KEY,
);

const firebaseAuthDomain = requiredEnv('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', ENV.FIREBASE_AUTH_DOMAIN);
const firebaseProjectId = requiredEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID', ENV.FIREBASE_PROJECT_ID);
const firebaseStorageBucket = requiredEnv('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET', ENV.FIREBASE_STORAGE_BUCKET);
const firebaseMessagingSenderId = requiredEnv('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', ENV.FIREBASE_MESSAGING_SENDER_ID);
const firebaseWebAppId = requiredEnv('EXPO_PUBLIC_FIREBASE_WEB_APP_ID', ENV.FIREBASE_WEB_APP_ID);
const firebaseAndroidAppId = requiredEnv('EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID', ENV.FIREBASE_ANDROID_APP_ID);

const firebaseMeasurementId = ENV.FIREBASE_MEASUREMENT_ID || undefined;

export const GOOGLE_WEB_CLIENT_ID = requiredEnv(
  'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  ENV.GOOGLE_WEB_CLIENT_ID,
);

export const GOOGLE_ANDROID_CLIENT_ID = requiredEnv(
  'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID',
  ENV.GOOGLE_ANDROID_CLIENT_ID,
);

if (__DEV__) {
  console.log('Google Sign-In config loaded:', {
    hasWebClientId: Boolean(GOOGLE_WEB_CLIENT_ID),
    hasAndroidClientId: Boolean(GOOGLE_ANDROID_CLIENT_ID),
  });
}

const firebaseWebConfig = {
  apiKey: firebaseWebApiKey,
  authDomain: firebaseAuthDomain,
  projectId: firebaseProjectId,
  storageBucket: firebaseStorageBucket,
  messagingSenderId: firebaseMessagingSenderId,
  appId: firebaseWebAppId,
  measurementId: firebaseMeasurementId,
};

const firebaseNativeConfig = {
  apiKey: firebaseAndroidApiKey,
  authDomain: firebaseAuthDomain,
  projectId: firebaseProjectId,
  storageBucket: firebaseStorageBucket,
  messagingSenderId: firebaseMessagingSenderId,
  appId: firebaseAndroidAppId,
};

const firebaseConfig = Platform.OS === 'web' ? firebaseWebConfig : firebaseNativeConfig;

// Use a global cache to avoid re-initializing Firebase/Auth during fast refresh or hot reloads
const globalForFirebase = globalThis.__lilycrestFirebase ?? {};

// Initialize Firebase app once
const app = globalForFirebase.app || (getApps().length === 0 ? initializeApp(firebaseConfig) : getApp());
globalForFirebase.app = app;

// Initialize Auth with proper persistence based on platform (once)
let auth = globalForFirebase.auth;
if (!auth || auth._deleted) {
  try {
    if (Platform.OS === 'web') {
      auth = initializeAuth(app, {
        persistence: browserLocalPersistence
      });
    } else {
      auth = initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage)
      });
    }
    console.log('Firebase Auth initialized with persistence for platform:', Platform.OS);
    globalForFirebase.auth = auth;
    globalThis.__lilycrestFirebase = globalForFirebase;
  } catch (error) {
    console.warn('Auth initialization error, using existing instance:', error.message);
    auth = getAuth(app);
    globalForFirebase.auth = auth;
    globalThis.__lilycrestFirebase = globalForFirebase;
  }
}

/**
 * Get fresh ID token, automatically refreshing if expired
 * @param {boolean} forceRefresh - Force token refresh even if not expired
 * @returns {Promise<string|null>} ID token or null if no user
 */
export async function getFreshIdToken(forceRefresh = false) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return null;
  }
  
  try {
    const idToken = await currentUser.getIdToken(forceRefresh);
    return idToken;
  } catch (error) {
    console.error('Error getting fresh ID token:', error);
    throw error;
  }
}

/**
 * Subscribe to auth state changes
 * @param {Function} callback - Called with user object when auth state changes
 * @returns {Function} Unsubscribe function
 */
export function subscribeToAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export { app, auth };
export default firebaseConfig;
