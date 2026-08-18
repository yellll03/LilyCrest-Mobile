import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import {
  getOrCreatePushInstallationId,
  savePushTokenToServer,
} from '../services/notifications';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '11111111-2222-4333-8444-555555555555'),
}));

jest.mock('../services/api', () => ({
  api: { post: jest.fn().mockResolvedValue({ data: { status: 'ok' } }) },
}));

describe('push installation identity', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('persists one stable installation ID and sends it with every token rotation', async () => {
    const firstId = await getOrCreatePushInstallationId();
    await savePushTokenToServer('ExponentPushToken[first-token]', {
      platform: 'android',
      syncKey: 'tenant-a',
    });
    await savePushTokenToServer('ExponentPushToken[rotated-token]', {
      platform: 'android',
      syncKey: 'tenant-a',
    });
    const secondId = await getOrCreatePushInstallationId();

    expect(secondId).toBe(firstId);
    expect(firstId).toMatch(/^lilycrest-(android|ios)-11111111-2222-4333-8444-555555555555$/);
    expect(api.post).toHaveBeenCalledTimes(2);
    for (const [, body] of api.post.mock.calls) {
      expect(body.device_id).toBe(firstId);
      expect(body.replace_legacy_platform_tokens).toBe(true);
    }
  });
});
