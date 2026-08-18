import { acquirePushToken } from '../services/notifications';

jest.mock('../services/api', () => ({
  api: { post: jest.fn() },
}));

describe('native push transport selection', () => {
  it('prefers native FCM on Android so notifications survive a terminated JS process', async () => {
    const notifications = {
      getDevicePushTokenAsync: jest.fn().mockResolvedValue({ type: 'fcm', data: 'native-fcm-token' }),
      getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExpoPushToken[unused]' }),
    };

    await expect(acquirePushToken({ notifications, platform: 'android', projectId: 'project-id' }))
      .resolves.toBe('native-fcm-token');
    expect(notifications.getDevicePushTokenAsync).toHaveBeenCalledTimes(1);
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('falls back to Expo on Android when native token acquisition fails', async () => {
    const notifications = {
      getDevicePushTokenAsync: jest.fn().mockRejectedValue(new Error('native unavailable')),
      getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExpoPushToken[fallback]' }),
    };

    await expect(acquirePushToken({ notifications, platform: 'android', projectId: 'project-id' }))
      .resolves.toBe('ExpoPushToken[fallback]');
  });

  it('retains Expo as the supported iOS provider', async () => {
    const notifications = {
      getDevicePushTokenAsync: jest.fn().mockResolvedValue({ type: 'apns', data: 'raw-apns-token' }),
      getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExpoPushToken[ios]' }),
    };

    await expect(acquirePushToken({ notifications, platform: 'ios', projectId: 'project-id' }))
      .resolves.toBe('ExpoPushToken[ios]');
    expect(notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
  });
});
