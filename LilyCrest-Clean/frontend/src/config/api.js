const RAW_BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  'https://lilycrest-mobile.onrender.com';

export const API_BASE_URL = RAW_BACKEND_URL.replace(/\/$/, '');

export const MOBILE_API_BASE_URL = `${API_BASE_URL}/api/m`;

export const MOBILE_HEALTH_URL = `${MOBILE_API_BASE_URL}/health`;
