const { ObjectId } = require('mongodb');
const { getDb } = require('../config/database');

const MAX_MESSAGE_CHARS = 1000;
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

function sanitizeBranch(value) {
  if (typeof value !== 'string') return null;
  const branch = value.trim();
  return branch || null;
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function asObjectId(value) {
  if (!value) return null;
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value);
  return null;
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

  if (user?._id) {
    const reservation = await db.collection('reservations').findOne(
      { userId: user._id, status: { $in: ['moveIn', 'active', 'completed', 'payment_pending', 'confirmed'] } },
      { sort: { createdAt: -1 } }
    );

    if (reservation) {
      context.branch = sanitizeBranch(reservation.branch) || context.branch;
      const roomDoc = reservation.roomId
        ? await db.collection('rooms').findOne({ _id: asObjectId(reservation.roomId) || reservation.roomId })
        : null;
      context.roomNumber = roomDoc?.roomNumber || reservation.roomNumber || reservation.roomName || '';
      context.roomBed = reservation.selectedBed?.position || reservation.selectedBed?.label || reservation.selectedBed?.id || '';
      return context;
    }
  }

  const bedHistory = await db.collection('bedhistories').findOne(
    { userId: user?._id },
    { sort: { moveInDate: -1 } }
  );

  if (bedHistory) {
    context.branch = sanitizeBranch(bedHistory.branch) || context.branch;
    const roomDoc = bedHistory.roomId
      ? await db.collection('rooms').findOne({ _id: asObjectId(bedHistory.roomId) || bedHistory.roomId })
      : null;
    context.roomNumber = roomDoc?.roomNumber || '';
    const bed = roomDoc?.beds?.find((item) => item.id === bedHistory.bedId);
    context.roomBed = bed?.position || bedHistory.bedId || '';
  }

  if (!context.branch) {
    throw createHttpError('Unable to determine tenant branch for support chat.', 400, 'BRANCH_REQUIRED');
  }

  return context;
}

async function autoAssignConversation(db, conversation) {
  const candidates = await db.collection('users').find({
    role: { $in: Array.from(ADMIN_ROLES) },
  }).toArray();

  const eligible = candidates.filter((user) => {
    const role = String(user.role || '').toLowerCase();
    if (!ADMIN_ROLES.has(role)) return false;
    if (role === 'superadmin') return true;
    return sanitizeBranch(user.branch || user.branchId) === conversation.branch;
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
    tenantId: user._id,
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

  const adminBranch = sanitizeBranch(user?.branch || user?.branchId);
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
        tenantId: req.user._id,
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
        tenantId: req.user._id,
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
      .find({ tenantId: req.user._id })
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

    const message = normalizeMessage(req.body?.message);
    const now = new Date();
    const messageDoc = {
      conversationId: conversation._id,
      senderId: req.user._id || null,
      senderUserId: req.user.user_id || '',
      senderName: displayName(req.user, 'Tenant'),
      senderRole: 'tenant',
      message,
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
          lastMessage: message,
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

    const message = normalizeMessage(req.body?.message);
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
          lastMessage: message,
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
  getAdminConversations,
  getAdminConversationMessages,
  sendAdminMessage,
  updateAdminConversationStatus,
};
