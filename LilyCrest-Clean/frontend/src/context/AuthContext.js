import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname, useRouter, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Platform, Pressable, StatusBar as RNStatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth, getFreshIdToken, subscribeToAuthState } from '../config/firebase';
import {
  api,
  getApiErrorMessage,
  getConfirmedSessionInvalidation,
  teardownExpiredSession,
} from '../services/api';
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
import { subscribeSessionExpired, subscribeSessionRecovered } from '../services/sessionEvents';
import {
  canonicalNotificationKey,
  publishCanonicalNotification,
  subscribeCanonicalNotifications,
} from '../services/canonicalEvents';
import { useToast } from './ToastContext';
import {
  isAuthenticatedNavigationReady,
  navigateToNotificationDestination,
  notificationDestinationKey,
} from '../utils/navigation';

const AuthContext = createContext(undefined);
const SESSION_USER_KEY = 'session_user';
const DEFAULT_NOTIFICATION_MESSAGE = 'Open LilyCrest to view the latest update.';

async function persistSession(sessionPayload, userData) {
  const writes = [];
  if (sessionPayload?.session_token) {
    const refreshOptions = isRefreshSessionPayloadShape(sessionPayload)
      ? {
          refreshToken: sessionPayload.refresh_token,
          expiresAt: sessionPayload.expires_at,
          refreshExpiresAt: sessionPayload.refresh_expires_at,
        }
      : {};
    writes.push(setSessionToken(sessionPayload.session_token, refreshOptions));
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
  } catch (error) {
    if (getConfirmedSessionInvalidation(error) || error?.response?.status === 403) {
      throw error;
    }
    return { ...fallbackUser, branch: null };
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAuthUserShape(value) {
  return isPlainObject(value) && typeof value.user_id === 'string' && value.user_id.trim().length > 0;
}

// This app is tenant-only. A valid session alone does not prove tenant
// registration; every authentication path must fail closed to the canonical
// tenant/resident roles used by the backend gate.
function isTenantRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return normalized === 'tenant' || normalized === 'resident';
}

const NOT_A_TENANT_MESSAGE = 'This account is not registered as an active tenant.';

function isSessionPayloadShape(value) {
  return isPlainObject(value)
    && isAuthUserShape(value.user)
    && typeof value.session_token === 'string'
    && value.session_token.trim().length > 0;
}

// The currently deployed API still returns the established user +
// session_token response, while newer API builds add a rotating refresh
// bundle. Both are valid login contracts during the rolling deployment.
// Only persist refresh metadata when the complete bundle is present so a
// partial/malformed optional bundle cannot break an otherwise valid login.
function isRefreshSessionPayloadShape(value) {
  return isSessionPayloadShape(value)
    && typeof value.refresh_token === 'string'
    && value.refresh_token.trim().length > 0
    && !Number.isNaN(Date.parse(value.expires_at))
    && !Number.isNaN(Date.parse(value.refresh_expires_at));
}

// resolveTenantBranch (backend/services/branchLocation.service.js) can
// transiently fail to resolve a tenant's branch (ambiguous/missing linked
// records) and buildTenantProfile silently degrades to branch: null rather
// than failing the whole /users/me response. Several screens independently
// re-fetch /users/me (Profile on focus, session restore, checkAuth); without
// this guard a transient null landing after a successful login would regress
// a branch every screen shares through this same context — not just Profile.
function preserveKnownBranch(prevUser, nextUser) {
  if (!nextUser) return nextUser;
  if (nextUser.branch != null) return nextUser;
  if (prevUser?.branch != null) return { ...nextUser, branch: prevUser.branch };
  return nextUser;
}

export function AuthProvider({ children }) {
  const safeAreaInsets = useSafeAreaInsets();
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState('initializing');
  const [sessionState, setSessionState] = useState('restoring');
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);
  // Single source of truth for every notification UI surface (tab badge,
  // header bell badge, notification sheet). All three used to derive their
  // own unread count independently — two from a client-local AsyncStorage
  // "last seen" timestamp compared against different data sources, one from
  // this same count. The backend already persists real per-notification read
  // state (see GET /notifications `read` field, backed by the
  // notification_reads/notification_read_state collections), so this is now
  // the only place that fetches it and every consumer reads from here.
  const [notifications, setNotifications] = useState([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [notificationBanner, setNotificationBanner] = useState(null);
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  const { showToast } = useToast();
  const routerRef = useRef(router);
  const pathnameRef = useRef(pathname);
  const segmentsRef = useRef(segments);
  const authStatusRef = useRef(authStatus);
  // Let logout/signInWithGoogle read the latest user/firebaseUser without
  // needing them in a useCallback dependency array — same technique already
  // used for routerRef/authStatusRef above, so those two callbacks can stay
  // referentially stable across renders instead of being recreated whenever
  // user/firebaseUser change (see the memoized context value below).
  const userRef = useRef(user);
  const firebaseUserRef = useRef(firebaseUser);
  const notificationsRef = useRef(notifications);
  // Synchronous dedup guard for concurrent forced-expiry events. authStatusRef
  // alone isn't enough — it's only updated on the next render, so several 401s
  // resolving in the same microtask tick could all read 'authenticated' before
  // any of them re-renders. This ref is checked-and-set synchronously, before
  // any await, so only the first of a burst of near-simultaneous events proceeds.
  const sessionExpiryHandlingRef = useRef(false);
  const pendingNotificationRef = useRef(null);
  const discardInitialNotificationResponseRef = useRef(false);
  const lastNotificationNavigationRef = useRef({ key: '', at: 0 });
  const latestNotificationKeyRef = useRef('');
  const bannerHideTimerRef = useRef(null);
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const bannerTranslateY = useRef(new Animated.Value(-18)).current;
  routerRef.current = router;
  pathnameRef.current = pathname;
  segmentsRef.current = segments;
  authStatusRef.current = authStatus;
  userRef.current = user;
  firebaseUserRef.current = firebaseUser;
  notificationsRef.current = notifications;

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

  // Returns true/false so screens that need explicit error/retry UI (e.g. the
  // Notifications screen, which now sources its unified feed from this same
  // context instead of polling independently) can react to a failed refresh
  // without this function's own silent-retry polling behavior having to change.
  const refreshNotifications = useCallback(async () => {
    if (authStatusRef.current !== 'authenticated' || !userRef.current?.user_id) return false;
    try {
      const response = await api.get('/notifications');
      const items = Array.isArray(response?.data) ? response.data : [];
      const nextUnreadCount = items.filter((item) => !item?.read).length;
      // Skip the state update entirely when nothing actually changed (e.g. an
      // empty list refetched as still-empty) — avoids replacing an array with
      // an equal-but-new reference and triggering a pointless re-render on
      // every 60s poll tick / foreground refresh for a tenant with no notifications.
      setNotifications((prev) => (
        prev.length === items.length && prev.every((item, i) => item?.notification_id === items[i]?.notification_id && item?.read === items[i]?.read)
          ? prev
          : items
      ));
      setNotificationUnreadCount((prev) => (prev === nextUnreadCount ? prev : nextUnreadCount));
      return true;
    } catch (error) {
      if (getConfirmedSessionInvalidation(error)) {
        await clearPersistedSession();
        setUser(null);
        setAuthStatus('unauthenticated');
        setSessionState('unauthenticated');
        setNotifications([]);
        setNotificationUnreadCount(0);
      }
      // Any other failure (offline, 5xx) is transient — leave the existing
      // list/count as-is rather than wiping a working badge.
      return false;
    }
  }, []);

  const markNotificationRead = useCallback(async (notificationId) => {
    if (!notificationId) return;
    const previous = notificationsRef.current;
    const target = previous.find((item) => item?.notification_id === notificationId);
    if (!target || target.read) return;

    setNotifications(previous.map((item) => (
      item.notification_id === notificationId ? { ...item, read: true } : item
    )));
    setNotificationUnreadCount((count) => Math.max(0, count - 1));

    try {
      await api.patch(`/notifications/${encodeURIComponent(notificationId)}/read`);
    } catch (_error) {
      // Roll back to the exact pre-optimistic snapshot on failure so a
      // network blip can't silently leave the UI out of sync with the server.
      setNotifications(previous);
      setNotificationUnreadCount((count) => count + 1);
    }
  }, []);

  const clearNotificationUnread = useCallback(async () => {
    const previous = notificationsRef.current;
    const previousUnreadCount = previous.filter((item) => !item?.read).length;
    if (previousUnreadCount === 0) return;

    setNotifications(previous.map((item) => ({ ...item, read: true })));
    setNotificationUnreadCount(0);

    try {
      await api.patch('/notifications/read-all');
    } catch (_error) {
      setNotifications(previous);
      setNotificationUnreadCount(previousUnreadCount);
    }
  }, []);

  // Dismiss (hide from this tenant's own feed only) a single notification or
  // announcement. Server-side this is a per-tenant junction write, never a
  // delete/mutation of a shared announcement — see mobileNotificationBridge.js
  // dismissNotification(). Failure rolls back the optimistic removal so a
  // network blip can't silently drop an item the server never actually hid
  // (Notification-9: a failed dismissal must not remain permanently hidden).
  const dismissNotification = useCallback(async (notificationId) => {
    if (!notificationId) return false;
    const previous = notificationsRef.current;
    const target = previous.find((item) => item?.notification_id === notificationId);
    if (!target) return false;

    const wasUnread = !target.read;
    setNotifications(previous.filter((item) => item.notification_id !== notificationId));
    if (wasUnread) setNotificationUnreadCount((count) => Math.max(0, count - 1));

    try {
      await api.delete(`/notifications/${encodeURIComponent(notificationId)}`);
      return true;
    } catch (_error) {
      setNotifications(previous);
      if (wasUnread) setNotificationUnreadCount((count) => count + 1);
      return false;
    }
  }, []);

  // Clear the tenant's currently-visible feed. This is a cutoff, not a
  // permanent hide-all — a new notification or newly published announcement
  // that arrives after this call still appears normally (see
  // mobileNotificationBridge.js clearNotifications()). Distinct from
  // clearNotificationUnread() above, which only marks everything read
  // without removing anything from the list.
  const clearNotifications = useCallback(async () => {
    const previous = notificationsRef.current;
    const previousUnreadCount = previous.filter((item) => !item?.read).length;
    if (previous.length === 0) return;

    setNotifications([]);
    setNotificationUnreadCount(0);

    try {
      await api.delete('/notifications');
    } catch (_error) {
      setNotifications(previous);
      setNotificationUnreadCount(previousUnreadCount);
    }
  }, []);

  // A fresh interactive sign-in (typed credentials, OTP, Google) must always
  // land on Home. Without this, a stale OS-cached "last tapped notification"
  // from a previous session gets replayed by the authStatus effect below and
  // overrides login's own redirect (e.g. bouncing the user to News).
  const dismissPendingNotificationForFreshSignIn = useCallback(() => {
    discardInitialNotificationResponseRef.current = true;
    const responseId = pendingNotificationRef.current?.responseId;
    pendingNotificationRef.current = null;
    clearLastNotificationResponse(responseId).catch(() => {});
  }, []);

  const navigateFromNotification = useCallback(async (interactionOrData) => {
    const isResponseInteraction = interactionOrData
      && typeof interactionOrData === 'object'
      && typeof interactionOrData.responseId === 'string'
      && interactionOrData.data
      && typeof interactionOrData.data === 'object';
    const interaction = isResponseInteraction
      ? interactionOrData
      : { data: interactionOrData, responseId: null };
    const destination = resolveNotificationRoute(interaction.data, { reportUnsupported: true });

    if (!destination) {
      pendingNotificationRef.current = null;
      if (interaction.responseId) {
        await clearLastNotificationResponse(interaction.responseId).catch(() => {});
      }
      return true;
    }
    if (!routerRef.current) return false;

    if (!isAuthenticatedNavigationReady(authStatusRef.current, pathnameRef.current, segmentsRef.current)) {
      pendingNotificationRef.current = interaction;
      return false;
    }

    const key = notificationDestinationKey(destination);
    const now = Date.now();
    const previous = lastNotificationNavigationRef.current;
    if (key && previous.key === key && now - previous.at < 1500) {
      pendingNotificationRef.current = null;
      await clearLastNotificationResponse(interaction.responseId).catch(() => {});
      return true;
    }

    if (!navigateToNotificationDestination(routerRef.current, destination)) return false;
    lastNotificationNavigationRef.current = { key, at: now };
    pendingNotificationRef.current = null;
    await clearLastNotificationResponse(interaction.responseId).catch(() => {});
    return true;
  }, []);

  const handleNotificationTap = useCallback(async (interactionOrData) => {
    if (!interactionOrData || typeof interactionOrData !== 'object') return;

    if (!isAuthenticatedNavigationReady(authStatusRef.current, pathnameRef.current, segmentsRef.current)) {
      pendingNotificationRef.current = interactionOrData;
      return;
    }

    await navigateFromNotification(interactionOrData);
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

  // Resets the forced-expiry dedup guard once the tenant is genuinely
  // authenticated again, so a later real expiry is handled normally instead of
  // being permanently suppressed by a stale "already handling" flag.
  useEffect(() => {
    if (authStatus === 'authenticated') {
      sessionExpiryHandlingRef.current = false;
    }
  }, [authStatus]);

  // The axios layer clears the session token itself (frontend/src/services/api.js)
  // when a background 401 can't be silently refreshed. Without this, React state
  // (authStatus/user) would stay "authenticated" until some other screen happened
  // to make another API call — this closes that gap and tells the tenant why
  // they're back at the login screen instead of leaving it unexplained.
  useEffect(() => {
    return subscribeSessionExpired(({ expiredToken, reason } = {}) => {
      // Synchronous check-and-set: only the first of a burst of concurrent
      // 401s (e.g. several parallel screen requests failing together) runs
      // the cleanup below; the rest bail out here before any async work.
      if (sessionExpiryHandlingRef.current) return;
      if (authStatusRef.current !== 'authenticated') return;
      sessionExpiryHandlingRef.current = true;

      setUser(null);
      setAuthStatus('unauthenticated');
      setSessionState('unauthenticated');
      setNotifications([]);
      setNotificationUnreadCount(0);
      showToast(reason === 'account_inactive' ? {
        type: 'warning',
        title: 'Account deactivated',
        message: 'Your account is no longer active. Please contact the administrator.',
      } : reason === 'tenant_access_required' ? {
        type: 'warning',
        title: 'Tenant access unavailable',
        message: 'This account is not registered as an active tenant. Please contact the administrator.',
      } : {
        type: 'warning',
        title: 'Session expired',
        message: 'Please log in again to continue.',
      });

      // Best-effort convergence toward the same cleanup explicit logout()
      // performs. None of this blocks the local logout above, which has
      // already happened synchronously — a failure here must not leave the
      // app stuck in an authenticated-looking state.
      (async () => {
        try {
          const pushToken = await getStoredPushToken().catch(() => null);
          await Promise.allSettled([
            clearCredentials().catch(() => {}),
            clearDocumentCache().catch(() => {}),
            // Uses /auth/session-teardown (a short post-expiry grace window,
            // see backend/middleware/auth.js:authMiddlewareRecentSession)
            // rather than the normal push-token endpoint, since the strict
            // session check that /users/push-token relies on would just
            // reject this same token again for a genuinely expired session.
            teardownExpiredSession(expiredToken, pushToken).catch(() => {}),
            auth.signOut().catch(() => {}),
          ]);
        } catch (_) {
          // Best-effort only — local state is already unauthenticated regardless.
        }
      })();
    });
  }, [showToast]);

  useEffect(() => subscribeSessionRecovered(() => {
    if (authStatusRef.current !== 'authenticated') return;
    // Only reconcile an already-retained session. Login/logout and confirmed
    // invalidation continue to own every other session-state transition.
    setSessionState((current) => current === 'retryable' ? 'online' : current);
  }), []);

  useEffect(() => {
    const cleanup = setupNotificationListeners(
      (notification) => {
        const title = notification?.request?.content?.title || 'New update';
        const message = notification?.request?.content?.body || DEFAULT_NOTIFICATION_MESSAGE;
        const data = notification?.request?.content?.data || {};
        publishCanonicalNotification({
          notification_id: notification?.request?.identifier,
          title,
          body: message,
          data,
        });
        // Refetch rather than blindly incrementing a local counter — this
        // notification may already exist server-side (or not be a
        // notification-list item at all), so re-syncing with the backend
        // keeps the shared unread state accurate instead of drifting.
      },
      (interaction) => {
        pendingNotificationRef.current = interaction;
        handleNotificationTap(interaction);
      }
    );

    return () => {
      if (cleanup) cleanup();
    };
  }, [handleNotificationTap]);

  useEffect(() => subscribeCanonicalNotifications((notification) => {
    if (authStatusRef.current !== 'authenticated') return;
    const nextKey = canonicalNotificationKey(notification);
    if (!nextKey || latestNotificationKeyRef.current === nextKey) return;
    latestNotificationKeyRef.current = nextKey;
    refreshNotifications();
    setNotificationBanner({
      key: nextKey,
      title: notification.title,
      message: notification.body || DEFAULT_NOTIFICATION_MESSAGE,
      data: notification.data || {},
    });
  }), [refreshNotifications]);

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
      const interaction = await getLastNotificationResponseData();
      if (cancelled || !interaction) return;
      if (discardInitialNotificationResponseRef.current) {
        await clearLastNotificationResponse(interaction.responseId).catch(() => {});
        return;
      }

      pendingNotificationRef.current = interaction;
      await handleNotificationTap(interaction);
    })();

    return () => {
      cancelled = true;
    };
  }, [handleNotificationTap]);

  useEffect(() => {
    if (!isAuthenticatedNavigationReady(authStatus, pathname, segments) || !pendingNotificationRef.current) return;
    handleNotificationTap(pendingNotificationRef.current);
  }, [authStatus, handleNotificationTap, pathname, segments, user?.user_id]);

  // Initial load + 60s poll while authenticated. Matches the cadence the old
  // per-surface tab-badge poller used, now feeding the one shared state.
  useEffect(() => {
    if (authStatus !== 'authenticated' || !user?.user_id) {
      setNotifications([]);
      setNotificationUnreadCount(0);
      return undefined;
    }

    refreshNotifications();
    const interval = setInterval(refreshNotifications, 60000);
    return () => clearInterval(interval);
  }, [authStatus, user?.user_id, refreshNotifications]);

  // Refetch whenever the app returns to the foreground, so a notification
  // read/received while backgrounded (or on another device) is reflected
  // without waiting for the next 60s poll tick.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshNotifications();
    });
    return () => subscription.remove();
  }, [refreshNotifications]);

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
            setSessionState('unauthenticated');
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
        if (!isTenantRole(response.data.role)) {
          await clearPersistedSession();
          await clearCredentials();
          if (!cancelled) {
            setUser(null);
            setAuthStatus('unauthenticated');
            setSessionState('unauthenticated');
          }
          return;
        }

        await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(response.data)).catch(() => {});
        if (!cancelled) {
          setUser((prev) => preserveKnownBranch(prev, response.data));
          setAuthStatus('authenticated');
          setSessionState('online');
        }
      } catch (error) {
        console.warn('Session hydration failed:', error?.message);
        const invalidation = getConfirmedSessionInvalidation(error);

        if (invalidation) {
          await clearPersistedSession();
          await clearCredentials();
          if (!cancelled) {
            setUser(null);
            setAuthStatus('unauthenticated');
            setSessionState('unauthenticated');
          }
          return;
        }

        const cachedUser = await getCachedSessionUser();
        if (!cancelled && cachedUser) {
          setUser(cachedUser);
          setAuthStatus('authenticated');
          setSessionState('retryable');
        } else if (!cancelled) {
          setUser(null);
          setAuthStatus('restoring_offline');
          setSessionState('retryable');
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
        provider: tokenData?.type || undefined,
        platform: Platform.OS,
        syncKey: user.user_id,
      }).catch(() => {});
    });
  }, [authStatus, user?.user_id]);

  const loginWithEmail = useCallback(async (email, password) => {
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

      const { user: userData } = data;
      if (!isTenantRole(userData.role)) {
        await clearPersistedSession();
        return { success: false, status: 403, error: NOT_A_TENANT_MESSAGE };
      }
      await persistSession(data, userData);
      const profile = await loadAuthoritativeTenantProfile(userData);
      await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(profile)).catch(() => {});
      setUser(profile);
      dismissPendingNotificationForFreshSignIn();
      setAuthStatus('authenticated');
      setSessionState('online');
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const attemptsRemaining = error.response?.data?.attempts_remaining;
      const classified = classifyAuthError(error);
      if (status === 400) {
        await clearPersistedSession();
        return {
          success: false,
          status,
          errorType: classified.type,
          error: classified.type === 'validation' ? classified.message : AUTH_MESSAGES.unexpected,
        };
      }
      if (status === 401) {
        await clearPersistedSession();
        return { success: false, status, error: AUTH_MESSAGES.invalidCredentials, attemptsRemaining };
      }
      if (status === 403) {
        await clearPersistedSession();
        await clearCredentials().catch(() => {});
        return {
          success: false,
          status,
          errorType: classified.type,
          error: classified.message,
        };
      }
      return {
        success: false,
        status: classified.status,
        errorType: classified.type,
        error: classified.message,
      };
    }
  }, [dismissPendingNotificationForFreshSignIn]);

  const verifyLoginOtp = useCallback(async (otpToken, otpCode) => {
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
      const { user: userData } = response.data;
      if (!isTenantRole(userData.role)) {
        await clearPersistedSession();
        return { success: false, status: 403, error: NOT_A_TENANT_MESSAGE };
      }

      await persistSession(response.data, userData);
      const profile = await loadAuthoritativeTenantProfile(userData);
      await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(profile)).catch(() => {});
      setUser(profile);
      dismissPendingNotificationForFreshSignIn();
      setAuthStatus('authenticated');
      setSessionState('online');
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data?.detail;
      const attemptsRemaining = error.response?.data?.attempts_remaining;
      if (status === 403) {
        await clearPersistedSession();
        await clearCredentials().catch(() => {});
      }
      return { success: false, status, error: detail || getApiErrorMessage(error, 'Invalid code. Please try again.'), attemptsRemaining };
    }
  }, [dismissPendingNotificationForFreshSignIn]);

  const login = useCallback(async (email, password) => {
    const result = await loginWithEmail(email, password);
    return result.success;
  }, [loginWithEmail]);

  const registerWithEmail = useCallback(async (email, password, name = '', phone = '') => {
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
      const { user: userData } = response.data;

      await persistSession(response.data, userData);
      const profile = await loadAuthoritativeTenantProfile(userData);
      await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(profile)).catch(() => {});
      setUser(profile);
      dismissPendingNotificationForFreshSignIn();
      setAuthStatus('authenticated');
      setSessionState('online');
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data?.detail;
      if (status === 400) {
        return { success: false, error: detail || 'Invalid registration data.' };
      }
      return { success: false, error: detail || getApiErrorMessage(error, 'Unable to create account. Please try again later.') };
    }
  }, [dismissPendingNotificationForFreshSignIn]);

  const signInWithGoogle = useCallback(async (idToken) => {
    try {
      let tokenToUse = idToken;
      if (!tokenToUse && firebaseUserRef.current) {
        tokenToUse = await getFreshIdToken();
      }

      if (!tokenToUse) {
        return {
          success: false,
          status: 0,
          errorType: 'credential',
          stage: 'backend-token',
          code: 'firebase-token-missing',
          error: 'Google did not return a sign-in credential. Please try again.',
        };
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
        return {
          success: false,
          status: 500,
          errorType: 'server',
          stage: 'backend-session',
          code: 'invalid-session-payload',
          error: 'Received an invalid Google sign-in response. Please try again.',
        };
      }
      const { user: userData } = response.data;
      if (!isTenantRole(userData.role)) {
        await clearPersistedSession();
        return {
          success: false,
          status: 403,
          errorType: 'access',
          stage: 'backend-authorization',
          code: 'tenant-role-required',
          error: NOT_A_TENANT_MESSAGE,
        };
      }

      await persistSession(response.data, userData);
      const profile = await loadAuthoritativeTenantProfile(userData);
      await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(profile)).catch(() => {});
      setUser(profile);
      dismissPendingNotificationForFreshSignIn();
      setAuthStatus('authenticated');
      setSessionState('online');
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data?.detail;
      const code = String(error.response?.data?.code || '').trim() || 'backend-request-failed';
      const classified = classifyAuthError(error);
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[GoogleAuthBackend]', {
          stage: 'backend-session',
          status: status || 0,
          code,
          type: classified.type,
          message: String(error?.message || 'unexpected'),
        });
      }

      if (status === 403) {
        await clearPersistedSession();
        await clearCredentials().catch(() => {});
        return {
          success: false,
          status,
          errorType: 'access',
          stage: 'backend-authorization',
          code,
          error: classified.message,
        };
      }
      if (status === 401) {
        return {
          success: false,
          status,
          errorType: 'credential',
          stage: 'backend-token-verification',
          code,
          error: detail || 'Invalid authentication. Please try again.',
        };
      }
      return {
        success: false,
        status: classified.status,
        errorType: classified.type,
        stage: 'backend-session',
        code,
        error: getApiErrorMessage(error, 'Unable to sign in with Google. Please try again.'),
      };
    }
  }, [dismissPendingNotificationForFreshSignIn]);

  const logout = useCallback(async () => {
    const token = await getSessionToken().catch(() => null);
    const pushToken = await getStoredPushToken().catch(() => null);
    const logoutSyncKey = userRef.current?.user_id || 'logout';

    try {
      await clearCredentials().catch(() => {});
      await clearPersistedSession();
      await clearDocumentCache().catch(() => {});
      setUser(null);
      setAuthStatus('unauthenticated');
      setSessionState('unauthenticated');
      setNotifications([]);
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
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const token = await getSessionToken();
      if (!token) {
        await AsyncStorage.removeItem(SESSION_USER_KEY).catch(() => {});
        setUser(null);
        setAuthStatus('unauthenticated');
        setSessionState('unauthenticated');
        return { authenticated: false };
      }

      const response = await api.get('/users/me', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 6000,
      });
      if (!isAuthUserShape(response.data)) {
        throw new Error('Invalid auth/me response shape');
      }
      if (!isTenantRole(response.data.role)) {
        await clearPersistedSession();
        await clearCredentials();
        setUser(null);
        setAuthStatus('unauthenticated');
        setSessionState('unauthenticated');
        return { authenticated: false };
      }
      await AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(response.data)).catch(() => {});
      setUser((prev) => preserveKnownBranch(prev, response.data));
      setAuthStatus('authenticated');
      setSessionState('online');
      return { authenticated: true, restoredFromCache: false };
    } catch (error) {
      if (getConfirmedSessionInvalidation(error)) {
        await clearPersistedSession();
        await clearCredentials();
        setUser(null);
        setAuthStatus('unauthenticated');
        setSessionState('unauthenticated');
        return { authenticated: false };
      }

      const cachedUser = await getCachedSessionUser() || userRef.current;
      if (cachedUser) {
        setUser(cachedUser);
        setAuthStatus('authenticated');
        setSessionState('retryable');
        return { authenticated: true, restoredFromCache: true, offline: true };
      }

      // A timeout, offline state, or 5xx response is not proof that the
      // locally persisted session is invalid. Keep the token so a later
      // retry can recover; only an authoritative 401/403 signs the user out.
      setAuthStatus((current) => current === 'authenticated' ? current : 'restoring_offline');
      setSessionState('retryable');
      return { authenticated: false, indeterminate: true };
    }
  }, []);

  // Retry a retained session when connectivity is likely to have changed.
  // The credential remains in SecureStore throughout a retryable outage.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active'
        && (authStatusRef.current === 'restoring_offline' || sessionState === 'retryable')) {
        checkAuth().catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [checkAuth, sessionState]);

  const updateUser = useCallback((data) => {
    setUser((prev) => {
      // All callers pass a complete canonical /users/me response. Replace
      // stale cached/default fields instead of merging them back over the
      // database authority; only retain the independently resolved Branch
      // when a transient branch lookup returns null.
      const nextUser = preserveKnownBranch(prev, data);
      AsyncStorage.setItem(SESSION_USER_KEY, JSON.stringify(nextUser)).catch(() => {});
      return nextUser;
    });
  }, []);

  const isLoading = authStatus === 'initializing' || !firebaseAuthReady;
  const authReady = authStatus !== 'initializing' && firebaseAuthReady;

  // Every function above is now referentially stable across renders (wrapped
  // in useCallback), so this memo actually skips recomputation on renders
  // that don't touch these specific fields — e.g. an unrelated re-render of
  // AuthProvider no longer forces every useAuth() consumer (Home, Profile,
  // Settings, ...) to re-render too, which they previously did on every
  // render because `value={{...}}` was a brand-new object every time,
  // regardless of what had actually changed.
  const contextValue = useMemo(() => ({
    user,
    firebaseUser,
    firebaseAuthReady,
    isLoading,
    authReady,
    authStatus,
    sessionState,
    login,
    loginWithEmail,
    verifyLoginOtp,
    registerWithEmail,
    logout,
    checkAuth,
    signInWithGoogle,
    updateUser,
    getFreshIdToken,
    notifications,
    notificationUnreadCount,
    hasUnreadNotifications: notificationUnreadCount > 0,
    markNotificationRead,
    clearNotificationUnread,
    dismissNotification,
    clearNotifications,
    refreshNotifications,
  }), [
    user, firebaseUser, firebaseAuthReady, isLoading, authReady, authStatus, sessionState,
    login, loginWithEmail, verifyLoginOtp, registerWithEmail, logout, checkAuth,
    signInWithGoogle, updateUser, notifications, notificationUnreadCount,
    markNotificationRead, clearNotificationUnread, dismissNotification, clearNotifications,
    refreshNotifications,
  ]);

  return (
    <AuthContext.Provider value={contextValue}>
      <View style={styles.container}>
        <View style={[styles.content, sessionState === 'retryable' && styles.contentWithOfflineBanner]}>
          {children}
        </View>
        {sessionState === 'retryable' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry LilyCrest connection"
            style={[styles.sessionOfflineBanner, { top: safeAreaInsets.top }]}
            onPress={() => checkAuth().catch(() => {})}
          >
            <Text style={styles.sessionOfflineText}>Offline — showing saved account data</Text>
            <Text style={styles.sessionOfflineAction}>Retry</Text>
          </Pressable>
        ) : null}
        {authStatus === 'restoring_offline' ? (
          <View style={styles.authRestoringOverlay}>
            <Text style={styles.authLoadingTitle}>Still restoring your session</Text>
            <Text style={styles.authLoadingText}>
              LilyCrest could not reach the server. Your secure session is still saved.
            </Text>
            <Pressable style={styles.authRetryButton} onPress={() => checkAuth().catch(() => {})}>
              <Text style={styles.authRetryButtonText}>Retry connection</Text>
            </Pressable>
          </View>
        ) : null}
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
  content: {
    flex: 1,
  },
  contentWithOfflineBanner: {
    paddingTop: 44,
  },
  sessionOfflineBanner: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1100,
    elevation: 9,
    minHeight: 44,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF7ED',
    borderBottomWidth: 1,
    borderBottomColor: '#FDBA74',
  },
  sessionOfflineText: {
    flex: 1,
    color: '#9A3412',
    fontSize: 13,
    fontWeight: '600',
  },
  sessionOfflineAction: {
    marginLeft: 12,
    color: '#9A3412',
    fontSize: 13,
    fontWeight: '800',
  },
  authRestoringOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#F8FAFC',
    zIndex: 2000,
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
    color: '#4B5563',
    textAlign: 'center',
  },
  authRetryButton: {
    marginTop: 18,
    minHeight: 48,
    minWidth: 160,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#0A1628',
  },
  authRetryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
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
    borderColor: '#2563EB',
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
    color: '#4B5563',
  },
});
