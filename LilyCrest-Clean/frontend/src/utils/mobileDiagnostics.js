import axios from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { API_BASE_URL, MOBILE_API_BASE_URL, MOBILE_HEALTH_URL } from '../config/api';
import { auth, getFreshIdToken } from '../config/firebase';
import { api } from '../services/api';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;
const DEFAULT_TIMEOUT = 10000;
const DIAGNOSTICS_BUILD = 'api-health-diagnostics-2026-05-27';

const TEST_URLS = {
  mobileHealth: MOBILE_HEALTH_URL,
  notifications: `${MOBILE_API_BASE_URL}/notifications`,
  authMe: `${MOBILE_API_BASE_URL}/auth/me`,
  dashboard: `${MOBILE_API_BASE_URL}/dashboard/me`,
};

function safeEnvironmentLabel() {
  const ownership = Constants?.appOwnership || 'unknown';
  const executionEnvironment = Constants?.executionEnvironment || 'unknown';
  return `${ownership}/${executionEnvironment}`;
}

function getMetroHost() {
  const candidates = [
    Constants?.expoConfig?.hostUri,
    Constants?.manifest?.debuggerHost,
    Constants?.manifest2?.extra?.expoClient?.hostUri,
    Constants?.manifest2?.extra?.expoClient?.debuggerHost,
  ].filter(Boolean);
  return candidates[0] || 'unknown';
}

function getMetroPort() {
  const host = getMetroHost();
  const match = String(host).match(/:(\d+)/);
  return match?.[1] || 'unknown';
}

function sanitizeForDiagnostics(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return '[MaxDepth]';
  if (typeof value === 'string') {
    if (value.length > 1500) return `${value.slice(0, 1500)}...[truncated]`;
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => sanitizeForDiagnostics(item, depth + 1));
  }

  return Object.entries(value).reduce((acc, [key, entryValue]) => {
    if (/token|secret|password|credential|authorization|api[_-]?key|private/i.test(key)) {
      acc[key] = '[REDACTED]';
    } else {
      acc[key] = sanitizeForDiagnostics(entryValue, depth + 1);
    }
    return acc;
  }, {});
}

function safeErrorPayload(error) {
  return {
    name: error?.name,
    message: error?.message,
    code: error?.code,
    hasResponse: Boolean(error?.response),
    hasRequest: Boolean(error?.request),
    status: error?.response?.status,
    body: sanitizeForDiagnostics(error?.response?.data),
  };
}

function buildCommonPayload({ testName, fullURL, method = 'GET', timeout = DEFAULT_TIMEOUT, hasFirebaseUser, hasIdToken }) {
  return {
    diagnosticsBuild: DIAGNOSTICS_BUILD,
    testName,
    platform: Platform.OS,
    resolvedBaseURL: API_BASE_URL,
    mobileApiBaseURL: MOBILE_API_BASE_URL,
    fullURL,
    method,
    timeout,
    environment: safeEnvironmentLabel(),
    metroHost: getMetroHost(),
    metroPort: getMetroPort(),
    hasFirebaseUser: Boolean(hasFirebaseUser ?? auth.currentUser),
    hasIdToken: Boolean(hasIdToken),
  };
}

function logDiagnosticResult(result) {
  console.log('API_DIAGNOSTICS_RESULT', result);
}

