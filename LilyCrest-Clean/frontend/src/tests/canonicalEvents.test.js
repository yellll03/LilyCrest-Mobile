/* global test */
import {
  normalizeCanonicalNotification,
  publishCanonicalNotification,
  resetCanonicalEventDedupeForTests,
  subscribeCanonicalNotifications,
} from '../services/canonicalEvents';

describe('canonical push/realtime event reconciliation', () => {
  beforeEach(() => resetCanonicalEventDedupeForTests());

  test('projects chat IDs from the backend dedupe key', () => {
    expect(normalizeCanonicalNotification({
      type: 'chat_reply',
      dedupeKey: 'chat_reply:conversation-1:message-1',
    }).data).toMatchObject({
      type: 'chat_reply', conversation_id: 'conversation-1', message_id: 'message-1',
    });
  });

  // The de-dupe window still earns its place after the dead Socket.IO client
  // was removed: one business event can still arrive twice, e.g. an OS push
  // and the locally-published copy AuthContext emits for the same event.
  test('two copies of one canonical event present once', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeCanonicalNotifications(listener);
    const event = {
      type: 'chat_reply',
      title: 'New support reply',
      data: {
        type: 'chat_reply',
        event_key: 'chat_reply:conversation-1:message-1',
        conversation_id: 'conversation-1',
        message_id: 'message-1',
      },
    };

    expect(publishCanonicalNotification(event)).toBe(true);
    expect(publishCanonicalNotification({ ...event, notification_id: 'push-copy' })).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
