const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const TENANT_NOTIFICATION_ROLES = new Set(['tenant', 'resident']);
const APPLICANT_NOTIFICATION_ROLES = new Set([
  'applicant',
  'prospect',
  'reservation_applicant',
  'pending_tenant',
]);

function isApplicantLifecycleNotification(notification = {}) {
  const roleAtCreation = normalizeString(
    notification.role_at_creation || notification.roleAtCreation || ''
  ).toLowerCase();

  // A stamped role is authoritative. In particular, never hide a legitimate
  // tenant billing item merely because its copy happens to mention a
  // reservation or move-in.
  if (TENANT_NOTIFICATION_ROLES.has(roleAtCreation)) return false;
  if (APPLICANT_NOTIFICATION_ROLES.has(roleAtCreation)) return true;

  // Older records predate role_at_creation. Infer only from strong applicant
  // lifecycle signals; generic payment/billing records remain visible.
  const data = notification.data && typeof notification.data === 'object'
    ? notification.data
    : {};
  const lifecycleRoute = [
    notification.type,
    notification.category,
    notification.source,
    notification.url,
    data.type,
    data.category,
    data.screen,
    data.url,
  ].map((value) => normalizeString(value).toLowerCase()).join(' ');
  if (/(^|[\s_./-])(applicant|application|reservation)(?=$|[\s_./-])/.test(lifecycleRoute)) return true;

  const reservationId = normalizeString(
    notification.reservation_id || notification.reservationId
      || data.reservation_id || data.reservationId || ''
  );
  const billingId = normalizeString(
    notification.billing_id || notification.billingId || notification.bill_id
      || data.billing_id || data.billingId || data.bill_id || ''
  );
  return Boolean(reservationId && !billingId);
}

function filterNotificationsForTenantLifecycle(user = {}, notifications = []) {
  const currentRole = normalizeString(user.role).toLowerCase();
  if (!TENANT_NOTIFICATION_ROLES.has(currentRole)) return [...notifications];
  return notifications.filter((notification) => !isApplicantLifecycleNotification(notification));
}

function normalizePriority(value) {
  const raw = normalizeString(value).toLowerCase();
  if (raw === 'high' || raw === 'urgent' || raw === 'critical') return 'high';
  if (raw === 'low' || raw === 'info') return 'low';
  return 'normal';
}

function sanitizePayload(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};

  const payload = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined) return;
    payload[key] = value;
  });
  return payload;
}

