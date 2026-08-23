#!/usr/bin/env node
const { assertStagingWriteTarget } = require('./stagingWriteGuard');

'use strict';

// Inventory the old support work-item collections and, when explicitly
// requested, link only unambiguous legacy rows to the canonical conversation
// that replaced them. Dry run is the default. This script never deletes,
// archives, or changes lifecycle state.

require('dotenv').config();

const { MongoClient } = require('mongodb');

const LEGACY_COLLECTIONS = ['live_chat_requests', 'live_chat_archive', 'tickets'];
const CANONICAL_COLLECTIONS = ['chat_conversations', 'chat_messages', 'chat_attachments'];
const LINKED_BY = 'auditLegacySupportWorkItems';

function text(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function legacyIdentity(doc = {}) {
  return {
    sessionId: text(doc.session_id || doc.sessionId || doc.assistantSessionId),
    tenantUserId: text(doc.user_id || doc.userId || doc.tenantUserId),
  };
}

function canonicalIdentity(doc = {}) {
  return {
    id: text(doc._id),
    sessionId: text(doc.assistantSessionId),
    tenantUserId: text(doc.tenantUserId || doc.user_id),
  };
}

function matchingCanonicalConversations(legacy, conversations = []) {
  const identity = legacyIdentity(legacy);
  if (!identity.sessionId) return [];
  return conversations.filter((conversation) => {
    const candidate = canonicalIdentity(conversation);
    if (candidate.sessionId !== identity.sessionId) return false;
    return !identity.tenantUserId || candidate.tenantUserId === identity.tenantUserId;
  });
}

function classifyLegacyLink(legacy, conversations = []) {
  const linkedId = text(legacy?.canonicalConversationId);
  const candidates = matchingCanonicalConversations(legacy, conversations);

  if (linkedId) {
    const target = conversations.find((conversation) => canonicalIdentity(conversation).id === linkedId);
    if (!target || (candidates.length && !candidates.some((candidate) => text(candidate._id) === linkedId))) {
      return { status: 'conflicting', candidates, target: target || null };
    }
    return { status: 'alreadyLinked', candidates, target };
  }

  if (candidates.length === 1) return { status: 'eligible', candidates, target: candidates[0] };
  if (candidates.length > 1) return { status: 'ambiguous', candidates, target: null };
  return { status: 'unlinked', candidates, target: null };
}

function emptyLegacySummary() {
  return {
    scanned: 0,
    alreadyLinked: 0,
    eligible: 0,
    unlinked: 0,
    ambiguous: 0,
    conflicting: 0,
    linked: 0,
    examples: { unlinked: [], ambiguous: [], conflicting: [] },
  };
}

async function auditLegacyCollection(db, collectionName, conversations, applyLinks) {
  const summary = emptyLegacySummary();
  const cursor = db.collection(collectionName).find({});

  for await (const doc of cursor) {
    summary.scanned += 1;
    const classification = classifyLegacyLink(doc, conversations);
    summary[classification.status] += 1;

    if (classification.status === 'eligible' && applyLinks) {
      const result = await db.collection(collectionName).updateOne(
        {
          _id: doc._id,
          $or: [
            { canonicalConversationId: { $exists: false } },
            { canonicalConversationId: null },
            { canonicalConversationId: '' },
          ],
        },
        {
          $set: {
            canonicalConversationId: classification.target._id,
            canonicalLinkedAt: new Date(),
            canonicalLinkedBy: LINKED_BY,
          },
        },
      );
      summary.linked += result.modifiedCount || 0;
    }

    if (summary.examples[classification.status]?.length < 10) {
      summary.examples[classification.status].push({
        legacyId: text(doc._id),
        sessionId: legacyIdentity(doc).sessionId || null,
        tenantUserId: legacyIdentity(doc).tenantUserId || null,
        candidateConversationIds: classification.candidates.map((candidate) => text(candidate._id)),
      });
    }
  }

  return summary;
}

async function runAudit(db, { applyLinks = false } = {}) {
  const conversations = await db.collection('chat_conversations').find({}).toArray();
  const report = {
    mode: applyLinks ? 'APPLY LINKS' : 'DRY RUN',
    destructiveChanges: false,
    canonical: {},
    legacy: {},
  };

  for (const collectionName of CANONICAL_COLLECTIONS) {
    report.canonical[collectionName] = collectionName === 'chat_conversations'
      ? conversations.length
      : await db.collection(collectionName).countDocuments({});
  }

  for (const collectionName of LEGACY_COLLECTIONS) {
    report.legacy[collectionName] = await auditLegacyCollection(
      db,
      collectionName,
      conversations,
      applyLinks,
    );
  }

  return report;
}

async function main() {
  const applyLinks = process.argv.includes('--apply-links');
  const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
  const dbName = process.env.DB_NAME || 'lilycrest_db';
  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 20000 });

  try {
    await client.connect();
    const report = await runAudit(client.db(dbName), { applyLinks });
    console.log(JSON.stringify(report, null, 2));
    if (!applyLinks) {
      console.log('\nDRY RUN - nothing was written. Re-run with --apply-links to add only unambiguous canonical links.');
    }
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  assertStagingWriteTarget(process.env, { toolName: 'auditLegacySupportWorkItems.js' });
  main().catch((error) => {
    console.error('Legacy support audit failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  CANONICAL_COLLECTIONS,
  LEGACY_COLLECTIONS,
  auditLegacyCollection,
  canonicalIdentity,
  classifyLegacyLink,
  legacyIdentity,
  matchingCanonicalConversations,
  runAudit,
};
