const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { notifyNewAnnouncement } = require('../services/pushService');

function getAnnouncementDateValue(doc = {}) {
  return doc.publishedAt || doc.sentAt || doc.created_at || doc.createdAt || doc.updated_at || doc.updatedAt || null;
}

function getAnnouncementTimestamp(doc = {}) {
  const value = getAnnouncementDateValue(doc);
  if (!value) return null;

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function sortAnnouncementsByDate(announcements = [], direction = 'desc') {
  const multiplier = direction === 'asc' ? 1 : -1;

  return [...announcements].sort((left, right) => {
    const leftTimestamp = getAnnouncementTimestamp(left);
    const rightTimestamp = getAnnouncementTimestamp(right);

    if (leftTimestamp === null && rightTimestamp === null) return 0;
    if (leftTimestamp === null) return 1;
    if (rightTimestamp === null) return -1;

    return (leftTimestamp - rightTimestamp) * multiplier;
  });
}

// Normalize a raw announcement document to the shape the mobile app expects.
// Admin-panel documents may use camelCase or different field names.
function normalizeAnnouncement(doc) {
  const id = doc.announcement_id || doc._id?.toString();
  const createdAt = getAnnouncementDateValue(doc);

  // Priority: map admin values to app values
  const rawPriority = doc.priority || doc.importance || doc.type || 'normal';
  let priority = 'normal';
  if (/high|urgent|important/i.test(rawPriority)) priority = 'high';
  else if (/low|info/i.test(rawPriority)) priority = 'low';
  else priority = 'normal';

  // If web admin set isPinned, treat as high priority
  if (doc.isPinned && priority !== 'high') priority = 'high';

  return {
    announcement_id: id,
    title: doc.title || doc.subject || 'Announcement',
    content: doc.content || doc.message || doc.body || doc.description || '',
    author_name: doc.author_name || doc.authorName || doc.publishedBy || doc.postedBy || 'LilyCrest Admin',
    priority,
    category: doc.category || doc.type || 'General',
    is_urgent: doc.is_urgent || doc.isUrgent || priority === 'high',
    is_pinned: doc.isPinned || doc.is_pinned || false,
    created_at: createdAt,
  };
}

function getAnnouncementDedupKey(doc = {}, normalized = {}) {
  const mongoId = doc._id?.toString?.() || '';
  const explicitAnnouncementId = [doc.announcement_id, normalized.announcement_id]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => value && value !== mongoId);

  if (explicitAnnouncementId) return `announcement_id:${explicitAnnouncementId}`;

  const timestamp = getAnnouncementTimestamp(doc) ?? getAnnouncementTimestamp(normalized) ?? 'no-date';
  const content = normalized.content || doc.content || doc.message || doc.body || doc.description || '';
  return `fallback:${String(content).trim()}::${timestamp}`;
}

// Get all announcements
async function getAllAnnouncements(req, res) {
  try {
    const db = getDb();
    const userId = req.user?.user_id || null;

    // Handle both snake_case (app-created) and camelCase (admin-panel-created) documents.
    // Web admin docs may lack is_active/isActive entirely — treat missing as active.
    const activeFilter = {
      $or: [
        { is_active: true },
        { isActive: true },
        { is_active: { $exists: false }, isActive: { $exists: false } },
      ],
    };
    // Exclude archived announcements (web admin uses isArchived)
    const notArchivedFilter = { isArchived: { $ne: true } };
    const visibilityFilter = {
      $or: [
        { is_private: { $ne: true }, isPrivate: { $ne: true } },
        ...(userId ? [{ is_private: true, user_id: userId }, { isPrivate: true, userId }] : []),
      ],
    };

    const announcements = await db.collection('announcements')
      .find({ $and: [activeFilter, notArchivedFilter, visibilityFilter] })
      .sort({ created_at: -1, createdAt: -1 })
      .toArray();

    const normalizedAnnouncements = announcements.map(normalizeAnnouncement);
    const dedupedAnnouncements = [];
    const seen = new Set();

    announcements.forEach((doc, index) => {
      const normalized = normalizedAnnouncements[index];
      const dedupKey = getAnnouncementDedupKey(doc, normalized);
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      dedupedAnnouncements.push(normalized);
    });

    res.json(sortAnnouncementsByDate(dedupedAnnouncements));
  } catch (error) {
    console.error('getAllAnnouncements error:', error);
    res.status(500).json({ detail: 'Failed to fetch announcements' });
  }
}

// Admin: create a new announcement and push-notify all tenants
async function createAnnouncement(req, res) {
  try {
    const { title, content, priority, category, is_urgent, is_private, user_id: targetUserId } = req.body;
    if (!title || !content) {
      return res.status(400).json({ detail: 'title and content are required' });
    }

    const db = getDb();
    const announcement = {
      announcement_id: `ann_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
      title,
      content,
      author_name: req.user?.name || req.user?.fullName || 'LilyCrest Admin',
      priority: priority || 'normal',
      category: category || 'General',
      is_urgent: is_urgent || priority === 'high' || false,
      is_active: true,
      is_private: is_private || false,
      user_id: targetUserId || null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.collection('announcements').insertOne(announcement);

    // Push notification to all tenants (non-blocking, skip for private targeted announcements)
    let notification_sent = false;
    if (!announcement.is_private) {
      notifyNewAnnouncement(db, announcement).catch(() => {});
      notification_sent = true;
    } else {
      console.log(`[createAnnouncement] Skipping push notification for private announcement "${announcement.title}" (user_id: ${announcement.user_id})`);
    }

    res.status(201).json({ ...normalizeAnnouncement(announcement), notification_sent });
  } catch (error) {
    console.error('createAnnouncement error:', error);
    res.status(500).json({ detail: 'Failed to create announcement' });
  }
}

module.exports = {
  getAllAnnouncements,
  createAnnouncement,
};
