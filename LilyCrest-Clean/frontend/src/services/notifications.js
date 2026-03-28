import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

// Safely lazy-load expo-notifications — crashes in Expo Go SDK 53+ due to
// module-level push registration side-effects. Always wrapped in try-catch.
let Notifications = null;
let _handlerConfigured = false;
try {
  Notifications = require('expo-notifications');
} catch (_e) {
  console.warn('[Notifications] Skipped — not available:', _e?.message);
  Notifications = null;
}

// Configure handler lazily (not at module load — native bridge may not be ready)
function ensureNotificationHandler() {
  if (!Notifications || _handlerConfigured) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
    _handlerConfigured = true;
  } catch (e) {
    console.warn('[Notifications] Handler setup deferred:', e?.message);
  }
}

const PUSH_TOKEN_KEY = '@lilycrest_push_token';

/**
 * Register for push notifications.
 * Returns the Expo push token string or null.
 */
export async function registerForPushNotifications() {
  if (!Notifications) return null;
  ensureNotificationHandler();
  if (Platform.OS === 'web') {
    console.log('[Notifications] Push notifications are not supported on web');
    return null;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Notifications] Permission not granted');
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    const token = tokenData.data;
    console.log('[Notifications] Push token:', token);

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'LilyCrest Notifications',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#D4682A',
        sound: 'default',
      });
    }

    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    return token;
  } catch (error) {
    console.warn('[Notifications] Push registration skipped:', error?.message || error);
    return null;
  }
}

/**
 * Send the push token to the backend.
 */
export async function savePushTokenToServer(token) {
  if (!token) return;
  try {
    await api.post('/users/push-token', { push_token: token });
    console.log('[Notifications] Token saved to server');
  } catch (error) {
    console.warn('[Notifications] Failed to save token to server:', error?.message);
  }
}

/**
 * Add listeners for incoming and tapped notifications.
 * Returns a cleanup function.
 */
export function setupNotificationListeners(onNotificationReceived, onNotificationTapped) {
  if (!Notifications) return () => {};
  ensureNotificationHandler();
  try {
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      console.log('[Notifications] Received:', notification.request.content.title);
      if (onNotificationReceived) onNotificationReceived(notification);
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data || {};
      console.log('[Notifications] Tapped, data:', data);
      if (onNotificationTapped) onNotificationTapped(data);
    });

    return () => {
      try { receivedSub?.remove?.(); } catch (_) {}
      try { responseSub?.remove?.(); } catch (_) {}
    };
  } catch (_e) {
    console.warn('[Notifications] Listeners skipped:', _e?.message);
    return () => {};
  }
}

/**
 * Get the locally stored push token.
 */
export async function getStoredPushToken() {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

/**
 * Schedule a local notification.
 */
export async function sendLocalNotification(title, body, data = {}) {
  if (!Notifications) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, sound: 'default' },
      trigger: null,
    });
  } catch (_e) {
    console.warn('[Notifications] Local notification skipped:', _e?.message);
  }
}

/**
 * Get the current badge count.
 */
export async function getBadgeCount() {
  if (!Notifications) return 0;
  try { return await Notifications.getBadgeCountAsync(); }
  catch (_e) { return 0; }
}

/**
 * Set the badge count.
 */
export async function setBadgeCount(count) {
  if (!Notifications) return;
  try { await Notifications.setBadgeCountAsync(count); }
  catch (_e) { /* unavailable */ }
}
