import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { auth, getFreshIdToken, subscribeToAuthState } from '../config/firebase';
import { api } from '../services/api';
import {
  registerForPushNotifications,
  savePushTokenToServer,
  setupNotificationListeners,
} from '../services/notifications';

const AuthContext = createContext(undefined);

// Auth status: 'initializing' → 'authenticated' | 'unauthenticated'
// This replaces the old mix of isLoading / rehydrated / authReady / signOutError

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState('initializing'); // single source of truth
  const [firebaseUser, setFirebaseUser] = useState(null);
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  // ── Push notification listeners (once) ──
  useEffect(() => {
    const cleanup = setupNotificationListeners(
      null,
      (data) => {
        if (routerRef.current) {
          if (data?.screen === 'billing') routerRef.current.push('/billing-history');
          else if (data?.screen === 'announcements') routerRef.current.push('/(tabs)/announcements');
          else if (data?.screen === 'services') routerRef.current.push('/(tabs)/services');
        }
      },
    );
    return () => { if (cleanup) cleanup(); };
  }, []);

  // ── Hydrate session on mount ──
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await AsyncStorage.getItem('session_token');
        if (!token) {
          if (!cancelled) {
            setUser(null);
            setAuthStatus('unauthenticated');
          }
          return;
        }

        // Validate token with backend
        const response = await api.get('/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!cancelled) {
          setUser(response.data);
          setAuthStatus('authenticated');
        }
      } catch (err) {
        console.warn('Session hydration failed:', err?.message);
        const status = err?.response?.status;
        if (status === 401) {
          // Token expired or invalid — clear session only
          // Keep remember_me and last_email so the user's preference survives
          await AsyncStorage.removeItem('session_token').catch(() => {});
        }
        if (!cancelled) {
          setUser(null);
          setAuthStatus('unauthenticated');
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // ── Firebase auth state listener ──
  // Only for Google sign-in — does NOT affect backend session
  useEffect(() => {
    const unsubscribe = subscribeToAuthState((fbUser) => {
      setFirebaseUser(fbUser);
    });
    return () => unsubscribe();
  }, []);

  // ── Login with Email/Password ──
  const loginWithEmail = async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      const { user: userData, session_token } = response.data;

      await AsyncStorage.setItem('session_token', session_token);
      setUser(userData);
      setAuthStatus('authenticated');

      // Push notifications (background, non-blocking)
      registerForPushNotifications().then(savePushTokenToServer).catch(() => {});

      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data?.detail;

      if (status === 400) {
        await AsyncStorage.removeItem('session_token').catch(() => {});
        return { success: false, status, error: detail || 'Please check your input and try again.' };
      }
      if (status === 401) {
        await AsyncStorage.removeItem('session_token').catch(() => {});
        return { success: false, status, error: detail || 'Invalid email or password. Please try again.' };
      }
      if (status === 403) {
        return { success: false, status, error: detail || 'Access denied. Your account is not registered as a verified tenant. Please contact the admin office.' };
      }
      if (status === 429) {
        return { success: false, status, error: detail || 'Too many failed attempts. Please wait a moment before trying again.' };
      }
      if (status === 500) {
        return { success: false, status, error: 'A server error occurred. Please try again in a moment.' };
      }
      return { success: false, status: 0, error: 'Unable to connect. Please check your internet connection.' };
    }
  };

  // ── Login shorthand (for components that just check true/false) ──
  const login = async (email, password) => {
    const result = await loginWithEmail(email, password);
    return result.success;
  };

  // ── Register with Email/Password ──
  const registerWithEmail = async (email, password, name = '', phone = '') => {
    try {
      const response = await api.post('/auth/register', { email, password, name, phone });
      const { user: userData, session_token } = response.data;

      await AsyncStorage.setItem('session_token', session_token);
      setUser(userData);
      setAuthStatus('authenticated');

      registerForPushNotifications().then(savePushTokenToServer).catch(() => {});
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data?.detail;
      if (status === 400) {
        return { success: false, error: detail || 'Invalid registration data.' };
      }
      return { success: false, error: detail || 'Unable to create account. Please try again later.' };
    }
  };

  // ── Google Sign-In ──
  const signInWithGoogle = async (idToken) => {
    try {
      let tokenToUse = idToken;
      if (!tokenToUse && firebaseUser) {
        tokenToUse = await getFreshIdToken();
      }

      if (!tokenToUse) {
        return { success: false, error: 'No authentication token available' };
      }

      const response = await api.post('/auth/google', { idToken: tokenToUse });
      const { user: userData, session_token } = response.data;

      await AsyncStorage.setItem('session_token', session_token);
      setUser(userData);
      setAuthStatus('authenticated');

      registerForPushNotifications().then(savePushTokenToServer).catch(() => {});
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data?.detail;

      if (status === 403) {
        return { success: false, error: detail || 'Access denied. Your account is not registered as an active tenant.' };
      }
      if (status === 401) {
        return { success: false, error: detail || 'Invalid authentication. Please try again.' };
      }
      return { success: false, error: 'Unable to sign in with Google. Please try again.' };
    }
  };

  // ── Logout ──
  const logout = async () => {
    try {
      const token = await AsyncStorage.getItem('session_token');
      if (token) {
        await api.post('/auth/logout', {}, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {}); // best effort
      }
    } finally {
      await AsyncStorage.removeItem('session_token').catch(() => {});
      // NOTE: We intentionally do NOT clear biometric credentials here.
      // Stored credentials must survive logout so the user can sign back in
      // with biometrics. They are cleared only when:
      //   1. The user changes their password (change-password.jsx)
      //   2. The user explicitly disables biometric in Settings
      setUser(null);
      setAuthStatus('unauthenticated');

      try { await auth.signOut(); } catch (_) { /* ok */ }
    }
  };

  // ── Re-check auth (for biometric, pull-to-refresh, etc.) ──
  const checkAuth = async () => {
    try {
      const token = await AsyncStorage.getItem('session_token');
      if (!token) {
        setUser(null);
        setAuthStatus('unauthenticated');
        return;
      }

      const response = await api.get('/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser(response.data);
      setAuthStatus('authenticated');
    } catch (error) {
      if (error?.response?.status === 401) {
        await AsyncStorage.removeItem('session_token').catch(() => {});
        setUser(null);
        setAuthStatus('unauthenticated');
      }
    }
  };

  // ── Update user data locally ──
  const updateUser = (data) => {
    setUser((prev) => prev ? { ...prev, ...data } : data);
  };

  // ── Derived booleans for backward compatibility ──
  const isLoading = authStatus === 'initializing';
  const authReady = authStatus !== 'initializing';

  // Block rendering until hydration completes
  if (authStatus === 'initializing') {
    return null;
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        firebaseUser,
        isLoading,
        authReady,
        authStatus,
        login,
        loginWithEmail,
        registerWithEmail,
        logout,
        checkAuth,
        signInWithGoogle,
        updateUser,
        getFreshIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
