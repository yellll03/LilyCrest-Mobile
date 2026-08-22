'use strict';

const path = require('node:path');

function argumentValue(argv, name) {
  const inline = argv.find((value) => String(value).startsWith(`${name}=`));
  if (inline) return String(inline).slice(name.length + 1).trim();
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? String(argv[index + 1]).trim() : '';
}

const argv = process.argv.slice(2);
const envFile = argumentValue(argv, '--env-file');
require('dotenv').config(envFile ? { path: path.resolve(envFile) } : undefined);

const { MongoClient, ObjectId } = require('mongodb');
const {
  announcementIdentityKeys,
  filterAnnouncementsForTenant,
  getPrivateRecipientScope,
  getStoredNotificationAnnouncementId,
  getTenantUserId,
  hasTenantAudienceIdentity,
  isAnnouncementLifecycleVisible,
  isPrivateAnnouncement,
  isStoredAnnouncementNotification,
  loadAnnouncementSourcesByIds,
} = require('../services/announcementAudience.service');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'lilycrest_db';

function parseArgs(values) {
  return {
    apply: values.includes('--apply'),
    help: values.includes('--help') || values.includes('-h'),
  };
}

function printUsage() {
  console.log('Usage: npm run announcements:audit-notification-audience -- [--env-file <path>] [--apply]');
  console.log('Default mode is read-only. --apply deletes only rows proven ineligible by the canonical audience resolver.');
}

function notificationSourceQuery() {
  return {
    $or: [
      { source: 'announcement' },
      { type: 'announcement' },
      { announcement_id: { $exists: true, $nin: [null, ''] } },
      { 'data.announcement_id': { $exists: true, $nin: [null, ''] } },
      { event_key: /^announcement:/i },
      { entityType: 'announcement' },
      { entity_type: 'announcement' },
    ],
  };
}

function notificationRecipientReference(notification = {}) {
  return String(
    notification.user_id
      || notification.userId
      || notification.tenant_id
      || notification.tenantId
      || notification.recipient_id
      || notification.recipientId
      || ''
  ).trim();
}

function userIdentityKeys(user = {}) {
  return [...new Set([
    getTenantUserId(user),
    String(user?._id || '').trim(),
    String(user?.userId || '').trim(),
  ].filter(Boolean))];
}

function sourceMap(announcements = []) {
  const map = new Map();
  announcements.forEach((announcement) => {
    announcementIdentityKeys(announcement).forEach((key) => map.set(key, announcement));
  });
  return map;
}

function reasonForIneligible(source, user, now) {
  if (!source) return 'source_not_found';
  if (!user || !getTenantUserId(user)) return 'tenant_not_found';
  if (!hasTenantAudienceIdentity(user)) return 'tenant_not_eligible';
  if (!isAnnouncementLifecycleVisible(source, now)) return 'lifecycle_not_visible';
  if (isPrivateAnnouncement(source)) {
    const recipient = getPrivateRecipientScope(source);
    if (recipient.conflict || recipient.recipientId !== getTenantUserId(user)) return 'private_recipient_ineligible';
  }
  return 'branch_ineligible';
}

async function auditAnnouncementNotificationAudience(db, options = {}) {
  const apply = options.apply === true;
  const now = options.now || new Date();
  const notificationRows = (await db.collection('notifications').find(notificationSourceQuery()).toArray())
    .filter(isStoredAnnouncementNotification);
  const sourceIds = [...new Set(notificationRows.map(getStoredNotificationAnnouncementId).filter(Boolean))];
  const sources = await loadAnnouncementSourcesByIds(db, sourceIds);
  const sourcesById = sourceMap(sources);
  const tenantReferences = [...new Set(notificationRows.map(notificationRecipientReference).filter(Boolean))];
  const objectIdReferences = tenantReferences
    .filter((value) => ObjectId.isValid(value))
    .map((value) => new ObjectId(value));
  const users = tenantReferences.length
    ? await db.collection('users').find({
      $or: [
        { user_id: { $in: tenantReferences } },
        { userId: { $in: tenantReferences } },
        ...(objectIdReferences.length ? [{ _id: { $in: objectIdReferences } }] : []),
      ],
    }).toArray()
    : [];
  const usersById = new Map(users.flatMap((user) => userIdentityKeys(user).map((key) => [key, user])));
  const rowsByUser = new Map();
  notificationRows.forEach((row) => {
    const userId = notificationRecipientReference(row);
    if (!rowsByUser.has(userId)) rowsByUser.set(userId, []);
    rowsByUser.get(userId).push(row);
  });

  const affected = [];
  for (const [userId, rows] of rowsByUser.entries()) {
    const user = usersById.get(userId);
    const userSources = [...new Set(rows
      .map((row) => sourcesById.get(getStoredNotificationAnnouncementId(row)))
      .filter(Boolean))];
    const visibleSources = user
      ? await filterAnnouncementsForTenant(db, user, userSources, { now })
      : [];
    const visibleIds = new Set(visibleSources.flatMap(announcementIdentityKeys));

    rows.forEach((row) => {
      const id = getStoredNotificationAnnouncementId(row);
      const source = sourcesById.get(id);
      if (id && visibleIds.has(id)) return;
      affected.push({ row, reason: reasonForIneligible(source, user, now) });
    });
  }

  const countsByReason = affected.reduce((counts, entry) => {
    counts[entry.reason] = (counts[entry.reason] || 0) + 1;
    return counts;
  }, {
    source_not_found: 0,
    tenant_not_found: 0,
    tenant_not_eligible: 0,
    lifecycle_not_visible: 0,
    private_recipient_ineligible: 0,
    branch_ineligible: 0,
  });
  let deletedRows = 0;
  if (apply && affected.length) {
    const ids = affected.map((entry) => entry.row._id).filter(Boolean);
    if (ids.length) {
      const result = await db.collection('notifications').deleteMany({ _id: { $in: ids } });
      deletedRows = result.deletedCount || 0;
    }
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    scannedAnnouncementNotificationRows: notificationRows.length,
    eligibleRows: notificationRows.length - affected.length,
    affectedRows: affected.length,
    affectedTenants: new Set(affected.map((entry) => notificationRecipientReference(entry.row)).filter(Boolean)).size,
    countsByReason,
    deletedRows,
    idempotentApply: true,
  };
}

async function main() {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return;
  }

  const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const result = await auditAnnouncementNotificationAudience(client.db(DB_NAME), { apply: args.apply });
    console.log(JSON.stringify(result, null, 2));
    if (!args.apply && result.affectedRows > 0) {
      console.log('No rows changed. Review the counts, then rerun with --apply only after approval.');
    }
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[AnnouncementAudienceAudit] Failed:', error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  auditAnnouncementNotificationAudience,
  notificationSourceQuery,
  parseArgs,
};
