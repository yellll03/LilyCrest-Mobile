// Safe, non-sensitive breadcrumb trail for involuntary logouts, so QA can
// tell an actual expired/revoked session apart from a frontend auth-state
// bug without ever touching the tokens themselves. Persisted (not just
// console-logged) because the logout that follows unmounts the screen that
// would have shown the log.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const LOG_KEY = 'auth_invalidation_log_v1';
const MAX_ENTRIES = 20;

const REASONS = Object.freeze({
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',
  REFRESH_TOKEN_MISSING: 'REFRESH_TOKEN_MISSING',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  SESSION_REVOKED: 'SESSION_REVOKED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  TOKEN_REFRESH_FAILED: 'TOKEN_REFRESH_FAILED',
  LOCAL_AUTH_STATE_MISSING: 'LOCAL_AUTH_STATE_MISSING',
  UNKNOWN_AUTH_INVALIDATION: 'UNKNOWN_AUTH_INVALIDATION',
});

const BACKEND_CODE_TO_REASON = {
  AUTH_ACCOUNT_NOT_FOUND: REASONS.USER_NOT_FOUND,
  ACCOUNT_INACTIVE: REASONS.ACCOUNT_INACTIVE,
  SESSION_REVOKED: REASONS.SESSION_REVOKED,
  SESSION_INVALID: REASONS.SESSION_REVOKED,
  SESSION_EXPIRED: REASONS.SESSION_EXPIRED,
  REFRESH_TOKEN_MISSING: REASONS.REFRESH_TOKEN_MISSING,
  REFRESH_TOKEN_INVALID: REASONS.REFRESH_TOKEN_INVALID,
  REFRESH_TOKEN_EXPIRED: REASONS.REFRESH_TOKEN_EXPIRED,
};

export function classifyInvalidationReason(backendCode) {
  return BACKEND_CODE_TO_REASON[String(backendCode || '').toUpperCase()] || REASONS.UNKNOWN_AUTH_INVALIDATION;
}

/**
 * Record one involuntary-logout / auth-invalidation event. Only safe
 * metadata — never a token value, refresh token, or session id.
 */
export async function recordAuthInvalidation({
  backendCode = null,
  httpStatus = null,
  endpoint = null,
  silentRefreshAttempted = false,
  silentRefreshSucceeded = false,
  hadStoredCredentials = false,
} = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    reason: classifyInvalidationReason(backendCode),
    backendCode: backendCode || null,
    httpStatus,
    endpoint,
    silentRefreshAttempted,
    silentRefreshSucceeded,
    hadStoredCredentials,
    buildCommit: Constants.expoConfig?.extra?.gitCommit || 'unknown',
    appVersion: Constants.expoConfig?.version || 'unknown',
    platform: Platform.OS,
  };

  if (__DEV__) {
    console.warn('[auth] involuntary logout', entry);
  }

  try {
    const raw = await AsyncStorage.getItem(LOG_KEY);
    const existing = raw ? JSON.parse(raw) : [];
    const next = [entry, ...(Array.isArray(existing) ? existing : [])].slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(LOG_KEY, JSON.stringify(next));
  } catch (_) {
    // Diagnostics must never block the actual logout flow.
  }

  return entry;
}

export async function getAuthInvalidationLog() {
  try {
    const raw = await AsyncStorage.getItem(LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export async function clearAuthInvalidationLog() {
  try {
    await AsyncStorage.removeItem(LOG_KEY);
  } catch (_) {
    // no-op
  }
}

export const AUTH_INVALIDATION_REASONS = REASONS;
