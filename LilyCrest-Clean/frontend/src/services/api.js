import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, { create as createAxios } from 'axios';
import { API_BASE_URL, MOBILE_API_BASE_URL, MOBILE_HEALTH_URL } from '../config/api';
import {
  getSessionCredentials,
  removeSessionToken,
  setSessionToken,
} from './secureCredentials';
import { emitSessionExpired } from './sessionEvents';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;
export const SERVER_STARTING_MESSAGE = 'The server is starting. Please try again in a few seconds.';
const GENERIC_API_MESSAGE = 'Unable to reach the server. Please try again in a few seconds.';

if (IS_DEV) {
  console.log('API base URL:', API_BASE_URL);
}

export function isNetworkOrColdStartError(error) {
  const status = error?.response?.status;
  const messageLooksNetworked = /network error|timeout|timed out|failed to fetch/i.test(String(error?.message || ''));
  return (!error?.response && Boolean(error?.request))
    || error?.code === 'ECONNABORTED'
    || error?.code === 'MOBILE_API_HEALTH_TIMEOUT'
    || messageLooksNetworked
    || [502, 503, 504].includes(status);
}

function getErrorDetail(error) {
  return typeof error?.response?.data?.detail === 'string'
    ? error.response.data.detail.trim()
    : typeof error?.response?.data?.message === 'string'
      ? error.response.data.message.trim()
      : typeof error?.response?.data?.error === 'string'
        ? error.response.data.error.trim()
        : '';
}

