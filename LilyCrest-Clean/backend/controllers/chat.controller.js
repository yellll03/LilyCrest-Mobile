const { ObjectId } = require('mongodb');
const { getDb } = require('../config/database');
const { resolveTenantBranch, normalizedBranchReference } = require('../services/branchLocation.service');
const { authorizeTenantStorageObject } = require('../services/documentStorageAuthorization.service');
const { resolveStorageBucket, admin } = require('../config/firebase');
const {
  CHAT_ATTACHMENT_COLLECTION,
  buildAttachmentUrl,
  createChatAttachment,
  findConversationAttachment,
  findConversationAttachments,
  serializeAttachmentRecord,
} = require('../services/chatAttachment.service');
const {
  MAX_SUPPORT_ATTACHMENTS,
  SUPPORT_ATTACHMENT_FOLDER,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_MIME_TYPES,
} = require('../constants/supportAttachments');

// Matches chatbot.controller.js's MAX_CHAT_MESSAGE_CHARS and the single
// client-side cap the mobile UI already applies to both the AI assistant and
// human support composer — this used to be 1000 while chatbot.controller.js
// was 800, silently allowing longer human-support messages than the UI ever
// exposed a way to send.
const MAX_MESSAGE_CHARS = 800;
const ACTIVE_CONVERSATION_STATUSES = ['open', 'in_review', 'waiting_tenant', 'resolved'];
const ADMIN_LISTABLE_STATUSES = new Set(['open', 'in_review', 'waiting_tenant', 'resolved', 'closed']);
const VALID_CATEGORIES = new Set([
  'billing_concern',
  'maintenance_concern',
  'reservation_concern',
  'payment_concern',
  'general_inquiry',
  'urgent_issue',
]);
const VALID_PRIORITIES = new Set(['normal', 'high', 'urgent']);
const ADMIN_ROLES = new Set(['admin', 'superadmin']);

// Support-chat attachments reuse the one durable storage pipeline this
// backend already has: the client uploads bytes through
// POST /upload/firebase-storage (which derives the tenant path segment
// server-side from req.user and enforces its own MIME/size ceilings against
// the decoded buffer), then registers the returned metadata here. Nothing
// about the bytes is trusted from the client at this step — only the
// server-issued downloadUrl/storagePath pair, re-proven below to be this
// caller's own object via the same authorizeTenantStorageObject invariant
// the /users/documents pipeline uses. There is deliberately no second
// storage system and no multipart parser.
//
// The count/size/MIME limits themselves live in ../constants/supportAttachments
// so this controller, the compose UI and the admin repository all state the
// same numbers in one named place each rather than as scattered literals.

function createHttpError(message, statusCode = 400, code = 'CHAT_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function sendError(res, error, fallback = 'Failed to process support chat request.') {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    console.error('[Support Chat] Controller error:', error);
  }
  return res.status(statusCode).json({
    error: statusCode >= 500 ? fallback : error.message,
    code: error.code || 'CHAT_ERROR',
  });
}

function displayName(user, fallback = 'Tenant') {
  if (!user || typeof user !== 'object') return fallback;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return user.name || user.fullName || fullName || user.email || user.user_id || fallback;
}

function asObjectId(value) {
  if (!value) return null;
  try {
    const candidate = typeof value?.toHexString === 'function'
      ? value.toHexString()
      : String(value);
    return ObjectId.isValid(candidate) ? new ObjectId(candidate) : null;
  } catch (_error) {
    return null;
  }
}

function buildTenantConversationFilter(user = {}) {
  const filters = [];
  const userId = typeof user.user_id === 'string' ? user.user_id.trim() : '';
  const objectId = asObjectId(user._id);
  const objectIdString = objectId ? objectId.toHexString() : '';

  if (objectId) {
    filters.push({ tenantId: objectId });
    filters.push({ userId: objectId });
  }
  if (objectIdString) {
    filters.push({ tenantId: objectIdString });
    filters.push({ userId: objectIdString });
  }
  if (userId) {
    filters.push({ tenantUserId: userId });
    filters.push({ user_id: userId });
  }

  return filters.length ? { $or: filters } : { _id: null };
}

