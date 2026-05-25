import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, { create as createAxios } from 'axios';
import { API_BASE_URL, MOBILE_API_BASE_URL, MOBILE_HEALTH_URL } from '../config/api';
import { getFreshIdToken } from '../config/firebase';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;
export const SERVER_STARTING_MESSAGE = 'The server is starting. Please try again in a few seconds.';
const GENERIC_API_MESSAGE = 'Unable to reach the server. Please try again in a few seconds.';

if (IS_DEV) {
  console.log('API base URL:', API_BASE_URL);
}

export function isNetworkOrColdStartError(error) {
  const status = error?.response?.status;
  const messageLooksNetworked = /network error|timeout|failed to fetch/i.test(String(error?.message || ''));
  return (!error?.response && Boolean(error?.request))
    || error?.code === 'ECONNABORTED'
    || messageLooksNetworked
    || [502, 503, 504].includes(status);
}

export function getApiErrorMessage(error, fallback = GENERIC_API_MESSAGE) {
  const detail = typeof error?.response?.data?.detail === 'string'
    ? error.response.data.detail.trim()
    : typeof error?.response?.data?.message === 'string'
      ? error.response.data.message.trim()
      : '';

  if (detail) return detail;
  if (error?.userMessage) return error.userMessage;
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
let refreshSessionPromise = null;

export const api = createAxios({
  baseURL: MOBILE_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

async function refreshGoogleSession() {
  if (!refreshSessionPromise) {
    refreshSessionPromise = (async () => {
      const idToken = await getFreshIdToken(true);
      if (!idToken) return null;

      const response = await axios.post(AUTH_REFRESH_URL, { idToken });
      const sessionToken = response?.data?.session_token || null;

      if (sessionToken) {
        await AsyncStorage.setItem('session_token', sessionToken);
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
    const token = await AsyncStorage.getItem('session_token');
    if (token) {
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
    
    // Handle 401 - try to refresh session once.
    // Skip for auth endpoints (login/register) - those 401s mean wrong credentials,
    // not an expired session. Retrying them would show the wrong error.
    const isAuthEndpoint = /\/auth\/(login|register|google|forgot-password|login\/verify-otp|login\/resend-otp)/.test(originalRequest?.url || '');
    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
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

      // Refresh failed or no Firebase user - clear session
      try {
        await AsyncStorage.multiRemove(['session_token', 'session_user']);
      } catch (_) {}
    }
    
    error.userMessage = getApiErrorMessage(error);

    if (IS_DEV) {
      console.log('API error:', error?.message);
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
  updateBilling: (billingId, data) => api.put(`/billing/${billingId}`, data),

  // PayMongo
  createPaymongoCheckout: (billingId) => api.post('/paymongo/checkout', { billingId }),
  getPaymongoCheckoutStatus: (checkoutId) => api.get(`/paymongo/checkout/${checkoutId}/status`),

  // Documents
  downloadDocumentUrl: (docId = 'contract') => `${MOBILE_API_BASE_URL}/documents/${docId}`,
  
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
  getNotifications: () => api.get('/notifications'),
  
  // User Profile
  getProfile: () => api.get('/users/me'),
  updateProfile: (data) => api.put('/users/me', data),

  // User Documents (uploaded IDs, etc.)
  uploadUserDocument: (data) => api.post('/users/documents', data),
  getUserDocuments: () => api.get('/users/documents'),
  getUserDocumentFile: (docId) => api.get(`/users/documents/${docId}`),
  deleteUserDocument: (docId) => api.delete(`/users/documents/${docId}`),
  
  // FAQs (Chatbot)
  getFAQs: (category) => api.get('/faqs', { params: { category } }),
  getFAQCategories: () => api.get('/faqs/categories'),
  
  // AI Chatbot
  sendChatMessage: (message, sessionId) => 
    api.post('/chatbot/message', { message, session_id: sessionId }),
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

  // Admin Ticket Management
  adminGetAllTickets: (status) => api.get('/tickets/admin/all', { params: { status } }),
  adminReplyToTicket: (ticketId, message) => api.post(`/tickets/admin/${ticketId}/reply`, { message }),
  adminUpdateTicketStatus: (ticketId, status) => api.put(`/tickets/admin/${ticketId}/status`, { status }),

  // Human support chat - synced with the web admin panel in real-time.
  // Uses /api/m/chat/... endpoints (mobile bridge in Capstone server) which
  // write to chat_conversations + chat_messages collections the web admin reads.
  startSupportChat: (data) => api.post('/chat/start', data),
  getMySupportChats: () => api.get('/chat/me'),
  getSupportChatMessages: (conversationId) => api.get(`/chat/${conversationId}/messages`),
  sendSupportMessage: (conversationId, message) =>
    api.post(`/chat/${conversationId}/messages`, { message }),
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