async function runFetchTest({ testName, fullURL, timeout = DEFAULT_TIMEOUT, hasFirebaseUser, hasIdToken, headers }) {
  const common = buildCommonPayload({ testName, fullURL, timeout, hasFirebaseUser, hasIdToken });
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeout) : null;

  try {
    const response = await fetch(fullURL, {
      method: 'GET',
      headers,
      signal: controller?.signal,
    });
    const text = await response.text();
    const result = {
      ...common,
      transport: 'fetch',
      ok: response.ok,
      status: response.status,
      body: sanitizeForDiagnostics(text),
      errorName: null,
      errorMessage: null,
      errorCode: null,
      hasResponse: true,
      hasRequest: true,
    };
    logDiagnosticResult(result);
    return result;
  } catch (error) {
    const result = {
      ...common,
      transport: 'fetch',
      ok: false,
      status: null,
      errorName: error?.name,
      errorMessage: error?.message,
      errorCode: error?.code,
      hasResponse: false,
      hasRequest: true,
    };
    logDiagnosticResult(result);
    return result;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function runAxiosTest({
  testName,
  fullURL,
  timeout = DEFAULT_TIMEOUT,
  hasFirebaseUser,
  hasIdToken,
  headers,
  client = axios,
  clientPath,
}) {
  const common = buildCommonPayload({
    testName,
    fullURL,
    timeout,
    hasFirebaseUser,
    hasIdToken,
  });

  try {
    const response = clientPath
      ? await client.get(clientPath, { timeout, headers })
      : await client.get(fullURL, { timeout, headers });
    const result = {
      ...common,
      transport: clientPath ? 'app-api-client' : 'raw-axios',
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      body: sanitizeForDiagnostics(response.data),
      errorName: null,
      errorMessage: null,
      errorCode: null,
      hasResponse: true,
      hasRequest: true,
    };
    logDiagnosticResult(result);
    return result;
  } catch (error) {
    const result = {
      ...common,
      transport: clientPath ? 'app-api-client' : 'raw-axios',
      ok: false,
      status: error?.response?.status ?? null,
      body: sanitizeForDiagnostics(error?.response?.data),
      errorName: error?.name,
      errorMessage: error?.message,
      errorCode: error?.code,
      hasResponse: Boolean(error?.response),
      hasRequest: Boolean(error?.request),
    };
    logDiagnosticResult(result);
    return result;
  }
}

function skippedResult({ testName, fullURL, reason, hasFirebaseUser, hasIdToken }) {
  const result = {
    ...buildCommonPayload({ testName, fullURL, hasFirebaseUser, hasIdToken }),
    transport: 'skipped',
    ok: false,
    status: null,
    skipped: true,
    reason,
    errorName: null,
    errorMessage: null,
    errorCode: null,
    hasResponse: false,
    hasRequest: false,
  };
  logDiagnosticResult(result);
  return result;
}

export async function runFullApiDiagnostics() {
  if (!IS_DEV) {
    return [skippedResult({
      testName: 'Diagnostics unavailable',
      fullURL: MOBILE_HEALTH_URL,
      reason: 'Diagnostics only run in development mode.',
    })];
  }

  const hasFirebaseUser = Boolean(auth.currentUser);
  let idToken = null;
  let tokenError = null;

  if (hasFirebaseUser) {
    try {
      idToken = await getFreshIdToken(false);
    } catch (error) {
      tokenError = {
        name: error?.name,
        message: error?.message,
        code: error?.code,
      };
    }
  }

  const hasIdToken = Boolean(idToken);
  const authHeaders = hasIdToken ? { Authorization: `Bearer ${idToken}` } : undefined;

  console.log('API_DIAGNOSTICS_START', {
    diagnosticsBuild: DIAGNOSTICS_BUILD,
    platform: Platform.OS,
    metroHost: getMetroHost(),
    metroPort: getMetroPort(),
    resolvedBaseURL: API_BASE_URL,
    mobileApiBaseURL: MOBILE_API_BASE_URL,
    hasFirebaseUser,
    hasIdToken,
    tokenError,
  });

  const results = [];

  results.push(await runFetchTest({
    testName: 'A. Native fetch mobile health',
    fullURL: TEST_URLS.mobileHealth,
    hasFirebaseUser,
    hasIdToken,
  }));
  results.push(await runAxiosTest({
    testName: 'B. Raw Axios mobile health',
    fullURL: TEST_URLS.mobileHealth,
    hasFirebaseUser,
    hasIdToken,
  }));
  results.push(await runAxiosTest({
    testName: 'C. App API client health',
    fullURL: TEST_URLS.mobileHealth,
    client: api,
    clientPath: '/health',
    hasFirebaseUser,
    hasIdToken,
  }));
  results.push(await runAxiosTest({
    testName: 'D. Protected notifications without auth',
    fullURL: TEST_URLS.notifications,
    hasFirebaseUser,
    hasIdToken,
  }));
  const protectedTests = [
    ['E1. Firebase token raw Axios auth/me', TEST_URLS.authMe],
    ['E2. Firebase token raw Axios notifications', TEST_URLS.notifications],
    ['E3. Firebase token raw Axios dashboard/me', TEST_URLS.dashboard],
  ];

  for (const [testName, fullURL] of protectedTests) {
    if (!hasIdToken) {
      results.push(skippedResult({
        testName,
        fullURL,
        reason: hasFirebaseUser ? 'Firebase user exists but ID token was unavailable.' : 'No Firebase currentUser.',
        hasFirebaseUser,
        hasIdToken,
      }));
    } else {
      results.push(await runAxiosTest({
        testName,
        fullURL,
        headers: authHeaders,
        hasFirebaseUser,
        hasIdToken,
      }));
    }
  }

  const appClientProtectedTests = [
    ['F1. App API client auth/me', TEST_URLS.authMe, '/auth/me'],
    ['F2. App API client notifications', TEST_URLS.notifications, '/notifications'],
    ['F3. App API client dashboard/me', TEST_URLS.dashboard, '/dashboard/me'],
  ];

  for (const [testName, fullURL, clientPath] of appClientProtectedTests) {
    results.push(await runAxiosTest({
      testName,
      fullURL,
      client: api,
      clientPath,
      hasFirebaseUser,
      hasIdToken,
    }));
  }

  console.log('API_DIAGNOSTICS_END', {
    diagnosticsBuild: DIAGNOSTICS_BUILD,
    resultCount: results.length,
    platform: Platform.OS,
    metroHost: getMetroHost(),
    metroPort: getMetroPort(),
  });

  return results;
}

export async function runMobileApiHealthDiagnostics({
  label = 'mobile-api-custom-domain',
  url = MOBILE_HEALTH_URL,
  timeout = DEFAULT_TIMEOUT,
} = {}) {
  if (!IS_DEV) return;

  const common = {
    label,
    platform: Platform.OS,
    resolvedBaseURL: API_BASE_URL,
    mobileApiBaseURL: MOBILE_API_BASE_URL,
    fullURL: url,
    method: 'GET',
    timeout,
    environment: safeEnvironmentLabel(),
  };

  console.log('[MobileDiagnostics][fetch] start', common);
  try {
    const response = await fetch(url);
    const text = await response.text();
    console.log('[MobileDiagnostics][fetch] result', {
      ...common,
      status: response.status,
      responseText: text,
    });
  } catch (error) {
    console.log('[MobileDiagnostics][fetch] error', {
      ...common,
      ...safeErrorPayload(error),
    });
  }

  console.log('[MobileDiagnostics][axios] start', common);
  try {
    const response = await axios.get(url, { timeout });
    console.log('[MobileDiagnostics][axios] result', {
      ...common,
      status: response.status,
      responseData: response.data,
    });
  } catch (error) {
    console.log('[MobileDiagnostics][axios] error', {
      ...common,
      ...safeErrorPayload(error),
    });
  }
}

export function runStartupMobileDiagnostics() {
  if (!IS_DEV) return;
  if (globalThis.__lilycrestMobileDiagnosticsRan) return;
  globalThis.__lilycrestMobileDiagnosticsRan = true;

  runMobileApiHealthDiagnostics()
    .catch((error) => {
      console.log('[MobileDiagnostics] unexpected error', {
        platform: Platform.OS,
        environment: safeEnvironmentLabel(),
        ...safeErrorPayload(error),
      });
    });
}
