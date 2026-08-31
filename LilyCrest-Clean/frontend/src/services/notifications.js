import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { api } from './api';
import { SURVEY_FEEDBACK_ENABLED } from '../config/features';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;

// Safely lazy-load expo-notifications because push support is unavailable in Expo Go
// on modern SDKs and can fail during module initialization.
let Notifications = null;
let handlerConfigured = false;
try {
  Notifications = require('expo-notifications');
} catch (_error) {
  console.warn('[Notifications] Skipped - not available:', _error?.message);
  Notifications = null;
}

const PUSH_TOKEN_KEY = '@lilycrest_push_token';
const PUSH_PERMISSION_REQUESTED_KEY = '@lilycrest_push_permission_requested';
const PUSH_SETTING_KEY = 'notifications';
const PUSH_SYNC_SIGNATURE_KEY = '@lilycrest_push_sync_signature';
const PUSH_INSTALLATION_ID_KEY = '@lilycrest_push_installation_id';
const LAST_HANDLED_NOTIFICATION_RESPONSE_KEY = '@lilycrest_last_handled_notification_response';
const DEFAULT_CHANNEL_ID = 'default';
const NOTIFICATION_INBOX_ROUTE = '/notifications';
const SAFE_NOTIFICATION_DIRECT_PATHS = new Set([
  '/notifications',
  '/settings',
  '/bill-details',
  '/billing-history',
  '/contract-viewer',
  '/document-viewer',
  '/documents',
  '/my-documents',
  '/room-transfer',
  '/(tabs)/home',
  '/(tabs)/services',
  '/(tabs)/announcements',
  '/(tabs)/billing',
  '/(tabs)/profile',
  '/(tabs)/chatbot',
]);

function notificationRouteFallback(data = {}, reason = 'unsupported', options = {}) {
  if (options.reportUnsupported === true) {
    const type = typeof data?.type === 'string' ? data.type.trim() : '';
    const category = typeof data?.category === 'string' ? data.category.trim() : '';
    const screen = typeof data?.screen === 'string' ? data.screen.trim() : '';
    console.warn('[Notifications] Falling back to the notification inbox', {
      reason,
      type: type || 'unknown',
      category: category || 'unknown',
      screen: screen || 'unknown',
    });
  }
  return NOTIFICATION_INBOX_ROUTE;
}

function isSafeNotificationDirectUrl(url = '') {
  if (typeof url !== 'string' || !url.startsWith('/')) return false;
  const path = url.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  return SAFE_NOTIFICATION_DIRECT_PATHS.has(path);
}

export function initializeNotificationHandler() {
  if (!Notifications || handlerConfigured) return;

  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        // The app renders its own in-app banner while foregrounded.
        shouldShowAlert: false,
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    handlerConfigured = true;
  } catch (error) {
    console.warn('[Notifications] Handler setup deferred:', error?.message);
  }
}

function normalizeDeviceProvider(platform = Platform.OS) {
  if (platform === 'android') return 'fcm';
  if (platform === 'ios') return 'apns';
  return platform;
}

function isExpoPushToken(token) {
  return typeof token === 'string'
    && /^(Expo|Exponent)PushToken\[[A-Za-z0-9-_=]+\]$/.test(token.trim());
}

function getExpoProjectId() {
  return Constants?.expoConfig?.extra?.eas?.projectId
    || Constants?.easConfig?.projectId
    || null;
}

function normalizePushProvider(token, platform = Platform.OS) {
  if (isExpoPushToken(token)) return 'expo';
  return normalizeDeviceProvider(platform);
}

function tokenValue(tokenData) {
  return typeof tokenData?.data === 'string' ? tokenData.data.trim() : '';
}

export async function acquirePushToken({
  notifications = Notifications,
  platform = Platform.OS,
  projectId = getExpoProjectId(),
} = {}) {
  if (!notifications) return '';

  const getNativeToken = async () => {
    if (!notifications.getDevicePushTokenAsync) return '';
    try {
      const token = tokenValue(await notifications.getDevicePushTokenAsync());
      if (token && IS_DEV) console.log('[Notifications] Native push token acquired');
      return token;
    } catch (error) {
      console.warn('[Notifications] Native push token fetch failed:', error?.message);
      return '';
    }
  };

  const getExpoToken = async () => {
    if (!projectId || !notifications.getExpoPushTokenAsync) return '';
    try {
      const token = tokenValue(await notifications.getExpoPushTokenAsync({ projectId }));
      if (token && IS_DEV) console.log('[Notifications] Expo push token acquired');
      return token;
    } catch (error) {
      console.warn('[Notifications] Expo push token fetch failed:', error?.message);
      return '';
    }
  };

  // Native FCM notification messages are displayed by Android even when the
  // React Native process is not running. Prefer that transport on Android;
  // retain Expo as a fallback and as the primary provider on iOS.
  if (platform === 'android') {
    return (await getNativeToken()) || (await getExpoToken());
  }

  const expoToken = await getExpoToken();
  if (expoToken) return expoToken;
  if (platform === 'ios') {
    console.warn('[Notifications] Expo push token unavailable on iOS; skipping unsupported direct APNs registration.');
    return '';
  }
  return getNativeToken();
}

