const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require('mongodb');
const { getDb } = require('../config/database');

// The client-visible announcement_id is either the explicit field set at
// creation (`ann_<hex>`, see createAnnouncement) or, for older documents
// that predate that field, normalizeAnnouncement()'s fallback to
// `doc._id.toString()` (a raw 24-char ObjectId hex string). Dismiss lookups
// must resolve both forms the same way the list endpoint generates them, or
// a legacy announcement becomes permanently un-dismissible.
function announcementIdFilter(id) {
  const clauses = [{ announcement_id: id }];
  if (ObjectId.isValid(id)) clauses.push({ _id: new ObjectId(id) });
  return { $or: clauses };
}
const { BRANCH_LOCATION_RECORDS } = require('../config/branchLocationRecords');
const { normalizedBranchReference } = require('../services/branchLocation.service');
const { deliverAnnouncementById } = require('../services/announcementDelivery.service');
const {
  filterAnnouncementsForTenant,
  getTenantUserId,
  hasTenantAudienceIdentity,
  loadVisibleAnnouncementsForTenant,
  resolveRequesterBranchCode,
} = require('../services/announcementAudience.service');

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

function announcementLifecycleStatus(doc = {}, now = new Date()) {
  if (
    doc.is_active === false
    || doc.isActive === false
    || doc.isArchived === true
    || doc.is_archived === true
    || doc.archivedAt
    || doc.archived_at
    || String(doc.status || '').toLowerCase() === 'archived'
  ) return 'archived';
  const publishAt = doc.publishedAt || doc.publishAt || doc.publish_at;
  const expiresAt = doc.expiresAt || doc.expiryAt || doc.expires_at || doc.expiry_at;
  const nowTime = now.getTime();
  if (publishAt && new Date(publishAt).getTime() > nowTime) return 'scheduled';
  if (expiresAt && new Date(expiresAt).getTime() <= nowTime) return 'expired';
  return 'active';
}

function normalizeAdminAnnouncement(doc, now = new Date()) {
  return {
    ...normalizeAnnouncement(doc),
    is_private: doc.is_private === true || doc.isPrivate === true,
    user_id: doc.user_id || doc.userId || null,
    branch: normalizedBranchReference(doc.branch || doc.branchId || doc.branch_id || '') || null,
    publish_at: doc.publishedAt || doc.publishAt || doc.publish_at || null,
    expires_at: doc.expiresAt || doc.expiryAt || doc.expires_at || doc.expiry_at || null,
    lifecycle_status: announcementLifecycleStatus(doc, now),
    delivery: {
      status: doc.delivery?.status || 'legacy',
      attempts: Number(doc.delivery?.attempts || 0),
      recipient_count: Number(doc.delivery?.recipientCount || 0),
      completed_at: doc.delivery?.completedAt || null,
      last_error: doc.delivery?.lastError || null,
    },
  };
}

