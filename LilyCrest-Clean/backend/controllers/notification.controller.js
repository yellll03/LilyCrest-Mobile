const { getDb } = require('../config/database');
const { sanitizeStoredNotification, normalizePriority } = require('../services/notificationService');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getAnnouncementDateValue(doc = {}) {
  return doc.publishedAt || doc.sentAt || doc.created_at || doc.createdAt || doc.updated_at || doc.updatedAt || null;
}

function getAnnouncementTimestamp(doc = {}) {
  const value = getAnnouncementDateValue(doc);
  if (!value) return null;

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function normalizeAnnouncementPriority(doc = {}) {
  const rawPriority = doc.priority || doc.importance || doc.type || 'normal';
  if (/high|urgent|important/i.test(String(rawPriority))) return 'high';
  if (/low|info/i.test(String(rawPriority))) return 'low';
  return 'normal';
}

function normalizeAnnouncementNotification(doc = {}) {
  const announcementId = normalizeString(doc.announcement_id || doc._id?.toString?.());
  const createdAt = getAnnouncementDateValue(doc) || new Date();
  const priority = normalizeAnnouncementPriority(doc);
  const category = normalizeString(doc.category || doc.type || 'Announcement') || 'Announcement';
  const body = normalizeString(doc.content || doc.message || doc.body || doc.description || '');
  const authorName = normalizeString(doc.author_name || doc.authorName || doc.publishedBy || doc.postedBy || 'LilyCrest Admin') || 'LilyCrest Admin';

  return {
    notification_id: announcementId || `announcement:${createdAt instanceof Date ? createdAt.getTime() : String(createdAt)}`,
    title: normalizeString(doc.title || doc.subject || 'Announcement') || 'Announcement',
    body,
    content: body,
    category,
    priority,
    is_urgent: doc.is_urgent === true || doc.isUrgent === true || priority === 'high',
    author_name: authorName,
    source_label: authorName,
    created_at: createdAt,
    updated_at: doc.updated_at || doc.updatedAt || createdAt,
    type: 'announcement',
    source: 'announcement',
    data: {
      type: 'announcement',
      announcement_id: announcementId,
      screen: 'announcements',
      url: '/(tabs)/announcements',
    },
    url: '/(tabs)/announcements',
    read: doc.read === true,
    announcement_id: announcementId,
    billing_id: '',
    request_id: '',
    session_id: '',
    reservation_id: '',
    dedup_key: announcementId ? `announcement:${announcementId}` : '',
  };
}

function buildNotificationKey(notification = {}) {
  const preferred = normalizeString(notification.dedup_key);
  if (preferred) return preferred;

  if (notification.announcement_id) return `announcement:${notification.announcement_id}`;
  if (notification.billing_id && notification.type) return `${notification.type}:${notification.billing_id}`;
  if (notification.request_id && notification.type) return `${notification.type}:${notification.request_id}`;
  if (notification.session_id && notification.type) return `${notification.type}:${notification.session_id}`;
  if (notification.reservation_id && notification.type) return `${notification.type}:${notification.reservation_id}`;

  return [
    normalizeString(notification.type || 'notification'),
    normalizeString(notification.title),
    normalizeString(notification.body || notification.content),
    notification.created_at ? new Date(notification.created_at).toISOString() : 'no-date',
  ].join(':');
}

function sortNotifications(list = []) {
  return [...list].sort((left, right) => {
    const leftTime = left?.created_at ? new Date(left.created_at).getTime() : 0;
    const rightTime = right?.created_at ? new Date(right.created_at).getTime() : 0;
    return rightTime - leftTime;
  });
}

async function getMyNotifications(req, res) {
  try {
    const db = getDb();
    const userId = req.user?.user_id || null;

    if (!userId) {
      return res.status(400).json({ detail: 'User context is required.' });
    }

    const storedNotifications = await db.collection('notifications')
      .find({ user_id: userId })
      .sort({ created_at: -1, updated_at: -1 })
      .limit(120)
      .toArray()
      .catch(() => []);

    const activeFilter = {
      $or: [
        { is_active: true },
        { isActive: true },
        { is_active: { $exists: false }, isActive: { $exists: false } },
      ],
    };
    const notArchivedFilter = { isArchived: { $ne: true } };
    const visibilityFilter = {
      $or: [
        { is_private: { $ne: true }, isPrivate: { $ne: true } },
        { is_private: true, user_id: userId },
        { isPrivate: true, userId },
      ],
    };

    const announcements = await db.collection('announcements')
      .find({ $and: [activeFilter, notArchivedFilter, visibilityFilter] })
      .sort({ created_at: -1, createdAt: -1 })
      .limit(80)
      .toArray()
      .catch(() => []);

    const mergedByKey = new Map();
    const [readReceipts, readState] = await Promise.all([
      db.collection('notification_reads').find({ user_id: userId }).project({ notification_key: 1 }).toArray().catch(() => []),
      db.collection('notification_read_state').findOne({ user_id: userId }).catch(() => null),
    ]);
    const readKeys = new Set(readReceipts.map((entry) => normalizeString(entry.notification_key)).filter(Boolean));
    const allReadAt = readState?.all_read_at ? new Date(readState.all_read_at).getTime() : 0;

    sortNotifications([
      ...storedNotifications.map((doc) => sanitizeStoredNotification(doc)),
      ...announcements.map((doc) => normalizeAnnouncementNotification(doc)),
    ]).forEach((notification) => {
      const key = buildNotificationKey(notification);
      const normalizedNotification = {
        ...notification,
        priority: normalizePriority(notification.priority),
        content: normalizeString(notification.content || notification.body),
        body: normalizeString(notification.body || notification.content),
      };
      const notificationTime = normalizedNotification.created_at ? new Date(normalizedNotification.created_at).getTime() : 0;
      normalizedNotification.read = normalizedNotification.read === true || readKeys.has(key) || (allReadAt > 0 && notificationTime <= allReadAt);

      const existing = mergedByKey.get(key);
      if (!existing) {
        mergedByKey.set(key, normalizedNotification);
        return;
      }

      // When a stored push preview duplicates a raw announcement, keep the
      // richer announcement payload so the user can still read the full notice.
      if (normalizedNotification.source === 'announcement' && existing.source !== 'announcement') {
        mergedByKey.set(key, normalizedNotification);
      }
    });

    res.json(sortNotifications(Array.from(mergedByKey.values())).slice(0, 100));
  } catch (error) {
    console.error('getMyNotifications error:', error);
    res.status(500).json({ detail: 'Failed to fetch notifications' });
  }
}

async function markNotificationRead(req, res) {
  const userId = req.user?.user_id;
  const notificationKey = normalizeString(req.params.notificationId);
  if (!notificationKey) return res.status(400).json({ detail: 'notificationId is required.' });
  const db = getDb();
  const stored = await db.collection('notifications').find({ user_id: userId }).limit(200).toArray();
  let ownedNotification = stored
    .map((doc) => sanitizeStoredNotification(doc))
    .find((item) => buildNotificationKey(item) === notificationKey || item.notification_id === notificationKey);

  if (!ownedNotification) {
    const announcements = await db.collection('announcements').find({
      $and: [
        { $or: [{ is_active: true }, { isActive: true }, { is_active: { $exists: false }, isActive: { $exists: false } }] },
        { isArchived: { $ne: true } },
        { $or: [
          { is_private: { $ne: true }, isPrivate: { $ne: true } },
          { is_private: true, user_id: userId },
          { isPrivate: true, userId },
        ] },
      ],
    }).limit(200).toArray();
    ownedNotification = announcements
      .map((doc) => normalizeAnnouncementNotification(doc))
      .find((item) => buildNotificationKey(item) === notificationKey || item.notification_id === notificationKey);
  }

  if (!ownedNotification) return res.status(404).json({ detail: 'Notification not found.' });
  const ownedKey = buildNotificationKey(ownedNotification);
  await db.collection('notification_reads').updateOne(
    { user_id: userId, notification_key: ownedKey },
    { $set: { read_at: new Date() }, $setOnInsert: { created_at: new Date() } },
    { upsert: true },
  );
  return res.json({ status: 'read', notification_id: ownedKey });
}

async function markAllNotificationsRead(req, res) {
  const db = getDb();
  const userId = req.user?.user_id;
  const now = new Date();
  await db.collection('notification_read_state').updateOne(
    { user_id: userId },
    { $set: { all_read_at: now, updated_at: now }, $setOnInsert: { created_at: now } },
    { upsert: true },
  );
  await db.collection('notifications').updateMany({ user_id: userId }, { $set: { read: true, read_at: now } });
  return res.json({ status: 'all_read', read_at: now });
}

module.exports = {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
