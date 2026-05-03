import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, getFreshIdToken, subscribeToAuthState } from '../config/firebase';
import { api } from '../services/api';
import {
  arePushNotificationsEnabled,
  clearLastNotificationResponse,
  getLastNotificationResponseData,
  getStoredPushToken,
  registerForPushNotifications,
  requestPushPermissionOnFirstLaunch,
  resolveNotificationRoute,
  savePushTokenToServer,
  setupNotificationListeners,
  subscribeToPushTokenChanges,
} from '../services/notifications';
import { useToast } from './ToastContext';

const AuthContext = createContext(undefined);
const SESSION_TOKEN_KEY = 'session_token';
const SESSION_USER_KEY = 'session_user';

async function persistSession(sessionToken, userData) {
  const writes = [];
  if (sessionToken) {
    writes.push(AsyncStorage.setItem(SESSION_TOKEN_KEY, sessionToken));
  }
  if (userData) {
    writes.push(AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(userData)));
  }
  await Promise.all(writes);
}

async function clearPersistedSession() {
  await AsyncStorage.multiRemove([SESSION_TOKEN_KEY, SESSION_USER_KEY]).catch(async () => {
    await AsyncStorage.removeItem(SESSION_TOKEN_KEY).catch(() => {});
    await AsyncStorage.removeItem(SESSION_USER_KEY).catch(() => {});
  });
}

