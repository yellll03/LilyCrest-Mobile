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
    const response = await fetch(`${BACKEND_URL}/api/auth/me`);
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
  baseURL: `${BACKEND_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

// Track if we're currently refreshing to prevent multiple refresh attempts
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  
  failedQueue = [];
};

// Request interceptor to add auth token
api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('session_token');
    const urlPath = config.url || '';
    const isAuthPath = urlPath.includes('/auth/');

    if (!token && !isAuthPath) {
      return Promise.reject(new axios.Cancel('Missing session token; request cancelled'));
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Only attach Firebase ID token for auth-related requests
    if (isAuthPath) {
      try {
        const idToken = await getFreshIdToken();
        if (idToken) {
          config.headers['X-Firebase-ID-Token'] = idToken;
        }
      } catch (idErr) {
        console.warn('Unable to attach Firebase ID token:', idErr?.message);
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // Handle 401 errors with token refresh attempt
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // If already refreshing, queue this request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(token => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch(err => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Try to get fresh Firebase token and create new session
        // This only works for Google/Firebase auth users — email/password users
        // don't have a Firebase session to refresh.
        const idToken = await getFreshIdToken(true); // Force refresh
        
        if (idToken) {
          // Firebase user exists — attempt Google-style session renewal
          const response = await axios.post(`${BACKEND_URL}/api/auth/google`, { idToken });
          const { session_token } = response.data;
          
          if (session_token) {
            await AsyncStorage.setItem('session_token', session_token);
            processQueue(null, session_token);
            
            // Retry original request with new token
            originalRequest.headers.Authorization = `Bearer ${session_token}`;
            isRefreshing = false;
            return api(originalRequest);
          }
        }
        // No Firebase user (email/password auth) — clear session, user must re-login
        processQueue(new Error('Session expired'), null);
        await AsyncStorage.removeItem('session_token');
        isRefreshing = false;
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
        processQueue(refreshError, null);
        await AsyncStorage.removeItem('session_token');
        isRefreshing = false;
        return Promise.reject(refreshError);
      }
    }
    
    // Log connection errors for debugging
    if (!error.response && error.request) {
      console.error('Network Error - No response from server:', {
        url: error.config?.url,
        baseURL: error.config?.baseURL,
        method: error.config?.method,
        message: error.message
      });
    }
    
    if (error.response?.status === 401) {
      try {
        await AsyncStorage.removeItem('session_token');
      } catch (_) {
        // ignore storage removal errors
      }
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
  
  // Assignments
  getMyAssignment: () => api.get('/assignments/me'),
  
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
  downloadDocumentUrl: (docId = 'contract') => `${BASE_BACKEND_URL}/api/documents/${docId}`,
  
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
};
