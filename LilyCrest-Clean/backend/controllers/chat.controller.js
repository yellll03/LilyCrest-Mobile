const { ObjectId } = require('mongodb');
const { getDb } = require('../config/database');

const MAX_MESSAGE_CHARS = 1000;
const CHAT_CONVERSATIONS = 'chat_conversations';
const CHAT_MESSAGES = 'chat_messages';
const ACTIVE_RESERVATION_STATUSES = ['moveIn', 'active', 'confirmed', 'completed'];
const ADMIN_ROLES = new Set(['admin', 'superadmin', 'owner', 'branch_admin']);
const VALID_BRANCHES = new Set(['gil-puyat', 'guadalupe']);
const ACTIVE_CONVERSATION_STATUSES = ['open', 'in_review', 'waiting_tenant', 'resolved'];
const VALID_CATEGORIES = new Set([
  'billing_concern',
  'maintenance_concern',
  'reservation_concern',
  'payment_concern',
  'general_inquiry',
  'urgent_issue',
]);
const CATEGORY_ALIASES = {
  'billing concern': 'billing_concern',
  billing: 'billing_concern',
  'maintenance concern': 'maintenance_concern',
  maintenance: 'maintenance_concern',
  'reservation concern': 'reservation_concern',
  reservation: 'reservation_concern',
  'payment concern': 'payment_concern',
  payment: 'payment_concern',
  'general inquiry': 'general_inquiry',
  general: 'general_inquiry',
  'urgent issue': 'urgent_issue',
  urgent: 'urgent_issue',
};
const VALID_PRIORITIES = new Set(['normal', 'high', 'urgent']);

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof ObjectId) return value;
  const stringValue = String(value);
  return ObjectId.isValid(stringValue) ? new ObjectId(stringValue) : null;
}

function requireConversationId(value) {
  const objectId = toObjectId(value);
  if (!objectId) {
    const error = new Error('Conversation not found.');
    error.statusCode = 404;
    throw error;
  }
  return objectId;
}

function sendError(res, error, fallback = 'Failed to process chat request.') {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    console.error('Chat controller error:', error);
  }
  return res.status(statusCode).json({
    detail: statusCode >= 500 ? fallback : error.message,
  });
}

function normalizeMessage(rawMessage) {
  if (typeof rawMessage !== 'string') {
    const error = new Error('Message cannot be empty.');
    error.statusCode = 400;
    throw error;
  }

  const message = rawMessage.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
  if (!message) {
    const error = new Error('Message cannot be empty.');
    error.statusCode = 400;
    throw error;
  }

  if (message.length > MAX_MESSAGE_CHARS) {
    const error = new Error(`Message must be ${MAX_MESSAGE_CHARS} characters or fewer.`);
    error.statusCode = 400;
    throw error;
  }

  return message;
}

function normalizeCategory(rawCategory, { required = false } = {}) {
  if (rawCategory === undefined || rawCategory === null || rawCategory === '') {
    if (required) {
      const error = new Error('Category is required.');
      error.statusCode = 400;
      throw error;
    }
    return null;
  }

  const categoryKey = String(rawCategory).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const category = VALID_CATEGORIES.has(categoryKey)
    ? categoryKey
    : CATEGORY_ALIASES[String(rawCategory).trim().toLowerCase()];

  if (!category) {
    const error = new Error('Category is required.');
    error.statusCode = 400;
    throw error;
  }

  return category;
}

function normalizePriority(rawPriority, category = '') {
  if (rawPriority !== undefined && rawPriority !== null && rawPriority !== '') {
    const priority = String(rawPriority).trim().toLowerCase();
    if (!VALID_PRIORITIES.has(priority)) {
      const error = new Error('Invalid priority.');
      error.statusCode = 400;
      throw error;
    }
    return priority;
  }

  return category === 'urgent_issue' ? 'urgent' : 'normal';
}

function displayName(user, fallback = 'Tenant') {
  return (
    user?.name ||
    user?.fullName ||
    `${user?.firstName || user?.first_name || ''} ${user?.lastName || user?.last_name || ''}`.trim() ||
    user?.email ||
    fallback
  );
}

