import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { auth, getFreshIdToken, subscribeToAuthState } from '../config/firebase';
import { api } from '../services/api';
import {
  registerForPushNotifications,
  savePushTokenToServer,
  setupNotificationListeners,
} from '../services/notifications';

const AuthContext = createContext(undefined);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [rehydrated, setRehydrated] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [sessionToken, setSessionToken] = useState(null);
  const [signOutError, setSignOutError] = useState(false);
  const authUnsubscribeRef = useRef(null);
  const notifCleanupRef = useRef(null);
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  // Setup push notification listeners once
  useEffect(() => {
    const cleanup = setupNotificationListeners(
      null, // onReceived — handled by the handler set in notifications.js
      (data) => {
        // When user taps a notification, navigate accordingly
        if (routerRef.current) {
          if (data?.screen === 'billing') routerRef.current.push('/billing-history');
          else if (data?.screen === 'announcements') routerRef.current.push('/(tabs)/announcements');
          else if (data?.screen === 'services') routerRef.current.push('/(tabs)/services');
        }
      }
    );
    notifCleanupRef.current = cleanup;
    return () => { if (notifCleanupRef.current) notifCleanupRef.current(); };
  }, []);
  // Hydrate session and bootstrap auth in a single pass
  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem('session_token');
        if (token) {
          setSessionToken(token);
          try {
            const response = await api.get('/auth/me', {
              headers: { Authorization: `Bearer ${token}` },
            });
            setUser(response.data);
          } catch (authErr) {
            console.warn('Initial auth bootstrap failed:', authErr?.message);
            // If 401, clear all stale auth state (token + remember-me prefs)
            if (authErr?.response?.status === 401) {
              await AsyncStorage.multiRemove(['session_token', 'remember_me', 'last_email']);
              setSessionToken(null);
              setUser(null);
            } else {
              // Network error — keep a minimal user so the app doesn't block rendering
              setUser((u) => u || { session_token: token });
            }
          }
        } else {
          setUser(null);
          setSessionToken(null);
        }
      } catch (err) {
        console.warn('Hydration error:', err?.message);
      } finally {
        setRehydrated(true);
        setAuthReady(true);
        setIsLoading(false);
      }
    })();
  }, []);

  // Subscribe to Firebase auth state changes
  useEffect(() => {
    const unsubscribe = subscribeToAuthState((fbUser) => {
      console.log('Firebase auth state changed:', fbUser?.email || 'signed out');
      // Firebase is used only for Google/OIDC; do not clear backend session on Firebase sign-out
      setFirebaseUser(fbUser);
    });

    authUnsubscribeRef.current = unsubscribe;

    return () => {
      if (authUnsubscribeRef.current) {
        authUnsubscribeRef.current();
      }
    };
  }, []);

  // PATCH: Only run checkAuth after hydration, and prevent infinite sign-out loop
  const safeCheckAuth = async () => {
    if (!rehydrated) return;
    try {
      setIsLoading(true);
      const token = await AsyncStorage.getItem('session_token');
      if (token) {
        setSessionToken(token);
        const response = await api.get('/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setUser(response.data);
        setSignOutError(false);
      }
    } catch (error) {
      const status = error.response?.status;
      console.warn('Auth check failed:', error?.message);
      if (status === 401) {
        await AsyncStorage.removeItem('session_token');
        setSessionToken(null);
        setUser(null);
      }
    } finally {
      setAuthReady(true);
      setIsLoading(false);
    }
  };

  const login = async (email, password) => {
    const result = await loginWithEmail(email, password);
    return result.success;
  };

  const loginWithEmail = async (email, password) => {
    try {
      // Call backend /auth/login endpoint directly
      const response = await api.post('/auth/login', { email, password });
      const { user: userData, session_token } = response.data;
      await AsyncStorage.setItem('session_token', session_token);
      setSessionToken(session_token);
      setUser(userData);
      setAuthReady(true);
      // Register push notifications in background after login
      registerForPushNotifications().then(savePushTokenToServer).catch(() => { });
      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      const status = error.response?.status;
      const detail = error.response?.data?.detail;
      if (status === 400 || status === 401) {
        return { success: false, error: detail || 'Invalid email or password.' };
      }
      if (status === 403) {
        return { success: false, error: detail || 'Access denied. Your account is not registered as a verified tenant.' };
      }
      if (status === 429) {
        return { success: false, error: detail || 'Too many attempts. Please try again later.' };
      }
      if (status === 500) {
        return { success: false, error: detail || 'Server error. Please try again in a moment.' };
      }
      return { success: false, error: 'Unable to sign in. Please check your connection and try again.' };
    }
  };

  const registerWithEmail = async (email, password, name = '', phone = '') => {
    try {
      // Use the dedicated registration endpoint which handles both
      // Firebase account creation and MongoDB tenant record creation
      const response = await api.post('/auth/register', { email, password, name, phone });
      const { user: userData, session_token } = response.data;
      await AsyncStorage.setItem('session_token', session_token);
      setSessionToken(session_token);
      setUser(userData);
      setAuthReady(true);
      // Register push notifications in background after registration
      registerForPushNotifications().then(savePushTokenToServer).catch(() => { });
      return { success: true };
    } catch (error) {
      console.error('Registration error:', error);
      const status = error.response?.status;
      const detail = error.response?.data?.detail;
      if (status === 400) {
        return { success: false, error: detail || 'Invalid registration data.' };
      }
      return { success: false, error: detail || 'Unable to create account. Please try again later.' };
    }
  };

  // Firebase Google Sign-In
  const signInWithGoogle = async (idToken) => {
    try {
      // If no idToken provided, try to get it from current Firebase user
      let tokenToUse = idToken;
      if (!tokenToUse && firebaseUser) {
        tokenToUse = await getFreshIdToken();
      }

      if (!tokenToUse) {
        return {
          success: false,
          error: 'No authentication token available'
        };
      }

      const response = await api.post('/auth/google', { idToken: tokenToUse });
      const { user: userData, session_token } = response.data;

      await AsyncStorage.setItem('session_token', session_token);
      setSessionToken(session_token);
      setUser(userData);
      setAuthReady(true);
      // Register push notifications in background after Google login
      registerForPushNotifications().then(savePushTokenToServer).catch(() => { });

      return { success: true };
    } catch (error) {
      console.error('Google sign-in error:', error);

      const status = error.response?.status;
      const detail = error.response?.data?.detail;

      if (status === 403) {
        return {
          success: false,
          error: detail || 'Access denied. Your account is not registered as an active tenant.'
        };
      } else if (status === 401) {
        return {
          success: false,
          error: detail || 'Invalid authentication. Please try again.'
        };
      } else {
        return {
          success: false,
          error: 'Unable to sign in with Google. Please try again.'
        };
      }
    }
  };

  const processSessionId = async (sessionId) => {
    try {
      const response = await api.post('/auth/session', { session_id: sessionId });
      const { user: userData, session_token } = response.data;

      await AsyncStorage.setItem('session_token', session_token);
      setSessionToken(session_token);
      setUser(userData);
      return true;
    } catch (error) {
      console.error('Process session error:', error);

      if (error.response?.status === 403) {
        const message = error.response?.data?.detail ||
          'Your account is not registered as an active tenant. Please contact the dormitory administrator.';
        Alert.alert('Access Denied', message);
      } else if (error.response?.status === 401) {
        Alert.alert('Authentication Failed', 'Invalid session. Please try logging in again.');
      } else {
        Alert.alert('Error', 'Unable to sign in. Please try again later.');
      }
      return false;
    }
  };

  const logout = async () => {
    try {
      const token = await AsyncStorage.getItem('session_token');
      if (token) {
        await api.post('/auth/logout', {}, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      await AsyncStorage.removeItem('session_token');
      setSessionToken(null);
      setUser(null);

      // Sign out from Firebase
      try {
        await auth.signOut();
        console.log('Signed out from Firebase');
      } catch (firebaseError) {
        console.error('Firebase sign out error:', firebaseError);
      }
    }
  };

  const updateUser = (data) => {
    setUser((prev) => prev ? { ...prev, ...data } : data);
  };

  // PATCH: Only render children after hydration
  if (!rehydrated) {
    return null; // Avoid rendering before storage hydration
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        firebaseUser,
        isLoading,
        authReady,
        sessionToken,
        login,
        loginWithEmail,
        registerWithEmail,
        logout,
        checkAuth: safeCheckAuth,
        processSessionId,
        signInWithGoogle,
        updateUser,
        getFreshIdToken, // Export for use in API interceptor
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