async function ensureAndroidNotificationChannel() {
  if (!Notifications || Platform.OS !== 'android') return;

  try {
    await Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL_ID, {
      name: 'LilyCrest Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0A1628',
      sound: 'default',
    });
  } catch (error) {
    console.warn('[Notifications] Channel setup skipped:', error?.message || error);
  }
}

export async function arePushNotificationsEnabled() {
  try {
    const raw = await AsyncStorage.getItem(PUSH_SETTING_KEY);
    return raw !== 'false';
  } catch (_error) {
    return true;
  }
}

export async function setPushNotificationsEnabled(enabled) {
  await AsyncStorage.setItem(PUSH_SETTING_KEY, String(Boolean(enabled)));
}

let installationIdPromise = null;

export async function getOrCreatePushInstallationId() {
  if (!installationIdPromise) {
    installationIdPromise = (async () => {
      const existing = String(await AsyncStorage.getItem(PUSH_INSTALLATION_ID_KEY) || '').trim();
      if (existing) return existing;

      const uuid = typeof Crypto?.randomUUID === 'function'
        ? Crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      const nextId = `lilycrest-${Platform.OS}-${uuid}`;
      await AsyncStorage.setItem(PUSH_INSTALLATION_ID_KEY, nextId);
      return nextId;
    })().catch((error) => {
      installationIdPromise = null;
      throw error;
    });
  }

  return installationIdPromise;
}

// AuthContext mounts two independent effects that can each call this: one
// unconditionally on app mount (via requestPushPermissionOnFirstLaunch, for
// a permission prompt before login exists), and one gated on authStatus
// becoming 'authenticated'. For a returning already-authenticated user both
// fire within the same startup sequence — often not concurrently (the first
// usually finishes well before the second, which waits on session hydration)
// — so a plain in-flight guard isn't enough; a short result cache is needed
// too. This makes registerForPushNotifications the single authoritative
// registration lifecycle regardless of how many call sites invoke it during
// one app launch.
let pushRegistrationPromise = null;
let pushRegistrationCache = null; // { requestPermission, result, at }
const PUSH_REGISTRATION_CACHE_WINDOW_MS = 10000;

export async function registerForPushNotifications({ requestPermission = false } = {}) {
  if (!Notifications) return null;
  initializeNotificationHandler();

  if (Platform.OS === 'web') {
    if (IS_DEV) console.log('[Notifications] Push notifications are not supported on web');
    return null;
  }

  if (pushRegistrationPromise) return pushRegistrationPromise;

  if (
    pushRegistrationCache
    // A cached `requestPermission: false` result satisfies a later
    // `requestPermission: false` call, but a call that actually needs to
    // prompt for permission must never be served a stale non-prompting
    // result — only reuse the cache when it did at least as much as asked.
    && (pushRegistrationCache.requestPermission || !requestPermission)
    && Date.now() - pushRegistrationCache.at < PUSH_REGISTRATION_CACHE_WINDOW_MS
  ) {
    return pushRegistrationCache.result;
  }

  pushRegistrationPromise = registerForPushNotificationsInner({ requestPermission })
    .then((result) => {
      pushRegistrationCache = { requestPermission, result, at: Date.now() };
      return result;
    })
    .finally(() => {
      pushRegistrationPromise = null;
    });
  return pushRegistrationPromise;
}

