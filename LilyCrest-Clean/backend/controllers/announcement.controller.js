const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { notifyNewAnnouncement, notifyPrivateAnnouncement } = require('../services/pushService');
const { resolveTenantBranch, normalizedBranchReference } = require('../services/branchLocation.service');

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

// Resolve the requesting tenant's authoritative branch code for filtering, or
// null if unauthenticated or no branch could be confirmed (no active occupancy,
// conflicting assignments, etc). Branch-restricted announcements are hidden
// rather than shown when this can't be determined — never guessed client-side.
async function resolveRequesterBranchCode(db, user) {
  if (!user) return null;
  try {
    const resolved = await resolveTenantBranch(db, user);
    const code = resolved?.branch?.branchCode;
    return code ? normalizedBranchReference(code) : null;
  } catch (_) {
    return null;
  }
}

// An announcement with no branch field (or blank) is global/legacy and stays
// visible to everyone — existing announcements must not suddenly disappear.
//
// A private (user_id-targeted) announcement is already scoped to exactly one
// tenant by the query-level ownership filter above — that's strictly more
// precise targeting than a branch match. Additionally requiring the branch to
// line up too would only ever narrow an already-exact match, and could hide a
// private announcement from its own intended recipient if the branch value is
// stale, mistyped, or the tenant transferred branches after it was sent — so
// branch filtering is skipped entirely for private announcements.
function isAnnouncementVisibleForBranch(doc, requesterBranchCode) {
  const isPrivate = doc.is_private === true || doc.isPrivate === true;
  if (isPrivate) return true;

  const branchRef = doc.branch || doc.branchId || doc.branch_id;
  if (!branchRef || !String(branchRef).trim()) return true;
  if (!requesterBranchCode) return false;
  return normalizedBranchReference(branchRef) === requesterBranchCode;
}

// Get all announcements
async function getAllAnnouncements(req, res) {
  try {
    const db = getDb();
    const userId = req.user?.user_id || null;
    const requesterBranchCode = await resolveRequesterBranchCode(db, req.user);

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

    const announcements = (await db.collection('announcements')
      .find({ $and: [activeFilter, notArchivedFilter, visibilityFilter] })
      .sort({ created_at: -1, createdAt: -1 })
      .toArray())
      .filter((doc) => isAnnouncementVisibleForBranch(doc, requesterBranchCode));

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
    const { priority, category, is_urgent, is_private, user_id: targetUserId, branch, publish_at, expires_at } = req.body;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    const normalizedPriority = String(priority || 'normal').trim().toLowerCase();
    const normalizedCategory = String(category || 'General').trim();
    const allowedPriorities = ['low', 'normal', 'high'];
    const allowedCategories = ['General', 'Account', 'Announcement', 'Billing', 'Maintenance', 'Security', 'Reservation', 'Rules', 'Promo', 'Event'];
    if (!title || title.length > 120) return res.status(400).json({ detail: 'title is required and must be 120 characters or fewer' });
    if (!content || content.length > 5000) return res.status(400).json({ detail: 'content is required and must be 5000 characters or fewer' });
    if (!allowedPriorities.includes(normalizedPriority)) return res.status(400).json({ detail: `priority must be one of: ${allowedPriorities.join(', ')}` });
    if (!allowedCategories.includes(normalizedCategory)) return res.status(400).json({ detail: `category must be one of: ${allowedCategories.join(', ')}` });
    const publishDate = publish_at ? new Date(publish_at) : new Date();
    const expiryDate = expires_at ? new Date(expires_at) : null;
    if (Number.isNaN(publishDate.getTime()) || (expiryDate && Number.isNaN(expiryDate.getTime()))) return res.status(400).json({ detail: 'publish_at and expires_at must be valid dates' });
    if (expiryDate && expiryDate <= publishDate) return res.status(400).json({ detail: 'expires_at must be after publish_at' });

    const db = getDb();
    if (is_private === true && !targetUserId) return res.status(400).json({ detail: 'user_id is required for a private announcement' });
    if (targetUserId) {
      const target = await db.collection('users').findOne({ user_id: String(targetUserId).trim() });
      if (!target) return res.status(400).json({ detail: 'Target user was not found' });
    }
    const announcement = {
      announcement_id: `ann_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
      title,
      content,
      author_name: req.user?.name || req.user?.fullName || 'LilyCrest Admin',
      priority: normalizedPriority,
      category: normalizedCategory,
      is_urgent: is_urgent === true || normalizedPriority === 'high',
      is_active: true,
      is_private: is_private || false,
      user_id: targetUserId || null,
      branch: typeof branch === 'string' && branch.trim() ? branch.trim() : null,
      publishedAt: publishDate,
      expiresAt: expiryDate,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.collection('announcements').insertOne(announcement);

    // Push/in-app notification delivery
    let notification_sent = false;
    if (!announcement.is_private) {
      notifyNewAnnouncement(db, announcement).catch(() => {});
      notification_sent = true;
    } else if (announcement.user_id) {
      notifyPrivateAnnouncement(announcement.user_id, announcement).catch(() => {});
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
  // exported for unit testing of branch-visibility rules in isolation
  isAnnouncementVisibleForBranch,
  resolveRequesterBranchCode,
};
