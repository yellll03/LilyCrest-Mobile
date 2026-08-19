#!/usr/bin/env node
'use strict';

// Backfill legacy support-chat attachment embeds onto the canonical
// `chat_attachments` identity.
//
// WHY
// ---
// Before the canonical contract landed, a chat message embedded the storage
// facts directly: a public Firebase download URL in `url`/`fileUrl`, plus
// name/mimeType/size. There was no `attachmentId`, so those embeds cannot be
// resolved through the protected read route and the serializer drops them —
// the tile would otherwise render permanently broken. This script recovers
// them by minting the missing `chat_attachments` record and rewriting the
// embed to the canonical id-only shape.
//
// SAFETY RULES (all enforced below, none optional)
//   * Dry run is the default. Writing requires an explicit --apply.
//   * Nothing is read from a client. The only inputs are documents already
//     persisted server-side.
//   * The storage path is derived from the *stored* Firebase URL and is
//     accepted only if the bucket in that URL equals this deployment's
//     configured bucket. A URL naming any other bucket is skipped.
//   * The referenced object must actually exist in storage. A record is never
//     minted for bytes that are gone.
//   * Conversation ownership is re-proven: the message's conversation must
//     exist, and the record inherits that conversation's `_id` and `branch`
//     rather than anything from the embed.
//   * Idempotent. A conversation+storagePath that already has a record reuses
//     it instead of creating a second one, and an embed that already carries
//     an `attachmentId` is left alone. Re-running is a no-op.
//
// USAGE
//   node scripts/backfillLegacyChatAttachments.js            # dry run
//   node scripts/backfillLegacyChatAttachments.js --apply    # writes

require('dotenv').config();

const { MongoClient } = require('mongodb');
const { admin, initializeFirebase, resolveStorageBucket } = require('../config/firebase');
const { CHAT_ATTACHMENT_COLLECTION, normalizeUploaderRole } = require('../services/chatAttachment.service');

const APPLY = process.argv.includes('--apply');
const MESSAGES = 'chat_messages';
const CONVERSATIONS = 'chat_conversations';

// `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<url-encoded path>?...`
function parseFirebaseUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'firebasestorage.googleapis.com') return null;
    const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!match) return null;
    return {
      bucket: decodeURIComponent(match[1]),
      storagePath: decodeURIComponent(match[2]),
    };
  } catch (_error) {
    return null;
  }
}

function isLegacyEmbed(embed) {
  return Boolean(embed) && !embed.attachmentId;
}

