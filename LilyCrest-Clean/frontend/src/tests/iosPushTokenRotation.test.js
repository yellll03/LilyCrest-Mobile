/* global test */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { subscribeToPushTokenChanges } from '../services/notifications';

let mockPushTokenListener;

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'ios-project-id' } } },
}));

jest.mock('expo-notifications', () => ({
  addPushTokenListener: jest.fn((listener) => {
    mockPushTokenListener = listener;
    return { remove: jest.fn() };
  }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExpoPushToken[rotated-ios]' }),
  getDevicePushTokenAsync: jest.fn().mockResolvedValue({ type: 'apns', data: 'raw-apns-token' }),
  setNotificationHandler: jest.fn(),
}));

jest.mock('../services/api', () => ({ api: { post: jest.fn() } }));

describe('iOS push token rotation', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    Platform.OS = 'ios';
  });

  test('APNs refresh reacquires and publishes the supported Expo token', async () => {
    const onChanged = jest.fn();
    const unsubscribe = subscribeToPushTokenChanges(onChanged);

    await mockPushTokenListener({ type: 'apns', data: 'raw-apns-token' });

    const Notifications = require('expo-notifications');
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'ios-project-id' });
    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledWith('ExpoPushToken[rotated-ios]', expect.objectContaining({ type: 'expo' }));
    expect(await AsyncStorage.getItem('@lilycrest_push_token')).toBe('ExpoPushToken[rotated-ios]');

    unsubscribe();
  });
});