async function registerForPushNotificationsInner({ requestPermission = false } = {}) {
  try {
    const notificationsEnabled = await arePushNotificationsEnabled();
    if (!notificationsEnabled) {
      if (IS_DEV) console.log('[Notifications] Push notifications are disabled in settings');
      return null;
    }

    await ensureAndroidNotificationChannel();

    const permissions = await Notifications.getPermissionsAsync();
    let finalStatus = permissions.status;

    if (permissions.status !== 'granted' && requestPermission) {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested.status;
      await AsyncStorage.setItem(PUSH_PERMISSION_REQUESTED_KEY, 'true');
    } else if (permissions.status === 'granted') {
      await AsyncStorage.setItem(PUSH_PERMISSION_REQUESTED_KEY, 'true');
    }

    if (finalStatus !== 'granted') {
      if (IS_DEV) console.log('[Notifications] Permission not granted');
      return null;
    }

    const token = await acquirePushToken();

    if (!token) return null;

    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    return token;
  } catch (error) {
    console.warn('[Notifications] Push registration skipped:', error?.message || error);
    return null;
  }
}

export async function requestPushPermissionOnFirstLaunch() {
  if (!Notifications || Platform.OS === 'web') return null;

  const notificationsEnabled = await arePushNotificationsEnabled();
  if (!notificationsEnabled) return null;

  const wasPrompted = await AsyncStorage.getItem(PUSH_PERMISSION_REQUESTED_KEY);
  if (wasPrompted === 'true') {
    return registerForPushNotifications({ requestPermission: false });
  }

  return registerForPushNotifications({ requestPermission: true });
}

export async function savePushTokenToServer(token, options = {}) {
  const trimmedToken = typeof token === 'string' ? token.trim() : '';
  const notificationsEnabled = options.notificationsEnabled ?? true;
  const devicePlatform = options.platform || Platform.OS;
  const provider = options.provider || normalizePushProvider(trimmedToken, devicePlatform);
  const authTokenOverride = typeof options.authTokenOverride === 'string' ? options.authTokenOverride.trim() : '';
  const suppressUnauthorized = options.suppressUnauthorized === true;
  const installationId = await getOrCreatePushInstallationId();
  const syncKey = typeof options.syncKey === 'string' && options.syncKey.trim()
    ? options.syncKey.trim()
    : 'default';
  const nextSignature = JSON.stringify({
    syncKey,
    token: trimmedToken || null,
    enabled: Boolean(notificationsEnabled),
    platform: devicePlatform,
    provider,
    installationId,
    // Refresh server-side last_seen_at at most once per UTC day without
    // registering repeatedly on every render/app foreground event.
    syncDay: new Date().toISOString().slice(0, 10),
  });

  if (!trimmedToken && notificationsEnabled) return;

  try {
    const existingSignature = await AsyncStorage.getItem(PUSH_SYNC_SIGNATURE_KEY);
    if (existingSignature === nextSignature) {
      return;
    }

    await api.post('/users/push-token', {
      push_token: trimmedToken || null,
      notifications_enabled: Boolean(notificationsEnabled),
      provider,
      device_platform: devicePlatform,
      device_id: installationId,
      replace_legacy_platform_tokens: true,
    }, {
      headers: authTokenOverride ? { Authorization: `Bearer ${authTokenOverride}` } : undefined,
    });
    await AsyncStorage.setItem(PUSH_SYNC_SIGNATURE_KEY, nextSignature);
    if (IS_DEV) console.log('[Notifications] Token saved to server');
  } catch (error) {
    if (suppressUnauthorized && error?.response?.status === 401) {
      return;
    }
    console.warn('[Notifications] Failed to save token to server:', error?.message);
    throw error;
  }
}

export function setupNotificationListeners(onNotificationReceived, onNotificationTapped) {
  if (!Notifications || Platform.OS === 'web') return () => {};
  initializeNotificationHandler();

  try {
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      if (IS_DEV) console.log('[Notifications] Received:', notification?.request?.content?.title);
      if (onNotificationReceived) onNotificationReceived(notification);
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const interaction = extractNotificationResponseInteraction(response);
      if (IS_DEV) console.log('[Notifications] Tapped, data:', interaction?.data);
      if (interaction && onNotificationTapped) onNotificationTapped(interaction);
    });

    return () => {
      try { receivedSub?.remove?.(); } catch (_) {}
      try { responseSub?.remove?.(); } catch (_) {}
    };
  } catch (error) {
    console.warn('[Notifications] Listeners skipped:', error?.message);
    return () => {};
  }
}

