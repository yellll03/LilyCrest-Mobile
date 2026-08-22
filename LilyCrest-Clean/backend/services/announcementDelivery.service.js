'use strict';

const { notifyNewAnnouncement } = require('./pushService');

const DELIVERY_LEASE_MS = 2 * 60 * 1000;
const DEFAULT_SWEEP_LIMIT = 50;

function unwrapMongoDocument(result) {
  return result?.value ?? result ?? null;
}

function announcementIdentityFilter(announcementId) {
  return { announcement_id: String(announcementId || '').trim() };
}

function dueDeliveryFilter(now = new Date(), announcementId = '') {
  const deliveryStates = [
    { 'delivery.status': { $in: ['pending', 'scheduled', 'failed'] } },
    { 'delivery.status': 'processing', 'delivery.leaseExpiresAt': { $lt: now } },
  ];
  return {
    ...(announcementId ? announcementIdentityFilter(announcementId) : {}),
    is_active: { $ne: false },
    isActive: { $ne: false },
    isArchived: { $ne: true },
    is_archived: { $ne: true },
    $and: [
      { $or: [{ publishedAt: { $exists: false } }, { publishedAt: null }, { publishedAt: { $lte: now } }] },
      { $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }] },
      { $or: deliveryStates },
    ],
  };
}

async function deliverAnnouncementById(db, announcementId, { now = new Date() } = {}) {
  const announcements = db.collection('announcements');
  const claimed = unwrapMongoDocument(await announcements.findOneAndUpdate(
    dueDeliveryFilter(now, announcementId),
    {
      $set: {
        'delivery.status': 'processing',
        'delivery.processingStartedAt': now,
        'delivery.leaseExpiresAt': new Date(now.getTime() + DELIVERY_LEASE_MS),
        'delivery.updatedAt': now,
        updated_at: now,
      },
      $inc: { 'delivery.attempts': 1 },
      $unset: { 'delivery.lastError': '' },
    },
    { returnDocument: 'after' },
  ));

  if (!claimed) {
    const current = await announcements.findOne(announcementIdentityFilter(announcementId));
    return {
      claimed: false,
      status: current?.delivery?.status || 'not_due',
      recipientCount: current?.delivery?.recipientCount || 0,
    };
  }

  try {
    const recipientCount = await notifyNewAnnouncement(db, claimed);
    const completedAt = new Date();
    const completed = await announcements.updateOne(
      { ...announcementIdentityFilter(announcementId), 'delivery.status': 'processing' },
      {
        $set: {
          'delivery.status': 'delivered',
          'delivery.recipientCount': Number(recipientCount || 0),
          'delivery.completedAt': completedAt,
          'delivery.updatedAt': completedAt,
          updated_at: completedAt,
        },
        $unset: { 'delivery.leaseExpiresAt': '', 'delivery.lastError': '' },
      },
    );
    if (completed.matchedCount !== 1) {
      throw new Error(`Announcement ${announcementId} lost its delivery lease`);
    }
    return { claimed: true, status: 'delivered', recipientCount: Number(recipientCount || 0) };
  } catch (error) {
    const failedAt = new Date();
    await announcements.updateOne(
      announcementIdentityFilter(announcementId),
      {
        $set: {
          'delivery.status': 'failed',
          'delivery.lastError': String(error?.message || error).slice(0, 500),
          'delivery.failedAt': failedAt,
          'delivery.updatedAt': failedAt,
          updated_at: failedAt,
        },
        $unset: { 'delivery.leaseExpiresAt': '' },
      },
    );
    throw error;
  }
}

async function runAnnouncementDeliverySweep(db, { now = new Date(), limit = DEFAULT_SWEEP_LIMIT } = {}) {
  const candidates = await db.collection('announcements')
    .find(dueDeliveryFilter(now), { projection: { _id: 0, announcement_id: 1 } })
    .sort({ publishedAt: 1, created_at: 1 })
    .limit(Math.max(1, Math.min(Number(limit) || DEFAULT_SWEEP_LIMIT, 200)))
    .toArray();

  const results = [];
  for (const candidate of candidates) {
    const announcementId = String(candidate.announcement_id || '').trim();
    if (!announcementId) continue;
    try {
      results.push({ announcementId, ...(await deliverAnnouncementById(db, announcementId, { now })) });
    } catch (error) {
      results.push({ announcementId, status: 'failed', error: String(error?.message || error) });
    }
  }
  return results;
}

module.exports = {
  DELIVERY_LEASE_MS,
  deliverAnnouncementById,
  dueDeliveryFilter,
  runAnnouncementDeliverySweep,
};
