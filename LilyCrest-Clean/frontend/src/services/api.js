import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, { create as createAxios } from 'axios';
import { API_BASE_URL, MOBILE_API_BASE_URL, MOBILE_HEALTH_URL } from '../config/api';
import { getFreshIdToken } from '../config/firebase';
import { getSessionToken, isCurrentSessionRemembered, removeSessionToken, setSessionToken } from './secureCredentials';
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


const AUTH_REFRESH_URL = `${MOBILE_API_BASE_URL}/auth/google`;
const SESSION_TEARDOWN_URL = `${MOBILE_API_BASE_URL}/auth/session-teardown`;
let refreshSessionPromise = null;

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

async function refreshGoogleSession() {
  if (!refreshSessionPromise) {
    refreshSessionPromise = (async () => {
      const idToken = await getFreshIdToken(true);
      if (!idToken) return null;

      const response = await axios.post(AUTH_REFRESH_URL, { idToken });
      const sessionToken = response?.data?.session_token || null;

      if (sessionToken) {
        // Preserve the original "Remember Me" choice — a same-run silent
        // refresh must not upgrade a memory-only session into a durable one.
        await setSessionToken(sessionToken, { remember: isCurrentSessionRemembered() });
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
    const token = await getSessionToken();
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

    // A deactivated account gets a 403 (not 401) from authMiddleware, which
    // already deleted every session for this user server-side — there is
    // nothing to refresh. Route it through the same clean-logout path as an
    // expired session instead of leaving authStatus stuck "authenticated"
    // until some later request happens to hit the now-deleted session and
    // 401s. Distinguished by a stable machine-readable code (not the English
    // detail string) so an unrelated 403 (e.g. hitting an admin-only route)
    // is never misread as account deactivation.
    if (error.response?.status === 403 && error.response?.data?.code === 'ACCOUNT_INACTIVE') {
      const authHeader = originalRequest?.headers?.Authorization || originalRequest?.headers?.authorization || '';
      const expiredToken = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
      try {
        await removeSessionToken();
        await AsyncStorage.removeItem('session_user');
      } catch (_) {}
      emitSessionExpired('account_inactive', { expiredToken });
    }

    // Handle 401 - try to refresh session once.
    // Skip for auth endpoints (login/register) - those 401s mean wrong credentials,
    // not an expired session. Retrying them would show the wrong error.
    const isAuthEndpoint = /\/auth\/(login|register|google|forgot-password|login\/verify-otp|login\/resend-otp)/.test(originalRequest?.url || '');
    // A request that never carried a session token in the first place has
    // nothing to refresh — attempting refreshGoogleSession() here would pull
    // from Firebase's own independently-persisted client session (it survives
    // an app kill regardless of "Remember Me", see config/firebase.js's
    // getReactNativePersistence(AsyncStorage)) and could silently mint a
    // brand-new backend session after a cold start where "Remember Me" was
    // off and no session should exist at all.
    const hadSessionToken = Boolean(
      originalRequest?.headers?.Authorization || originalRequest?.headers?.authorization,
    );
    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint && hadSessionToken) {
      originalRequest._retry = true;

      try {
        const sessionToken = await refreshGoogleSession();

        if (sessionToken) {
          originalRequest.headers.Authorization = `Bearer ${sessionToken}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        console.warn('Token refresh failed:', {
          message: refreshError?.message,
          endpoint: AUTH_REFRESH_URL,
        });
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

      // Refresh failed or no Firebase user - clear session and let AuthContext
      // know synchronously, so a screen that's still mounted doesn't keep
      // rendering as if authenticated until its next API call also 401s.
      try {
        await removeSessionToken();
        await AsyncStorage.removeItem('session_user');
      } catch (_) {}
      emitSessionExpired('refresh_failed', { expiredToken });
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
  sendChatMessage: (message, sessionId, attachments = []) =>
    api.post('/chatbot/message', { message, session_id: sessionId, attachments }),
  resetChatSession: (sessionId) =>
    api.post('/chatbot/reset', { session_id: sessionId }),
  requestAdminChat: (sessionId, reason) =>
    api.post('/chatbot/request-admin', { session_id: sessionId, reason }),
  getLiveChatStatus: (sessionId) =>
    api.get(`/chatbot/live-status/${sessionId}`),
  // Tenant live chat uses the same endpoint; backend routes to admin when active.
  sendLiveChatMessage: (message, sessionId) =>
    api.post('/chatbot/message', { message, session_id: sessionId }),
  closeLiveChat: (sessionId) =>
    api.post('/chatbot/close-live-chat', { session_id: sessionId }),
  
  // Support Tickets
  getMyTickets: (status) => api.get('/tickets/me', { params: { status } }),
  getTicket: (ticketId) => api.get(`/tickets/${ticketId}`),
  createTicket: (data) => api.post('/tickets', data),
  respondToTicket: (ticketId, data) => api.post(`/tickets/${ticketId}/respond`, data),
  updateTicketStatus: (ticketId, status) => api.put(`/tickets/${ticketId}/status`, { status }),

  // Human support chat - synced with the web admin panel in real-time.
  // Uses /api/m/chat/... endpoints (mobile bridge in Capstone server) which
  // write to chat_conversations + chat_messages collections the web admin reads.
  startSupportChat: (data) => api.post('/chat/start', data),
  getMySupportChats: () => api.get('/chat/me'),
  getSupportChatMessages: (conversationId) => api.get(`/chat/${conversationId}/messages`),
  sendSupportMessage: (conversationId, message) =>
    api.post(`/chat/${conversationId}/messages`, { message }),
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
