const notificationListeners = new Set();
const recentNotificationKeys = new Map();
const DEDUPE_WINDOW_MS = 30_000;

function text(value) {
  return value == null ? '' : String(value).trim();
}

export function canonicalNotificationKey(event = {}) {
  const data = event.data && typeof event.data === 'object' ? event.data : event;
  const explicit = text(
    data.event_key
    || data.dedup_key
    || data.dedupeKey
    || data.notification_id
    || event.notification_id,
  );
  if (explicit) return explicit;

  const type = text(data.type || event.type || 'notification').toLowerCase();
  const entityId = text(
    data.message_id
    || data.messageId
    || data.contract_id
    || data.contractId
    || data.conversation_id
    || data.conversationId
    || data.entityId
    || event.entityId,
  );
  return `${type}:${entityId || text(event.title)}:${text(event.body || event.message)}`;
}

export function normalizeCanonicalNotification(event = {}) {
  const sourceData = event.data && typeof event.data === 'object' ? event.data : {};
  const type = text(sourceData.type || event.type).toLowerCase();
  const entityType = text(event.entityType).toLowerCase();
  const entityId = text(event.entityId);
  const dedupeKey = text(event.dedupeKey || sourceData.event_key || sourceData.dedup_key);
  const dedupeParts = dedupeKey.startsWith('chat_reply:') ? dedupeKey.split(':') : [];
  const conversationId = text(
    sourceData.conversation_id
    || sourceData.conversationId
    || (entityType === 'chat' ? entityId : '')
    || dedupeParts[1],
  );
  const messageId = text(
    sourceData.message_id
    || sourceData.messageId
    || (dedupeParts.length > 2 ? dedupeParts.slice(2).join(':') : ''),
  );
  const contractId = text(
    sourceData.contract_id
    || sourceData.contractId
    || (entityType === 'contract' ? entityId : ''),
  );

  const data = {
    ...sourceData,
    ...(type ? { type } : {}),
    ...(conversationId ? { conversation_id: conversationId } : {}),
    ...(messageId ? { message_id: messageId } : {}),
    ...(contractId ? { contract_id: contractId } : {}),
    ...(dedupeKey ? { event_key: dedupeKey } : {}),
  };

  return {
    ...event,
    type,
    title: text(event.title) || 'New update',
    body: text(event.body || event.message) || 'You have a new LilyCrest update.',
    data,
  };
}

export function publishCanonicalNotification(event = {}) {
  const normalized = normalizeCanonicalNotification(event);
  const key = canonicalNotificationKey(normalized);
  const now = Date.now();

  for (const [knownKey, seenAt] of recentNotificationKeys) {
    if (now - seenAt > DEDUPE_WINDOW_MS) recentNotificationKeys.delete(knownKey);
  }
  if (key && recentNotificationKeys.has(key)) return false;
  if (key) recentNotificationKeys.set(key, now);

  notificationListeners.forEach((listener) => listener(normalized));
  return true;
}

export function subscribeCanonicalNotifications(listener) {
  notificationListeners.add(listener);
  return () => notificationListeners.delete(listener);
}

export function resetCanonicalEventDedupeForTests() {
  recentNotificationKeys.clear();
}
