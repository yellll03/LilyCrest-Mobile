import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Platform, Pressable, StatusBar as RNStatusBar, StyleSheet, Text, View } from 'react-native';
import { auth, getFreshIdToken, subscribeToAuthState } from '../config/firebase';
import { api, getApiErrorMessage } from '../services/api';
import { validateStrongPassword } from '../utils/passwordValidation';
import { AUTH_MESSAGES, classifyAuthError } from '../utils/authStability';
import { clearDocumentCache } from '../services/documentManager';
import {
  arePushNotificationsEnabled,
  clearLastNotificationResponse,
  getLastNotificationResponseData,
  getStoredPushToken,
  initializeNotificationHandler,
  registerForPushNotifications,
  requestPushPermissionOnFirstLaunch,
  resolveNotificationRoute,
  savePushTokenToServer,
  setupNotificationListeners,
  subscribeToPushTokenChanges,
} from '../services/notifications';
import {
  clearCredentials,
  getSessionToken,
  migrateLegacyCredentials,
  removeSessionToken,
  setSessionToken,
} from '../services/secureCredentials';

const AuthContext = createContext(undefined);
const SESSION_USER_KEY = 'session_user';
const ANNOUNCEMENTS_LAST_SEEN_KEY = 'lilycrest_announcements_last_seen';
const DEFAULT_NOTIFICATION_MESSAGE = 'Open LilyCrest to view the latest update.';

async function persistSession(sessionToken, userData) {
  const writes = [];
  if (sessionToken) {
    writes.push(setSessionToken(sessionToken));
  }
  if (userData) {
    writes.push(AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(userData)));
  }
  await Promise.all(writes);
}

async function clearPersistedSession() {
  await Promise.all([removeSessionToken(), AsyncStorage.removeItem(SESSION_USER_KEY).catch(() => {})]);
}

async function getCachedSessionUser() {
  try {
    const raw = await AsyncStorage.getItem(SESSION_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isAuthUserShape(parsed)) {
      await AsyncStorage.removeItem(SESSION_USER_KEY).catch(() => {});
      return null;
    }
    return parsed;
  } catch (_error) {
    await AsyncStorage.removeItem(SESSION_USER_KEY).catch(() => {});
    return null;
  }
}

