'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { persistPushTokenForUser } = require('../controllers/user.controller');
const { __test: pushTest } = require('../services/pushService');

function pushStore(user) {
  let current = { ...user };
  return {
    get user() { return current; },
    collection(name) {
      assert.equal(name, 'users');
      return {
        async findOne() { return { ...current }; },
        async updateOne(_filter, update) {
          current = { ...current, ...(update.$set || {}) };
          return { matchedCount: 1, modifiedCount: 1 };
        },
      };
    },
  };
}

test('a rotated token replaces only the stale token for the same installation', async () => {
  const db = pushStore({
    user_id: 'tenant-a',
    push_tokens: [
      { token: 'ExpoPushToken[old-ios]', provider: 'expo', platform: 'ios', device_id: 'ios-install-a', enabled: true },
      { token: 'android-other-device', provider: 'fcm', platform: 'android', device_id: 'android-install-b', enabled: true },
    ],
  });

  await persistPushTokenForUser(db, 'tenant-a', {
    rawPushToken: 'ExpoPushToken[new-ios]',
    notificationsEnabled: true,
    provider: 'expo',
    devicePlatform: 'ios',
    deviceId: 'ios-install-a',
  });

  assert.deepEqual(db.user.push_tokens.map((entry) => entry.token), [
    'ExpoPushToken[new-ios]',
    'android-other-device',
  ]);
  assert.equal(db.user.push_tokens[0].device_id, 'ios-install-a');
  assert.equal(db.user.push_token, 'ExpoPushToken[new-ios]');
});

test('duplicate legacy and structured token entries are persisted once', async () => {
  const db = pushStore({
    user_id: 'tenant-a',
    push_token: 'ExpoPushToken[same]',
    push_provider: 'expo',
    push_platform: 'ios',
    push_tokens: [{ token: 'ExpoPushToken[same]', provider: 'expo', platform: 'ios', enabled: true }],
  });

  await persistPushTokenForUser(db, 'tenant-a', {
    rawPushToken: 'ExpoPushToken[same]',
    notificationsEnabled: true,
    provider: 'expo',
    devicePlatform: 'ios',
    deviceId: 'ios-install-a',
  });

  assert.equal(db.user.push_tokens.length, 1);
});

test('Expo/APNs-compatible payload includes alert, sound, high priority, and string data', async () => {
  const originalPost = axios.post;
  let sentMessages = null;
  axios.post = async (_url, messages) => {
    sentMessages = messages;
    return { data: { data: [{ status: 'ok' }] } };
  };
  try {
    const result = await pushTest.sendMulticast(
      [{ token: 'ExpoPushToken[ios-device]', provider: 'expo', platform: 'ios' }],
      { title: 'Maintenance Update', body: 'Your request changed.', data: { request_id: 123, screen: 'maintenance' } },
    );
    assert.equal(result.successCount, 1);
    assert.deepEqual(sentMessages, [{
      to: 'ExpoPushToken[ios-device]',
      title: 'Maintenance Update',
      body: 'Your request changed.',
      data: { request_id: '123', screen: 'maintenance', channelId: 'default' },
      sound: 'default',
      channelId: 'default',
      priority: 'high',
    }]);
  } finally {
    axios.post = originalPost;
  }
});
