// Regression test for the duplicate-push-registration fix. AuthContext
// mounts two independent effects that can each call
// registerForPushNotifications() during one app launch (one unconditional on
// mount, one gated on authStatus === 'authenticated') — for a returning
// already-authenticated user, both used to independently hit the native
// permission check + token acquisition, doing the same work twice on every
// startup. registerForPushNotifications() now shares one in-flight call and
// caches its result briefly so a second call within the same startup window
// reuses it instead of repeating native work.

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getDevicePushTokenAsync: jest.fn().mockResolvedValue({ data: 'native-token-abc' }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'expo-token-abc' }),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(),
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

describe('registerForPushNotifications de-duplication (regression)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    // iOS only trusts the Expo push token path, which needs a configured
    // projectId this test doesn't set up. Android's native-token path needs
    // nothing extra, so it isolates the dedup behavior under test.
    require('react-native').Platform.OS = 'android';
  });

  it('a second call shortly after the first reuses the cached result instead of repeating native work', async () => {
    const Notifications = require('expo-notifications');
    const { registerForPushNotifications } = require('../services/notifications');

    const first = await registerForPushNotifications({ requestPermission: false });
    const second = await registerForPushNotifications({ requestPermission: false });

    expect(first).toBeTruthy();
    expect(second).toEqual(first);
    expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('two concurrent calls share the same in-flight registration', async () => {
    const Notifications = require('expo-notifications');
    const { registerForPushNotifications } = require('../services/notifications');

    const [first, second] = await Promise.all([
      registerForPushNotifications({ requestPermission: false }),
      registerForPushNotifications({ requestPermission: false }),
    ]);

    expect(first).toEqual(second);
    expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('a call that must prompt for permission is never served a cached result that skipped the prompt', async () => {
    const Notifications = require('expo-notifications');
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const { registerForPushNotifications } = require('../services/notifications');

    await registerForPushNotifications({ requestPermission: false });
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();

    await registerForPushNotifications({ requestPermission: true });
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});
