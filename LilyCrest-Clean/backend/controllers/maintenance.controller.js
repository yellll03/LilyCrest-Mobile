const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require('mongodb');
const { getDb } = require('../config/database');
const { notifyMaintenanceStatusChange } = require('../services/pushService');

// Canonical collection used by the website backend (Mongoose model collection).
const PRIMARY_COLLECTION = 'maintenance_requests';

// Legacy collection used by earlier mobile/backend builds.
const LEGACY_COLLECTION = 'maintenancerequests';

// Read from both so old records still appear while new records land in primary.
const COLLECTIONS = [...new Set([PRIMARY_COLLECTION, LEGACY_COLLECTION])];

const ACTIVE_RESERVATION_STATUSES = ['moveIn', 'active', 'completed', 'confirmed'];
const VALID_URGENCIES = ['low', 'normal', 'high'];
const VALID_STATUSES = ['pending', 'viewed', 'in_progress', 'resolved', 'completed', 'rejected', 'cancelled'];

function asObjectId(value) {
  if (!value) return null;
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string' && ObjectId.isValid(value)) {
    return new ObjectId(value);
  }
  return null;
}

function sanitizeBranch(value) {
  if (typeof value !== 'string') return null;
  const branch = value.trim();
  return branch || null;
}

function actorNameFromUser(user) {
  if (!user) return null;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return user.name || user.fullName || fullName || user.email || user.user_id || null;
}

