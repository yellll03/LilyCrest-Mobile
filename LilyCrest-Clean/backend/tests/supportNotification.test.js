'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('canonical admin reply notification is conversation-bound and idempotent', async () => {
  const writes = [];
  const db = {
    collection(name) {
      if (name === 'notifications') {
        return {
          async updateOne(filter, update, options) {
            writes.push({ filter, update, options });
            return { matchedCount: 0, upsertedCount: 1 };
          },
        };
      }
      if (name === 'users') {
        return { async findOne() { return null; } };
      }
      throw new Error(`Unexpected collection access: ${name}`);
    },
  };

  const databasePath = require.resolve('../config/database');
  const notificationPath = require.resolve('../services/notificationService');
  const pushPath = require.resolve('../services/pushService');
  require(databasePath).getDb = () => db;
  delete require.cache[notificationPath];
  delete require.cache[pushPath];
  const { notifySupportReply } = require(pushPath);
  const { sanitizeStoredNotification } = require(notificationPath);

  const payload = {
    adminName: 'Branch Admin',
    message: 'Your concern has been reviewed.',
    conversationId: 'conversation-1',
    messageId: 'message-1',
  };
  await notifySupportReply('tenant-a', payload);
  await notifySupportReply('tenant-a', payload);

  assert.equal(writes.length, 2);
  for (const write of writes) {
    assert.deepEqual(write.filter, {
      user_id: 'tenant-a',
      event_key: 'chat_reply:conversation-1:message-1',
    });
    assert.equal(write.options.upsert, true);
    assert.equal(write.update.$setOnInsert.type, 'chat_reply');
    assert.equal(write.update.$set.data.type, 'chat_reply');
    assert.equal(write.update.$set.data.conversation_id, 'conversation-1');
    assert.equal(write.update.$set.data.message_id, 'message-1');
    assert.equal(write.update.$set.data.url, '/(tabs)/chatbot');
    assert.equal(write.update.$set.conversation_id, 'conversation-1');
    assert.equal(write.update.$set.message_id, 'message-1');
  }

  const storedDto = sanitizeStoredNotification({
    ...writes[0].update.$setOnInsert,
    ...writes[0].update.$set,
  });
  assert.equal(storedDto.type, 'chat_reply');
  assert.equal(storedDto.conversation_id, 'conversation-1');
  assert.equal(storedDto.message_id, 'message-1');
});
