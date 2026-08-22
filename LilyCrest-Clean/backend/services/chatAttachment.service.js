'use strict';

// Canonical support-chat attachment resource.
//
// One attachment is one immutable document in the `chat_attachments`
// collection. That document is the *sole* owner of every storage and
// authorization fact about the file: which conversation it belongs to, which
// branch, who uploaded it, where the bytes actually live (`storagePath`), and
// the provider download URL (`storageUrl`, never handed to a client).
//
// A chat message embeds only an immutable `attachmentId` plus the few
// presentation fields a bubble needs to draw itself (name, mime type, size)
// and a *protected app route* — `/chat/:conversationId/attachments/:attachmentId`.
// It deliberately embeds no `storagePath`, no `downloadUrl` and no bucket, so
// there is exactly one source of truth for "where is this file and who may
// read it", and a client can never talk its way to the bytes by supplying its
// own storage location.
//
// The collection name, field names and ObjectId types here are chosen to be
// byte-compatible with the `ChatAttachment` Mongoose model in the separate
// Capstone-Website admin repository (`server/models/ChatAttachment.js`), which
// reads the same MongoDB. A record written here resolves through that repo's
// existing protected `downloadChatAttachment` handler with no change to its
// authorization logic, and vice versa.

const { ObjectId } = require('mongodb');

const CHAT_ATTACHMENT_COLLECTION = 'chat_attachments';

// Matches the enum on Capstone-Website's ChatAttachment schema exactly.
const UPLOADER_ROLES = new Set(['tenant', 'admin', 'owner']);
const OWNER_ROLE_VALUES = new Set(['owner', 'superadmin']);

function toObjectId(value) {
  if (!value) return null;
  try {
    const candidate = typeof value?.toHexString === 'function' ? value.toHexString() : String(value);
    return ObjectId.isValid(candidate) ? new ObjectId(candidate) : null;
  } catch (_error) {
    return null;
  }
}

// tenant | admin | owner — an admin whose role is owner/superadmin is stored
// as `owner`, matching how the admin repository classifies the same person.
function normalizeUploaderRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'tenant' || !normalized) return 'tenant';
  if (OWNER_ROLE_VALUES.has(normalized)) return 'owner';
  if (UPLOADER_ROLES.has(normalized)) return normalized;
  return 'admin';
}

// The one protected route shape both apps consume. Never a storage URL.
function buildAttachmentUrl(conversationId, attachmentId) {
  const conversation = String(conversationId || '').trim();
  const attachment = String(attachmentId || '').trim();
  if (!conversation || !attachment) return '';
  return `/chat/${conversation}/attachments/${attachment}`;
}

// Inserts the canonical record and returns it (with its generated `_id`).
// `normalized` is the already-validated, already-ownership-proven metadata
// produced by the chat controller — this function never re-derives trust.
async function createChatAttachment(db, {
  conversation,
  uploader,
  uploaderRole,
  attachment,
  clientAttachmentId = '',
} = {}) {
  const conversationId = toObjectId(conversation?._id);
  const uploadedBy = toObjectId(uploader?._id);
  const branch = String(conversation?.branch || '').trim();

  if (!conversationId || !uploadedBy || !branch) {
    const error = new Error('Attachment could not be registered for this conversation.');
    error.statusCode = 400;
    error.code = 'ATTACHMENT_INVALID';
    throw error;
  }

  const now = new Date();
  const doc = {
    conversationId,
    branch,
    uploadedBy,
    uploaderRole: normalizeUploaderRole(uploaderRole),
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    provider: attachment.provider || 'firebase-storage',
    storagePath: attachment.storagePath,
    // Kept server-side only. It is never serialized to a client, and the
    // download handler streams from `storagePath` with privileged credentials
    // rather than redirecting anyone to this URL.
    storageUrl: attachment.downloadUrl,
    createdAt: attachment.uploadedAt instanceof Date ? attachment.uploadedAt : now,
    updatedAt: now,
  };
  if (clientAttachmentId) doc.clientAttachmentId = clientAttachmentId;

  const result = await db.collection(CHAT_ATTACHMENT_COLLECTION).insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function findIdempotentConversationAttachment(
  db,
  conversationId,
  uploadedBy,
  clientAttachmentId,
) {
  const conversation = toObjectId(conversationId);
  const uploader = toObjectId(uploadedBy);
  if (!conversation || !uploader || !clientAttachmentId) return null;
  return db.collection(CHAT_ATTACHMENT_COLLECTION).findOne({
    conversationId: conversation,
    uploadedBy: uploader,
    clientAttachmentId,
  });
}

// Resolves attachment records that are bound to this exact conversation.
// The conversation must already have been authorized for the caller; binding
// on `conversationId` is what stops an attachment from one conversation being
// substituted into another.
async function findConversationAttachments(db, conversationId, attachmentIds = []) {
  const conversation = toObjectId(conversationId);
  const ids = attachmentIds.map(toObjectId).filter(Boolean);
  if (!conversation || !ids.length) return [];
  return db.collection(CHAT_ATTACHMENT_COLLECTION)
    .find({ _id: { $in: ids }, conversationId: conversation })
    .toArray();
}

async function findConversationAttachment(db, conversationId, attachmentId) {
  const conversation = toObjectId(conversationId);
  const attachment = toObjectId(attachmentId);
  if (!conversation || !attachment) return null;
  return db.collection(CHAT_ATTACHMENT_COLLECTION)
    .findOne({ _id: attachment, conversationId: conversation });
}

// The exact key set a client is allowed to see. Storage-provider internals
// (storagePath, storageUrl, bucket) are deliberately absent.
function serializeAttachmentRecord(record = {}, conversationId) {
  const attachmentId = record._id ? String(record._id) : '';
  const url = buildAttachmentUrl(conversationId || record.conversationId, attachmentId);
  const name = record.originalName || 'attachment';
  const mimeType = record.mimeType || 'application/octet-stream';
  return {
    attachmentId,
    id: attachmentId,
    name,
    fileName: name,
    originalName: name,
    mimeType,
    type: mimeType,
    size: Number.isFinite(Number(record.size)) ? Number(record.size) : 0,
    provider: record.provider || 'firebase-storage',
    uploadedAt: record.createdAt || null,
    url,
    fileUrl: url,
  };
}

module.exports = {
  CHAT_ATTACHMENT_COLLECTION,
  buildAttachmentUrl,
  createChatAttachment,
  findConversationAttachment,
  findConversationAttachments,
  findIdempotentConversationAttachment,
  normalizeUploaderRole,
  serializeAttachmentRecord,
};
