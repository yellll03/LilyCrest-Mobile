/* global test */
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockExpoNotifications = {
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  clearLastNotificationResponseAsync: jest.fn().mockResolvedValue(),
  getLastNotificationResponseAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
};

jest.mock('expo-notifications', () => mockExpoNotifications);
jest.mock('../config/firebase', () => ({ getFreshIdToken: jest.fn() }));

const {
  clearLastNotificationResponse,
  extractNotificationResponseInteraction,
  getLastNotificationResponseData,
  setupNotificationListeners,
} = require('../services/notifications');

const response = (data = { type: 'announcement' }, identifier = 'notification-1') => ({
  actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
  notification: {
    request: {
      identifier,
      content: { data },
    },
  },
});

describe('notification response lifecycle', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockExpoNotifications.clearLastNotificationResponseAsync.mockResolvedValue();
  });

  test('preserves the native response identity alongside route data', () => {
    expect(extractNotificationResponseInteraction(response())).toEqual({
      data: { type: 'announcement' },
      responseId: 'notification-1:expo.modules.notifications.actions.DEFAULT',
    });
    expect(extractNotificationResponseInteraction({ notification: { request: { content: { data: {} } } } }))
      .toBeNull();
  });

  test('a live notification tap is delivered as an identifiable interaction', () => {
    const onTap = jest.fn();
    setupNotificationListeners(undefined, onTap);

    const listener = mockExpoNotifications.addNotificationResponseReceivedListener.mock.calls[0][0];
    listener(response({ type: 'billing', billing_id: 'bill-1' }, 'notification-live'));

    expect(onTap).toHaveBeenCalledWith({
      data: { type: 'billing', billing_id: 'bill-1' },
      responseId: 'notification-live:expo.modules.notifications.actions.DEFAULT',
    });
  });

  test('a handled cold response cannot replay after native clearing fails', async () => {
    const cachedResponse = response({ type: 'announcement' }, 'notification-stale');
    mockExpoNotifications.getLastNotificationResponseAsync.mockResolvedValue(cachedResponse);

    const firstRead = await getLastNotificationResponseData();
    expect(firstRead).toEqual({
      data: { type: 'announcement' },
      responseId: 'notification-stale:expo.modules.notifications.actions.DEFAULT',
    });

    mockExpoNotifications.clearLastNotificationResponseAsync.mockRejectedValueOnce(new Error('native clear failed'));
    await clearLastNotificationResponse(firstRead.responseId);

    expect(await getLastNotificationResponseData()).toBeNull();
    expect(mockExpoNotifications.getLastNotificationResponseAsync).toHaveBeenCalledTimes(2);
  });
});
