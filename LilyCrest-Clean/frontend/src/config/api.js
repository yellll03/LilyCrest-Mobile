const MOBILE_BACKEND_URL = 'https://mobile-api.lilycrest.space';
const ADMIN_BACKEND_HOST = ['api', 'lilycrest', 'space'].join('.');

const normalizeBackendUrl = (value) => String(value || '').trim().replace(/\/$/, '');
const isDisallowedMobileRuntimeUrl = (value) => {
  const normalized = normalizeBackendUrl(value);
  const host = normalized.replace(/^https?:\/\//i, '').split('/')[0];
  return !normalized
    || host === ADMIN_BACKEND_HOST
    || /onrender\.com/i.test(normalized)
    || /trycloudflare\.com/i.test(normalized);
};

const configuredBackendUrl = normalizeBackendUrl(process.env.EXPO_PUBLIC_BACKEND_URL);

const RAW_BACKEND_URL =
  isDisallowedMobileRuntimeUrl(configuredBackendUrl)
    ? MOBILE_BACKEND_URL
    : configuredBackendUrl;

export const API_BASE_URL = RAW_BACKEND_URL;

export const MOBILE_API_BASE_URL = `${API_BASE_URL}/api/m`;

export const MOBILE_HEALTH_URL = `${MOBILE_API_BASE_URL}/health`;

export const MOBILE_API_FALLBACK_BASE_URL = '';