async function getCachedSessionUser() {
  try {
    const raw = await AsyncStorage.getItem(SESSION_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_error) {
    await AsyncStorage.removeItem(SESSION_USER_KEY).catch(() => {});
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState('initializing');
  const [firebaseUser, setFirebaseUser] = useState(null);
  const router = useRouter();
  const { showToast } = useToast();
  const routerRef = useRef(router);
  const authStatusRef = useRef(authStatus);
  const pendingNotificationRef = useRef(null);
  routerRef.current = router;
  authStatusRef.current = authStatus;

  // Safety net: if session hydration hangs for any reason, unblock the app after 10s
  useEffect(() => {
    const timeout = setTimeout(() => {
      setAuthStatus((prev) => (prev === 'initializing' ? 'unauthenticated' : prev));
    }, 10000);
    return () => clearTimeout(timeout);
  }, []);

  const navigateFromNotification = useCallback(async (data) => {
    const destination = resolveNotificationRoute(data);
    if (!destination || !routerRef.current) return false;

    routerRef.current.push(destination);
    pendingNotificationRef.current = null;
    await clearLastNotificationResponse().catch(() => {});
    return true;
  }, []);

  const handleNotificationTap = useCallback(async (data) => {
    if (!data) return;

    if (authStatusRef.current !== 'authenticated') {
      pendingNotificationRef.current = data;
      return;
    }

    await navigateFromNotification(data);
  }, [navigateFromNotification]);

  useEffect(() => {
    requestPushPermissionOnFirstLaunch().catch(() => {});
  }, []);

  useEffect(() => {
    const cleanup = setupNotificationListeners(
      (notification) => {
        const title = notification?.request?.content?.title || 'New update';
        const message = notification?.request?.content?.body || 'Open LilyCrest to view the latest update.';
        showToast({
          type: 'info',
          title,
          message,
          duration: 3600,
        });
      },
      (data) => {
        pendingNotificationRef.current = data;
        handleNotificationTap(data);
      }
    );

    return () => {
      if (cleanup) cleanup();
    };
  }, [handleNotificationTap, showToast]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const data = await getLastNotificationResponseData();
      if (cancelled || !data) return;

      pendingNotificationRef.current = data;
      await handleNotificationTap(data);
    })();

    return () => {
      cancelled = true;
    };
  }, [handleNotificationTap]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !pendingNotificationRef.current) return;
    handleNotificationTap(pendingNotificationRef.current);
  }, [authStatus, handleNotificationTap, user?.user_id]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await AsyncStorage.getItem(SESSION_TOKEN_KEY);
        if (!token) {
          await AsyncStorage.removeItem(SESSION_USER_KEY).catch(() => {});
          if (!cancelled) {
            setUser(null);
            setAuthStatus('unauthenticated');
          }
          return;
        }

        const response = await api.get('/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 6000,
        });

        await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(response.data)).catch(() => {});
        if (!cancelled) {
          setUser(response.data);
          setAuthStatus('authenticated');
        }
      } catch (error) {
        console.warn('Session hydration failed:', error?.message);
        const status = error?.response?.status;

        if (status === 401) {
          await clearPersistedSession();
          if (!cancelled) {
            setUser(null);
            setAuthStatus('unauthenticated');
          }
          return;
        }

        const cachedUser = await getCachedSessionUser();
        if (!cancelled) {
          if (cachedUser) {
            setUser(cachedUser);
            setAuthStatus('authenticated');
            // Re-validate after a delay — clears session if token was server-side revoked
            setTimeout(async () => {
              if (cancelled) return;
              const reToken = await AsyncStorage.getItem(SESSION_TOKEN_KEY).catch(() => null);
              if (!reToken || cancelled) return;
              try {
                const fresh = await api.get('/auth/me', {
                  headers: { Authorization: `Bearer ${reToken}` },
                  timeout: 8000,
                });
                if (!cancelled) {
                  setUser(fresh.data);
                  await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(fresh.data)).catch(() => {});
                }
              } catch (retryErr) {
                if (retryErr?.response?.status === 401 && !cancelled) {
                  await clearPersistedSession();
                  setUser(null);
                  setAuthStatus('unauthenticated');
                }
              }
            }, 4000);
          } else {
            setUser(null);
            setAuthStatus('unauthenticated');
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((fbUser) => {
      setFirebaseUser(fbUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !user?.user_id) return undefined;

    let cancelled = false;

    (async () => {
      const notificationsEnabled = await arePushNotificationsEnabled();
      const token = notificationsEnabled
        ? await registerForPushNotifications({ requestPermission: false })
        : await getStoredPushToken();

      if (cancelled) return;

      savePushTokenToServer(token, { notificationsEnabled }).catch(() => {});
    })();

    return () => {
      cancelled = true;
    };
  }, [authStatus, user?.user_id]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !user?.user_id) return undefined;

    return subscribeToPushTokenChanges((token, tokenData) => {
      savePushTokenToServer(token, {
        notificationsEnabled: true,
        platform: tokenData?.type || undefined,
      }).catch(() => {});
    });
  }, [authStatus, user?.user_id]);

  const loginWithEmail = async (email, password, { biometricLogin = false } = {}) => {
    try {
      // Step 1: authenticate with Firebase client SDK to get an ID token
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const firebaseIdToken = await userCredential.user.getIdToken(true);

      // Step 2: exchange the Firebase ID token for a backend session
      const { data } = await api.post('/auth/login', { biometric_login: biometricLogin }, {
        headers: { Authorization: `Bearer ${firebaseIdToken}` },
      });

      // Support both response formats: {user, session_token} and {data: {user, session_token}}
      const payload = data?.data ?? data;

      if (payload.otp_required) {
        return {
          success: false,
          otpRequired: true,
          otpToken: payload.otp_token,
          maskedEmail: payload.masked_email,
        };
      }

      const { user: userData, session_token } = payload;
      await persistSession(session_token, userData);
      setUser(userData);
      setAuthStatus('authenticated');
      return { success: true };
    } catch (error) {
      // Firebase SDK errors (wrong credentials, disabled account, etc.)
      const firebaseCode = error?.code;
      if (firebaseCode === 'auth/invalid-credential' || firebaseCode === 'auth/wrong-password' || firebaseCode === 'auth/user-not-found') {
        return { success: false, error: 'Invalid email or password. Please try again.' };
      }
      if (firebaseCode === 'auth/too-many-requests') {
        return { success: false, error: 'Too many failed attempts. Please wait before trying again.' };
      }
      if (firebaseCode === 'auth/user-disabled') {
        return { success: false, error: 'This account has been disabled. Please contact support.' };
      }
      if (firebaseCode) {
        return { success: false, error: 'Authentication failed. Please try again.' };
      }

      // Backend errors
      const status = error.response?.status;
      const detail = error.response?.data?.detail || error.response?.data?.error;
      if (status === 403) return { success: false, status, error: detail || 'Access denied. Your account is not registered as a verified tenant.' };
      if (status === 429) return { success: false, status, error: detail || 'Too many failed attempts. Please wait a moment before trying again.' };
      if (status === 500) return { success: false, status, error: 'A server error occurred. Please try again in a moment.' };
      return { success: false, status: 0, error: 'Unable to connect. Please check your internet connection.' };
    }
  };

  const verifyLoginOtp = async (otpToken, otpCode) => {
    const normalizedToken = typeof otpToken === 'string' ? otpToken.trim() : '';
    const normalizedCode = String(otpCode ?? '').replace(/\D/g, '');

    if (!normalizedToken) {
      return { success: false, status: 400, error: 'Your verification session has expired. Please log in again.' };
    }

    try {
      const response = await api.post('/auth/login/verify-otp', {
        otp_token: normalizedToken,
        otp_code: normalizedCode,
      });
      const { user: userData, session_token } = response.data;

      await persistSession(session_token, userData);
      setUser(userData);
      setAuthStatus('authenticated');
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data?.detail;
      const attemptsRemaining = error.response?.data?.attempts_remaining;
      return { success: false, status, error: detail || 'Invalid code. Please try again.', attemptsRemaining };
    }
  };

  const login = async (email, password) => {
    const result = await loginWithEmail(email, password);
    return result.success;
  };

  const registerWithEmail = async (email, password, name = '', phone = '') => {
    try {
      const response = await api.post('/auth/register', { email, password, name, phone });
      const { user: userData, session_token } = response.data;

      await persistSession(session_token, userData);
      setUser(userData);
      setAuthStatus('authenticated');
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

  const signInWithGoogle = async (idToken) => {
    try {
      let tokenToUse = idToken;
      if (!tokenToUse && firebaseUser) {
        tokenToUse = await getFreshIdToken();
      }

      if (!tokenToUse) {
        return { success: false, error: 'No authentication token available' };
      }

      // Pass Firebase ID token in Authorization header — same endpoint as email login
      const { data } = await api.post('/auth/login', {}, {
        headers: { Authorization: `Bearer ${tokenToUse}` },
      });

      const payload = data?.data ?? data;
      const { user: userData, session_token } = payload;

      await persistSession(session_token, userData);
      setUser(userData);
      setAuthStatus('authenticated');
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data?.detail || error.response?.data?.error;

      if (status === 403) {
        return { success: false, error: detail || 'Access denied. Your account is not registered as an active tenant.' };
      }
      if (status === 401) {
        return { success: false, error: detail || 'Invalid authentication. Please try again.' };
      }
      return { success: false, error: 'Unable to sign in with Google. Please try again.' };
    }
  };

  const logout = async () => {
    try {
      const token = await AsyncStorage.getItem(SESSION_TOKEN_KEY);
      const pushToken = await getStoredPushToken();

      if (token) {
        await api.post('/auth/logout', {}, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }

      await savePushTokenToServer(pushToken, { notificationsEnabled: false }).catch(() => {});
    } finally {
      await clearPersistedSession();
      setUser(null);
      setAuthStatus('unauthenticated');

      try {
        await auth.signOut();
      } catch (_) {
        // Ignore Firebase sign-out failures because the backend session is already cleared.
      }
    }
  };

  const checkAuth = async () => {
    try {
      const token = await AsyncStorage.getItem(SESSION_TOKEN_KEY);
      if (!token) {
        await AsyncStorage.removeItem(SESSION_USER_KEY).catch(() => {});
        setUser(null);
        setAuthStatus('unauthenticated');
        return { authenticated: false };
      }

      const response = await api.get('/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 6000,
      });
      await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(response.data)).catch(() => {});
      setUser(response.data);
      setAuthStatus('authenticated');
      return { authenticated: true, restoredFromCache: false };
    } catch (error) {
      if (error?.response?.status === 401) {
        await clearPersistedSession();
        setUser(null);
        setAuthStatus('unauthenticated');
        return { authenticated: false };
      }

      const cachedUser = await getCachedSessionUser();
      if (cachedUser) {
        setUser(cachedUser);
        setAuthStatus('authenticated');
        return { authenticated: true, restoredFromCache: true };
      }

      return { authenticated: false };
    }
  };

  const updateUser = (data) => {
    setUser((prev) => {
      const nextUser = prev ? { ...prev, ...data } : data;
      AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(nextUser)).catch(() => {});
      return nextUser;
    });
  };

  const isLoading = authStatus === 'initializing';
  const authReady = authStatus !== 'initializing';

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
        verifyLoginOtp,
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