export function subscribeToPushTokenChanges(onTokenChanged) {
  if (!Notifications?.addPushTokenListener || Platform.OS === 'web') return () => {};
  initializeNotificationHandler();

  try {
    const subscription = Notifications.addPushTokenListener(async (tokenData) => {
      // Expo reports a native APNs token through this listener on iOS, while
      // LilyCrest's backend sends iOS notifications through Expo Push. Re-mint
      // the corresponding Expo token after APNs rotation instead of replacing
      // the usable Expo token with an unsupported raw APNs token.
      const token = Platform.OS === 'ios'
        ? await acquirePushToken()
        : (typeof tokenData?.data === 'string' ? tokenData.data.trim() : '');
      if (!token) return;

      await AsyncStorage.setItem(PUSH_TOKEN_KEY, token).catch(() => {});
      if (onTokenChanged) {
        onTokenChanged(token, {
          ...tokenData,
          type: normalizePushProvider(token, Platform.OS),
        });
      }
    });

    return () => {
      try { subscription?.remove?.(); } catch (_) {}
    };
  } catch (error) {
    console.warn('[Notifications] Push token listener skipped:', error?.message);
    return () => {};
  }
}

export async function getStoredPushToken() {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

export function extractNotificationResponseInteraction(response) {
  const requestId = typeof response?.notification?.request?.identifier === 'string'
    ? response.notification.request.identifier.trim()
    : '';
  if (!requestId) return null;

  const actionId = typeof response?.actionIdentifier === 'string' && response.actionIdentifier.trim()
    ? response.actionIdentifier.trim()
    : 'default';
  const data = response?.notification?.request?.content?.data;

  return {
    data: data && typeof data === 'object' && !Array.isArray(data) ? data : {},
    responseId: `${requestId}:${actionId}`,
  };
}

export async function getLastNotificationResponseData() {
  if (!Notifications?.getLastNotificationResponseAsync || Platform.OS === 'web') return null;

  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;

    const interaction = extractNotificationResponseInteraction(response);
    if (!interaction) {
      await clearLastNotificationResponse();
      return null;
    }

    const lastHandledResponseId = await AsyncStorage.getItem(LAST_HANDLED_NOTIFICATION_RESPONSE_KEY)
      .catch(() => null);
    if (lastHandledResponseId === interaction.responseId) {
      // Expo can retain the last response after an Activity/process restart.
      // Durable acknowledgement prevents a launcher resume from replaying it
      // even when clearing the native response previously failed.
      await clearLastNotificationResponse(interaction.responseId);
      return null;
    }

    return interaction;
  } catch (error) {
    console.warn('[Notifications] Last response fetch skipped:', error?.message);
    return null;
  }
}

export async function clearLastNotificationResponse(responseId) {
  const normalizedResponseId = typeof responseId === 'string' ? responseId.trim() : '';
  if (normalizedResponseId) {
    // Persist first. Native clearing is best-effort and has failed on some
    // Android lifecycle paths, but a handled response must never be replayed.
    await AsyncStorage.setItem(LAST_HANDLED_NOTIFICATION_RESPONSE_KEY, normalizedResponseId)
      .catch((error) => console.warn('[Notifications] Response acknowledgement skipped:', error?.message));
  }

  if (!Notifications?.clearLastNotificationResponseAsync || Platform.OS === 'web') return;

  try {
    await Notifications.clearLastNotificationResponseAsync();
  } catch (error) {
    console.warn('[Notifications] Last response clear skipped:', error?.message);
  }
}

