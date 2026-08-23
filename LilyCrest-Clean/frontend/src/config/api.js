export const PRODUCTION_MOBILE_BACKEND_URL = 'https://api.lilycrest.space';

const NON_PRODUCTION_HOST_MARKER = /(?:^|[-.])(staging|stage|qa|e2e|test|dev)(?:[-.]|$)/i;

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

function hasNonProductionHostMarker(value) {
  return NON_PRODUCTION_HOST_MARKER.test(extractBackendHost(value));
}

export const isDisallowedMobileRuntimeUrl = (value, environment = 'production') => {
  const normalized = normalizeBackendUrl(value);
  if (environment === 'staging') {
    return !normalized
      || normalized === PRODUCTION_MOBILE_BACKEND_URL
      || isLocalOrPrivateBackendUrl(normalized)
      || !/^https:\/\//i.test(normalized)
      || !hasNonProductionHostMarker(normalized);
  }
  return normalized !== PRODUCTION_MOBILE_BACKEND_URL;
};

function isDevelopmentRuntime() {
  return typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
}

export function resolveDeploymentEnvironment(
  value,
  { isDevelopment = isDevelopmentRuntime() } = {},
) {
  const configured = String(value || '').trim().toLowerCase();
  if (configured) return configured;
  return isDevelopment ? 'development' : 'production';
}

export function resolveBackendUrl(value, options = {}) {
  const isDevelopment = options.isDevelopment ?? isDevelopmentRuntime();
  const environment = resolveDeploymentEnvironment(options.environment, { isDevelopment });
  const normalized = normalizeBackendUrl(value);

  if (environment === 'development') {
    return normalized || PRODUCTION_MOBILE_BACKEND_URL;
  }

  if (environment === 'staging') {
    if (isDisallowedMobileRuntimeUrl(normalized, 'staging')) {
      throw new Error('Invalid staging backend URL. Staging requires a public HTTPS QA/staging host and must never use api.lilycrest.space.');
    }
    return normalized;
  }

  if (environment !== 'production') {
    throw new Error(`Unsupported LilyCrest deployment environment: ${environment}`);
  }

  if (isLocalOrPrivateBackendUrl(normalized)) {
    throw new Error('Invalid production backend URL. Configure EXPO_PUBLIC_BACKEND_URL with the canonical public HTTPS LilyCrest API host.');
  }

  // Production remains pinned to the canonical host. A misconfigured value
  // cannot make a release APK talk to staging or an arbitrary third party.
  return isDisallowedMobileRuntimeUrl(normalized, 'production')
    ? PRODUCTION_MOBILE_BACKEND_URL
    : normalized;
}

export const DEPLOYMENT_ENVIRONMENT = resolveDeploymentEnvironment(
  process.env.EXPO_PUBLIC_DEPLOYMENT_ENV,
);
const configuredBackendUrl = normalizeBackendUrl(process.env.EXPO_PUBLIC_BACKEND_URL);

export const API_BASE_URL = resolveBackendUrl(configuredBackendUrl, {
  environment: DEPLOYMENT_ENVIRONMENT,
});
export const MOBILE_API_BASE_URL = `${API_BASE_URL}/api/m`;
export const MOBILE_HEALTH_URL = `${MOBILE_API_BASE_URL}/health`;
