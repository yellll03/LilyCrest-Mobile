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
const MAX_PROGRESS_ATTACHMENTS = 4;
const MAX_PROGRESS_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TENANT_ATTACHMENTS = 4;
const MAX_TENANT_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const LOCAL_ONLY_URI_PATTERN = /^(?:file|content|ph|assets-library|blob|ms-appdata):\/\/|^\/data\/user\/|^\/storage\/|^\/private\/var\/|^\/var\/mobile\/|(?:^|[\\/])cache(?:[\\/]|$)/i;
const IMAGE_ATTACHMENT_NAME_PATTERN = /\.(png|jpe?g|gif|webp|bmp|heic|heif)(?:\?.*)?$/i;

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

function getDecodedBase64Bytes(value = '') {
  const raw = String(value || '').replace(/^data:[^;]+;base64,/, '');
  if (!raw) return 0;
  const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
  return Math.floor((raw.length * 3) / 4) - padding;
}

function isLocalOnlyAttachmentUri(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized || /^https?:\/\//i.test(normalized)) {
    return false;
  }
  return LOCAL_ONLY_URI_PATTERN.test(normalized);
}

function validateAttachmentUri(uri, { allowDataImage = false } = {}) {
  const normalized = String(uri || '').trim();

  if (!normalized) {
    return { ok: false, error: 'Attachment URL is required.' };
  }

  if (isLocalOnlyAttachmentUri(normalized)) {
    return {
      ok: false,
      error: 'Attachments must be uploaded before submission. Local device paths are not allowed.',
    };
  }

  if (/^https:\/\//i.test(normalized)) {
    return { ok: true, value: normalized };
  }

  if (allowDataImage && /^data:image\//i.test(normalized)) {
    return { ok: true, value: normalized };
  }

  return {
    ok: false,
    error: allowDataImage
      ? 'Attachments must use HTTPS upload URLs or image data URLs.'
      : 'Attachments must use uploaded HTTPS URLs.',
  };
}

function attachmentUrlFromEntry(entry = {}) {
  return typeof entry?.downloadUrl === 'string' && entry.downloadUrl.trim()
    ? entry.downloadUrl.trim()
    : typeof entry?.uri === 'string'
      ? entry.uri.trim()
      : '';
}

function attachmentNameFromEntry(entry = {}, fallback = 'attachment') {
  const name = typeof entry?.originalName === 'string' && entry.originalName.trim()
    ? entry.originalName.trim()
    : typeof entry?.name === 'string' && entry.name.trim()
      ? entry.name.trim()
      : fallback;
  return name.replace(/[<>]/g, '').slice(0, 180);
}

function attachmentMimeTypeFromEntry(entry = {}, fallback = 'application/octet-stream') {
  const type = typeof entry?.mimeType === 'string' && entry.mimeType.trim()
    ? entry.mimeType.trim()
    : typeof entry?.type === 'string' && entry.type.trim()
      ? entry.type.trim()
      : fallback;
  return type.slice(0, 120);
}

function attachmentProviderFromEntry(entry = {}, url = '') {
  if (typeof entry?.provider === 'string' && entry.provider.trim()) {
    return entry.provider.trim().slice(0, 80);
  }
  return /firebasestorage(?:\.googleapis\.com|\.app)/i.test(url) ? 'firebase-storage' : 'https-url';
}

function isImageTenantAttachment({ downloadUrl = '', originalName = '', mimeType = '' } = {}) {
  return String(mimeType || '').toLowerCase().startsWith('image/')
    || IMAGE_ATTACHMENT_NAME_PATTERN.test(String(originalName || ''))
    || IMAGE_ATTACHMENT_NAME_PATTERN.test(String(downloadUrl || '').split('?')[0]);
}