function requestTimestampValue(request) {
  const dt = request?.created_at || request?.createdAt || 0;
  const time = new Date(dt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function stripInternalRequestFields(request) {
  if (!request) return request;
  const clean = { ...request };
  clean._id = undefined;
  delete clean.__source_collection;
  return clean;
}

function normalizeRequestForPrimary(request, user = {}) {
  const now = new Date();
  const normalized = { ...request };

  delete normalized._id;
  delete normalized.__source_collection;

  normalized.request_id = normalized.request_id || `maint_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
  normalized.user_id = normalized.user_id || user.user_id || null;
  if (!normalized.userId && user._id) {
    normalized.userId = asObjectId(user._id) || user._id;
  }

  normalized.request_type = normalized.request_type || 'other';
  normalized.description = normalized.description || '';
  normalized.urgency = VALID_URGENCIES.includes(normalized.urgency) ? normalized.urgency : 'normal';
  normalized.status = normalized.status || 'pending';
  normalized.assigned_to = normalized.assigned_to ?? null;
  normalized.notes = normalized.notes ?? null;
  normalized.reopen_note = normalized.reopen_note ?? null;

  normalized.attachments = Array.isArray(normalized.attachments) ? normalized.attachments : [];
  normalized.reopen_history = Array.isArray(normalized.reopen_history) ? normalized.reopen_history : [];
  normalized.statusHistory = Array.isArray(normalized.statusHistory) ? normalized.statusHistory : [];

  normalized.created_at = normalized.created_at || normalized.createdAt || now;
  normalized.updated_at = normalized.updated_at || normalized.updatedAt || now;
  normalized.createdAt = normalized.createdAt || normalized.created_at;
  normalized.updatedAt = normalized.updatedAt || normalized.updated_at;

  normalized.cancelled_at = normalized.cancelled_at ?? null;
  normalized.reopened_at = normalized.reopened_at ?? null;
  normalized.resolved_at = normalized.resolved_at ?? null;
  normalized.isArchived = typeof normalized.isArchived === 'boolean' ? normalized.isArchived : false;

  normalized.branch = sanitizeBranch(normalized.branch || user.branch || user.branchId) || null;
  normalized.reservationId = normalized.reservationId ?? null;
  normalized.roomId = normalized.roomId ?? null;

  return normalized;
}

async function resolveTenantContext(db, user) {
  const context = {
    branch: sanitizeBranch(user?.branch || user?.branchId),
    reservationId: null,
    roomId: null,
  };

  const mongoId = asObjectId(user?._id);
  if (!mongoId) return context;

  const reservation = await db.collection('reservations').findOne(
    {
      userId: mongoId,
      status: { $in: ACTIVE_RESERVATION_STATUSES },
      isArchived: { $ne: true },
    },
    {
      sort: { createdAt: -1 },
      projection: { _id: 1, roomId: 1, branch: 1 },
    }
  );

  if (reservation) {
    context.branch = sanitizeBranch(reservation.branch) || context.branch;
    context.reservationId = reservation._id || null;
    context.roomId = asObjectId(reservation.roomId) || reservation.roomId || null;
  }

  if (!context.roomId || !context.branch) {
    const bedHistory = await db.collection('bedhistories').findOne(
      { tenantId: mongoId, status: 'active' },
      { sort: { moveInDate: -1 }, projection: { roomId: 1, branch: 1 } }
    );

    if (bedHistory) {
      context.branch = sanitizeBranch(bedHistory.branch) || context.branch;
      context.roomId = context.roomId || asObjectId(bedHistory.roomId) || bedHistory.roomId || null;
    }
  }

  if (!context.roomId || !context.branch) {
    const occupancy = await db.collection('roomoccupancyhistories').findOne(
      { tenantId: mongoId, stayStatus: 'active' },
      { sort: { moveInDate: -1 }, projection: { roomId: 1, branchId: 1 } }
    );

    if (occupancy) {
      context.branch = sanitizeBranch(occupancy.branchId) || context.branch;
      context.roomId = context.roomId || asObjectId(occupancy.roomId) || occupancy.roomId || null;
    }
  }

  if (!context.branch && context.roomId) {
    const roomObjectId = asObjectId(context.roomId);
    const roomFilter = roomObjectId
      ? { _id: roomObjectId }
      : { room_id: String(context.roomId) };

    const room = await db.collection('rooms').findOne(roomFilter, {
      projection: { branch: 1, branchId: 1 },
    });

    context.branch = sanitizeBranch(room?.branch || room?.branchId) || context.branch;
  }

  return context;
}

function dedupeRequests(requests) {
  const map = new Map();

  for (const request of requests) {
    const key = request.request_id || String(request._id);
    const previous = map.get(key);

    if (!previous) {
      map.set(key, request);
      continue;
    }

    // Prefer canonical collection entries when duplicate request_id exists.
    if (
      previous.__source_collection === LEGACY_COLLECTION
      && request.__source_collection === PRIMARY_COLLECTION
    ) {
      map.set(key, request);
    }
  }

  return Array.from(map.values());
}

async function loadRequestsAcrossCollections(db, filter) {
  const records = [];

  for (const collectionName of COLLECTIONS) {
    try {
      const docs = await db.collection(collectionName).find(filter).toArray();
      records.push(...docs.map((doc) => ({ ...doc, __source_collection: collectionName })));
    } catch (_) {
      // Ignore missing legacy collections; keep serving from available source.
    }
  }

  return dedupeRequests(records)
    .sort((left, right) => requestTimestampValue(right) - requestTimestampValue(left));
}

async function findRequestForUser(db, requestId, userId) {
  for (const collectionName of [PRIMARY_COLLECTION, LEGACY_COLLECTION]) {
    try {
      const request = await db.collection(collectionName).findOne({
        request_id: requestId,
        user_id: userId,
      });

      if (request) {
        return { request, collectionName };
      }
    } catch (_) {
      // Continue lookup in other collection.
    }
  }

  return null;
}

async function findRequestForAdmin(db, requestId) {
  for (const collectionName of [PRIMARY_COLLECTION, LEGACY_COLLECTION]) {
    try {
      const request = await db.collection(collectionName).findOne({ request_id: requestId });
      if (request) {
        return { request, collectionName };
      }
    } catch (_) {
      // Continue lookup in other collection.
    }
  }

  return null;
}

async function promoteRequestToPrimary(db, request, user = {}) {
  const normalized = normalizeRequestForPrimary(request, user);

  await db.collection(PRIMARY_COLLECTION).updateOne(
    { request_id: normalized.request_id },
    { $set: normalized },
    { upsert: true }
  );

  return db.collection(PRIMARY_COLLECTION).findOne({ request_id: normalized.request_id });
}

// Get user's maintenance requests
async function getMyMaintenance(req, res) {
  try {
    const db = getDb();
    const userId = req.user.user_id;
    const mongoId = asObjectId(req.user._id);
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

    const filter = {
      $or: [
        { user_id: userId },
        ...(mongoId ? [{ userId: mongoId }] : []),
      ],
    };

    if (status) {
      filter.status = status;
    }

    const requests = await loadRequestsAcrossCollections(db, filter);
    res.json(requests.map(stripInternalRequestFields));
  } catch (error) {
    console.error('Get maintenance error:', error);
    res.status(500).json({ detail: 'Failed to fetch maintenance requests' });
  }
}

// Create maintenance request
async function createMaintenance(req, res) {
  try {
    const db = getDb();
    const requestType = typeof req.body?.request_type === 'string'
      ? req.body.request_type.trim()
      : '';
    const description = typeof req.body?.description === 'string'
      ? req.body.description.trim()
      : '';
    const urgencyRaw = typeof req.body?.urgency === 'string'
      ? req.body.urgency.trim().toLowerCase()
      : 'normal';
    const attachmentsRaw = req.body?.attachments;

    if (!requestType) {
      return res.status(400).json({ detail: 'request_type is required' });
    }
    if (!description) {
      return res.status(400).json({ detail: 'description is required' });
    }

    const urgency = VALID_URGENCIES.includes(urgencyRaw) ? urgencyRaw : 'normal';
    const attachments = Array.isArray(attachmentsRaw)
      ? attachmentsRaw
        .map((entry) => ({
          name: typeof entry?.name === 'string' ? entry.name.trim() : '',
          uri: typeof entry?.uri === 'string' ? entry.uri.trim() : '',
          type: typeof entry?.type === 'string' ? entry.type.trim() : '',
        }))
        .filter((entry) => entry.name && entry.uri && entry.type)
      : [];

    const tenantContext = await resolveTenantContext(db, req.user);
    const now = new Date();

    const newRequest = normalizeRequestForPrimary(
      {
        request_id: `maint_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
        user_id: req.user.user_id,
        ...(req.user._id ? { userId: asObjectId(req.user._id) || req.user._id } : {}),
        request_type: requestType,
        description,
        urgency,
        status: 'pending',
        assigned_to: null,
        notes: null,
        attachments,
        reopen_note: null,
        reopen_history: [],
        statusHistory: [
          {
            event: 'submitted',
            status: 'pending',
            actor_id: req.user.user_id || null,
            actor_name: actorNameFromUser(req.user),
            actor_role: req.user.role || null,
            note: null,
            timestamp: now,
          },
        ],
        branch: tenantContext.branch,
        reservationId: tenantContext.reservationId,
        roomId: tenantContext.roomId,
        isArchived: false,
        created_at: now,
        updated_at: now,
        createdAt: now,
        updatedAt: now,
      },
      req.user,
    );

    await db.collection(PRIMARY_COLLECTION).insertOne(newRequest);
    res.status(201).json(stripInternalRequestFields(newRequest));
  } catch (error) {
    console.error('Create maintenance error:', error);
    res.status(500).json({ detail: 'Failed to create maintenance request' });
  }
}