function parsePageValue(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function adminLifecycleFilter(status, now) {
  const notArchived = {
    $and: [
      { is_active: { $ne: false } },
      { isActive: { $ne: false } },
      { isArchived: { $ne: true } },
      { is_archived: { $ne: true } },
      { $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }] },
      { $or: [{ archived_at: { $exists: false } }, { archived_at: null }] },
      { status: { $nin: ['archived', 'Archived', 'ARCHIVED'] } },
    ],
  };
  const published = { $or: [
    { publishedAt: { $exists: false } },
    { publishedAt: null },
    { publishedAt: { $lte: now } },
  ] };
  const unexpired = { $or: [
    { expiresAt: { $exists: false } },
    { expiresAt: null },
    { expiresAt: { $gt: now } },
  ] };

  if (status === 'archived') return { $nor: [notArchived] };
  if (status === 'scheduled') return { $and: [notArchived, { publishedAt: { $gt: now } }] };
  if (status === 'expired') return { $and: [notArchived, { expiresAt: { $lte: now } }] };
  if (status === 'active') return { $and: [notArchived, published, unexpired] };
  return {};
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
    const userId = getTenantUserId(req.user);
    if (!userId) return res.status(401).json({ detail: 'Authentication is required.' });
    if (!hasTenantAudienceIdentity(req.user)) return res.status(403).json({ detail: 'Tenant access is required.' });
    const dismissedIds = new Set((await db.collection('announcement_dismissals')
      .find({ user_id: userId })
      .project({ announcement_id: 1 })
      .toArray()
      .catch(() => []))
      .map((entry) => String(entry.announcement_id || '')).filter(Boolean));

    const announcements = await loadVisibleAnnouncementsForTenant(db, req.user);

    const normalizedAnnouncements = announcements.map(normalizeAnnouncement);
    const dedupedAnnouncements = [];
    const seen = new Set();

    announcements.forEach((doc, index) => {
      const normalized = normalizedAnnouncements[index];
      if (normalized.announcement_id && dismissedIds.has(normalized.announcement_id)) return;
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

async function getAdminAnnouncements(req, res) {
  try {
    const db = getDb();
    const now = new Date();
    const page = parsePageValue(req.query?.page, 1, 100000);
    const limit = parsePageValue(req.query?.limit, 25, 100);
    const status = String(req.query?.status || '').trim().toLowerCase();
    const search = String(req.query?.search || '').trim().slice(0, 80);
    if (status && !['active', 'scheduled', 'expired', 'archived'].includes(status)) {
      return res.status(400).json({ detail: 'status must be active, scheduled, expired, or archived' });
    }

    const clauses = [];
    const lifecycle = adminLifecycleFilter(status, now);
    if (Object.keys(lifecycle).length) clauses.push(lifecycle);
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      clauses.push({ $or: [{ title: pattern }, { content: pattern }, { announcement_id: pattern }] });
    }
    const query = clauses.length ? { $and: clauses } : {};
    const collection = db.collection('announcements');
    const [items, total] = await Promise.all([
      collection.find(query)
        .sort({ publishedAt: -1, created_at: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return res.json({
      items: items.map((item) => normalizeAdminAnnouncement(item, now)),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error('getAdminAnnouncements error:', error);
    return res.status(500).json({ detail: 'Failed to fetch admin announcements' });
  }
}

async function getAdminAnnouncementOptions(req, res) {
  try {
    const db = getDb();
    const search = String(req.query?.search || '').trim().slice(0, 80);
    const query = {
      $and: [
        { role: { $in: ['tenant', 'resident'] } },
        { is_active: { $ne: false } },
        { isActive: { $ne: false } },
        { active: { $ne: false } },
        ...(search ? [{ $or: [
          { name: new RegExp(escapeRegex(search), 'i') },
          { fullName: new RegExp(escapeRegex(search), 'i') },
          { email: new RegExp(escapeRegex(search), 'i') },
          { user_id: new RegExp(escapeRegex(search), 'i') },
        ] }] : []),
      ],
    };
    const tenants = await db.collection('users')
      .find(query, { projection: { _id: 1, user_id: 1, userId: 1, name: 1, fullName: 1, email: 1, role: 1 } })
      .sort({ name: 1, fullName: 1, user_id: 1 })
      .limit(100)
      .toArray();
    const tenantOptions = await Promise.all(tenants.map(async (tenant) => ({
      user_id: getTenantUserId(tenant),
      name: String(tenant.name || tenant.fullName || tenant.email || getTenantUserId(tenant)).trim(),
      email: String(tenant.email || '').trim() || null,
      branch: await resolveRequesterBranchCode(db, tenant),
    })));
    return res.json({
      branches: BRANCH_LOCATION_RECORDS
        .filter((branch) => branch.isActive !== false)
        .map((branch) => ({ code: branch.branchCode, name: branch.branchName })),
      tenants: tenantOptions.filter((tenant) => tenant.user_id),
    });
  } catch (error) {
    console.error('getAdminAnnouncementOptions error:', error);
    return res.status(500).json({ detail: 'Failed to fetch announcement audience options' });
  }
}

async function setAnnouncementLifecycle(req, res) {
  try {
    const announcementId = String(req.params?.announcementId || '').trim();
    const action = String(req.body?.action || '').trim().toLowerCase();
    if (!announcementId) return res.status(400).json({ detail: 'announcementId is required' });
    if (!['archive', 'activate', 'retry_delivery'].includes(action)) {
      return res.status(400).json({ detail: 'action must be archive, activate, or retry_delivery' });
    }

    const db = getDb();
    const collection = db.collection('announcements');
    const existing = await collection.findOne(announcementIdFilter(announcementId));
    if (!existing) return res.status(404).json({ detail: 'Announcement not found' });
    const stableId = existing.announcement_id || String(existing._id);
    const now = new Date();

    if (action === 'archive') {
      await collection.updateOne(
        { _id: existing._id },
        {
          $set: {
            is_active: false,
            isArchived: true,
            status: 'archived',
            archivedAt: now,
            'delivery.cancelledAt': now,
            updated_at: now,
          },
        },
      );
    } else {
      if (action === 'retry_delivery' && announcementLifecycleStatus(existing, now) === 'archived') {
        return res.status(409).json({ detail: 'Activate the announcement before retrying delivery.' });
      }
      const expiry = existing.expiresAt || existing.expires_at;
      if (expiry && new Date(expiry).getTime() <= now.getTime()) {
        return res.status(409).json({ detail: 'Expired announcements cannot be activated or delivered again.' });
      }
      const alreadyDelivered = Boolean(existing.delivery?.completedAt || existing.delivery?.status === 'delivered');
      const publishTime = new Date(existing.publishedAt || existing.publish_at || now).getTime();
      const nextDeliveryStatus = alreadyDelivered
        ? 'delivered'
        : publishTime > now.getTime() ? 'scheduled' : 'pending';
      await collection.updateOne(
        { _id: existing._id },
        {
          $set: {
            is_active: true,
            isArchived: false,
            status: 'active',
            'delivery.status': nextDeliveryStatus,
            'delivery.updatedAt': now,
            updated_at: now,
          },
          $unset: {
            archivedAt: '',
            archived_at: '',
            'delivery.cancelledAt': '',
            'delivery.lastError': '',
            'delivery.leaseExpiresAt': '',
          },
        },
      );
      if (!alreadyDelivered && publishTime <= now.getTime()) {
        try { await deliverAnnouncementById(db, stableId, { now }); } catch (error) {
          console.warn(`[AnnouncementDelivery] Manual ${action} queued for retry:`, error?.message);
        }
      }
    }

    const updated = await collection.findOne({ _id: existing._id });
    return res.json(normalizeAdminAnnouncement(updated, new Date()));
  } catch (error) {
    console.error('setAnnouncementLifecycle error:', error);
    return res.status(500).json({ detail: 'Failed to update announcement lifecycle' });
  }
}

// Admin: create a new announcement and push-notify all tenants
async function createAnnouncement(req, res) {
  try {
    const {
      priority,
      category,
      is_urgent,
      is_private,
      user_id: targetUserId,
      branch,
      publish_at,
      expires_at,
      client_request_id: clientRequestId,
    } = req.body;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    const normalizedPriority = String(priority || 'normal').trim().toLowerCase();
    const normalizedCategory = String(category || 'General').trim();
    const allowedPriorities = ['low', 'normal', 'high'];
    const allowedCategories = ['General', 'Account', 'Announcement', 'Billing', 'Maintenance', 'Security', 'Reservation', 'Rules', 'Promo', 'Event', 'Emergency'];
    if (!title || title.length > 120) return res.status(400).json({ detail: 'title is required and must be 120 characters or fewer' });
    if (!content || content.length > 5000) return res.status(400).json({ detail: 'content is required and must be 5000 characters or fewer' });
    if (!allowedPriorities.includes(normalizedPriority)) return res.status(400).json({ detail: `priority must be one of: ${allowedPriorities.join(', ')}` });
    if (!allowedCategories.includes(normalizedCategory)) return res.status(400).json({ detail: `category must be one of: ${allowedCategories.join(', ')}` });
    if (is_private !== undefined && typeof is_private !== 'boolean') return res.status(400).json({ detail: 'is_private must be a boolean' });
    if (is_urgent !== undefined && typeof is_urgent !== 'boolean') return res.status(400).json({ detail: 'is_urgent must be a boolean' });
    const normalizedClientRequestId = String(clientRequestId || '').trim();
    if (normalizedClientRequestId && !/^[a-zA-Z0-9_-]{8,100}$/.test(normalizedClientRequestId)) {
      return res.status(400).json({ detail: 'client_request_id must be 8-100 letters, numbers, underscores, or hyphens' });
    }
    const publishDate = publish_at ? new Date(publish_at) : new Date();
    const expiryDate = expires_at ? new Date(expires_at) : null;
    if (Number.isNaN(publishDate.getTime()) || (expiryDate && Number.isNaN(expiryDate.getTime()))) return res.status(400).json({ detail: 'publish_at and expires_at must be valid dates' });
    if (expiryDate && expiryDate <= publishDate) return res.status(400).json({ detail: 'expires_at must be after publish_at' });

    const db = getDb();
    const normalizedTargetUserId = targetUserId ? String(targetUserId).trim() : '';
    if (is_private === true && !normalizedTargetUserId) return res.status(400).json({ detail: 'user_id is required for a private announcement' });
    if (is_private !== true && normalizedTargetUserId) return res.status(400).json({ detail: 'user_id is only valid for a private announcement' });
    const normalizedBranch = normalizedBranchReference(branch);
    const allowedBranchCodes = new Set(BRANCH_LOCATION_RECORDS
      .filter((record) => record.isActive !== false)
      .map((record) => normalizedBranchReference(record.branchCode)));
    if (branch && (!normalizedBranch || !allowedBranchCodes.has(normalizedBranch))) {
      return res.status(400).json({ detail: 'branch must be an active canonical LilyCrest branch' });
    }

    const creatorUserId = String(req.user?.user_id || '').trim();
    if (normalizedClientRequestId) {
      const existingRequest = await db.collection('announcements').findOne({
        created_by: creatorUserId,
        client_request_id: normalizedClientRequestId,
      });
      if (existingRequest) {
        return res.status(200).json({
          ...normalizeAdminAnnouncement(existingRequest),
          notification_sent: existingRequest.delivery?.status === 'delivered',
          idempotent_replay: true,
        });
      }
    }

    let target = null;
    if (normalizedTargetUserId) {
      target = await db.collection('users').findOne({
        $or: [{ user_id: normalizedTargetUserId }, { userId: normalizedTargetUserId }],
      });
      if (!target || !hasTenantAudienceIdentity(target) || target.is_active === false || target.isActive === false) {
        return res.status(400).json({ detail: 'Target tenant was not found or is inactive' });
      }
    }
    if (target && normalizedBranch) {
      const targetBranch = await resolveRequesterBranchCode(db, target);
      if (!targetBranch || targetBranch !== normalizedBranch) {
        return res.status(400).json({ detail: 'The private target is not eligible for the selected branch.' });
      }
    }
    const now = new Date();
    const immediatelyDue = publishDate.getTime() <= now.getTime();
    const announcement = {
      announcement_id: `ann_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
      title,
      content,
      author_name: req.user?.name || req.user?.fullName || 'LilyCrest Admin',
      priority: normalizedPriority,
      category: normalizedCategory,
      is_urgent: is_urgent === true || normalizedPriority === 'high',
      is_active: true,
      is_private: is_private === true,
      user_id: normalizedTargetUserId || null,
      branch: normalizedBranch || null,
      publishedAt: publishDate,
      expiresAt: expiryDate,
      created_by: creatorUserId,
      ...(normalizedClientRequestId ? { client_request_id: normalizedClientRequestId } : {}),
      delivery: {
        status: immediatelyDue ? 'pending' : 'scheduled',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      },
      created_at: now,
      updated_at: now,
    };

    try {
      await db.collection('announcements').insertOne(announcement);
    } catch (error) {
      if (error?.code === 11000 && normalizedClientRequestId) {
        const replay = await db.collection('announcements').findOne({
          created_by: creatorUserId,
          client_request_id: normalizedClientRequestId,
        });
        if (replay) {
          return res.status(200).json({
            ...normalizeAdminAnnouncement(replay),
            notification_sent: replay.delivery?.status === 'delivered',
            idempotent_replay: true,
          });
        }
      }
      throw error;
    }

    if (immediatelyDue) {
      try {
        await deliverAnnouncementById(db, announcement.announcement_id, { now });
      } catch (error) {
        console.warn(`[AnnouncementDelivery] Immediate delivery queued for retry:`, error?.message);
      }
    }
    const persisted = await db.collection('announcements').findOne({ announcement_id: announcement.announcement_id }) || announcement;
    return res.status(201).json({
      ...normalizeAdminAnnouncement(persisted),
      notification_sent: persisted.delivery?.status === 'delivered',
      idempotent_replay: false,
    });
  } catch (error) {
    console.error('createAnnouncement error:', error);
    res.status(500).json({ detail: 'Failed to create announcement' });
  }
}

// Hide one announcement from this tenant's News tab only. Writes a per-tenant
// junction row (announcement_dismissals) — never deletes or mutates the
// shared `announcements` document, so admin content stays intact for audit
// and for every other tenant, and the Home bell (which tracks its own
// separate notification_dismissals) is unaffected.
async function dismissAnnouncement(req, res) {
  const userId = req.user?.user_id;
  const announcementId = String(req.params.announcementId || '').trim();
  if (!announcementId) return res.status(400).json({ detail: 'announcementId is required.' });
  const db = getDb();
  const exists = await db.collection('announcements').findOne(announcementIdFilter(announcementId));
  const visible = exists ? await filterAnnouncementsForTenant(db, req.user, [exists]) : [];
  if (!visible.length) return res.status(404).json({ detail: 'Announcement not found.' });
  await db.collection('announcement_dismissals').updateOne(
    { user_id: userId, announcement_id: announcementId },
    { $set: { dismissed_at: new Date() }, $setOnInsert: { created_at: new Date() } },
    { upsert: true },
  );
  return res.json({ status: 'dismissed', announcement_id: announcementId });
}

// Exact inverse of dismissAnnouncement: removes this tenant's dismissal row
// so the announcement reappears in their News tab. Backs the "Undo" toast the
// News tab shows immediately after a dismiss. Like dismiss, it only ever
// touches the per-tenant announcement_dismissals junction — the shared
// `announcements` document is never read-modified-written here, so a restore
// can neither resurrect nor alter admin content.
//
// Idempotent: restoring an announcement that was never dismissed is a no-op
// success, so a retried/duplicated Undo cannot fail. `restored` reports
// whether a dismissal row actually existed.
async function restoreAnnouncement(req, res) {
  const userId = req.user?.user_id;
  const announcementId = String(req.params.announcementId || '').trim();
  if (!announcementId) return res.status(400).json({ detail: 'announcementId is required.' });
  const db = getDb();
  const exists = await db.collection('announcements').findOne(announcementIdFilter(announcementId));
  const visible = exists ? await filterAnnouncementsForTenant(db, req.user, [exists]) : [];
  if (!visible.length) return res.status(404).json({ detail: 'Announcement not found.' });
  const result = await db.collection('announcement_dismissals').deleteOne({
    user_id: userId,
    announcement_id: announcementId,
  });
  return res.json({
    status: 'restored',
    announcement_id: announcementId,
    restored: (result?.deletedCount || 0) > 0,
  });
}

// Matches both id forms getAllAnnouncements can hand back: the explicit
// `ann_<hex>` field set at creation, or a legacy doc's raw ObjectId string.
const ANNOUNCEMENT_ID_PATTERN = /^(ann_[a-f0-9]{1,32}|[a-f0-9]{24})$/i;
const MAX_BULK_DISMISS_IDS = 100;

// Multi-select delete for the News tab. Same per-tenant junction write as
// dismissAnnouncement, just batched. Validates every entry up front —
// well-formed AND actually an existing announcement — and rejects the whole
// request on any bad id rather than silently dropping it or writing
// dismissal rows for ids that don't exist.
async function dismissAnnouncementsBulk(req, res) {
  const userId = req.user?.user_id;
  const rawIds = req.body?.ids;
  if (!Array.isArray(rawIds) || !rawIds.length) {
    return res.status(400).json({ detail: 'ids must be a non-empty array.' });
  }
  if (rawIds.length > MAX_BULK_DISMISS_IDS) {
    return res.status(400).json({ detail: `ids must contain ${MAX_BULK_DISMISS_IDS} or fewer entries.` });
  }
  if (!rawIds.every((id) => typeof id === 'string' && ANNOUNCEMENT_ID_PATTERN.test(id.trim()))) {
    return res.status(400).json({ detail: 'ids must all be valid announcement ids.' });
  }
  const ids = [...new Set(rawIds.map((id) => id.trim()))];

  const db = getDb();
  const existing = await db.collection('announcements').find({
    $or: ids.flatMap((id) => [{ announcement_id: id }, ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : [])]),
  }).toArray();
  const visible = await filterAnnouncementsForTenant(db, req.user, existing);
  const visibleIds = new Set(visible.flatMap((announcement) => [
    String(announcement.announcement_id || ''),
    String(announcement._id || ''),
  ].filter(Boolean)));
  if (ids.some((id) => !visibleIds.has(id))) {
    return res.status(400).json({ detail: 'One or more ids do not match an existing announcement.' });
  }

  const now = new Date();
  const operations = ids.map((announcementId) => ({
    updateOne: {
      filter: { user_id: userId, announcement_id: announcementId },
      update: { $set: { dismissed_at: now }, $setOnInsert: { created_at: now } },
      upsert: true,
    },
  }));
  await db.collection('announcement_dismissals').bulkWrite(operations);
  return res.json({ status: 'dismissed', announcement_ids: ids });
}

module.exports = {
  getAllAnnouncements,
  getAdminAnnouncements,
  getAdminAnnouncementOptions,
  createAnnouncement,
  setAnnouncementLifecycle,
  dismissAnnouncement,
  restoreAnnouncement,
  dismissAnnouncementsBulk,
  __test: { announcementLifecycleStatus, normalizeAdminAnnouncement, adminLifecycleFilter },
};
