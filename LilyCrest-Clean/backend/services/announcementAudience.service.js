'use strict';

const { ObjectId } = require('mongodb');
const { resolveTenantBranch, normalizedBranchReference } = require('./branchLocation.service');
const { isTenantMobileRole } = require('../utils/tenantEligibility');

const PUBLISH_FIELDS = ['publishedAt', 'publishAt', 'publish_at'];
const EXPIRY_FIELDS = ['expiresAt', 'expiryAt', 'expires_at', 'expiry_at'];
const BRANCH_FIELDS = ['branch', 'branchId', 'branch_id', 'branchCode', 'branch_code'];

function normalizeIdentity(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function getTenantUserId(user = {}) {
  if (!user || typeof user !== 'object') return '';
  return normalizeIdentity(user.user_id || user.userId || user.tenant_id || user.tenantId);
}

function hasTenantAudienceIdentity(user = {}) {
  return Boolean(getTenantUserId(user) && isTenantMobileRole(user?.role));
}

function isTrueFlag(value) {
  return value === true || value === 1 || ['true', '1', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function isFalseFlag(value) {
  return value === false || value === 0 || ['false', '0', 'no'].includes(String(value ?? '').trim().toLowerCase());
}

function isPrivateAnnouncement(announcement = {}) {
  return isTrueFlag(announcement.is_private) || isTrueFlag(announcement.isPrivate);
}

function getPrivateRecipientScope(announcement = {}) {
  const recipients = [...new Set([
    announcement.user_id,
    announcement.userId,
    announcement.recipient_user_id,
    announcement.recipientUserId,
  ].map(normalizeIdentity).filter(Boolean))];
  if (recipients.length === 0) return { recipientId: '', conflict: false };
  if (recipients.length > 1) return { recipientId: '', conflict: true };
  return { recipientId: recipients[0], conflict: false };
}

function getPrivateRecipientId(announcement = {}) {
  return getPrivateRecipientScope(announcement).recipientId;
}

function getAnnouncementId(announcement = {}) {
  return normalizeIdentity(announcement.announcement_id || announcement.announcementId || announcement._id);
}

function valuesForFields(record, fields) {
  return fields
    .filter((field) => Object.prototype.hasOwnProperty.call(record || {}, field))
    .map((field) => record[field])
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function validDateTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function isAnnouncementLifecycleVisible(announcement = {}, now = new Date()) {
  const nowTimestamp = validDateTimestamp(now);
  if (nowTimestamp === null) throw new TypeError('now must be a valid date');

  if (isFalseFlag(announcement.is_active) || isFalseFlag(announcement.isActive) || isFalseFlag(announcement.active)) return false;
  if (isTrueFlag(announcement.isArchived) || isTrueFlag(announcement.is_archived)) return false;
  if (valuesForFields(announcement, ['archivedAt', 'archived_at']).length > 0) return false;
  if (String(announcement.status || '').trim().toLowerCase() === 'archived') return false;

  const publishValues = valuesForFields(announcement, PUBLISH_FIELDS);
  if (publishValues.some((value) => {
    const timestamp = validDateTimestamp(value);
    return timestamp === null || timestamp > nowTimestamp;
  })) return false;

  const expiryValues = valuesForFields(announcement, EXPIRY_FIELDS);
  if (expiryValues.some((value) => {
    const timestamp = validDateTimestamp(value);
    return timestamp === null || timestamp <= nowTimestamp;
  })) return false;

  return true;
}

function branchValue(value) {
  if (value && typeof value === 'object') {
    return value.branchCode || value.branch_code || value.branchId || value.branch_id || value.slug || value._id || '';
  }
  return value;
}

function getAnnouncementBranchScope(announcement = {}) {
  const references = BRANCH_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(announcement, field))
    .map((field) => branchValue(announcement[field]))
    .map((value) => normalizeIdentity(value))
    .filter(Boolean)
    .map(normalizedBranchReference)
    .filter(Boolean);
  const unique = [...new Set(references)];

  if (unique.length === 0) return { restricted: false, branchCode: null, conflict: false };
  if (unique.length > 1) return { restricted: true, branchCode: null, conflict: true };
  return { restricted: true, branchCode: unique[0], conflict: false };
}

function isAnnouncementVisibleForBranch(announcement = {}, requesterBranchCode) {
  const scope = getAnnouncementBranchScope(announcement);
  if (scope.conflict) return false;
  if (!scope.restricted) return true;
  const normalizedRequester = normalizedBranchReference(requesterBranchCode);
  return Boolean(normalizedRequester && normalizedRequester === scope.branchCode);
}

function buildTenantAnnouncementQuery(userOrId) {
  const userId = typeof userOrId === 'object' && userOrId !== null
    ? getTenantUserId(userOrId)
    : normalizeIdentity(userOrId);

  const ownership = {
    $or: [
      { is_private: { $ne: true }, isPrivate: { $ne: true } },
      ...(userId ? [
        { is_private: true, user_id: userId },
        { is_private: true, userId },
        { is_private: true, recipient_user_id: userId },
        { is_private: true, recipientUserId: userId },
        { isPrivate: true, user_id: userId },
        { isPrivate: true, userId },
        { isPrivate: true, recipient_user_id: userId },
        { isPrivate: true, recipientUserId: userId },
      ] : []),
    ],
  };

  // This query only narrows candidates. The canonical predicate below is
  // always applied after loading because legacy documents can contain mixed
  // field names or conflicting fields, which must fail closed.
  return {
    $and: [
      { is_active: { $ne: false } },
      { isActive: { $ne: false } },
      { active: { $ne: false } },
      { isArchived: { $ne: true } },
      { is_archived: { $ne: true } },
      ownership,
    ],
  };
}

async function resolveRequesterBranchCode(db, user) {
  if (!getTenantUserId(user)) return null;
  try {
    const resolved = await resolveTenantBranch(db, user);
    const code = resolved?.branch?.branchCode;
    return code ? normalizedBranchReference(code) : null;
  } catch (_) {
    return null;
  }
}

function isAnnouncementVisibleToTenant(announcement = {}, context = {}, options = {}) {
  const now = options.now || new Date();
  const userId = normalizeIdentity(context.userId || getTenantUserId(context.user));
  if (!userId || !isAnnouncementLifecycleVisible(announcement, now)) return false;

  const privateRecipient = getPrivateRecipientScope(announcement);
  if (privateRecipient.conflict) return false;
  if (isPrivateAnnouncement(announcement) && privateRecipient.recipientId !== userId) return false;

  const branchScope = getAnnouncementBranchScope(announcement);
  if (branchScope.conflict) return false;
  if (!branchScope.restricted) return true;

  const branchCode = normalizeIdentity(context.branchCode)
    ? normalizedBranchReference(context.branchCode)
    : null;
  return Boolean(branchCode && branchCode === branchScope.branchCode);
}

async function filterAnnouncementsForTenant(db, user, announcements = [], options = {}) {
  const now = options.now || new Date();
  const userId = getTenantUserId(user);
  if (!hasTenantAudienceIdentity(user)) return [];

  const lifecycleAndOwnerCandidates = announcements.filter((announcement) => {
    if (!isAnnouncementLifecycleVisible(announcement, now)) return false;
    if (!isPrivateAnnouncement(announcement)) return true;
    const recipient = getPrivateRecipientScope(announcement);
    return !recipient.conflict && recipient.recipientId === userId;
  });
  const needsBranch = lifecycleAndOwnerCandidates.some((announcement) => getAnnouncementBranchScope(announcement).restricted);
  const branchCode = needsBranch ? await resolveRequesterBranchCode(db, user) : null;

  return lifecycleAndOwnerCandidates.filter((announcement) => (
    isAnnouncementVisibleToTenant(announcement, { userId, branchCode }, { now })
  ));
}

async function loadVisibleAnnouncementsForTenant(db, user, options = {}) {
  const userId = getTenantUserId(user);
  if (!hasTenantAudienceIdentity(user)) return [];

  const cursor = db.collection('announcements')
    .find(buildTenantAnnouncementQuery(userId))
    .sort(options.sort || { created_at: -1, createdAt: -1, publishedAt: -1 });
  const candidates = await cursor.toArray();
  const visible = await filterAnnouncementsForTenant(db, user, candidates, options);
  return Number.isInteger(options.limit) && options.limit >= 0
    ? visible.slice(0, options.limit)
    : visible;
}

function getStoredNotificationAnnouncementId(notification = {}) {
  const direct = normalizeIdentity(
    notification.announcement_id
      || notification.announcementId
      || notification.data?.announcement_id
      || notification.data?.announcementId
  );
  if (direct) return direct;

  const entityType = normalizeIdentity(notification.entityType || notification.entity_type).toLowerCase();
  if (entityType === 'announcement') {
    const entityId = normalizeIdentity(notification.entityId || notification.entity_id);
    if (entityId) return entityId;
  }

  const eventKey = normalizeIdentity(notification.event_key || notification.eventKey || notification.dedup_key);
  const match = /^announcement:(.+)$/i.exec(eventKey);
  return match ? normalizeIdentity(match[1]) : '';
}

function isStoredAnnouncementNotification(notification = {}) {
  const type = normalizeIdentity(notification.type || notification.data?.type).toLowerCase();
  const source = normalizeIdentity(notification.source).toLowerCase();
  const entityType = normalizeIdentity(notification.entityType || notification.entity_type).toLowerCase();
  return type === 'announcement' || source === 'announcement' || entityType === 'announcement'
    || Boolean(getStoredNotificationAnnouncementId(notification));
}

function announcementIdentityKeys(announcement = {}) {
  return [...new Set([
    normalizeIdentity(announcement.announcement_id),
    normalizeIdentity(announcement.announcementId),
    normalizeIdentity(announcement._id),
  ].filter(Boolean))];
}

async function loadAnnouncementSourcesByIds(db, ids = []) {
  const normalizedIds = [...new Set(ids.map(normalizeIdentity).filter(Boolean))];
  if (!normalizedIds.length) return [];
  const objectIds = normalizedIds.filter(ObjectId.isValid).map((id) => new ObjectId(id));
  const clauses = [
    { announcement_id: { $in: normalizedIds } },
    { announcementId: { $in: normalizedIds } },
  ];
  if (objectIds.length) clauses.push({ _id: { $in: objectIds } });
  return db.collection('announcements').find({ $or: clauses }).toArray();
}

async function filterStoredNotificationsForTenant(db, user, notifications = [], options = {}) {
  const announcementRows = notifications.filter(isStoredAnnouncementNotification);
  if (!announcementRows.length) return [...notifications];

  const sourceIds = announcementRows.map(getStoredNotificationAnnouncementId).filter(Boolean);
  const sources = await loadAnnouncementSourcesByIds(db, sourceIds);
  const visibleSources = await filterAnnouncementsForTenant(db, user, sources, options);
  const visibleIds = new Set(visibleSources.flatMap(announcementIdentityKeys));

  return notifications.filter((notification) => {
    if (!isStoredAnnouncementNotification(notification)) return true;
    const announcementId = getStoredNotificationAnnouncementId(notification);
    return Boolean(announcementId && visibleIds.has(announcementId));
  });
}

function isActiveTenant(user = {}) {
  if (!hasTenantAudienceIdentity(user)) return false;
  if (isFalseFlag(user.is_active) || isFalseFlag(user.isActive) || isFalseFlag(user.active)) return false;
  return true;
}

async function resolveAnnouncementRecipientUsers(db, announcement, options = {}) {
  const now = options.now || new Date();
  if (!isAnnouncementLifecycleVisible(announcement, now)) return [];

  const privateAnnouncement = isPrivateAnnouncement(announcement);
  const privateRecipient = getPrivateRecipientScope(announcement);
  const targetUserId = privateRecipient.recipientId;
  if (privateAnnouncement && (!targetUserId || privateRecipient.conflict)) return [];

  const query = {
    $and: [
      { is_active: { $ne: false } },
      { isActive: { $ne: false } },
      { active: { $ne: false } },
      { role: { $in: ['tenant', 'resident'] } },
      { $or: [
        { user_id: { $exists: true, $nin: [null, ''] } },
        { userId: { $exists: true, $nin: [null, ''] } },
      ] },
      ...(privateAnnouncement ? [{ $or: [{ user_id: targetUserId }, { userId: targetUserId }] }] : []),
    ],
  };
  const users = (await db.collection('users').find(query).toArray()).filter(isActiveTenant);
  const ownerCandidates = privateAnnouncement
    ? users.filter((user) => getTenantUserId(user) === targetUserId)
    : users;

  const branchScope = getAnnouncementBranchScope(announcement);
  if (branchScope.conflict) return [];
  if (!branchScope.restricted) return ownerCandidates;

  const resolved = await Promise.all(ownerCandidates.map(async (user) => {
    const branchCode = await resolveRequesterBranchCode(db, user);
    return isAnnouncementVisibleToTenant(
      announcement,
      { userId: getTenantUserId(user), branchCode },
      { now }
    ) ? user : null;
  }));
  return resolved.filter(Boolean);
}

module.exports = {
  announcementIdentityKeys,
  buildTenantAnnouncementQuery,
  filterAnnouncementsForTenant,
  filterStoredNotificationsForTenant,
  getAnnouncementBranchScope,
  getAnnouncementId,
  getPrivateRecipientId,
  getPrivateRecipientScope,
  getStoredNotificationAnnouncementId,
  getTenantUserId,
  hasTenantAudienceIdentity,
  isAnnouncementLifecycleVisible,
  isAnnouncementVisibleForBranch,
  isAnnouncementVisibleToTenant,
  isPrivateAnnouncement,
  isStoredAnnouncementNotification,
  loadAnnouncementSourcesByIds,
  loadVisibleAnnouncementsForTenant,
  resolveAnnouncementRecipientUsers,
  resolveRequesterBranchCode,
};
