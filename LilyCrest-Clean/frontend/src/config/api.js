const MOBILE_BACKEND_URL = 'https://api.lilycrest.space';
// Emergency rollback target (LilyCrest-Mobile on Render). Not used by any
// runtime resolver — documented here so the rollback host stays discoverable.
export const ROLLBACK_BACKEND_URL = 'https://mobile-api.lilycrest.space';

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

export const isDisallowedMobileRuntimeUrl = (value) => {
  const normalized = normalizeBackendUrl(value);
  return !normalized
    || /onrender\.com/i.test(normalized)
    || /trycloudflare\.com/i.test(normalized);
};

function isDevelopmentRuntime() {
  return typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
}

export function resolveBackendUrl(value, { isDevelopment = isDevelopmentRuntime() } = {}) {
  const normalized = normalizeBackendUrl(value);

  if (!isDevelopment && isLocalOrPrivateBackendUrl(normalized)) {
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
