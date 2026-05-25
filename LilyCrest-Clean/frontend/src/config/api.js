const PRODUCTION_BACKEND_URL = 'https://api.lilycrest.space';

const normalizeBackendUrl = (value) => String(value || '').trim().replace(/\/$/, '');

const configuredBackendUrl = normalizeBackendUrl(process.env.EXPO_PUBLIC_BACKEND_URL);

const RAW_BACKEND_URL =
  !configuredBackendUrl || configuredBackendUrl.includes('lilycrest-mobile.onrender.com')
    ? PRODUCTION_BACKEND_URL
    : configuredBackendUrl;

export const API_BASE_URL = RAW_BACKEND_URL;

export const MOBILE_API_BASE_URL = `${API_BASE_URL}/api/m`;

export const MOBILE_HEALTH_URL = `${MOBILE_API_BASE_URL}/health`;