// Update maintenance request (only when pending)
async function updateMaintenance(req, res) {
  try {
    const { requestId } = req.params;
    const { request_type, description, urgency } = req.body;
    const db = getDb();

    const located = await findRequestForUser(db, requestId, req.user.user_id);
    if (!located) {
      return res.status(404).json({ detail: 'Request not found' });
    }
    if ((located.request.status || '').toLowerCase() !== 'pending') {
      return res.status(400).json({ detail: 'Only pending requests can be edited' });
    }

    const updates = { updated_at: new Date(), updatedAt: new Date() };

    if (typeof request_type === 'string' && request_type.trim()) {
      updates.request_type = request_type.trim();
    }
    if (description !== undefined) {
      updates.description = typeof description === 'string' ? description.trim() : '';
    }
    if (typeof urgency === 'string' && VALID_URGENCIES.includes(urgency.trim().toLowerCase())) {
      updates.urgency = urgency.trim().toLowerCase();
    }

    await db.collection(located.collectionName).updateOne(
      { request_id: requestId },
      { $set: updates }
    );

    const updatedSource = await db.collection(located.collectionName).findOne({ request_id: requestId });
    const updated = await promoteRequestToPrimary(db, updatedSource, req.user)
      .catch(() => updatedSource);
    res.json(stripInternalRequestFields(updated));
  } catch (error) {
    console.error('Update maintenance error:', error);
    res.status(500).json({ detail: 'Failed to update maintenance request' });
  }
}