function selectedBedLabel(reservation = {}) {
  const selectedBed = reservation.selectedBed || reservation.selected_bed || {};
  return [selectedBed.position, selectedBed.id || selectedBed.bed_id].filter(Boolean).join(' ').trim();
}

function serializeConversation(conversation) {
  if (!conversation) return null;
  return {
    id: String(conversation._id),
    tenantId: conversation.tenantId ? String(conversation.tenantId) : '',
    tenantName: conversation.tenantName || 'Tenant',
    tenantEmail: conversation.tenantEmail || '',
    branch: conversation.branch || '',
    roomNumber: conversation.roomNumber || '',
    roomBed: conversation.roomBed || '',
    status: conversation.status || 'open',
    category: conversation.category || 'general_inquiry',
    priority: conversation.priority || 'normal',
    assignedAdminId: conversation.assignedAdminId ? String(conversation.assignedAdminId) : '',
    assignedAdminName: conversation.assignedAdminName || '',
    lastMessage: conversation.lastMessage || '',
    lastMessageAt: conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt || null,
    unreadAdminCount: conversation.unreadAdminCount || 0,
    unreadTenantCount: conversation.unreadTenantCount || 0,
    createdAt: conversation.createdAt || null,
    updatedAt: conversation.updatedAt || null,
    closedAt: conversation.closedAt || null,
    closedBy: conversation.closedBy ? String(conversation.closedBy) : null,
    closingNote: conversation.closingNote || '',
    statusHistory: Array.isArray(conversation.statusHistory)
      ? conversation.statusHistory.map((entry) => ({
          status: entry.status || '',
          note: entry.note || '',
          actorId: entry.actorId ? String(entry.actorId) : '',
          actorName: entry.actorName || '',
          createdAt: entry.createdAt || null,
        }))
      : [],
  };
}

function serializeMessage(message) {
  if (!message) return null;
  return {
    id: String(message._id),
    conversationId: message.conversationId ? String(message.conversationId) : '',
    senderId: message.senderId ? String(message.senderId) : '',
    senderName: message.senderName || '',
    senderRole: message.senderRole || 'tenant',
    message: message.message || '',
    readAt: message.readAt || null,
    createdAt: message.createdAt || null,
  };
}

function tenantQuery(user) {
  const clauses = [];
  const mongoId = toObjectId(user?._id);
  if (mongoId) clauses.push({ tenantId: mongoId });
  if (user?.user_id) clauses.push({ tenantUserId: user.user_id });
  return clauses.length ? { $or: clauses } : { tenantUserId: '__none__' };
}

async function resolveTenantContext(db, user) {
  const role = String(user?.role || '').toLowerCase();
  if (ADMIN_ROLES.has(role)) {
    const error = new Error('No active tenant.');
    error.statusCode = 403;
    throw error;
  }

  const mongoId = toObjectId(user?._id);
  let branch = user?.branch || user?.assigned_branch || '';
  let roomNumber = user?.roomNumber || user?.room_number || '';
  let roomBed = user?.bedId || user?.bed_id || '';

  if (mongoId) {
    const bedHistory = await db.collection('bedhistories').findOne(
      { tenantId: mongoId, status: 'active' },
      { sort: { moveInDate: -1, effectiveStartDate: -1 } },
    );

    if (bedHistory) {
      branch = bedHistory.branch || branch;
      roomBed = bedHistory.bedId || roomBed;
      const roomId = toObjectId(bedHistory.roomId);
      if (roomId) {
        const room = await db.collection('rooms').findOne(
          { _id: roomId },
          { projection: { roomNumber: 1, name: 1, branch: 1 } },
        );
        branch = room?.branch || branch;
        roomNumber = room?.roomNumber || room?.name || roomNumber;
      }
    }

    if (!VALID_BRANCHES.has(branch)) {
      const reservation = await db.collection('reservations').findOne(
        {
          userId: mongoId,
          status: { $in: ACTIVE_RESERVATION_STATUSES },
          isArchived: { $ne: true },
        },
        { sort: { moveInDate: -1, createdAt: -1 } },
      );

      if (reservation) {
        roomBed = selectedBedLabel(reservation) || roomBed;
        const roomId = toObjectId(reservation.roomId);
        if (roomId) {
          const room = await db.collection('rooms').findOne(
            { _id: roomId },
            { projection: { roomNumber: 1, name: 1, branch: 1 } },
          );
          branch = room?.branch || branch;
          roomNumber = room?.roomNumber || room?.name || roomNumber;
        }
      }
    }
  }

  if (!mongoId || !VALID_BRANCHES.has(branch)) {
    const error = new Error('No active tenant.');
    error.statusCode = 400;
    throw error;
  }

  return {
    user,
    mongoId,
    tenantName: displayName(user),
    tenantEmail: user?.email || user?.google_email || '',
    branch,
    roomNumber,
    roomBed,
  };
}