export function normalizeApiError(error, fallback = GENERIC_API_MESSAGE) {
  const status = error?.response?.status ?? null;
  const detail = getErrorDetail(error);
  const method = String(error?.config?.method || '').toUpperCase() || undefined;
  const baseURL = error?.config?.baseURL ? String(error.config.baseURL).replace(/\/$/, '') : '';
  const requestPath = error?.config?.url ? String(error.config.url).replace(/^\//, '') : '';
  const url = baseURL && requestPath ? `${baseURL}/${requestPath}` : error?.config?.url;

  if (status === 401) {
    return {
      type: 'auth',
      status,
      message: detail || 'Session expired',
      method,
      url,
    };
  }

  if (status === 404) {
    return {
      type: 'route',
      status,
      message: detail || 'API route not found',
      method,
      url,
    };
  }

  if (status >= 500) {
    return {
      type: 'server',
      status,
      message: detail || (status === 503 ? SERVER_STARTING_MESSAGE : 'Server error'),
      method,
      url,
    };
  }

  if (!error?.response && (error?.request || /network error|timeout|failed to fetch/i.test(String(error?.message || '')))) {
    return {
      type: 'network',
      status: null,
      message: 'Network connection issue',
      method,
      url,
    };
  }

  return {
    type: status ? 'api' : 'unknown',
    status,
    message: detail || error?.userMessage || fallback,
    method,
    url,
  };
}

export function getApiErrorMessage(error, fallback = GENERIC_API_MESSAGE) {
  const detail = getErrorDetail(error);

  if (detail) return detail;
  if (error?.normalized?.message) return error.normalized.message;
  if (error?.userMessage) return error.userMessage;
  const normalized = normalizeApiError(error, fallback);
  if (normalized.type === 'network' || normalized.type === 'auth' || normalized.type === 'route' || normalized.type === 'server') {
    return normalized.message;
  }
  if (isNetworkOrColdStartError(error)) return SERVER_STARTING_MESSAGE;
  return fallback;
}

// --- Connectivity check for debugging ---
export async function checkBackendConnection() {
  try {
    const response = await fetch(MOBILE_HEALTH_URL);
    if (IS_DEV) {
      console.log('Backend connectivity:', response.ok ? 'SUCCESS' : `FAIL ${response.status}`);
    }
    return { ok: response.ok, status: response.status, url: MOBILE_HEALTH_URL };
  } catch (err) {
    if (IS_DEV) {
      console.log('Backend connectivity: ERROR', err?.message);
      console.log('API base URL:', API_BASE_URL);
    }
    return { ok: false, error: getApiErrorMessage(err), url: MOBILE_HEALTH_URL };
  }
}


const AUTH_REFRESH_URL = `${MOBILE_API_BASE_URL}/auth/session/refresh`;
const SESSION_TEARDOWN_URL = `${MOBILE_API_BASE_URL}/auth/session-teardown`;
const SESSION_REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
let refreshSessionPromise = null;

const CONFIRMED_INVALIDATION_CODES = new Set([
  'AUTH_TOKEN_MISSING',
  'SESSION_INVALID',
  'SESSION_REVOKED',
  'AUTH_ACCOUNT_NOT_FOUND',
  'REFRESH_TOKEN_MISSING',
  'REFRESH_TOKEN_INVALID',
  'REFRESH_TOKEN_EXPIRED',
]);

export function getConfirmedSessionInvalidation(error) {
  if (error?.sessionRetained === true) return null;
  const status = error?.response?.status;
  const code = String(error?.response?.data?.code || '').trim().toUpperCase();
  if (status === 403 && code === 'ACCOUNT_INACTIVE') return 'account_inactive';
  if (status === 401 && code === 'SESSION_EXPIRED') return 'session_expired';
  if (status === 401 && CONFIRMED_INVALIDATION_CODES.has(code)) return 'session_invalid';
  return null;
}

function isRetryableRefreshFailure(error) {
  const status = error?.response?.status;
  return !error?.response
    || error?.response?.data?.retryable === true
    || status === 408
    || status === 429
    || status >= 500;
}

// Best-effort cleanup for a session that just died (see AuthContext's forced
// session-expiry handler). Unlike a normal authenticated call, `expiredToken`
// is the token that just 401'd — it only works here because the backend's
// /auth/session-teardown route accepts a session within a short grace period
// after expiry (see backend/middleware/auth.js:authMiddlewareRecentSession),
// specifically so a device can disable its own push-token association even
// when the request that discovered the expiry already failed. If the token is
// past that grace window (or was invalidated some other way), this silently
// fails — it must never block local logout.
export async function teardownExpiredSession(expiredToken, pushToken) {
  if (!expiredToken) return false;
  try {
    await axios.post(SESSION_TEARDOWN_URL, { push_token: pushToken || null }, {
      headers: { Authorization: `Bearer ${expiredToken}` },
      timeout: 8000,
    });
    return true;
  } catch (_error) {
    return false;
  }
}

export const api = createAxios({
  baseURL: MOBILE_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

async function refreshBackendSession() {
  if (!refreshSessionPromise) {
    refreshSessionPromise = (async () => {
      const credentials = await getSessionCredentials();
      if (!credentials?.refreshToken) return null;

      const response = await axios.post(AUTH_REFRESH_URL, {
        refresh_token: credentials.refreshToken,
      }, { timeout: 15000 });
      const sessionToken = response?.data?.session_token || null;

      if (sessionToken) {
        // Keep the method-neutral refresh credential while rotating the
        // bearer token and its seven-day idle deadline.
        await setSessionToken(sessionToken, {
          refreshToken: credentials.refreshToken,
          expiresAt: response?.data?.expires_at,
          refreshExpiresAt: response?.data?.refresh_expires_at,
        });
      }

      return sessionToken;
    })().finally(() => {
      refreshSessionPromise = null;
    });
  }

  return refreshSessionPromise;
}

// Request interceptor - attach session token to every request
api.interceptors.request.use(
  async (config) => {
    const credentials = await getSessionCredentials();
    let token = credentials?.sessionToken || null;
    const expiresAtMs = credentials?.expiresAt ? Date.parse(credentials.expiresAt) : Number.NaN;
    const isAuthEndpoint = /\/auth\//.test(config?.url || '');

    // Rotate before the seven-day idle deadline, leaving a full day for
    // retries when the device is temporarily offline or the server is waking.
    // A proactive refresh failure never clears a still-valid bearer session.
    if (!isAuthEndpoint
      && credentials?.refreshToken
      && Number.isFinite(expiresAtMs)
      && expiresAtMs - Date.now() <= SESSION_REFRESH_WINDOW_MS) {
      try {
        token = await refreshBackendSession() || token;
      } catch (_) {
        // Keep and use the current credential. Only a server-confirmed
        // invalidation in the response interceptor may clear it.
      }
    }

    if (token && !config.headers?.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const invalidationReason = getConfirmedSessionInvalidation(error);

    // A deactivated account gets a 403 (not 401) from authMiddleware, which
    // already deleted every session for this user server-side — there is
    // nothing to refresh. Route it through the same clean-logout path as an
    // expired session instead of leaving authStatus stuck "authenticated"
    // until some later request happens to hit the now-deleted session and
    // 401s. Distinguished by a stable machine-readable code (not the English
    // detail string) so an unrelated 403 (e.g. hitting an admin-only route)
    // is never misread as account deactivation.
    if (invalidationReason === 'account_inactive') {
      const authHeader = originalRequest?.headers?.Authorization || originalRequest?.headers?.authorization || '';
      const expiredToken = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
      try {
        await removeSessionToken();
        await AsyncStorage.removeItem('session_user');
      } catch (_) {}
      emitSessionExpired(invalidationReason, { expiredToken });
    }

    // Handle 401 - try to refresh session once.
    // Skip for auth endpoints (login/register) - those 401s mean wrong credentials,
    // not an expired session. Retrying them would show the wrong error.
    const isAuthEndpoint = /\/auth\//.test(originalRequest?.url || '');
    // A request that never carried a session token has no authenticated
    // session to rotate. The refresh path never consults Firebase state.
    const hadSessionToken = Boolean(
      originalRequest?.headers?.Authorization || originalRequest?.headers?.authorization,
    );
    if (invalidationReason === 'session_expired' && !originalRequest._retry && !isAuthEndpoint && hadSessionToken) {
      originalRequest._retry = true;

      try {
        const sessionToken = await refreshBackendSession();

        if (sessionToken) {
          originalRequest.headers.Authorization = `Bearer ${sessionToken}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        console.warn('Session renewal unavailable:', {
          message: refreshError?.message,
          endpoint: AUTH_REFRESH_URL,
        });
        if (isRetryableRefreshFailure(refreshError)) {
          error.sessionRetained = true;
          error.normalized = normalizeApiError(refreshError);
          error.userMessage = getApiErrorMessage(refreshError);
          return Promise.reject(error);
        }
      }

      // Capture the dying token before it's deleted below. Even for a
      // genuinely TTL-expired session (the normal reason we're here),
      // AuthContext can still use this token for one authenticated cleanup
      // call: POST /auth/session-teardown accepts a session within a short
      // grace period after expiry specifically for this purpose (see
      // backend/middleware/auth.js:authMiddlewareRecentSession). This doesn't
      // widen backend trust generally — that endpoint still validates this
      // exact token against its own session record, and is scoped to nothing
      // but the caller's own push-token teardown.
      const expiredAuthHeader = originalRequest?.headers?.Authorization || originalRequest?.headers?.authorization || '';
      const expiredToken = typeof expiredAuthHeader === 'string' ? expiredAuthHeader.replace(/^Bearer\s+/i, '').trim() : '';

      // The server confirmed expiry and no refresh succeeded. Clear locally
      // and notify AuthContext synchronously.
      try {
        await removeSessionToken();
        await AsyncStorage.removeItem('session_user');
      } catch (_) {}
      emitSessionExpired('session_expired', { expiredToken });
    } else if (invalidationReason === 'session_invalid' && !isAuthEndpoint && hadSessionToken) {
      const authHeader = originalRequest?.headers?.Authorization || originalRequest?.headers?.authorization || '';
      const expiredToken = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
      try {
        await removeSessionToken();
        await AsyncStorage.removeItem('session_user');
      } catch (_) {}
      emitSessionExpired('session_invalid', { expiredToken });
    }

    error.normalized = normalizeApiError(error);
    error.userMessage = getApiErrorMessage(error);

    if (IS_DEV) {
      const requestUrl = originalRequest?.baseURL && originalRequest?.url
        ? `${String(originalRequest.baseURL).replace(/\/$/, '')}/${String(originalRequest.url).replace(/^\//, '')}`
        : originalRequest?.url;
      console.log('API error:', {
        message: error?.message,
        status: error?.response?.status,
        method: originalRequest?.method,
        url: requestUrl,
        type: error.normalized?.type,
        code: error?.response?.data?.code,
        detail: error?.response?.data?.detail || error?.response?.data?.message || error?.response?.data?.error,
      });
      console.log('API base URL:', API_BASE_URL);
    }
    
    return Promise.reject(error);
  }
);

// API functions
export const apiService = {
  // Dashboard
  getDashboard: () => api.get('/dashboard/me'),
  
  // Rooms
  getRooms: (params) => api.get('/rooms', { params }),
  getRoom: (roomId) => api.get(`/rooms/${roomId}`),
  
  // Billing
  getMyBilling: () => api.get('/billing/me'),
  getBillingHistory: () => api.get('/billing/history'),
  getPaymentHistory: () => api.get('/billing/history/paid'),
  getLatestBilling: () => api.get('/billing/me/latest'),
  getBillingById: (billingId) => api.get(`/billing/${billingId}`),
  submitPaymentProof: (billingId, proof) => api.post(`/billing/${billingId}/payment-proof`, { proof }),

  // PayMongo
  createPaymongoCheckout: (billingId) => api.post('/paymongo/checkout', { billingId }),
  getPaymongoCheckoutStatus: (checkoutId) => api.get(`/paymongo/checkout/${checkoutId}/status`),

  // Documents
  downloadDocumentUrl: (docId = 'contract') => `${MOBILE_API_BASE_URL}/documents/${docId}`,

  // Lease Contract (authoritative record — same Contract Capstone-Website's
  // Web admin manages, served via its mobileContractRoutes.js bridge at /api/m)
  getCurrentContract: () => api.get('/contracts/current'),

  // Maintenance
  getMyMaintenance: (status) => api.get('/maintenance/me', { params: { status } }),
  getMaintenance: (requestId) => api.get(`/maintenance/${requestId}`),
  createMaintenance: (data) => api.post('/maintenance', data),
  sendMaintenanceReply: (requestId, data) => api.post(`/maintenance/${requestId}/replies`, data),
  markMaintenanceRead: (requestId) => api.patch(`/maintenance/${requestId}/read`),
  confirmMaintenanceResolved: (requestId) => api.patch(`/maintenance/${requestId}/confirm-resolved`),
  updateMaintenance: (requestId, data) => api.put(`/maintenance/${requestId}`, data),
  cancelMaintenance: (requestId) => api.patch(`/maintenance/${requestId}/cancel`),
  reopenMaintenance: (requestId, data) => api.patch(`/maintenance/${requestId}/reopen`, data),
  
  // Announcements
  getAnnouncements: () => api.get('/announcements'),
  dismissAnnouncement: (announcementId) =>
    api.post(`/announcements/${encodeURIComponent(announcementId)}/dismiss`),
  restoreAnnouncement: (announcementId) =>
    api.delete(`/announcements/${encodeURIComponent(announcementId)}/dismiss`),
  dismissAnnouncementsBulk: (announcementIds) =>
    api.post('/announcements/dismiss-bulk', { ids: announcementIds }),
  getNotifications: () => api.get('/notifications'),
  markNotificationRead: (notificationId) => api.patch(`/notifications/${encodeURIComponent(notificationId)}/read`),
  markAllNotificationsRead: () => api.patch('/notifications/read-all'),
  
  // User Profile
  getProfile: () => api.get('/users/me'),
  updateProfile: (data) => api.put('/users/me', data),

  // User Documents (uploaded IDs, etc.)
  uploadUserDocument: (data) => api.post('/users/documents', data),
  getUserDocuments: () => api.get('/users/documents'),
  getUserDocumentFile: (docId) => api.get(`/users/documents/${docId}`),
  deleteUserDocument: (docId) => api.delete(`/users/documents/${docId}`),

  // Tenant surveys
  getMySurveys: () => api.get('/surveys/me'),
  getMySurvey: (surveyId) => api.get(`/surveys/${encodeURIComponent(surveyId)}/me`),
  saveSurveyDraft: (surveyId, answers) => api.put(`/surveys/${encodeURIComponent(surveyId)}/draft`, { answers }),
  submitSurvey: (surveyId, answers) => api.post(`/surveys/${encodeURIComponent(surveyId)}/submit`, { answers }),
  getMySurveyResponse: (surveyId) => api.get(`/surveys/${encodeURIComponent(surveyId)}/response/me`),
  
  // FAQs (Chatbot)
  getFAQs: (category) => api.get('/faqs', { params: { category } }),
  getFAQCategories: () => api.get('/faqs/categories'),
  
  // AI Chatbot
  sendChatMessage: (message, sessionId, attachments = [], clientMessageId = '') =>
    api.post('/chatbot/message', {
      message,
      session_id: sessionId,
      attachments,
      client_message_id: clientMessageId,
    }),
  getChatbotSuggestions: () => api.get('/chatbot/suggestions'),
  resetChatSession: (sessionId) =>
    api.post('/chatbot/reset', { session_id: sessionId }),

  // Human support chat. All current mobile support work goes through the one
  // canonical conversation/message/attachment model shared with web admin.
  startSupportChat: (data) => api.post('/chat/start', data),
  getMySupportChats: () => api.get('/chat/me'),
  getSupportChatMessages: (conversationId, params = {}) =>
    api.get(`/chat/${conversationId}/messages`, { params }),
  sendSupportMessage: (conversationId, message, attachments = [], clientMessageId = '') =>
    api.post(`/chat/${conversationId}/messages`, { message, attachments, clientMessageId }),
  // Registers an attachment whose bytes were already uploaded through the
  // canonical durable-storage pipeline (POST /upload/firebase-storage, via
  // ensureFirebaseStorageAttachments). The backend has no multipart parser
  // and deliberately no second storage system — it re-proves the
  // server-issued storagePath/downloadUrl pair belongs to this tenant, then
  // records the metadata.
  registerSupportAttachment: (conversationId, attachment = {}, clientAttachmentId = '') =>
    api.post(`/chat/${encodeURIComponent(conversationId)}/attachments`, { attachment, clientAttachmentId }),
  // Rollback for a multi-file send that failed part-way. Only the uploader can
  // discard, and only while no message references the attachment yet, so this
  // can never delete sent chat history.
  discardSupportAttachment: (conversationId, attachmentId) =>
    api.delete(
      `/chat/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}`,
    ),
  confirmSupportResolution: (conversationId, resolved, note = '', satisfaction = {}) =>
    api.patch(`/chat/${conversationId}/resolution`, {
      resolved,
      note,
      ...(satisfaction.rating ? { rating: satisfaction.rating } : {}),
      ...(satisfaction.feedback?.trim() ? { feedback: satisfaction.feedback.trim() } : {}),
    }),
  reopenSupportChat: (conversationId, note) =>
    api.patch(`/chat/${conversationId}/reopen`, { note }),
  closeSupportChat: (conversationId, note) =>
    api.patch(`/chat/${conversationId}/close`, { note }),
  
  // Seed data
  seedData: () => api.post('/seed'),

  // Push notifications
  savePushToken: (pushToken, provider = 'fcm', devicePlatform = null) =>
    api.post('/users/push-token', {
      push_token: pushToken,
      provider,
      device_platform: devicePlatform,
      notifications_enabled: true,
    }),

  // Auth
  // Password reset is a public, shared web/mobile operation. Use the
  // canonical Firebase action-code request service through the tenant-only
  // /api/m alias, not the retired password_reset_tokens authority.
  forgotPassword: (email) => axios.post(
    `${MOBILE_API_BASE_URL}/auth/forgot-password`,
    { email },
    { timeout: 15000 },
  ),
  changePassword: (currentPassword, newPassword, options = {}) =>
    api.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
      notify_app: options.notifyApp ?? true,
      notify_email: options.notifyEmail ?? true,
    }),
  verifyLoginOtp: (otpToken, otpCode) =>
    api.post('/auth/login/verify-otp', { otp_token: otpToken, otp_code: otpCode }),
  resendLoginOtp: (otpToken) =>
    api.post('/auth/login/resend-otp', { otp_token: otpToken }),
};
