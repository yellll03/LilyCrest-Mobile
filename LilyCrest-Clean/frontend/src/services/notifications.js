import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

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

async function ensureAndroidNotificationChannel() {
  if (!Notifications || Platform.OS !== 'android') return;

  try {
    await Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL_ID, {
      name: 'LilyCrest Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#204b7e',
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

export async function registerForPushNotifications({ requestPermission = false } = {}) {
  if (!Notifications) return null;
  initializeNotificationHandler();

  if (Platform.OS === 'web') {
    console.log('[Notifications] Push notifications are not supported on web');
    return null;
  }

  try {
    const notificationsEnabled = await arePushNotificationsEnabled();
    if (!notificationsEnabled) {
      console.log('[Notifications] Push notifications are disabled in settings');
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
      console.log('[Notifications] Permission not granted');
      return null;
    }

    let token = '';
    const projectId = getExpoProjectId();

    if (projectId && Notifications.getExpoPushTokenAsync) {
      try {
        const expoTokenData = await Notifications.getExpoPushTokenAsync({ projectId });
        token = typeof expoTokenData?.data === 'string' ? expoTokenData.data.trim() : '';
        if (token) {
          console.log('[Notifications] Expo push token:', token);
        }
      } catch (error) {
        console.warn('[Notifications] Expo push token fetch failed, falling back to native token:', error?.message);
      }
    }

    if (!token) {
      if (Platform.OS === 'ios') {
        console.warn('[Notifications] Expo push token unavailable on iOS; skipping unsupported APNs token registration.');
        return null;
      }
      const tokenData = await Notifications.getDevicePushTokenAsync();
      token = typeof tokenData?.data === 'string' ? tokenData.data.trim() : '';
      console.log('[Notifications] Native push token:', token);
    }

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
  const authTokenOverride = typeof options.authTokenOverride === 'string' ? options.authTokenOverride.trim() : '';
  const suppressUnauthorized = options.suppressUnauthorized === true;
  const syncKey = typeof options.syncKey === 'string' && options.syncKey.trim()
    ? options.syncKey.trim()
    : 'default';
  const nextSignature = JSON.stringify({
    syncKey,
    token: trimmedToken || null,
    enabled: Boolean(notificationsEnabled),
    platform: devicePlatform,
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
      provider: normalizePushProvider(trimmedToken, devicePlatform),
      device_platform: devicePlatform,
    }, {
      headers: authTokenOverride ? { Authorization: `Bearer ${authTokenOverride}` } : undefined,
    });
    await AsyncStorage.setItem(PUSH_SYNC_SIGNATURE_KEY, nextSignature);
    console.log('[Notifications] Token saved to server');
  } catch (error) {
    if (suppressUnauthorized && error?.response?.status === 401) {
      return;
    }
    console.warn('[Notifications] Failed to save token to server:', error?.message);
    throw error;
  }
}

export function setupNotificationListeners(onNotificationReceived, onNotificationTapped) {
  if (!Notifications) return () => {};
  initializeNotificationHandler();

  try {
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      console.log('[Notifications] Received:', notification?.request?.content?.title);
      if (onNotificationReceived) onNotificationReceived(notification);
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data || {};
      console.log('[Notifications] Tapped, data:', data);
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
  if (!Notifications?.addPushTokenListener) return () => {};
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
  if (!Notifications?.getLastNotificationResponseAsync) return null;

  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    return response?.notification?.request?.content?.data || null;
  } catch (error) {
    console.warn('[Notifications] Last response fetch skipped:', error?.message);
    return null;
  }
}

export async function clearLastNotificationResponse() {
  if (!Notifications?.clearLastNotificationResponseAsync) return;

  try {
    await Notifications.clearLastNotificationResponseAsync();
  } catch (error) {
    console.warn('[Notifications] Last response clear skipped:', error?.message);
  }
}

export function resolveNotificationRoute(data = {}) {
  if (!data || typeof data !== 'object') return '/(tabs)/announcements';

  const directUrl = typeof data?.url === 'string' ? data.url.trim() : '';
  if (directUrl.startsWith('/')) return directUrl;

  const billingId = data?.billing_id || data?.bill_id;
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
      return '/(tabs)/services';
    case 'chat':
    case 'chatbot':
    case 'admin chat':
    case 'live chat':
      return '/(tabs)/chatbot';
    case 'reservation':
      return '/(tabs)/home';
    case 'settings':
      return '/settings';
    case 'profile':
    case 'system':
      return '/(tabs)/profile';
    default:
      return '/(tabs)/announcements';
  }
}

export async function sendLocalNotification(title, body, data = {}) {
  if (!Notifications) return;

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
  if (!Notifications) return 0;
  try {
    return await Notifications.getBadgeCountAsync();
  } catch (_error) {
    return 0;
  }
}

export async function setBadgeCount(count) {
  if (!Notifications) return;
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch (_error) {
    // Badge count is not available on every platform.
  }
}
