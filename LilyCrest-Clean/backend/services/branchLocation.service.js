'use strict';

const { ObjectId } = require('mongodb');
const { BRANCH_LOCATION_RECORDS } = require('../config/branchLocationRecords');

const ACTIVE_STAY = /^(active|current|occupied|checked_in)$/i;
const APPROVED = /^(approved|confirmed|active|completed|executed|signed)$/i;

function objectId(value) {
  try { return value && ObjectId.isValid(String(value)) ? new ObjectId(String(value)) : null; } catch (_) { return null; }
}

function identityFilter(user = {}, fieldNames = ['user_id', 'userId', 'tenant_id', 'tenantId']) {
  const values = [
    user.user_id, user.userId, user.tenant_id, user.tenantId,
    user._id, objectId(user._id),
  ].filter(Boolean);
  return { $or: fieldNames.flatMap((field) => values.map((value) => ({ [field]: value }))) };
}

function branchReference(record = {}) {
  const value = record.branchId ?? record.branch_id ?? record.branchCode ?? record.branch_code
    ?? record.branchSlug ?? record.branch_slug ?? record.branch;
  if (value && typeof value === 'object') return value.branchId || value.branchCode || value._id || null;
  return value == null ? null : String(value).trim();
}

function uniqueReferences(records = []) {
  return [...new Set(records.map(branchReference).filter(Boolean).map((reference) => {
    const normalized = String(reference).trim().toLowerCase().replace(/[\s_]+/g, '-');
    return normalized.replace(/^branch-/, '');
  }))];
}

function resolutionError(code, message) {
  return Object.assign(new Error(message), { code, status: code === 'BRANCH_ASSIGNMENT_CONFLICT' ? 409 : 404 });
}

async function findTierRecords(db, user, tier) {
  const identity = identityFilter(user);
  if (!identity.$or.length) return [];
  if (tier === 'current_stay') {
    return db.collection('stays').find({
      $and: [identity, { $or: [{ status: ACTIVE_STAY }, { isActive: true }] }],
    }).sort({ updatedAt: -1, createdAt: -1 }).limit(20).toArray();
  }
  if (tier === 'active_room_assignment') {
    const results = [];
    for (const collectionName of ['room_assignments', 'bedhistories']) {
      try {
        const records = await db.collection(collectionName).find({
          $and: [
            identity,
            { $or: [
              { status: ACTIVE_STAY },
              { isActive: true },
              { $and: [{ moveInDate: { $exists: true } }, { moveOutDate: null }] },
            ] },
          ],
        }).sort({ updatedAt: -1, moveInDate: -1, createdAt: -1 }).limit(20).toArray();
        for (const record of records) {
          if (branchReference(record)) {
            results.push(record);
            continue;
          }
          const roomId = record.roomId || record.room_id;
          if (!roomId) continue;
          const room = await db.collection('rooms').findOne({
            $or: [{ _id: objectId(roomId) || roomId }, { roomId }, { room_id: roomId }],
          });
          if (room) results.push(room);
        }
      } catch (_) {
        // Legacy deployments may not contain both assignment collections.
      }
    }
    return results;
  }
  if (tier === 'approved_contract') {
    return db.collection('reservations').find({
      $and: [
        identity,
        { $or: [{ contractStatus: APPROVED }, { leaseStatus: APPROVED }, { contractApproved: true }] },
      ],
    }).sort({ contractApprovedAt: -1, updatedAt: -1 }).limit(20).toArray();
  }
  return db.collection('reservations').find({
    $and: [
      identity,
      { $or: [{ status: APPROVED }, { applicationStatus: APPROVED }, { approvalStatus: APPROVED }, { isApproved: true }] },
    ],
  }).sort({ approvedAt: -1, updatedAt: -1, createdAt: -1 }).limit(20).toArray();
}

async function findBranch(db, reference) {
  const normalizedReference = String(reference || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  const filters = [
    { branchId: reference }, { branchCode: reference }, { slug: reference },
    { branch_id: reference }, { id: reference },
  ];
  const id = objectId(reference);
  if (id) filters.push({ _id: id });
  const stored = await db.collection('branches').findOne({ $or: filters });
  const canonical = BRANCH_LOCATION_RECORDS.find((record) => (
    record.branchCode.toLowerCase() === normalizedReference
    || `branch_${record.branchCode.replace(/-/g, '_')}` === normalizedReference.replace(/-/g, '_')
  ));
  if (!stored && !canonical) return null;
  if (!canonical) return stored;
  return {
    branchId: stored?.branchId || `BRANCH_${canonical.branchCode.replace(/-/g, '_').toUpperCase()}`,
    ...canonical,
    ...stored,
    branchCode: canonical.branchCode,
    branchName: stored?.branchName || canonical.branchName,
    branchAddress: stored?.branchAddress || canonical.branchAddress,
    googleMapsUrl: stored?.googleMapsUrl || canonical.googleMapsUrl,
    isActive: stored?.isActive !== false && canonical.isActive,
  };
}

function publicBranchLocation(branch) {
  if (!branch) return null;
  const coordinates = branch.coordinates || branch.location || {};
  const latitude = Number(branch.latitude ?? coordinates.latitude);
  const longitude = Number(branch.longitude ?? coordinates.longitude);
  const result = {
    branchId: String(branch.branchId || branch._id || ''),
    branchCode: String(branch.branchCode || branch.slug || '').trim(),
    branchName: String(branch.branchName || branch.displayName || branch.name || '').trim(),
    branchAddress: String(branch.branchAddress || branch.legalAddress?.formattedAddress || branch.address || '').trim(),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    googleMapsUrl: String(branch.googleMapsUrl || '').trim(),
    isActive: branch.isActive === true || String(branch.status || '').toUpperCase() === 'ACTIVE',
  };
  if (!result.branchId || !result.branchCode || !result.branchName || !result.branchAddress || !result.googleMapsUrl) {
    throw resolutionError('BRANCH_LOCATION_INCOMPLETE', 'Branch location is not available yet.');
  }
  if (!result.isActive) throw resolutionError('BRANCH_INACTIVE', 'Branch location is not available yet.');
  return result;
}

async function resolveTenantBranch(db, user = {}) {
  for (const tier of ['current_stay', 'active_room_assignment', 'approved_contract', 'approved_reservation']) {
    const records = await findTierRecords(db, user, tier);
    const references = uniqueReferences(records);
    if (references.length > 1) {
      throw resolutionError('BRANCH_ASSIGNMENT_CONFLICT', 'Multiple branch assignments were found. Please contact the admin office.');
    }
    if (references.length === 1) {
      const branch = await findBranch(db, references[0]);
      if (!branch) throw resolutionError('BRANCH_RECORD_MISSING', 'Branch location is not available yet.');
      return { branch: publicBranchLocation(branch), source: tier };
    }
  }
  throw resolutionError('BRANCH_ASSIGNMENT_MISSING', 'Branch location is not available yet.');
}

module.exports = { branchReference, publicBranchLocation, resolveTenantBranch, uniqueReferences };
