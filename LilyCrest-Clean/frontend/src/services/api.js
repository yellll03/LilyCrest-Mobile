import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getFreshIdToken } from '../config/firebase';

const DEFAULT_PORT = process.env.EXPO_PUBLIC_BACKEND_PORT || '8001';
// Default the chatbot port to the main backend unless explicitly overridden.
const CHATBOT_PORT = process.env.EXPO_PUBLIC_CHATBOT_PORT || DEFAULT_PORT;
const DEV_FALLBACK_HOST = process.env.EXPO_PUBLIC_DEV_HOST || null;

function resolveDevHost() {
  const hostUri = Constants.expoConfig?.hostUri || Constants.manifest2?.extra?.expoGo?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    const backendUrl = `http://${host}:${DEFAULT_PORT}`;
    console.log('Backend URL resolved from Expo host:', backendUrl);
    return backendUrl;
  }
  const fallbackHost = DEV_FALLBACK_HOST || Platform.select({ android: 'http://10.0.2.2', default: 'http://localhost' });
  const fallbackUrl = `${fallbackHost}:${DEFAULT_PORT}`;
  console.log('Backend URL using fallback:', fallbackUrl);
  return fallbackUrl;
}


let BACKEND_URL;
if (Platform.OS === 'android') {
  // Prefer Expo hostUri (works for both emulator and physical device); fall back to emulator loopback.
  BACKEND_URL = resolveDevHost();
} else if (Platform.OS === 'web') {
  BACKEND_URL = `http://localhost:${DEFAULT_PORT}`;
} else {
  BACKEND_URL = resolveDevHost();
}

console.log('Final Backend URL:', BACKEND_URL);

// --- Connectivity check for debugging ---
export async function checkBackendConnection() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/m/health`);
    if (response.ok) {
      console.log('Backend connectivity: SUCCESS');
    } else {
      console.warn('Backend connectivity: FAIL', response.status);
    }
  } catch (err) {
    console.error('Backend connectivity: ERROR', err.message);
  }
}

function withPort(baseUrl, port) {
  // Use simple string replacement — new URL() may not work reliably on all Hermes versions
  return `${baseUrl.replace(/:\d+$/, '')}:${port}`;
}

const CHATBOT_BASE_URL = withPort(BACKEND_URL, CHATBOT_PORT);

// Export base URL for non-axios downloads (e.g., Linking openURL)
export const BASE_BACKEND_URL = BACKEND_URL;

export const api = axios.create({
  baseURL: `${BACKEND_URL}/api/m`,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

// Request interceptor — attach session token to every request
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
    
    // Handle 401 — try to refresh session once.
    // Skip for auth endpoints (login/register) — those 401s mean wrong credentials,
    // not an expired session. Retrying them would show the wrong error.
    const isAuthEndpoint = /\/auth\/(login|register)/.test(originalRequest?.url || '');
    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      originalRequest._retry = true;

      try {
        // Only works for Google/Firebase auth users
        const idToken = await getFreshIdToken(true);
        
        if (idToken) {
          // Renew session via Google auth endpoint
          const response = await axios.post(`${BACKEND_URL}/api/auth/google`, { idToken });
          const { session_token } = response.data;
          
          if (session_token) {
            await AsyncStorage.setItem('session_token', session_token);
            originalRequest.headers.Authorization = `Bearer ${session_token}`;
            return api(originalRequest);
          }
        }
      } catch (refreshError) {
        console.warn('Token refresh failed:', refreshError?.message);
      }

      // Refresh failed or no Firebase user — clear session
      try {
        await AsyncStorage.removeItem('session_token');
      } catch (_) {}
    }
    
    // Log network errors for debugging
    if (!error.response && error.request) {
      console.error('Network Error:', {
        url: error.config?.url,
        method: error.config?.method,
        message: error.message,
      });
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
  getPaymentHistory: () => api.get('/billing/history'),
  getLatestBilling: () => api.get('/billing/me/latest'),
  updateBilling: (billingId, data) => api.put(`/billing/${billingId}`, data),

  // PayMongo
  createPaymongoCheckout: (billingId) => api.post('/paymongo/checkout', { billingId }),
  getPaymongoCheckoutStatus: (checkoutId) => api.get(`/paymongo/checkout/${checkoutId}/status`),

  // Documents
  downloadDocumentUrl: (docId = 'contract') => `${BASE_BACKEND_URL}/api/m/documents/${docId}`,
  
  // Maintenance
  getMyMaintenance: (status) => api.get('/maintenance/me', { params: { status } }),
  createMaintenance: (data) => api.post('/maintenance', data),
  updateMaintenance: (requestId, data) => api.put(`/maintenance/${requestId}`, data),
  cancelMaintenance: (requestId) => api.patch(`/maintenance/${requestId}/cancel`),
  reopenMaintenance: (requestId, data) => api.patch(`/maintenance/${requestId}/reopen`, data),
  
  // Announcements
  getAnnouncements: () => api.get('/announcements'),
  
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
  
  // Support Tickets
  getMyTickets: (status) => api.get('/tickets/me', { params: { status } }),
  getTicket: (ticketId) => api.get(`/tickets/${ticketId}`),
  createTicket: (data) => api.post('/tickets', data),
  respondToTicket: (ticketId, data) => api.post(`/tickets/${ticketId}/respond`, data),
  updateTicketStatus: (ticketId, status) => api.put(`/tickets/${ticketId}/status`, { status }),
  
  // Seed data
  seedData: () => api.post('/seed'),

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