async function getTenantConversation(db, conversationId, user) {
  const conversation = await db.collection(CHAT_CONVERSATIONS).findOne({
    _id: requireConversationId(conversationId),
  });
  if (!conversation) {
    const error = new Error('Conversation not found.');
    error.statusCode = 404;
    throw error;
  }

  const mongoId = toObjectId(user?._id);
  const ownsById = mongoId && String(conversation.tenantId) === String(mongoId);
  const ownsByUserId = user?.user_id && conversation.tenantUserId === user.user_id;
  if (!ownsById && !ownsByUserId) {
    const error = new Error('You do not have access to this conversation.');
    error.statusCode = 403;
    throw error;
  }

  return conversation;
}

async function notifyAdminsOfTenantMessage(db, conversation) {
  try {
    const admins = await db.collection('users').find({
      isArchived: { $ne: true },
      accountStatus: { $ne: 'banned' },
      $or: [
        { role: { $in: ['owner', 'superadmin', 'admin'] } },
        { role: 'branch_admin', branch: conversation.branch },
      ],
    }, { projection: { _id: 1 } }).toArray();

    if (!admins.length) return;

    const now = new Date();
    await db.collection('notifications').insertMany(admins.map((admin) => ({
      userId: admin._id,
      type: 'general',
      title: conversation.priority === 'urgent' ? 'Urgent Tenant Message' : 'New Tenant Message',
      message: conversation.priority === 'urgent'
        ? `${conversation.tenantName || 'A tenant'} sent an urgent support message.`
        : `${conversation.tenantName || 'A tenant'} sent a message.`,
      isRead: false,
      readAt: null,
      actionUrl: '/admin/chat',
      entityType: '',
      entityId: String(conversation._id),
      createdAt: now,
      updatedAt: now,
    })));
  } catch (error) {
    console.warn('[Chat] Admin notification skipped:', error?.message);
  }
}

async function startConversation(req, res) {
  try {
    const db = getDb();
    const tenant = await resolveTenantContext(db, req.user);
    const conversations = db.collection(CHAT_CONVERSATIONS);
    const now = new Date();

    let conversation = await conversations.findOne({
      ...tenantQuery(req.user),
      status: { $in: ACTIVE_CONVERSATION_STATUSES },
    }, { sort: { updatedAt: -1 } });

    if (conversation) {
      await conversations.updateOne(
        { _id: conversation._id },
        {
          $set: {
            tenantName: tenant.tenantName,
            tenantEmail: tenant.tenantEmail,
            branch: tenant.branch,
            roomNumber: tenant.roomNumber,
            roomBed: tenant.roomBed,
            category: conversation.category || 'general_inquiry',
            priority: conversation.priority || 'normal',
            updatedAt: now,
          },
        },
      );
      conversation = await conversations.findOne({ _id: conversation._id });
    } else {
      const category = normalizeCategory(req.body?.category, { required: true });
      const priority = normalizePriority(req.body?.priority, category);
      conversation = {
        tenantId: tenant.mongoId,
        tenantUserId: req.user.user_id || '',
        tenantName: tenant.tenantName,
        tenantEmail: tenant.tenantEmail,
        branch: tenant.branch,
        roomNumber: tenant.roomNumber,
        roomBed: tenant.roomBed,
        status: 'open',
        category,
        priority,
        lastMessage: '',
        lastMessageAt: null,
        unreadAdminCount: 0,
        unreadTenantCount: 0,
        assignedAdminId: null,
        assignedAdminName: '',
        closedAt: null,
        closedBy: null,
        closingNote: '',
        statusHistory: [{
          status: 'open',
          note: 'Conversation started.',
          actorId: tenant.mongoId,
          actorName: tenant.tenantName,
          createdAt: now,
        }],
        createdAt: now,
        updatedAt: now,
      };
      const result = await conversations.insertOne(conversation);
      conversation._id = result.insertedId;
    }

    return res.json({ conversation: serializeConversation(conversation) });
  } catch (error) {
    return sendError(res, error, 'Failed to start chat.');
  }
}