function buildNotificationDocument(userId, payload = {}) {
  const now = payload.created_at instanceof Date
    ? payload.created_at
    : payload.createdAt instanceof Date
      ? payload.createdAt
      : new Date();
  const priority = normalizePriority(payload.priority);
  // Applicant and tenant share the same user_id — a notification created
  // while someone was an applicant stays attached to that account after
  // approval. Tenant feed filtering reads this stamp so historical
  // applicant-only actions do not leak into the current tenant experience.
  const roleAtCreation = normalizeString(payload.role_at_creation || payload.roleAtCreation || '');
  const body = normalizeString(payload.body || payload.content || payload.message);
  const sourceLabel = normalizeString(payload.source_label || payload.author_name || payload.authorName || 'LilyCrest System');
  const data = sanitizePayload(payload.data);
  const eventKey = normalizeString(payload.eventKey || payload.event_key || '');

  return {
    notification_id: `notif_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
    user_id: userId,
    title: normalizeString(payload.title) || 'Notification',
    body,
    content: body,
    type: normalizeString(payload.type || 'notification') || 'notification',
    category: normalizeString(payload.category) || 'General',
    priority,
    is_urgent: payload.is_urgent === true || priority === 'high',
    source: normalizeString(payload.source || 'system') || 'system',
    source_label: sourceLabel,
    author_name: sourceLabel,
    data,
    url: normalizeString(payload.url || data.url || ''),
    ...(eventKey ? { event_key: eventKey } : {}),
    announcement_id: normalizeString(payload.announcement_id || data.announcement_id || ''),
    billing_id: normalizeString(payload.billing_id || data.billing_id || data.bill_id || ''),
    request_id: normalizeString(payload.request_id || data.request_id || ''),
    conversation_id: normalizeString(payload.conversation_id || data.conversation_id || data.conversationId || ''),
    message_id: normalizeString(payload.message_id || data.message_id || data.messageId || ''),
    session_id: normalizeString(payload.session_id || data.session_id || ''),
    reservation_id: normalizeString(payload.reservation_id || data.reservation_id || ''),
    ...(roleAtCreation ? { role_at_creation: roleAtCreation } : {}),
    read: payload.read === true,
    created_at: now,
    updated_at: now,
  };
}

function sanitizeStoredNotification(doc = {}) {
  return {
    notification_id: doc.notification_id || doc._id?.toString?.() || '',
    title: normalizeString(doc.title) || 'Notification',
    body: normalizeString(doc.body || doc.content || ''),
    content: normalizeString(doc.content || doc.body || ''),
    category: normalizeString(doc.category) || 'General',
    priority: normalizePriority(doc.priority),
    is_urgent: doc.is_urgent === true || normalizePriority(doc.priority) === 'high',
    author_name: normalizeString(doc.author_name || doc.source_label || 'LilyCrest System') || 'LilyCrest System',
    source_label: normalizeString(doc.source_label || doc.author_name || 'LilyCrest System') || 'LilyCrest System',
    created_at: doc.created_at || doc.createdAt || doc.updated_at || doc.updatedAt || new Date(),
    updated_at: doc.updated_at || doc.updatedAt || doc.created_at || doc.createdAt || new Date(),
    type: normalizeString(doc.type || 'notification') || 'notification',
    source: normalizeString(doc.source || 'system') || 'system',
    data: sanitizePayload(doc.data),
    url: normalizeString(doc.url || doc.data?.url || ''),
    read: doc.read === true,
    announcement_id: normalizeString(doc.announcement_id || doc.data?.announcement_id || ''),
    billing_id: normalizeString(doc.billing_id || doc.data?.billing_id || doc.data?.bill_id || ''),
    request_id: normalizeString(doc.request_id || doc.data?.request_id || ''),
    conversation_id: normalizeString(doc.conversation_id || doc.data?.conversation_id || doc.data?.conversationId || ''),
    message_id: normalizeString(doc.message_id || doc.data?.message_id || doc.data?.messageId || ''),
    session_id: normalizeString(doc.session_id || doc.data?.session_id || ''),
    reservation_id: normalizeString(doc.reservation_id || doc.data?.reservation_id || ''),
    role_at_creation: normalizeString(doc.role_at_creation || ''),
    dedup_key: normalizeString(doc.event_key || ''),
  };
}

async function saveNotificationForUser(userId, payload = {}, options = {}) {
  const normalizedUserId = normalizeString(userId);
  if (!normalizedUserId) return null;

  const db = options.db || getDb();

  // Best-effort: stamp the account's current role unless a caller already
  // supplied one explicitly. A lookup failure must never block the
  // notification itself from being saved.
  let resolvedPayload = payload;
  if (!normalizeString(payload.role_at_creation || payload.roleAtCreation || '')) {
    try {
      const owner = await db.collection('users').findOne(
        { user_id: normalizedUserId },
        { projection: { role: 1 } },
      );
      if (owner?.role) {
        resolvedPayload = { ...payload, role_at_creation: owner.role };
      }
    } catch (_) {
      // Keep resolvedPayload as-is — the field is simply omitted.
    }
  }

  const doc = buildNotificationDocument(normalizedUserId, resolvedPayload);

  if (doc.event_key) {
    await db.collection('notifications').updateOne(
      { user_id: normalizedUserId, event_key: doc.event_key },
      {
        $set: {
          title: doc.title,
          body: doc.body,
          content: doc.content,
          category: doc.category,
          priority: doc.priority,
          is_urgent: doc.is_urgent,
          source: doc.source,
          source_label: doc.source_label,
          author_name: doc.author_name,
          data: doc.data,
          url: doc.url,
          announcement_id: doc.announcement_id,
          billing_id: doc.billing_id,
          request_id: doc.request_id,
          conversation_id: doc.conversation_id,
          message_id: doc.message_id,
          session_id: doc.session_id,
          reservation_id: doc.reservation_id,
          updated_at: new Date(),
        },
        $setOnInsert: {
          notification_id: doc.notification_id,
          user_id: doc.user_id,
          type: doc.type,
          event_key: doc.event_key,
          ...(doc.role_at_creation ? { role_at_creation: doc.role_at_creation } : {}),
          read: false,
          created_at: doc.created_at,
        },
      },
      { upsert: true }
    );

    return doc;
  }

  await db.collection('notifications').insertOne(doc);
  return doc;
}

async function saveNotificationForUsers(userIds = [], payload = {}, options = {}) {
  const db = options.db || getDb();
  const normalizedUserIds = Array.from(new Set(
    (userIds || [])
      .map((value) => normalizeString(value))
      .filter(Boolean)
  ));

  if (!normalizedUserIds.length) return 0;

  if (payload.eventKey || payload.event_key) {
    await Promise.all(
      normalizedUserIds.map((userId) => saveNotificationForUser(userId, payload, { db }))
    );
    return normalizedUserIds.length;
  }

  const docs = normalizedUserIds.map((userId) => buildNotificationDocument(userId, payload));
  if (!docs.length) return 0;
  await db.collection('notifications').insertMany(docs, { ordered: false });
  return docs.length;
}

async function saveNotificationForAllTenants(db, payload = {}) {
  const users = await db.collection('users').find(
    {
      is_active: { $ne: false },
      role: { $nin: ['admin', 'superadmin'] },
      user_id: { $exists: true, $nin: [null, ''] },
    },
    { projection: { user_id: 1 } }
  ).toArray();

  return saveNotificationForUsers(
    users.map((user) => user.user_id),
    payload,
    { db }
  );
}

module.exports = {
  filterNotificationsForTenantLifecycle,
  isApplicantLifecycleNotification,
  normalizePriority,
  sanitizeStoredNotification,
  saveNotificationForUser,
  saveNotificationForUsers,
  saveNotificationForAllTenants,
  // Exported only for direct unit testing of the role_at_creation stamp
  // (see tests/notificationRoleAtCreation.test.js).
  buildNotificationDocument,
};