// Cancel maintenance request (only when pending)
async function cancelMaintenance(req, res) {
  try {
    const { requestId } = req.params;
    const db = getDb();

    const located = await findRequestForUser(db, requestId, req.user.user_id);
    if (!located) {
      return res.status(404).json({ detail: 'Request not found' });
    }
    if ((located.request.status || '').toLowerCase() !== 'pending') {
      return res.status(400).json({ detail: 'Only pending requests can be cancelled' });
    }

    const now = new Date();
    const statusHistory = Array.isArray(located.request.statusHistory)
      ? [...located.request.statusHistory]
      : [];
    statusHistory.push({
      event: 'cancelled',
      status: 'cancelled',
      actor_id: req.user.user_id || null,
      actor_name: actorNameFromUser(req.user),
      actor_role: req.user.role || null,
      note: null,
      timestamp: now,
    });

    await db.collection(located.collectionName).updateOne(
      { request_id: requestId },
      {
        $set: {
          status: 'cancelled',
          cancelled_at: now,
          statusHistory,
          updated_at: now,
          updatedAt: now,
        },
      }
    );

    const updatedSource = await db.collection(located.collectionName).findOne({ request_id: requestId });
    const updated = await promoteRequestToPrimary(db, updatedSource, req.user)
      .catch(() => updatedSource);
    res.json(stripInternalRequestFields(updated));
  } catch (error) {
    console.error('Cancel maintenance error:', error);
    res.status(500).json({ detail: 'Failed to cancel maintenance request' });
  }
}

// Reopen a resolved/completed request
async function reopenMaintenance(req, res) {
  try {
    const { requestId } = req.params;
    const { reopen_note } = req.body;
    const db = getDb();

    const located = await findRequestForUser(db, requestId, req.user.user_id);
    if (!located) {
      return res.status(404).json({ detail: 'Request not found' });
    }

    const reopenableStatuses = ['resolved', 'completed'];
    if (!reopenableStatuses.includes((located.request.status || '').toLowerCase())) {
      return res.status(400).json({ detail: 'Only resolved or completed requests can be reopened' });
    }

    const now = new Date();
    const note = typeof reopen_note === 'string' && reopen_note.trim()
      ? reopen_note.trim()
      : null;

    const reopenHistory = Array.isArray(located.request.reopen_history)
      ? [...located.request.reopen_history]
      : [];
    reopenHistory.push({
      reopened_at: now,
      previous_status: located.request.status,
      note,
    });

    const statusHistory = Array.isArray(located.request.statusHistory)
      ? [...located.request.statusHistory]
      : [];
    statusHistory.push({
      event: 'reopened',
      status: 'pending',
      actor_id: req.user.user_id || null,
      actor_name: actorNameFromUser(req.user),
      actor_role: req.user.role || null,
      note,
      timestamp: now,
    });

    await db.collection(located.collectionName).updateOne(
      { request_id: requestId },
      {
        $set: {
          status: 'pending',
          reopen_note: note,
          reopen_history: reopenHistory,
          reopened_at: now,
          statusHistory,
          updated_at: now,
          updatedAt: now,
        },
      }
    );

    const updatedSource = await db.collection(located.collectionName).findOne({ request_id: requestId });
    const updated = await promoteRequestToPrimary(db, updatedSource, req.user)
      .catch(() => updatedSource);
    res.json(stripInternalRequestFields(updated));
  } catch (error) {
    console.error('Reopen maintenance error:', error);
    res.status(500).json({ detail: 'Failed to reopen maintenance request' });
  }
}