async function getMyConversations(req, res) {
  try {
    const db = getDb();
    await resolveTenantContext(db, req.user);
    const conversations = await db.collection(CHAT_CONVERSATIONS)
      .find(tenantQuery(req.user))
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(50)
      .toArray();

    return res.json({ conversations: conversations.map(serializeConversation) });
  } catch (error) {
    return sendError(res, error, 'Failed to load conversations.');
  }
}

async function getConversationMessages(req, res) {
  try {
    const db = getDb();
    await resolveTenantContext(db, req.user);
    const conversation = await getTenantConversation(db, req.params.conversationId, req.user);
    const now = new Date();

    await Promise.all([
      db.collection(CHAT_CONVERSATIONS).updateOne(
        { _id: conversation._id },
        { $set: { unreadTenantCount: 0, updatedAt: now } },
      ),
      db.collection(CHAT_MESSAGES).updateMany(
        {
          conversationId: conversation._id,
          senderRole: { $in: ['admin', 'owner', 'superadmin'] },
          readAt: null,
        },
        { $set: { readAt: now } },
      ),
    ]);

    const messages = await db.collection(CHAT_MESSAGES)
      .find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .toArray();

    return res.json({ messages: messages.map(serializeMessage) });
  } catch (error) {
    return sendError(res, error, 'Failed to load messages.');
  }
}

async function sendMessage(req, res) {
  try {
    const db = getDb();
    const tenant = await resolveTenantContext(db, req.user);
    const conversation = await getTenantConversation(db, req.params.conversationId, req.user);

    if (conversation.status === 'closed') {
      const error = new Error('This conversation is closed.');
      error.statusCode = 400;
      throw error;
    }

    const messageText = normalizeMessage(req.body?.message);
    const now = new Date();
    const messageDoc = {
      conversationId: conversation._id,
      senderId: tenant.mongoId,
      senderUserId: req.user.user_id || '',
      senderName: tenant.tenantName,
      senderRole: 'tenant',
      message: messageText,
      readAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const insertResult = await db.collection(CHAT_MESSAGES).insertOne(messageDoc);
    messageDoc._id = insertResult.insertedId;

    await db.collection(CHAT_CONVERSATIONS).updateOne(
      { _id: conversation._id },
      {
        $set: {
          lastMessage: messageText,
          lastMessageAt: now,
          status: 'open',
          updatedAt: now,
        },
        $inc: { unreadAdminCount: 1 },
        ...(conversation.status !== 'open'
          ? {
              $push: {
                statusHistory: {
                  $each: [{
                    status: 'open',
                    note: 'Tenant replied.',
                    actorId: tenant.mongoId,
                    actorName: tenant.tenantName,
                    createdAt: now,
                  }],
                  $slice: -25,
                },
              },
            }
          : {}),
      },
    );

    const updatedConversation = await db.collection(CHAT_CONVERSATIONS).findOne({
      _id: conversation._id,
    });

    await notifyAdminsOfTenantMessage(db, updatedConversation);

    return res.json({
      message: serializeMessage(messageDoc),
      conversation: serializeConversation(updatedConversation),
    });
  } catch (error) {
    return sendError(res, error, 'Failed to send message.');
  }
}

module.exports = {
  startConversation,
  getMyConversations,
  getConversationMessages,
  sendMessage,
};