export function resolveNotificationRoute(data = {}, options = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return notificationRouteFallback({}, 'invalid-payload', options);
  }

  const directUrl = typeof data?.url === 'string' ? data.url.trim() : '';
  const conversationId = data?.conversation_id || data?.conversationId || data?.session_id;
  const messageId = data?.message_id || data?.messageId;
  const requestId = data?.request_id || data?.requestId;
  const contractId = data?.contract_id || data?.contractId;
  const announcementId = data?.announcement_id || data?.announcementId;
  const explicitScreen = typeof data?.screen === 'string' ? data.screen.trim().toLowerCase() : '';
  const type = typeof data?.type === 'string' ? data.type.trim().toLowerCase() : '';
  const category = typeof data?.category === 'string' ? data.category.trim().toLowerCase() : '';
  // Some bridge records use the generic type "notification" while their
  // category carries the actual destination (billing, maintenance, etc.).
  // Never let that generic envelope misroute a non-News item to News.
  const genericNotificationType = type === 'notification' || type === 'notifications';
  const screen = explicitScreen || (genericNotificationType && category ? category : type) || category;

  if (type === 'chat_reply') {
    return conversationId
      ? {
          pathname: '/(tabs)/chatbot',
          params: {
            conversationId: String(conversationId),
            ...(messageId ? { messageId: String(messageId) } : {}),
          },
        }
      : '/(tabs)/chatbot';
  }
  if (type === 'contract_document_ready') {
    return contractId
      ? { pathname: '/contract-viewer', params: { contractId: String(contractId) } }
      : '/contract-viewer';
  }
  if (/^\/\(tabs\)\/chatbot(?:[/?#]|$)/i.test(directUrl) && conversationId) {
    return {
      pathname: '/(tabs)/chatbot',
      params: {
        conversationId: String(conversationId),
        ...(messageId ? { messageId: String(messageId) } : {}),
      },
    };
  }
  if (/^\/\(tabs\)\/services(?:[/?#]|$)/i.test(directUrl) && requestId) {
    return { pathname: '/(tabs)/services', params: { requestId: String(requestId) } };
  }
  const directSurvey = directUrl.match(/^\/surveys\/([^/?#]+)/i);
  if (directSurvey) {
    return SURVEY_FEEDBACK_ENABLED
      ? { pathname: '/survey-form', params: { surveyId: decodeURIComponent(directSurvey[1]) } }
      : notificationRouteFallback(data, 'survey-feature-disabled', options);
  }
  if (isSafeNotificationDirectUrl(directUrl)) return directUrl;

  const billingId = data?.billing_id || data?.bill_id;
  const surveyId = data?.surveyId || data?.survey_id;

  switch (screen) {
    case 'billing':
    case 'payment':
    case 'payments':
    case 'bill_generated':
    case 'bill_released':
    case 'billing_released':
    case 'utility_bill_released':
    case 'bill_due_reminder':
    case 'penalty_applied':
    case 'payment_approved':
    case 'payment_rejected':
      return billingId
        ? { pathname: '/bill-details', params: { billId: String(billingId) } }
        : '/(tabs)/billing';
    case 'announcements':
    case 'announcement':
    case 'news':
      return announcementId
        ? { pathname: '/(tabs)/announcements', params: { announcementId: String(announcementId) } }
        : '/(tabs)/announcements';
    case 'notification':
    case 'notifications':
      return '/notifications';
    case 'maintenance':
    case 'services':
    case 'maintenance_update':
    case 'maintenance_status_changed':
    case 'maintenance_status':
      return requestId
        ? { pathname: '/(tabs)/services', params: { requestId: String(requestId) } }
        : '/(tabs)/services';
    case 'chat':
    case 'chat_reply':
    case 'chatbot':
    case 'admin chat':
    case 'live chat':
      return conversationId
        ? {
            pathname: '/(tabs)/chatbot',
            params: {
              conversationId: String(conversationId),
              ...(messageId ? { messageId: String(messageId) } : {}),
            },
          }
        : '/(tabs)/chatbot';
    case 'reservation':
      return '/(tabs)/home';
    case 'room_transfer':
    case 'room-transfer':
      return '/room-transfer';
    case 'survey':
    case 'surveys':
      if (!SURVEY_FEEDBACK_ENABLED) {
        return notificationRouteFallback(data, 'survey-feature-disabled', options);
      }
      return surveyId
        ? { pathname: '/survey-form', params: { surveyId: String(surveyId) } }
        : '/surveys';
    case 'settings':
      return '/settings';
    case 'contract':
    case 'contracts':
    case 'contract_document_ready':
      return contractId
        ? { pathname: '/contract-viewer', params: { contractId: String(contractId) } }
        : '/contract-viewer';
    case 'profile':
    case 'account':
    case 'account_update':
    case 'move_in':
    case 'move-in':
    case 'tenant_approved':
    case 'system':
      return '/(tabs)/profile';
    default:
      // Unknown, empty, stale, or unsafe direct payloads always land on a
      // valid informational parent route. Callers handling an actual tap opt
      // into the warning above; render-time route previews stay side-effect free.
      return notificationRouteFallback(data, 'unsupported-or-stale-route', options);
  }
}

export async function sendLocalNotification(title, body, data = {}) {
  if (!Notifications || Platform.OS === 'web') return;

  try {
    await ensureAndroidNotificationChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: 'default',
      },
      trigger: null,
    });
  } catch (error) {
    console.warn('[Notifications] Local notification skipped:', error?.message);
  }
}

export async function getBadgeCount() {
  if (!Notifications || Platform.OS === 'web') return 0;
  try {
    return await Notifications.getBadgeCountAsync();
  } catch (_error) {
    return 0;
  }
}

export async function setBadgeCount(count) {
  if (!Notifications || Platform.OS === 'web') return;
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch (_error) {
    // Badge count is not available on every platform.
  }
}