async function main() {
  const bucketName = resolveStorageBucket();
  if (!bucketName) {
    console.error('FIREBASE bucket is not configured — cannot verify stored objects. Aborting.');
    process.exitCode = 1;
    return;
  }

  let storageBucket = null;
  try {
    initializeFirebase();
    storageBucket = admin.storage().bucket(bucketName);
  } catch (error) {
    console.error(`Firebase Admin could not be initialized (${error.message}) — cannot verify stored objects. Aborting.`);
    process.exitCode = 1;
    return;
  }

  const client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db(process.env.DB_NAME);

  const report = {
    mode: APPLY ? 'APPLY' : 'DRY RUN',
    bucket: bucketName,
    messagesScanned: 0,
    legacyEmbeds: 0,
    recoverable: 0,
    reusedExistingRecord: 0,
    recordsCreated: 0,
    messagesRewritten: 0,
    skipped: [],
    earliest: null,
    latest: null,
  };

  const cursor = db.collection(MESSAGES).find({
    attachments: { $elemMatch: { attachmentId: { $exists: false } } },
  });

  for await (const message of cursor) {
    report.messagesScanned += 1;
    const createdAt = message.createdAt ? new Date(message.createdAt) : null;
    if (createdAt && (!report.earliest || createdAt < report.earliest)) report.earliest = createdAt;
    if (createdAt && (!report.latest || createdAt > report.latest)) report.latest = createdAt;

    const conversation = await db.collection(CONVERSATIONS).findOne({ _id: message.conversationId });
    const nextEmbeds = [];
    let changed = false;

    for (const embed of message.attachments || []) {
      if (!isLegacyEmbed(embed)) {
        nextEmbeds.push(embed);
        continue;
      }

      report.legacyEmbeds += 1;
      const note = (reason) => report.skipped.push({
        messageId: String(message._id),
        name: embed.name || embed.fileName || '',
        reason,
      });

      if (!conversation) {
        note('conversation no longer exists');
        nextEmbeds.push(embed);
        continue;
      }
      if (!String(conversation.branch || '').trim()) {
        note('conversation has no branch — cannot authorize the record');
        nextEmbeds.push(embed);
        continue;
      }

      const located = parseFirebaseUrl(embed.url || embed.fileUrl || embed.downloadUrl || embed.uri)
        || (embed.storagePath ? { bucket: bucketName, storagePath: String(embed.storagePath) } : null);
      if (!located) {
        note('no resolvable storage location in the embed');
        nextEmbeds.push(embed);
        continue;
      }
      if (located.bucket !== bucketName) {
        note(`stored URL names a foreign bucket (${located.bucket})`);
        nextEmbeds.push(embed);
        continue;
      }

      let exists = false;
      try {
        [exists] = await storageBucket.file(located.storagePath).exists();
      } catch (error) {
        note(`storage check failed: ${error.message}`);
        nextEmbeds.push(embed);
        continue;
      }
      if (!exists) {
        note('the underlying storage object no longer exists');
        nextEmbeds.push(embed);
        continue;
      }

      report.recoverable += 1;

      // Idempotency: one record per conversation+object.
      let record = await db.collection(CHAT_ATTACHMENT_COLLECTION).findOne({
        conversationId: conversation._id,
        storagePath: located.storagePath,
      });

      if (record) {
        report.reusedExistingRecord += 1;
      } else if (APPLY) {
        const now = new Date();
        const doc = {
          conversationId: conversation._id,
          branch: String(conversation.branch).trim(),
          uploadedBy: message.senderId,
          uploaderRole: normalizeUploaderRole(message.senderRole),
          originalName: String(embed.name || embed.fileName || 'attachment').slice(0, 255),
          mimeType: String(embed.mimeType || embed.type || 'application/octet-stream'),
          size: Number.isFinite(Number(embed.size)) ? Number(embed.size) : 0,
          provider: 'firebase-storage',
          storagePath: located.storagePath,
          storageUrl: String(embed.url || embed.fileUrl || ''),
          createdAt: message.createdAt || now,
          updatedAt: now,
        };
        const result = await db.collection(CHAT_ATTACHMENT_COLLECTION).insertOne(doc);
        record = { ...doc, _id: result.insertedId };
        report.recordsCreated += 1;
      } else {
        report.recordsCreated += 1;
        nextEmbeds.push(embed);
        changed = true;
        continue;
      }

      const url = `/chat/${conversation._id}/attachments/${record._id}`;
      nextEmbeds.push({
        attachmentId: record._id,
        url,
        fileUrl: url,
        name: record.originalName,
        fileName: record.originalName,
        type: record.mimeType,
        mimeType: record.mimeType,
        size: record.size,
      });
      changed = true;
    }

    if (changed) {
      report.messagesRewritten += 1;
      if (APPLY) {
        await db.collection(MESSAGES).updateOne(
          { _id: message._id },
          { $set: { attachments: nextEmbeds, updatedAt: new Date() } },
        );
      }
    }
  }

  await client.close();

  console.log(JSON.stringify({
    ...report,
    earliest: report.earliest ? report.earliest.toISOString() : null,
    latest: report.latest ? report.latest.toISOString() : null,
  }, null, 2));

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to perform the backfill.');
  }
}

main().catch((error) => {
  console.error('Backfill failed:', error.message);
  process.exitCode = 1;
});