// Admin: update maintenance request status and notify tenant
async function adminUpdateStatus(req, res) {
  try {
    const { requestId } = req.params;
    const { status, notes, assigned_to } = req.body;
    const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : '';

    if (!normalizedStatus || !VALID_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({ detail: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const db = getDb();
    const located = await findRequestForAdmin(db, requestId);
    if (!located) {
      return res.status(404).json({ detail: 'Request not found' });
    }

    const now = new Date();
    const statusHistory = Array.isArray(located.request.statusHistory)
      ? [...located.request.statusHistory]
      : [];
    statusHistory.push({
      event: 'status_changed',
      status: normalizedStatus,
      actor_id: req.user?.user_id || null,
      actor_name: actorNameFromUser(req.user),
      actor_role: req.user?.role || null,
      note: typeof notes === 'string' ? notes.trim() : null,
      timestamp: now,
    });

    const updates = {
      status: normalizedStatus,
      statusHistory,
      updated_at: now,
      updatedAt: now,
    };

    if (notes !== undefined) {
      updates.notes = typeof notes === 'string' ? notes.trim() : null;
    }
    if (assigned_to !== undefined) {
      updates.assigned_to = typeof assigned_to === 'string' ? assigned_to.trim() : null;
    }
    if (['resolved', 'completed'].includes(normalizedStatus)) {
      updates.resolved_at = now;
    }
    if (['pending', 'viewed', 'in_progress'].includes(normalizedStatus)) {
      updates.cancelled_at = null;
    }

    await db.collection(located.collectionName).updateOne(
      { request_id: requestId },
      { $set: updates }
    );

    const updatedSource = await db.collection(located.collectionName).findOne({ request_id: requestId });
    const updated = await promoteRequestToPrimary(db, updatedSource, req.user)
      .catch(() => updatedSource);

    // Notify the tenant (non-blocking)
    notifyMaintenanceStatusChange(updated?.user_id || located.request.user_id, updated || located.request, normalizedStatus)
      .catch(() => {});

    res.json(stripInternalRequestFields(updated));
  } catch (error) {
    console.error('Admin update maintenance status error:', error);
    res.status(500).json({ detail: 'Failed to update maintenance request status' });
  }
}

// Admin: get all maintenance requests
async function adminGetAll(req, res) {
  try {
    const db = getDb();
    const { status, user_id, request_type, urgency, branch } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (user_id) filter.user_id = user_id;
    if (request_type) filter.request_type = request_type;
    if (urgency) filter.urgency = urgency;
    if (branch) filter.branch = branch;

    const requests = await loadRequestsAcrossCollections(db, filter);
    res.json(requests.map(stripInternalRequestFields));
  } catch (error) {
    console.error('Admin get maintenance error:', error);
    res.status(500).json({ detail: 'Failed to fetch maintenance requests' });
  }
}

module.exports = {
  getMyMaintenance,
  createMaintenance,
  updateMaintenance,
  cancelMaintenance,
  reopenMaintenance,
  adminUpdateStatus,
  adminGetAll,
};