async function loadAuthoritativeTenantProfile(fallbackUser) {
  try {
    const response = await api.get('/users/me');
    return response?.data || { ...fallbackUser, branch: null };
  } catch (_) {
    return { ...fallbackUser, branch: null };
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAuthUserShape(value) {
  return isPlainObject(value) && typeof value.user_id === 'string' && value.user_id.trim().length > 0;
}

function isSessionPayloadShape(value) {
  return isPlainObject(value)
    && isAuthUserShape(value.user)
    && typeof value.session_token === 'string'
    && value.session_token.trim().length > 0;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState('initializing');
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [notificationBanner, setNotificationBanner] = useState(null);
  const router = useRouter();
  const routerRef = useRef(router);
  const authStatusRef = useRef(authStatus);
  const pendingNotificationRef = useRef(null);
  const latestNotificationKeyRef = useRef('');
  const bannerHideTimerRef = useRef(null);
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const bannerTranslateY = useRef(new Animated.Value(-18)).current;
  routerRef.current = router;
  authStatusRef.current = authStatus;

  const dismissNotificationBanner = useCallback(() => {
    if (bannerHideTimerRef.current) {
      clearTimeout(bannerHideTimerRef.current);
      bannerHideTimerRef.current = null;
    }

    Animated.parallel([
      Animated.timing(bannerOpacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(bannerTranslateY, {
        toValue: -18,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setNotificationBanner(null);
      }
    });
  }, [bannerOpacity, bannerTranslateY]);

  const markNotificationsUnread = useCallback((count = 1) => {
    const increment = Number.isFinite(count) ? Math.max(1, count) : 1;
    setNotificationUnreadCount((prev) => prev + increment);
  }, []);

  const clearNotificationUnread = useCallback(async () => {
    await api.patch('/notifications/read-all');
    setNotificationUnreadCount(0);
    await AsyncStorage.setItem(ANNOUNCEMENTS_LAST_SEEN_KEY, new Date().toISOString()).catch(() => {});
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
    if (!data || typeof data !== 'object') return;

    if (authStatusRef.current !== 'authenticated') {
      pendingNotificationRef.current = data;
      return;
    }

    await navigateFromNotification(data);
  }, [navigateFromNotification]);

  useEffect(() => {
    initializeNotificationHandler();
    requestPushPermissionOnFirstLaunch().catch(() => {});
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((fbUser) => {
      setFirebaseUser(fbUser);
      setFirebaseAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const buildNotificationKey = (notification) => {
      const identifier = notification?.request?.identifier;
      if (identifier) return String(identifier);

      const title = notification?.request?.content?.title || '';
      const body = notification?.request?.content?.body || '';
      const data = notification?.request?.content?.data || {};
      return JSON.stringify({ title, body, data });
    };

    const cleanup = setupNotificationListeners(
      (notification) => {
        const title = notification?.request?.content?.title || 'New update';
        const message = notification?.request?.content?.body || DEFAULT_NOTIFICATION_MESSAGE;
        const data = notification?.request?.content?.data || {};
        const nextKey = buildNotificationKey(notification);

        if (!nextKey || latestNotificationKeyRef.current === nextKey) return;

        latestNotificationKeyRef.current = nextKey;
        markNotificationsUnread(1);
        setNotificationBanner({
          key: nextKey,
          title,
          message,
          data,
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
  }, [handleNotificationTap, markNotificationsUnread]);

  useEffect(() => {
    if (!notificationBanner) return undefined;

    if (bannerHideTimerRef.current) {
      clearTimeout(bannerHideTimerRef.current);
      bannerHideTimerRef.current = null;
    }

    bannerOpacity.stopAnimation();
    bannerTranslateY.stopAnimation();
    bannerOpacity.setValue(0);
    bannerTranslateY.setValue(-18);

    Animated.parallel([
      Animated.timing(bannerOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.spring(bannerTranslateY, {
        toValue: 0,
        friction: 8,
        tension: 90,
        useNativeDriver: true,
      }),
    ]).start();

    bannerHideTimerRef.current = setTimeout(() => {
      dismissNotificationBanner();
    }, 3800);

    return () => {
      if (bannerHideTimerRef.current) {
        clearTimeout(bannerHideTimerRef.current);
        bannerHideTimerRef.current = null;
      }
    };
  }, [bannerOpacity, bannerTranslateY, dismissNotificationBanner, notificationBanner]);

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
    if (authStatus !== 'authenticated' || !user?.user_id) {
      setNotificationUnreadCount(0);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const [response, lastSeenRaw] = await Promise.all([
          api.get('/notifications'),
          AsyncStorage.getItem(ANNOUNCEMENTS_LAST_SEEN_KEY),
        ]);

        if (cancelled) return;

        const announcements = Array.isArray(response?.data) ? response.data : [];
        const lastSeen = lastSeenRaw ? new Date(lastSeenRaw) : new Date(0);
        const unreadCount = announcements.filter((item) => {
          const createdAt = item?.created_at ? new Date(item.created_at) : new Date(0);
          return createdAt > lastSeen;
        }).length;

        // TODO: replace this client-side fallback with a backend unread-count endpoint when available.
        setNotificationUnreadCount(unreadCount);
      } catch (error) {
        if (error?.response?.status === 401) {
          await clearPersistedSession();
          if (!cancelled) {
            setUser(null);
            setAuthStatus('unauthenticated');
          }
          return;
        }
        if (!cancelled) {
          setNotificationUnreadCount((prev) => prev);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authStatus, user?.user_id]);

  useEffect(() => {
    if (!firebaseAuthReady) return undefined;
    let cancelled = false;

    (async () => {
      try {
        await migrateLegacyCredentials();
        const token = await getSessionToken();
        if (!token) {
          await AsyncStorage.removeItem(SESSION_USER_KEY).catch(() => {});
          if (!cancelled) {
            setUser(null);
            setAuthStatus('unauthenticated');
          }
          return;
        }

        const response = await api.get('/users/me', {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 30000,
        });
        if (!isAuthUserShape(response.data)) {
          throw new Error('Invalid auth/me response shape');
        }

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
          await clearCredentials({ disableBiometric: false });
          if (!cancelled) {
            setUser(null);
            setAuthStatus('unauthenticated');
          }
          return;
        }

        const cachedUser = await getCachedSessionUser();
        if (!cancelled && cachedUser) {
          setUser(cachedUser);
          setAuthStatus('authenticated');
        } else if (!cancelled) {
          setUser(null);
          setAuthStatus('unauthenticated');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [firebaseAuthReady]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !user?.user_id) return undefined;

    let cancelled = false;

    (async () => {
      const notificationsEnabled = await arePushNotificationsEnabled();
      const token = notificationsEnabled
        ? await registerForPushNotifications({ requestPermission: false })
        : await getStoredPushToken();

      if (cancelled) return;

      savePushTokenToServer(token, {
        notificationsEnabled,
        syncKey: user.user_id,
      }).catch(() => {});
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
        syncKey: user.user_id,
      }).catch(() => {});
    });
  }, [authStatus, user?.user_id]);

  const loginWithEmail = async (email, password) => {
    try {
      const { data } = await api.post('/auth/login', {
        email,
        password,
      }, {
        // Password authentication also sends the login OTP. Render cold starts
        // and email delivery can legitimately exceed the shared 15s API timeout.
        timeout: 60000,
      });

      if (data.otp_required) {
        if (typeof data.otp_token !== 'string' || !data.otp_token.trim()) {
          await clearPersistedSession();
          return { success: false, status: 500, error: 'Received an invalid sign-in response. Please try again.' };
        }
        return {
          success: false,
          otpRequired: true,
          otpToken: data.otp_token,
          maskedEmail: data.masked_email,
        };
      }
      if (!isSessionPayloadShape(data)) {
        await clearPersistedSession();
        return { success: false, status: 500, error: 'Received an invalid sign-in response. Please try again.' };
      }

      const { user: userData, session_token } = data;
      await persistSession(session_token, userData);
      const profile = await loadAuthoritativeTenantProfile(userData);
      await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(profile)).catch(() => {});
      setUser(profile);
      setAuthStatus('authenticated');
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const attemptsRemaining = error.response?.data?.attempts_remaining;
      const classified = classifyAuthError(error);
      if (status === 400) {
        await clearPersistedSession();
        return { success: false, status, error: AUTH_MESSAGES.unexpected };
      }
      if (status === 401) {
        await clearPersistedSession();
        return { success: false, status, error: AUTH_MESSAGES.invalidCredentials, attemptsRemaining };
      }
      if (status === 403) {
        return { success: false, status, error: 'Access denied. Please contact the admin office.' };
      }
      return {
        success: false,
        status: classified.status,
        errorType: classified.type,
        error: classified.message,
      };
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
      if (!isSessionPayloadShape(response.data)) {
        await clearPersistedSession();
        return { success: false, status: 500, error: 'Received an invalid verification response. Please try again.' };
      }
      const { user: userData, session_token } = response.data;

      await persistSession(session_token, userData);
      const profile = await loadAuthoritativeTenantProfile(userData);
      await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(profile)).catch(() => {});
      setUser(profile);
      setAuthStatus('authenticated');
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data?.detail;
      const attemptsRemaining = error.response?.data?.attempts_remaining;
      return { success: false, status, error: detail || getApiErrorMessage(error, 'Invalid code. Please try again.'), attemptsRemaining };
    }
  };

  const login = async (email, password) => {
    const result = await loginWithEmail(email, password);
    return result.success;
  };

  const registerWithEmail = async (email, password, name = '', phone = '') => {
    const passwordValidation = validateStrongPassword(password);
    if (!passwordValidation.valid) {
      return { success: false, error: passwordValidation.error };
    }

    try {
      const response = await api.post('/auth/register', { email, password, name, phone });
      if (!isSessionPayloadShape(response.data)) {
        await clearPersistedSession();
        return { success: false, error: 'Received an invalid registration response. Please try again.' };
      }
      const { user: userData, session_token } = response.data;

      await persistSession(session_token, userData);
      const profile = await loadAuthoritativeTenantProfile(userData);
      await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(profile)).catch(() => {});
      setUser(profile);
      setAuthStatus('authenticated');
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data?.detail;
      if (status === 400) {
        return { success: false, error: detail || 'Invalid registration data.' };
      }
      return { success: false, error: detail || getApiErrorMessage(error, 'Unable to create account. Please try again later.') };
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

      let response;
      try {
        response = await api.post('/auth/google', { idToken: tokenToUse });
      } catch (firstError) {
        // Retry exactly once, and only when no HTTP response was ever
        // received (connection-level failure: timeout / network error —
        // error.response is undefined). A request the server actually
        // answered (4xx/5xx) must never be retried here; those are real
        // outcomes, not transient connectivity. The backend pairs this
        // with a short session-reuse window so a retry after a connection
        // stall can't invalidate a session whose success response the
        // first attempt simply never delivered, or mint a duplicate one.
        if (firstError.response) {
          throw firstError;
        }
        response = await api.post('/auth/google', { idToken: tokenToUse });
      }
      if (!isSessionPayloadShape(response.data)) {
        await clearPersistedSession();
        return { success: false, error: 'Received an invalid Google sign-in response. Please try again.' };
      }
      const { user: userData, session_token } = response.data;

      await persistSession(session_token, userData);
      const profile = await loadAuthoritativeTenantProfile(userData);
      await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(profile)).catch(() => {});
      setUser(profile);
      setAuthStatus('authenticated');
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
      return { success: false, error: getApiErrorMessage(error, 'Unable to sign in with Google. Please try again.') };
    }
  };

  const logout = async () => {
    const token = await getSessionToken().catch(() => null);
    const pushToken = await getStoredPushToken().catch(() => null);
    const logoutSyncKey = user?.user_id || 'logout';

    try {
      await clearCredentials().catch(() => {});
      await clearPersistedSession();
      await clearDocumentCache().catch(() => {});
      setUser(null);
      setAuthStatus('unauthenticated');
      setNotificationUnreadCount(0);
    } finally {
      Promise.allSettled([
        token
          ? api.post('/auth/logout', {}, {
              headers: { Authorization: `Bearer ${token}` },
            })
          : Promise.resolve(),
        savePushTokenToServer(pushToken, {
          notificationsEnabled: false,
          syncKey: logoutSyncKey,
          authTokenOverride: token,
          suppressUnauthorized: true,
        }).catch(() => {}),
        auth.signOut().catch(() => {}),
      ]).catch(() => {});
    }
  };

  const checkAuth = async () => {
    try {
      const token = await getSessionToken();
      if (!token) {
        await AsyncStorage.removeItem(SESSION_USER_KEY).catch(() => {});
        setUser(null);
        setAuthStatus('unauthenticated');
        return { authenticated: false };
      }

      const response = await api.get('/users/me', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 6000,
      });
      if (!isAuthUserShape(response.data)) {
        throw new Error('Invalid auth/me response shape');
      }
      await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(response.data)).catch(() => {});
      setUser(response.data);
      setAuthStatus('authenticated');
      return { authenticated: true, restoredFromCache: false };
    } catch (error) {
      if (error?.response?.status === 401) {
        await clearPersistedSession();
        await clearCredentials({ disableBiometric: false });
        setUser(null);
        setAuthStatus('unauthenticated');
        return { authenticated: false };
      }

      const cachedUser = await getCachedSessionUser();
      if (cachedUser) await AsyncStorage.removeItem(SESSION_USER_KEY).catch(() => {});
      setUser(null);
      setAuthStatus('unauthenticated');
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

  const isLoading = authStatus === 'initializing' || !firebaseAuthReady;
  const authReady = authStatus !== 'initializing' && firebaseAuthReady;

  if (isLoading) {
    return (
      <View style={styles.authLoadingContainer}>
        <ActivityIndicator size="large" color="#204B7E" />
        <Text style={styles.authLoadingTitle}>Preparing LilyCrest</Text>
        <Text style={styles.authLoadingText}>Checking your secure session...</Text>
      </View>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        firebaseUser,
        firebaseAuthReady,
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
        notificationUnreadCount,
        hasUnreadNotifications: notificationUnreadCount > 0,
        clearNotificationUnread,
      }}
    >
      <View style={styles.container}>
        {children}
        {notificationBanner ? (
          <View pointerEvents="box-none" style={styles.bannerOverlay}>
            <Animated.View
              style={[
                styles.bannerCard,
                {
                  opacity: bannerOpacity,
                  transform: [{ translateY: bannerTranslateY }],
                },
              ]}
            >
              <Pressable
                style={styles.bannerContent}
                onPress={async () => {
                  const bannerData = notificationBanner?.data;
                  dismissNotificationBanner();
                  await handleNotificationTap(bannerData);
                }}
              >
                {notificationBanner.title ? (
                  <Text style={styles.bannerTitle} numberOfLines={1}>{notificationBanner.title}</Text>
                ) : null}
                <Text style={styles.bannerMessage} numberOfLines={2}>
                  {notificationBanner.message || DEFAULT_NOTIFICATION_MESSAGE}
                </Text>
              </Pressable>
              <Pressable style={styles.bannerClose} onPress={dismissNotificationBanner} hitSlop={10}>
                <Text style={styles.bannerCloseText}>×</Text>
              </Pressable>
            </Animated.View>
          </View>
        ) : null}
      </View>
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

const bannerTopInset = Platform.OS === 'ios'
  ? 56
  : Math.max((RNStatusBar.currentHeight || 0) + 12, 18);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  authLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#F8FAFC',
  },
  authLoadingTitle: {
    marginTop: 14,
    fontSize: 16,
    fontWeight: '800',
    color: '#1E293B',
  },
  authLoadingText: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
  },
  bannerOverlay: {
    position: 'absolute',
    top: bannerTopInset,
    left: 16,
    right: 16,
    zIndex: 1000,
    pointerEvents: 'box-none',
  },
  bannerCard: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 8 },
      web: { boxShadow: '0 10px 30px rgba(15, 23, 42, 0.16)' },
    }),
  },
  bannerContent: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E40AF',
    marginBottom: 2,
  },
  bannerMessage: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: '#1E40AF',
  },
  bannerClose: {
    paddingHorizontal: 4,
    paddingTop: 1,
  },
  bannerCloseText: {
    fontSize: 18,
    lineHeight: 18,
    color: '#64748B',
  },
});