function normalizeProgressAttachments(rawAttachments) {
  if (!Array.isArray(rawAttachments)) return { attachments: [], error: null };

  const attachments = rawAttachments
    .slice(0, MAX_PROGRESS_ATTACHMENTS)
    .map((entry, index) => {
      const uri = typeof entry?.uri === 'string' ? entry.uri.trim() : '';
      const name = typeof entry?.name === 'string' && entry.name.trim()
        ? entry.name.trim()
        : `progress-photo-${index + 1}.jpg`;
      const type = typeof entry?.type === 'string' && entry.type.trim()
        ? entry.type.trim()
        : 'image/jpeg';
      const uriCheck = validateAttachmentUri(uri, { allowDataImage: true });

      if (!uriCheck.ok) {
        return { error: uriCheck.error };
      }
      if (/^data:image\//i.test(uriCheck.value) && getDecodedBase64Bytes(uriCheck.value) > MAX_PROGRESS_ATTACHMENT_BYTES) {
        return { error: 'Progress photo exceeds the 5 MB limit.' };
      }

      return { name, uri: uriCheck.value, type };
    });

  const invalidEntry = attachments.find((entry) => entry?.error);
  if (invalidEntry?.error) {
    return { attachments: [], error: invalidEntry.error };
  }

  return {
    attachments: attachments.filter(Boolean),
    error: null,
  };
}

function normalizeTenantAttachments(rawAttachments) {
  if (!Array.isArray(rawAttachments)) return { attachments: [], error: null };
  if (rawAttachments.length > MAX_TENANT_ATTACHMENTS) {
    return { attachments: [], error: `You can upload up to ${MAX_TENANT_ATTACHMENTS} maintenance photos only.` };
  }

  const attachments = rawAttachments.map((entry, index) => {
    const downloadUrl = attachmentUrlFromEntry(entry);
    const originalName = attachmentNameFromEntry(entry, `attachment-${index + 1}`);
    const mimeType = attachmentMimeTypeFromEntry(entry);
    const storagePath = typeof entry?.storagePath === 'string' ? entry.storagePath.trim().slice(0, 500) : '';
    const uriCheck = validateAttachmentUri(downloadUrl);

    if (!uriCheck.ok) {
      return { error: uriCheck.error };
    }

    const size = Number(entry?.size);
    const provider = attachmentProviderFromEntry(entry, uriCheck.value);
    if (provider !== 'firebase-storage') {
      return { error: 'Maintenance attachments must be uploaded to Firebase Storage.' };
    }
    if (!/firebasestorage(?:\.googleapis\.com|\.app)/i.test(uriCheck.value)) {
      return { error: 'Maintenance attachments must use Firebase Storage download URLs.' };
    }
    if (!storagePath) {
      return { error: 'Maintenance attachment storagePath is required.' };
    }
    if (!isImageTenantAttachment({ downloadUrl: uriCheck.value, originalName, mimeType })) {
      return { error: 'Maintenance attachments must be image files.' };
    }
    if (Number.isFinite(size) && size > MAX_TENANT_ATTACHMENT_BYTES) {
      return { error: 'Maintenance attachment exceeds the 5 MB limit.' };
    }

    return {
      downloadUrl: uriCheck.value,
      storagePath,
      originalName,
      mimeType,
      size: Number.isFinite(size) ? size : null,
      uploadedAt: entry?.uploadedAt ? new Date(entry.uploadedAt) : new Date(),
      provider,
    };
  });

  const invalidEntry = attachments.find((entry) => entry?.error);
  if (invalidEntry?.error) {
    return { attachments: [], error: invalidEntry.error };
  }

  return {
    attachments: attachments.filter(Boolean),
    error: null,
  };
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

function buildUserMaintenanceFilter(user, extraFilter = {}) {
  const userId = user?.user_id;
  const mongoId = asObjectId(user?._id);

  return {
    ...extraFilter,
    $or: [
      ...(userId ? [{ user_id: userId }] : []),
      ...(mongoId ? [{ userId: mongoId }] : []),
    ],
  };
}

async function countActiveMaintenanceForUser(db, user) {
  const filter = buildUserMaintenanceFilter(user, {
    status: { $in: ['pending', 'viewed', 'in_progress'] },
  });

  if (!filter.$or.length) return 0;

  const requests = await loadRequestsAcrossCollections(db, filter);
  return requests.length;
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
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const filter = buildUserMaintenanceFilter(req.user, status ? { status } : {});

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
    const { attachments, error: attachmentError } = normalizeTenantAttachments(attachmentsRaw);
    if (attachmentError) {
      return res.status(400).json({ detail: attachmentError });
    }

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
    const { attachments: progressAttachments, error: progressAttachmentError } = normalizeProgressAttachments(
      req.body?.progress_attachments !== undefined
        ? req.body.progress_attachments
        : req.body?.attachments
    );
    if (progressAttachmentError) {
      return res.status(400).json({ detail: progressAttachmentError });
    }

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
      attachments: progressAttachments,
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
  countActiveMaintenanceForUser,
};
