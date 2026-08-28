import { resolveQaRuntimeFromEnv } from './qaRuntime';

const MOBILE_BACKEND_URL = 'https://api.lilycrest.space';

export const normalizeBackendUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

function extractBackendHost(value) {
  const normalized = normalizeBackendUrl(value);
  if (!normalized) return '';

  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch (_) {
    return normalized.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase();
  }
}

export function isLocalOrPrivateBackendUrl(value) {
  const host = extractBackendHost(value);
  if (!host) return false;

  if (['localhost', '127.0.0.1', '0.0.0.0', '10.0.2.2'].includes(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;

  const private172Match = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (private172Match) {
    const secondOctet = Number(private172Match[1]);
    return secondOctet >= 16 && secondOctet <= 31;
  }

  return false;
}

// Production runtime host allowlist. This is intentionally an allowlist
// (only the canonical API host resolves) rather than a denylist of known-bad
// hosts — a denylist only blocks hosts already known to us and silently lets
// anything else through
// unnoticed if EXPO_PUBLIC_BACKEND_URL is ever misconfigured. There is no
// runtime failover: a request to the canonical host that fails is retried
// against that same host (see services/api.js) or surfaced as an error —
// this function only guards which host the app is even allowed to build
// requests against in the first place.
export const isDisallowedMobileRuntimeUrl = (value) => {
  const normalized = normalizeBackendUrl(value);
  return normalized !== MOBILE_BACKEND_URL;
};

function isDevelopmentRuntime() {
  return typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
}

export function resolveBackendUrl(value, {
  isDevelopment = isDevelopmentRuntime(),
  qaRuntime = resolveQaRuntimeFromEnv(),
} = {}) {
  const normalized = normalizeBackendUrl(value);

  // A production-mode QA APK may use loopback only when the dedicated,
  // fail-closed QA runtime contract has been explicitly enabled. ADB reverse
  // then maps this device-local address to the isolated workstation server.
  if (qaRuntime) return qaRuntime.backendUrl;

  // Development builds may legitimately point at a local machine, emulator
  // loopback, or LAN IP for Metro/dev-server testing — the production
  // allowlist below does not apply to them. Production is never reached
  // through this branch (isDevelopment is derived from __DEV__/NODE_ENV).
  if (isDevelopment) {
    return normalized || MOBILE_BACKEND_URL;
  }

  if (isLocalOrPrivateBackendUrl(normalized)) {
    throw new Error('Invalid production backend URL. Configure EXPO_PUBLIC_BACKEND_URL with a public HTTPS LilyCrest API host.');
  }

  return isDisallowedMobileRuntimeUrl(normalized)
    ? MOBILE_BACKEND_URL
    : normalized;
}

const configuredBackendUrl = normalizeBackendUrl(process.env.EXPO_PUBLIC_BACKEND_URL);

const RAW_BACKEND_URL = resolveBackendUrl(configuredBackendUrl);

export const API_BASE_URL = RAW_BACKEND_URL;

export const MOBILE_API_BASE_URL = `${API_BASE_URL}/api/m`;

export const MOBILE_HEALTH_URL = `${MOBILE_API_BASE_URL}/health`;