function sanitizeBranch(value) {
  if (typeof value !== 'string') return null;
  const branch = value.trim();
  return branch || null;
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeMessage(rawMessage) {
  if (typeof rawMessage !== 'string') {
    throw createHttpError('Message cannot be empty.', 400, 'EMPTY_MESSAGE');
  }
  const message = rawMessage.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
  if (!message) {
    throw createHttpError('Message cannot be empty.', 400, 'EMPTY_MESSAGE');
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    throw createHttpError(`Message must be ${MAX_MESSAGE_CHARS} characters or fewer.`, 400, 'MESSAGE_TOO_LONG');
  }
  return message;
}

// Validates one already-uploaded attachment's metadata and proves the object
// belongs to the caller. Fails closed on anything ambiguous.
function normalizeSupportAttachment(entry, userId) {
  const downloadUrl = String(entry?.downloadUrl || entry?.uri || '').trim();
  const storagePath = String(entry?.storagePath || '').trim().slice(0, 500);
  const mimeType = String(entry?.mimeType || entry?.type || '').trim().toLowerCase();
  const originalName = String(entry?.originalName || entry?.name || 'attachment').trim().slice(0, 200);
  const size = Number(entry?.size);

  if (!downloadUrl || !storagePath) {
    throw createHttpError('Attachment storage details are required.', 400, 'ATTACHMENT_INVALID');
  }
  if (!SUPPORT_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    throw createHttpError('Support attachments must be a JPG, PNG, WebP, HEIC/HEIF image, or PDF.', 400, 'ATTACHMENT_UNSUPPORTED_TYPE');
  }
  // Reject outright when size is missing or non-numeric — a client must not be
  // able to bypass the cap by omitting the field the upload endpoint returned.
  if (!Number.isFinite(size) || size <= 0 || size > SUPPORT_ATTACHMENT_MAX_BYTES) {
    throw createHttpError(
      `Attachment exceeds the ${Math.round(SUPPORT_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB limit.`,
      400,
      'ATTACHMENT_TOO_LARGE'
    );
  }

  const authorization = authorizeTenantStorageObject({
    downloadUrl,
    storagePath,
    userId,
    configuredBucket: resolveStorageBucket(),
    folder: SUPPORT_ATTACHMENT_FOLDER,
  });
  if (!authorization.authorized) {
    throw createHttpError('Attachment storage location could not be verified.', 400, 'ATTACHMENT_UNAUTHORIZED');
  }

  return {
    downloadUrl,
    storagePath,
    originalName,
    mimeType,
    size,
    provider: 'firebase-storage',
    uploadedAt: new Date(),
  };
}

// Resolves the attachment ids a message references back to canonical
// `chat_attachments` records **bound to this exact conversation**. A message
// therefore never carries storage coordinates of its own: it carries an
// immutable id, and the record is the only thing that knows where the bytes
// are. Substituting an attachment from another conversation (or an id that
// does not exist) fails here rather than at read time.
async function normalizeSupportAttachments(db, conversation, rawAttachments) {
  if (rawAttachments === undefined || rawAttachments === null) return [];
  if (!Array.isArray(rawAttachments)) {
    throw createHttpError('Attachments must be a list.', 400, 'ATTACHMENT_INVALID');
  }
  if (!rawAttachments.length) return [];
  if (rawAttachments.length > MAX_SUPPORT_ATTACHMENTS) {
    throw createHttpError(`You can attach up to ${MAX_SUPPORT_ATTACHMENTS} files per message.`, 400, 'ATTACHMENT_LIMIT');
  }

  const ids = rawAttachments
    .map((entry) => String(entry?.attachmentId || entry?.id || '').trim())
    .filter(Boolean);
  if (ids.length !== rawAttachments.length || ids.some((id) => !ObjectId.isValid(id))) {
    throw createHttpError('Upload each attachment before sending it.', 400, 'INVALID_CHAT_ATTACHMENT');
  }

  const records = await findConversationAttachments(db, conversation._id, ids);
  const byId = new Map(records.map((record) => [String(record._id), record]));
  if (byId.size !== new Set(ids).size || byId.size !== ids.length) {
    throw createHttpError('An attachment does not belong to this conversation.', 403, 'ATTACHMENT_ACCESS_DENIED');
  }

  // Only an id plus presentation fields is embedded — same embed shape the
  // admin repository's ChatMessage schema already defines.
  return ids.map((id) => {
    const record = byId.get(id);
    const url = buildAttachmentUrl(conversation._id, id);
    return {
      attachmentId: record._id,
      url,
      fileUrl: url,
      name: record.originalName,
      fileName: record.originalName,
      type: record.mimeType,
      mimeType: record.mimeType,
      size: record.size,
    };
  });
}

// Client-facing attachment shape. `url` is always the protected app route;
// no storage path, bucket or provider download URL ever leaves the server.
function serializeAttachment(embedded = {}, conversationId = '') {
  const attachmentId = embedded.attachmentId ? String(embedded.attachmentId) : '';
  const url = attachmentId ? buildAttachmentUrl(conversationId, attachmentId) : '';
  const name = embedded.name || embedded.fileName || 'attachment';
  const mimeType = embedded.mimeType || embedded.type || 'application/octet-stream';
  return {
    attachmentId,
    id: attachmentId,
    name,
    fileName: name,
    originalName: name,
    mimeType,
    type: mimeType,
    size: Number.isFinite(Number(embedded.size)) ? Number(embedded.size) : 0,
    url,
    fileUrl: url,
  };
}

function normalizeCategory(rawCategory) {
  const normalized = String(rawCategory || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!VALID_CATEGORIES.has(normalized)) {
    return 'general_inquiry';
  }
  return normalized;
}

function normalizePriority(rawPriority, category = 'general_inquiry') {
  const normalized = String(rawPriority || '').trim().toLowerCase();
  if (VALID_PRIORITIES.has(normalized)) {
    return normalized;
  }
  return category === 'urgent_issue' ? 'urgent' : 'normal';
}

function serializeConversation(doc = {}) {
  return {
    id: doc._id ? String(doc._id) : '',
    tenantId: doc.tenantId ? String(doc.tenantId) : '',
    tenantUserId: doc.tenantUserId || '',
    tenantName: doc.tenantName || '',
    tenantEmail: doc.tenantEmail || '',
    branch: doc.branch || '',
    roomNumber: doc.roomNumber || '',
    roomBed: doc.roomBed || '',
    status: doc.status || 'open',
    category: doc.category || 'general_inquiry',
    priority: doc.priority || 'normal',
    assignedAdminId: doc.assignedAdminId ? String(doc.assignedAdminId) : '',
    assignedAdminName: doc.assignedAdminName || '',
    lastMessage: doc.lastMessage || '',
    lastMessageAt: doc.lastMessageAt || null,
    unreadAdminCount: Number(doc.unreadAdminCount || 0),
    unreadTenantCount: Number(doc.unreadTenantCount || 0),
    closedAt: doc.closedAt || null,
    closedBy: doc.closedBy ? String(doc.closedBy) : null,
    closingNote: doc.closingNote || '',
    statusHistory: Array.isArray(doc.statusHistory)
      ? doc.statusHistory.map((entry) => ({
          status: entry.status,
          note: entry.note || '',
          actorId: entry.actorId ? String(entry.actorId) : null,
          actorName: entry.actorName || '',
          createdAt: entry.createdAt || null,
        }))
      : [],
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    assistantSessionId: doc.assistantSessionId || '',
  };
}

function serializeMessage(doc = {}) {
  return {
    id: doc._id ? String(doc._id) : '',
    conversationId: doc.conversationId ? String(doc.conversationId) : '',
    senderId: doc.senderId ? String(doc.senderId) : '',
    senderUserId: doc.senderUserId || '',
    senderName: doc.senderName || '',
    senderRole: doc.senderRole || 'tenant',
    message: doc.message || '',
    attachments: Array.isArray(doc.attachments)
      ? doc.attachments
          .map((entry) => serializeAttachment(entry, doc.conversationId))
          // A legacy pre-contract embed has no attachment id and therefore no
          // resolvable protected route. Drop it rather than emit a half-shape
          // the clients would render as a permanently broken tile.
          .filter((entry) => Boolean(entry.attachmentId))
      : [],
    readAt: doc.readAt || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

async function resolveTenantContext(db, user) {
  const context = {
    user,
    branch: sanitizeBranch(user?.branch || user?.branchId),
    roomNumber: '',
    roomBed: '',
  };

  // Uses the same multi-tier lookup (current stay, active room assignment,
  // approved contract, approved reservation) that chatbot.controller.js's
  // general Q&A already relies on, so "Talk to Admin" can resolve a branch
  // for every tenant whose branch the AI assistant can already resolve.
  try {
    const resolvedBranch = await resolveTenantBranch(db, user);
    context.branch = resolvedBranch.branch.branchCode || context.branch;
  } catch (_) {
    // Fall through to the narrower reservation/bed-history lookups below.
  }

  if (user?._id) {
    const reservation = await db.collection('reservations').findOne(
      { userId: user._id, status: { $in: ['moveIn', 'active', 'completed', 'payment_pending', 'confirmed', 'paid'] } },
      { sort: { createdAt: -1 } }
    );

    if (reservation) {
      context.branch = context.branch || sanitizeBranch(reservation.branch);
      const roomDoc = reservation.roomId
        ? await db.collection('rooms').findOne({ _id: asObjectId(reservation.roomId) || reservation.roomId })
        : null;
      context.roomNumber = roomDoc?.roomNumber || reservation.roomNumber || reservation.roomName || '';
      context.roomBed = reservation.selectedBed?.position || reservation.selectedBed?.label || reservation.selectedBed?.id || '';
      if (context.branch) return context;
    }
  }

  const bedHistory = await db.collection('bedhistories').findOne(
    { userId: user?._id },
    { sort: { moveInDate: -1 } }
  );

  if (bedHistory) {
    context.branch = context.branch || sanitizeBranch(bedHistory.branch);
    if (!context.roomNumber) {
      const roomDoc = bedHistory.roomId
        ? await db.collection('rooms').findOne({ _id: asObjectId(bedHistory.roomId) || bedHistory.roomId })
        : null;
      context.roomNumber = roomDoc?.roomNumber || '';
      const bed = roomDoc?.beds?.find((item) => item.id === bedHistory.bedId);
      context.roomBed = bed?.position || bedHistory.bedId || '';
    }
  }

  // Normalize whichever tier produced context.branch (canonical branchCode,
  // raw reservation/bed-history string, or the user's own branch field) to
  // the same lowercase-hyphen code so it lines up with the normalized
  // comparison used for admin-branch matching below.
  context.branch = normalizedBranchReference(context.branch) || context.branch;

  if (!context.branch) {
    throw createHttpError('Unable to determine tenant branch for support chat.', 400, 'BRANCH_REQUIRED');
  }

  return context;
}

async function autoAssignConversation(db, conversation) {
  const candidates = await db.collection('users').find({
    role: { $in: Array.from(ADMIN_ROLES) },
  }).toArray();

  const conversationBranch = normalizedBranchReference(conversation.branch);
  const eligible = candidates.filter((user) => {
    const role = String(user.role || '').toLowerCase();
    if (!ADMIN_ROLES.has(role)) return false;
    if (role === 'superadmin') return true;
    return normalizedBranchReference(user.branch || user.branchId) === conversationBranch;
  });

  if (!eligible.length) return conversation;

  const candidateIds = eligible.map((user) => user._id).filter(Boolean);
  const workload = await db.collection('chat_conversations').aggregate([
    {
      $match: {
        assignedAdminId: { $in: candidateIds },
        status: { $in: ACTIVE_CONVERSATION_STATUSES },
      },
    },
    { $group: { _id: '$assignedAdminId', count: { $sum: 1 } } },
  ]).toArray();

  const counts = new Map(workload.map((entry) => [String(entry._id), entry.count]));
  eligible.sort((left, right) => {
    const leftCount = counts.get(String(left._id)) || 0;
    const rightCount = counts.get(String(right._id)) || 0;
    if (leftCount !== rightCount) return leftCount - rightCount;
    return displayName(left).localeCompare(displayName(right));
  });

  const chosen = eligible[0];
  if (!chosen?._id) return conversation;

  await db.collection('chat_conversations').updateOne(
    { _id: conversation._id },
    {
      $set: {
        assignedAdminId: chosen._id,
        assignedAdminName: displayName(chosen, 'Admin'),
        updatedAt: new Date(),
      },
    }
  );

  conversation.assignedAdminId = chosen._id;
  conversation.assignedAdminName = displayName(chosen, 'Admin');
  return conversation;
}

async function findConversationForTenant(db, conversationId, user) {
  const _id = asObjectId(conversationId);
  if (!_id) {
    throw createHttpError('Conversation not found.', 404, 'CONVERSATION_NOT_FOUND');
  }

  const conversation = await db.collection('chat_conversations').findOne({
    _id,
    ...buildTenantConversationFilter(user),
  });

  if (!conversation) {
    throw createHttpError('Conversation not found.', 404, 'CONVERSATION_NOT_FOUND');
  }

  return conversation;
}

function buildAdminConversationFilter(user, requestedStatus) {
  const filter = {};
  const normalizedStatus = String(requestedStatus || '').trim().toLowerCase();
  if (normalizedStatus && ADMIN_LISTABLE_STATUSES.has(normalizedStatus)) {
    filter.status = normalizedStatus;
  }

  if (normalizeRole(user?.role) === 'owner' || normalizeRole(user?.role) === 'superadmin') {
    return filter;
  }

  const adminBranch = normalizedBranchReference(user?.branch || user?.branchId) || null;
  const adminObjectId = asObjectId(user?._id);
  const clauses = [];

  if (adminBranch) {
    clauses.push({ branch: adminBranch });
  }

  if (adminObjectId) {
    clauses.push({ assignedAdminId: adminObjectId });
  }

  if (!clauses.length) {
    throw createHttpError('Unable to determine admin support scope.', 400, 'ADMIN_SCOPE_REQUIRED');
  }

  filter.$or = clauses;
  return filter;
}

async function findConversationForAdmin(db, conversationId, user) {
  const _id = asObjectId(conversationId);
  if (!_id) {
    throw createHttpError('Conversation not found.', 404, 'CONVERSATION_NOT_FOUND');
  }

  const filter = buildAdminConversationFilter(user);
  const conversation = await db.collection('chat_conversations').findOne({
    ...filter,
    _id,
  });

  if (!conversation) {
    throw createHttpError('Conversation not found.', 404, 'CONVERSATION_NOT_FOUND');
  }

  return conversation;
}

async function markAdminMessagesRead(db, conversationId) {
  await db.collection('chat_messages').updateMany(
    {
      conversationId,
      senderRole: { $in: ['admin', 'owner', 'superadmin'] },
      readAt: null,
    },
    { $set: { readAt: new Date() } }
  );

  await db.collection('chat_conversations').updateOne(
    { _id: conversationId },
    { $set: { unreadTenantCount: 0, updatedAt: new Date() } }
  );
}

async function markTenantMessagesRead(db, conversationId) {
  await db.collection('chat_messages').updateMany(
    {
      conversationId,
      senderRole: 'tenant',
      readAt: null,
    },
    { $set: { readAt: new Date() } }
  );

  await db.collection('chat_conversations').updateOne(
    { _id: conversationId },
    { $set: { unreadAdminCount: 0, updatedAt: new Date() } }
  );
}

async function seedInitialTenantMessage(db, conversation, user, initialMessage) {
  const normalized = typeof initialMessage === 'string' && initialMessage.trim()
    ? normalizeMessage(initialMessage)
    : '';

  if (!normalized) {
    return { conversation, createdMessage: null, inserted: false };
  }

  const latestMessage = await db.collection('chat_messages')
    .find({ conversationId: conversation._id })
    .sort({ createdAt: -1 })
    .limit(1)
    .next();

  if (latestMessage?.senderRole === 'tenant' && latestMessage?.message === normalized) {
    const freshConversation = await db.collection('chat_conversations').findOne({ _id: conversation._id });
    return { conversation: freshConversation || conversation, createdMessage: null, inserted: false };
  }

  const now = new Date();
  const tenantName = displayName(user, 'Tenant');
  const messageDoc = {
    conversationId: conversation._id,
    senderId: user._id || null,
    senderUserId: user.user_id || '',
    senderName: tenantName,
    senderRole: 'tenant',
    message: normalized,
    readAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const insertResult = await db.collection('chat_messages').insertOne(messageDoc);
  const statusHistory = Array.isArray(conversation.statusHistory) ? [...conversation.statusHistory] : [];
  statusHistory.push({
    status: 'open',
    note: 'Tenant shared a support concern.',
    actorId: user._id || null,
    actorName: tenantName,
    createdAt: now,
  });

  await db.collection('chat_conversations').updateOne(
    { _id: conversation._id },
    {
      $set: {
        status: 'open',
        lastMessage: normalized,
        lastMessageAt: now,
        unreadAdminCount: Number(conversation.unreadAdminCount || 0) + 1,
        unreadTenantCount: 0,
        statusHistory,
        updatedAt: now,
      },
    }
  );

  const freshConversation = await db.collection('chat_conversations').findOne({ _id: conversation._id });
  return {
    conversation: freshConversation || conversation,
    createdMessage: { ...messageDoc, _id: insertResult.insertedId },
    inserted: true,
  };
}

async function startConversation(req, res) {
  try {
    const db = getDb();
    const tenantContext = await resolveTenantContext(db, req.user);
    const tenantName = displayName(req.user, 'Tenant');
    const category = normalizeCategory(req.body?.category);
    const priority = normalizePriority(req.body?.priority, category);
    const assistantSessionId = typeof req.body?.assistantSessionId === 'string'
      ? req.body.assistantSessionId.trim().slice(0, 120)
      : '';
    let reusedExisting = false;

    let conversation = await db.collection('chat_conversations').findOne(
      {
        ...buildTenantConversationFilter(req.user),
        status: { $in: ACTIVE_CONVERSATION_STATUSES },
      },
      { sort: { updatedAt: -1 } }
    );

    if (conversation) {
      reusedExisting = true;
      await db.collection('chat_conversations').updateOne(
        { _id: conversation._id },
        {
          $set: {
            tenantName,
            tenantEmail: req.user.email || '',
            branch: tenantContext.branch,
            roomNumber: tenantContext.roomNumber,
            roomBed: tenantContext.roomBed,
            category: conversation.category && conversation.category !== 'general_inquiry'
              ? conversation.category
              : category,
            priority: conversation.priority && conversation.priority !== 'normal'
              ? conversation.priority
              : priority,
            assistantSessionId: assistantSessionId || conversation.assistantSessionId || '',
            updatedAt: new Date(),
          },
        }
      );
      conversation = await db.collection('chat_conversations').findOne({ _id: conversation._id });
      if (!conversation?.assignedAdminId) {
        conversation = await autoAssignConversation(db, conversation);
      }
    } else {
      const now = new Date();
      const newConversation = {
        tenantId: asObjectId(req.user._id) || req.user._id,
        tenantUserId: req.user.user_id || '',
        tenantName,
        tenantEmail: req.user.email || '',
        branch: tenantContext.branch,
        roomNumber: tenantContext.roomNumber,
        roomBed: tenantContext.roomBed,
        status: 'open',
        category,
        priority,
        assistantSessionId,
        assignedAdminId: null,
        assignedAdminName: '',
        lastMessage: '',
        lastMessageAt: null,
        unreadAdminCount: 0,
        unreadTenantCount: 0,
        closedAt: null,
        closedBy: null,
        closingNote: '',
        statusHistory: [
          {
            status: 'open',
            note: 'Conversation started.',
            actorId: req.user._id || null,
            actorName: tenantName,
            createdAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      };

      const result = await db.collection('chat_conversations').insertOne(newConversation);
      conversation = { ...newConversation, _id: result.insertedId };
      conversation = await autoAssignConversation(db, conversation);
    }

    const seeded = await seedInitialTenantMessage(db, conversation, req.user, req.body?.initialMessage);
    return res.json({
      conversation: serializeConversation(seeded.conversation),
      reusedExisting,
      initialMessageCreated: seeded.inserted,
      initialMessage: seeded.createdMessage ? serializeMessage(seeded.createdMessage) : null,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to start support chat.');
  }
}

async function getMyConversations(req, res) {
  try {
    const db = getDb();
    const conversations = await db.collection('chat_conversations')
      .find(buildTenantConversationFilter(req.user))
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(50)
      .toArray();

    return res.json({
      conversations: conversations.map(serializeConversation),
    });
  } catch (error) {
    return sendError(res, error, 'Failed to load support chats.');
  }
}

async function getConversationMessages(req, res) {
  try {
    const db = getDb();
    const conversation = await findConversationForTenant(db, req.params.conversationId, req.user);
    await markAdminMessagesRead(db, conversation._id);

    const messages = await db.collection('chat_messages')
      .find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .toArray();

    const freshConversation = await db.collection('chat_conversations').findOne({ _id: conversation._id });
    return res.json({
      conversation: serializeConversation(freshConversation || conversation),
      messages: messages.map(serializeMessage),
    });
  } catch (error) {
    return sendError(res, error, 'Failed to load support chat messages.');
  }
}

async function sendTenantMessage(req, res) {
  try {
    const db = getDb();
    const conversation = await findConversationForTenant(db, req.params.conversationId, req.user);

    if (conversation.status === 'closed') {
      throw createHttpError('This conversation is closed.', 400, 'CONVERSATION_CLOSED');
    }

    const attachments = await normalizeSupportAttachments(db, conversation, req.body?.attachments);
    // An attachment-only message is legitimate (the composer allows sending a
    // photo with no caption), so the non-empty text rule only applies when
    // there is nothing else to deliver.
    const message = attachments.length && !String(req.body?.message || '').trim()
      ? ''
      : normalizeMessage(req.body?.message);
    const now = new Date();
    const messageDoc = {
      conversationId: conversation._id,
      senderId: req.user._id || null,
      senderUserId: req.user.user_id || '',
      senderName: displayName(req.user, 'Tenant'),
      senderRole: 'tenant',
      message,
      attachments,
      readAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const insertResult = await db.collection('chat_messages').insertOne(messageDoc);
    const unreadAdminCount = Number(conversation.unreadAdminCount || 0) + 1;

    const statusHistory = Array.isArray(conversation.statusHistory) ? [...conversation.statusHistory] : [];
    if (conversation.status !== 'open') {
      statusHistory.push({
        status: 'open',
        note: 'Tenant replied.',
        actorId: req.user._id || null,
        actorName: displayName(req.user, 'Tenant'),
        createdAt: now,
      });
    }

    await db.collection('chat_conversations').updateOne(
      { _id: conversation._id },
      {
        $set: {
          status: 'open',
          // The conversation-list preview must still say something useful for
          // an attachment-only message.
          lastMessage: message || (attachments.length ? `Sent ${attachments.length} attachment${attachments.length > 1 ? 's' : ''}` : ''),
          lastMessageAt: now,
          unreadAdminCount,
          unreadTenantCount: 0,
          statusHistory,
          updatedAt: now,
        },
      }
    );

    const updatedConversation = await db.collection('chat_conversations').findOne({ _id: conversation._id });
    return res.json({
      message: serializeMessage({ ...messageDoc, _id: insertResult.insertedId }),
      conversation: serializeConversation(updatedConversation || conversation),
    });
  } catch (error) {
    return sendError(res, error, 'Failed to send support message.');
  }
}

async function closeConversation(req, res) {
  try {
    const db = getDb();
    const conversation = await findConversationForTenant(db, req.params.conversationId, req.user);
    const now = new Date();
    const note = String(req.body?.note || '').trim() || 'Closed by tenant from the mobile app.';
    const statusHistory = Array.isArray(conversation.statusHistory) ? [...conversation.statusHistory] : [];

    if (conversation.status !== 'closed') {
      statusHistory.push({
        status: 'closed',
        note,
        actorId: req.user._id || null,
        actorName: displayName(req.user, 'Tenant'),
        createdAt: now,
      });
    }

    await db.collection('chat_conversations').updateOne(
      { _id: conversation._id },
      {
        $set: {
          status: 'closed',
          closedAt: now,
          closedBy: req.user._id || null,
          closingNote: note,
          statusHistory,
          updatedAt: now,
        },
      }
    );

    const updatedConversation = await db.collection('chat_conversations').findOne({ _id: conversation._id });
    return res.json({ conversation: serializeConversation(updatedConversation || conversation) });
  } catch (error) {
    return sendError(res, error, 'Failed to close support chat.');
  }
}

// Registers one already-uploaded file against a conversation the caller owns
// and mints the canonical attachment resource for it.
//
// The bytes reached Firebase Storage through POST /upload/firebase-storage,
// which derived the tenant path segment from the authenticated session; this
// step re-proves ownership of that exact object, then persists it as a
// `chat_attachments` record. From here on the storage path exists only on that
// record — the response, the message embed and every later read refer to the
// file by its immutable id through the protected route.
async function registerConversationAttachment(req, res, { admin: asAdmin = false } = {}) {
  try {
    const db = getDb();
    const conversation = asAdmin
      ? await findConversationForAdmin(db, req.params.conversationId, req.user)
      : await findConversationForTenant(db, req.params.conversationId, req.user);

    if (conversation.status === 'closed') {
      throw createHttpError('This conversation is closed.', 400, 'CONVERSATION_CLOSED');
    }

    const source = req.body?.attachment && typeof req.body.attachment === 'object'
      ? req.body.attachment
      : req.body;
    const attachment = normalizeSupportAttachment(source, req.user?.user_id);
    const record = await createChatAttachment(db, {
      conversation,
      uploader: req.user,
      uploaderRole: asAdmin ? normalizeRole(req.user?.role) || 'admin' : 'tenant',
      attachment,
    });

    return res.status(201).json({
      attachment: serializeAttachmentRecord(record, conversation._id),
    });
  } catch (error) {
    return sendError(res, error, 'Failed to attach that file to your support conversation.');
  }
}

function uploadConversationAttachment(req, res) {
  return registerConversationAttachment(req, res, { admin: false });
}

function uploadAdminConversationAttachment(req, res) {
  return registerConversationAttachment(req, res, { admin: true });
}

// The only way any client reads attachment bytes.
//
// Authorization is layered and none of it is taken from the request body:
//   1. the route's auth middleware proves a session,
//   2. the conversation is located through the caller's *existing* scope
//      filter — buildTenantConversationFilter for a tenant (own conversations
//      only) or buildAdminConversationFilter for an admin (branch/assignment,
//      with owner/superadmin unrestricted) — so an unreachable conversation is
//      a 404 exactly as it is everywhere else in this controller,
//   3. the attachment is then resolved by id *and* conversationId, so an
//      attachment belonging to a different conversation cannot be substituted,
//   4. the storage path comes from that persisted record only.
// Every failure is a definite response; nothing hangs.
async function streamConversationAttachment(req, res, { admin: asAdmin = false } = {}) {
  try {
    const db = getDb();
    const conversation = asAdmin
      ? await findConversationForAdmin(db, req.params.conversationId, req.user)
      : await findConversationForTenant(db, req.params.conversationId, req.user);

    const attachment = await findConversationAttachment(db, conversation._id, req.params.attachmentId);
    if (!attachment) {
      throw createHttpError('Attachment not found.', 404, 'ATTACHMENT_NOT_FOUND');
    }

    const bucketName = resolveStorageBucket();
    if (!bucketName || !admin.apps.length) {
      throw createHttpError('Attachment storage is unavailable.', 503, 'ATTACHMENT_STORAGE_UNAVAILABLE');
    }

    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(attachment.originalName || 'attachment')}`,
    );
    res.setHeader('Cache-Control', 'private, max-age=300');

    return admin.storage().bucket(bucketName).file(attachment.storagePath).createReadStream()
      .on('error', () => {
        // A missing or unreadable storage object is a controlled 404, never a
        // socket left open for the client to spin on.
        if (!res.headersSent) res.status(404).json({ error: 'Attachment not found.', code: 'ATTACHMENT_NOT_FOUND' });
        else res.destroy();
      })
      .pipe(res);
  } catch (error) {
    return sendError(res, error, 'Failed to download attachment.');
  }
}

function downloadConversationAttachment(req, res) {
  return streamConversationAttachment(req, res, { admin: false });
}

function downloadAdminConversationAttachment(req, res) {
  return streamConversationAttachment(req, res, { admin: true });
}

// Rollback for a partially-completed multi-file send.
//
// Sending is atomic by construction: every file is uploaded and registered
// *before* any ChatMessage is created, and normalizeSupportAttachments
// validates the whole set, so a message that claims N attachments always has
// N resolvable records. What a mid-way failure does leave behind is registered
// records (and their storage objects) that no message ever referenced. This
// endpoint lets the composer discard exactly those, so a failed send does not
// accumulate orphaned bytes.
//
// It is deliberately narrow, because deletion is the dangerous direction:
//   * the conversation must resolve through the caller's own scope filter,
//   * the attachment must be bound to that conversation,
//   * the caller must be the uploader — an admin cannot delete a tenant's file
//     and vice versa,
//   * and it must not be referenced by any message. A referenced attachment is
//     chat history and is refused with a 409, never quietly removed.
async function discardConversationAttachment(req, res, { admin: asAdmin = false } = {}) {
  try {
    const db = getDb();
    const conversation = asAdmin
      ? await findConversationForAdmin(db, req.params.conversationId, req.user)
      : await findConversationForTenant(db, req.params.conversationId, req.user);

    const attachment = await findConversationAttachment(db, conversation._id, req.params.attachmentId);
    if (!attachment) {
      throw createHttpError('Attachment not found.', 404, 'ATTACHMENT_NOT_FOUND');
    }

    if (String(attachment.uploadedBy) !== String(req.user?._id || '')) {
      // Same 404 convention the rest of this controller uses for
      // "exists, but not yours" — it reveals nothing extra.
      throw createHttpError('Attachment not found.', 404, 'ATTACHMENT_NOT_FOUND');
    }

    const referenced = await db.collection('chat_messages').countDocuments(
      { conversationId: conversation._id, 'attachments.attachmentId': attachment._id },
      { limit: 1 },
    );
    if (referenced) {
      throw createHttpError('This attachment has already been sent.', 409, 'ATTACHMENT_ALREADY_SENT');
    }

    // Best effort on the bytes: the record is what makes the file reachable,
    // so a storage object that outlives a failed delete is unreadable rather
    // than exposed. The record is only removed once we have tried the object.
    const bucketName = resolveStorageBucket();
    if (bucketName && admin.apps.length && attachment.storagePath) {
      try {
        await admin.storage().bucket(bucketName).file(attachment.storagePath).delete();
      } catch (_storageError) {
        // Already gone, or storage is refusing — the record removal below
        // still leaves nothing referencing it.
      }
    }

    await db.collection(CHAT_ATTACHMENT_COLLECTION).deleteOne({
      _id: attachment._id,
      conversationId: conversation._id,
    });

    return res.json({ discarded: true, attachmentId: String(attachment._id) });
  } catch (error) {
    return sendError(res, error, 'Failed to discard that attachment.');
  }
}

function deleteConversationAttachment(req, res) {
  return discardConversationAttachment(req, res, { admin: false });
}

function deleteAdminConversationAttachment(req, res) {
  return discardConversationAttachment(req, res, { admin: true });
}

// Tenant's answer to "was this resolved?" — the counterpart to the admin
// moving a conversation to waiting_tenant. Confirming settles it at
// `resolved` (the tenant can still reopen); declining returns it to `open`
// so admin support picks it back up. Optional satisfaction rating/feedback
// is recorded on the conversation, never as a chat message.
async function confirmConversationResolution(req, res) {
  try {
    const db = getDb();
    const conversation = await findConversationForTenant(db, req.params.conversationId, req.user);

    if (conversation.status === 'closed') {
      throw createHttpError('This conversation is closed.', 400, 'CONVERSATION_CLOSED');
    }
    if (typeof req.body?.resolved !== 'boolean') {
      throw createHttpError('A resolution choice is required.', 400, 'RESOLUTION_REQUIRED');
    }

    const resolved = req.body.resolved;
    const now = new Date();
    const note = String(req.body?.note || '').trim().slice(0, 1000)
      || (resolved ? 'Tenant confirmed the concern is resolved.' : 'Tenant reports the concern is not resolved yet.');
    const nextStatus = resolved ? 'resolved' : 'open';

    const rawRating = Number(req.body?.rating);
    const rating = Number.isInteger(rawRating) && rawRating >= 1 && rawRating <= 5 ? rawRating : null;
    const feedback = String(req.body?.feedback || '').trim().slice(0, 1000);

    const statusHistory = Array.isArray(conversation.statusHistory) ? [...conversation.statusHistory] : [];
    statusHistory.push({
      status: nextStatus,
      note,
      actorId: req.user._id || null,
      actorName: displayName(req.user, 'Tenant'),
      createdAt: now,
    });

    const update = {
      status: nextStatus,
      statusHistory,
      updatedAt: now,
      tenantResolutionConfirmed: resolved,
      tenantResolutionAt: now,
    };
    if (resolved) {
      update.resolvedAt = now;
    }
    if (rating !== null) update.satisfactionRating = rating;
    if (feedback) update.satisfactionFeedback = feedback;

    await db.collection('chat_conversations').updateOne({ _id: conversation._id }, { $set: update });

    const updatedConversation = await db.collection('chat_conversations').findOne({ _id: conversation._id });
    return res.json({ conversation: serializeConversation(updatedConversation || conversation) });
  } catch (error) {
    return sendError(res, error, 'Unable to save your resolution choice.');
  }
}

// Reopens a resolved or closed conversation in place, rather than starting a
// new one, so the whole history stays on a single thread. Branch/admin
// assignment is preserved exactly as it was, so reopening cannot leak the
// conversation to a different branch's admins.
async function reopenConversation(req, res) {
  try {
    const db = getDb();
    const conversation = await findConversationForTenant(db, req.params.conversationId, req.user);

    if (!['resolved', 'closed', 'waiting_tenant'].includes(conversation.status)) {
      throw createHttpError('This conversation is already open.', 400, 'CONVERSATION_ALREADY_OPEN');
    }

    const now = new Date();
    const note = String(req.body?.note || '').trim().slice(0, 1000)
      || 'Tenant reopened this concern from the mobile app.';
    const statusHistory = Array.isArray(conversation.statusHistory) ? [...conversation.statusHistory] : [];
    statusHistory.push({
      status: 'open',
      note,
      actorId: req.user._id || null,
      actorName: displayName(req.user, 'Tenant'),
      createdAt: now,
    });

    await db.collection('chat_conversations').updateOne(
      { _id: conversation._id },
      {
        $set: {
          status: 'open',
          statusHistory,
          updatedAt: now,
          tenantResolutionConfirmed: false,
          reopenedAt: now,
        },
        $unset: { closedAt: '', closedBy: '', closingNote: '' },
      }
    );

    const updatedConversation = await db.collection('chat_conversations').findOne({ _id: conversation._id });
    return res.json({ conversation: serializeConversation(updatedConversation || conversation) });
  } catch (error) {
    return sendError(res, error, 'Failed to reopen this support conversation.');
  }
}

async function getAdminConversations(req, res) {
  try {
    const db = getDb();
    const filter = buildAdminConversationFilter(req.user, req.query?.status);
    const conversations = await db.collection('chat_conversations')
      .find(filter)
      .sort({ updatedAt: -1, lastMessageAt: -1 })
      .limit(100)
      .toArray();

    return res.json({
      conversations: conversations.map(serializeConversation),
    });
  } catch (error) {
    return sendError(res, error, 'Failed to load admin support conversations.');
  }
}

async function getAdminConversationMessages(req, res) {
  try {
    const db = getDb();
    const conversation = await findConversationForAdmin(db, req.params.conversationId, req.user);
    await markTenantMessagesRead(db, conversation._id);

    const messages = await db.collection('chat_messages')
      .find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .toArray();

    const freshConversation = await db.collection('chat_conversations').findOne({ _id: conversation._id });
    return res.json({
      conversation: serializeConversation(freshConversation || conversation),
      messages: messages.map(serializeMessage),
    });
  } catch (error) {
    return sendError(res, error, 'Failed to load admin support messages.');
  }
}

async function sendAdminMessage(req, res) {
  try {
    const db = getDb();
    const conversation = await findConversationForAdmin(db, req.params.conversationId, req.user);

    if (conversation.status === 'closed') {
      throw createHttpError('This conversation is closed.', 400, 'CONVERSATION_CLOSED');
    }

    const adminAttachments = await normalizeSupportAttachments(db, conversation, req.body?.attachments);
    const message = adminAttachments.length && !String(req.body?.message || '').trim()
      ? ''
      : normalizeMessage(req.body?.message);
    const now = new Date();
    const adminName = displayName(req.user, 'Admin');
    const senderRole = normalizeRole(req.user?.role) === 'superadmin' ? 'superadmin' : 'admin';
    const messageDoc = {
      conversationId: conversation._id,
      senderId: req.user._id || null,
      senderUserId: req.user.user_id || '',
      senderName: adminName,
      senderRole,
      message,
      // Admin-side attachments resolve through the same conversation-bound
      // canonical records as tenant ones, so the tenant app opens them through
      // the identical protected route.
      attachments: adminAttachments,
      readAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const insertResult = await db.collection('chat_messages').insertOne(messageDoc);
    const statusHistory = Array.isArray(conversation.statusHistory) ? [...conversation.statusHistory] : [];
    statusHistory.push({
      status: 'waiting_tenant',
      note: 'Admin replied.',
      actorId: req.user._id || null,
      actorName: adminName,
      createdAt: now,
    });

    await db.collection('chat_conversations').updateOne(
      { _id: conversation._id },
      {
        $set: {
          status: 'waiting_tenant',
          assignedAdminId: req.user._id || null,
          assignedAdminName: adminName,
          lastMessage: message || (adminAttachments.length ? `Sent ${adminAttachments.length} attachment${adminAttachments.length > 1 ? 's' : ''}` : ''),
          lastMessageAt: now,
          unreadAdminCount: 0,
          unreadTenantCount: Number(conversation.unreadTenantCount || 0) + 1,
          statusHistory,
          updatedAt: now,
        },
      }
    );

    const updatedConversation = await db.collection('chat_conversations').findOne({ _id: conversation._id });
    return res.json({
      message: serializeMessage({ ...messageDoc, _id: insertResult.insertedId }),
      conversation: serializeConversation(updatedConversation || conversation),
    });
  } catch (error) {
    return sendError(res, error, 'Failed to send admin support message.');
  }
}

async function updateAdminConversationStatus(req, res) {
  try {
    const db = getDb();
    const conversation = await findConversationForAdmin(db, req.params.conversationId, req.user);
    const status = String(req.body?.status || '').trim().toLowerCase();
    const note = String(req.body?.note || '').trim();

    if (!ADMIN_LISTABLE_STATUSES.has(status)) {
      throw createHttpError('Invalid support status.', 400, 'INVALID_STATUS');
    }

    const now = new Date();
    const adminName = displayName(req.user, 'Admin');
    const statusHistory = Array.isArray(conversation.statusHistory) ? [...conversation.statusHistory] : [];
    statusHistory.push({
      status,
      note: note || `Admin marked the conversation as ${status.replace(/_/g, ' ')}.`,
      actorId: req.user._id || null,
      actorName: adminName,
      createdAt: now,
    });

    const updates = {
      status,
      assignedAdminId: req.user._id || conversation.assignedAdminId || null,
      assignedAdminName: adminName || conversation.assignedAdminName || '',
      statusHistory,
      updatedAt: now,
    };

    if (status === 'resolved') {
      updates.closingNote = note || 'Resolved by admin support.';
    }

    if (status === 'closed') {
      updates.closedAt = now;
      updates.closedBy = req.user._id || null;
      updates.closingNote = note || 'Closed by admin support.';
    }

    await db.collection('chat_conversations').updateOne(
      { _id: conversation._id },
      { $set: updates }
    );

    const updatedConversation = await db.collection('chat_conversations').findOne({ _id: conversation._id });
    return res.json({ conversation: serializeConversation(updatedConversation || conversation) });
  } catch (error) {
    return sendError(res, error, 'Failed to update support conversation status.');
  }
}

module.exports = {
  startConversation,
  getMyConversations,
  getConversationMessages,
  sendTenantMessage,
  closeConversation,
  uploadConversationAttachment,
  downloadConversationAttachment,
  deleteConversationAttachment,
  confirmConversationResolution,
  reopenConversation,
  getAdminConversations,
  getAdminConversationMessages,
  sendAdminMessage,
  updateAdminConversationStatus,
  uploadAdminConversationAttachment,
  downloadAdminConversationAttachment,
  deleteAdminConversationAttachment,
  __test: {
    normalizeMessage,
    MAX_MESSAGE_CHARS,
    normalizeSupportAttachment,
    normalizeSupportAttachments,
    serializeAttachment,
    serializeMessage,
    SUPPORT_ATTACHMENT_FOLDER,
    SUPPORT_ATTACHMENT_MAX_BYTES,
    MAX_SUPPORT_ATTACHMENTS,
    SUPPORT_ATTACHMENT_MIME_TYPES,
  },
};
