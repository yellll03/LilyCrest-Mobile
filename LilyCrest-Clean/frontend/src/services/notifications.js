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
const DEFAULT_CHANNEL_ID = 'default';

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

export async function registerForPushNotifications({ requestPermission = false } = {}) {
  if (!Notifications) return null;
  initializeNotificationHandler();

  if (Platform.OS === 'web') {
    if (IS_DEV) console.log('[Notifications] Push notifications are not supported on web');
    return null;
  }

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
      const data = response?.notification?.request?.content?.data || {};
      if (IS_DEV) console.log('[Notifications] Tapped, data:', data);
      if (onNotificationTapped) onNotificationTapped(data);
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
      const token = typeof tokenData?.data === 'string' ? tokenData.data.trim() : '';
      if (!token) return;

      await AsyncStorage.setItem(PUSH_TOKEN_KEY, token).catch(() => {});
      if (onTokenChanged) {
        onTokenChanged(token, tokenData);
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

export async function getLastNotificationResponseData() {
  if (!Notifications?.getLastNotificationResponseAsync || Platform.OS === 'web') return null;

  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    return response?.notification?.request?.content?.data || null;
  } catch (error) {
    console.warn('[Notifications] Last response fetch skipped:', error?.message);
    return null;
  }
}

export async function clearLastNotificationResponse() {
  if (!Notifications?.clearLastNotificationResponseAsync || Platform.OS === 'web') return;

  try {
    await Notifications.clearLastNotificationResponseAsync();
  } catch (error) {
    console.warn('[Notifications] Last response clear skipped:', error?.message);
  }
}

export function resolveNotificationRoute(data = {}) {
  if (!data || typeof data !== 'object') return '/(tabs)/announcements';

  const directUrl = typeof data?.url === 'string' ? data.url.trim() : '';
  const conversationId = data?.conversation_id || data?.conversationId || data?.session_id;
  const requestId = data?.request_id || data?.requestId;
  if (/^\/\(tabs\)\/chatbot(?:[/?#]|$)/i.test(directUrl) && conversationId) {
    return { pathname: '/(tabs)/chatbot', params: { conversationId: String(conversationId) } };
  }
  if (/^\/\(tabs\)\/services(?:[/?#]|$)/i.test(directUrl) && requestId) {
    return { pathname: '/(tabs)/services', params: { requestId: String(requestId) } };
  }
  const directSurvey = directUrl.match(/^\/surveys\/([^/?#]+)/i);
  if (directSurvey) {
    return SURVEY_FEEDBACK_ENABLED
      ? { pathname: '/survey-form', params: { surveyId: decodeURIComponent(directSurvey[1]) } }
      : '/(tabs)/announcements';
  }
  if (directUrl.startsWith('/') && !/^\/surveys?(\/|$)/i.test(directUrl)) return directUrl;

  const billingId = data?.billing_id || data?.bill_id;
  const contractId = data?.contract_id || data?.contractId;
  const surveyId = data?.surveyId || data?.survey_id;
  const explicitScreen = typeof data?.screen === 'string' ? data.screen.trim().toLowerCase() : '';
  const type = typeof data?.type === 'string' ? data.type.trim().toLowerCase() : '';
  const category = typeof data?.category === 'string' ? data.category.trim().toLowerCase() : '';
  const screen = explicitScreen || type || category;

  switch (screen) {
    case 'billing':
    case 'payment':
    case 'payments':
      return billingId
        ? { pathname: '/bill-details', params: { billId: String(billingId) } }
        : '/(tabs)/billing';
    case 'announcements':
    case 'announcement':
    case 'news':
    case 'notification':
    case 'notifications':
      return '/(tabs)/announcements';
    case 'maintenance':
    case 'services':
      return requestId
        ? { pathname: '/(tabs)/services', params: { requestId: String(requestId) } }
        : '/(tabs)/services';
    case 'chat':
    case 'chatbot':
    case 'admin chat':
    case 'live chat':
      return conversationId
        ? { pathname: '/(tabs)/chatbot', params: { conversationId: String(conversationId) } }
        : '/(tabs)/chatbot';
    case 'reservation':
      return '/(tabs)/home';
    case 'survey':
    case 'surveys':
      if (!SURVEY_FEEDBACK_ENABLED) return '/(tabs)/announcements';
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
    case 'system':
      return '/(tabs)/profile';
    default:
      return '/(tabs)/announcements';
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
