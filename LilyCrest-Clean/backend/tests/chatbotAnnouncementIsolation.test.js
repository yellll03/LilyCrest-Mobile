'use strict';

// MOB-P0-02 mandatory prompt-spy regression: the Lily Assistant chatbot must
// never place an announcement a tenant isn't authorized to see into the
// Gemini prompt/context. Before this fix, sendMessage queried
// `{is_active:true}` directly with no owner/branch/publish/expiry filter,
// so another branch's announcement, another tenant's private announcement,
// or a future/expired/archived one could all leak into the prompt sent to
// the model. This test spies on the (mocked) Gemini call and asserts the
// forbidden fixtures never appear in what's actually sent.
//
// Uses the same require.cache-seeding technique as
// announcementHandlerIntegration.test.js, extended to also seed
// services/gemini.service.js (the chatbot's only network dependency).
// Must run in isolation if config/database.js or services/gemini.service.js
// were already required by an earlier test in this process.

const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../config/database');
const geminiModulePath = require.resolve('../services/gemini.service');

function cursor(records = []) {
  return { sort() { return this; }, limit() { return this; }, async toArray() { return records; } };
}

// Mirrors buildAnnouncementBaseQuery's query-level filter (active/archived/
// private-ownership) — see announcementVisibilitySecurity.test.js for why
// this in-memory fake needs to enforce that layer too, not just branch/window.
function matchesAnnouncementQuery(doc, userId) {
  const isActive = doc.is_active === true || doc.isActive === true
    || (doc.is_active === undefined && doc.isActive === undefined);
  if (!isActive) return false;
  if (doc.isArchived === true) return false;
  const isPrivate = doc.is_private === true || doc.isPrivate === true;
  if (!isPrivate) return true;
  if (!userId) return false;
  return (doc.is_private === true && doc.user_id === userId)
    || (doc.isPrivate === true && doc.userId === userId);
}

function fakeDb({ announcements = [], reservations = [], requesterUserId = null } = {}) {
  return {
    collection(name) {
      if (name === 'announcements') {
        return { find() { return cursor(announcements.filter((doc) => matchesAnnouncementQuery(doc, requesterUserId))); } };
      }
      if (name === 'reservations') {
        return {
          find(query) {
            const contractTier = JSON.stringify(query || {}).includes('contractStatus');
            return cursor(reservations.filter((record) => contractTier
              ? Boolean(record.contractStatus || record.leaseStatus || record.contractApproved)
              : Boolean(record.status || record.applicationStatus || record.approvalStatus || record.isApproved)));
          },
          async findOne() { return null; },
        };
      }
      return {
        find() { return cursor([]); },
        async findOne() { return null; },
        async insertOne() { return { insertedId: 'fake' }; },
        async updateOne() { return { matchedCount: 0, modifiedCount: 0 }; },
      };
    },
  };
}

let currentDb = null;
const capturedPrompts = [];

if (require.cache[dbModulePath] || require.cache[geminiModulePath]) {
  throw new Error(
    'config/database.js or services/gemini.service.js was already required by an earlier test in this '
    + 'process — the require.cache seeding trick in chatbotAnnouncementIsolation.test.js only works if '
    + 'this file requires the chatbot controller first. Run this file in isolation if it fails for this reason.',
  );
}

require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: {
    getDb: () => currentDb,
    connectToMongo: async () => currentDb,
    closeConnection: async () => {},
  },
};

require.cache[geminiModulePath] = {
  id: geminiModulePath,
  filename: geminiModulePath,
  loaded: true,
  exports: {
    classifyIntent: async () => ({ intent: 'general', confidence: 0.3 }),
    // The prompt spy: records every prompt actually sent to "Gemini".
    async sendGeminiMessage(_sessionId, prompt) {
      capturedPrompts.push(prompt);
      return { text: 'Mock Lily response.' };
    },
    liveChatQueue: new Map(),
    chatSessions: new Map(),
    isQuotaError: () => false,
  },
};

const { sendMessage } = require('../controllers/chatbot.controller');
const { liveChatQueue: sharedLiveChatQueue, chatSessions: sharedChatSessions } = require('../services/gemini.service');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const GIL_PUYAT_RESERVATION = { user_id: 'tenant-gil', branch: 'gil-puyat', status: 'approved' };
const NOW = new Date();
const PAST = new Date(NOW.getTime() - 60 * 60 * 1000);
const FUTURE = new Date(NOW.getTime() + 60 * 60 * 1000);

function fixtureAnnouncements() {
  return [
    { announcement_id: 'a-global', title: 'Global Notice', content: 'GLOBAL_MARKER_CONTENT', publishedAt: PAST },
    { announcement_id: 'a-branch-gil', title: 'Gil Puyat Notice', content: 'BRANCH_GIL_MARKER_CONTENT', branch: 'gil-puyat', publishedAt: PAST },
    { announcement_id: 'a-branch-guadalupe', title: 'FORBIDDEN Guadalupe-only Notice', content: 'FORBIDDEN_BRANCH_MARKER_CONTENT', branch: 'guadalupe', publishedAt: PAST },
    { announcement_id: 'a-private-mine', title: 'Private For Gil', content: 'PRIVATE_MINE_MARKER_CONTENT', is_private: true, user_id: 'tenant-gil', publishedAt: PAST },
    { announcement_id: 'a-private-other', title: 'FORBIDDEN Private For Someone Else', content: 'FORBIDDEN_PRIVATE_MARKER_CONTENT', is_private: true, user_id: 'tenant-other', publishedAt: PAST },
    { announcement_id: 'a-future', title: 'FORBIDDEN Future Notice', content: 'FORBIDDEN_FUTURE_MARKER_CONTENT', publishedAt: FUTURE },
    { announcement_id: 'a-expired', title: 'FORBIDDEN Expired Notice', content: 'FORBIDDEN_EXPIRED_MARKER_CONTENT', publishedAt: PAST, expiresAt: PAST },
    { announcement_id: 'a-archived', title: 'FORBIDDEN Archived Notice', content: 'FORBIDDEN_ARCHIVED_MARKER_CONTENT', isArchived: true, publishedAt: PAST },
  ];
}

const ALLOWED_MARKERS = ['GLOBAL_MARKER_CONTENT', 'BRANCH_GIL_MARKER_CONTENT', 'PRIVATE_MINE_MARKER_CONTENT'];
const FORBIDDEN_MARKERS = [
  'FORBIDDEN_BRANCH_MARKER_CONTENT',
  'FORBIDDEN_PRIVATE_MARKER_CONTENT',
  'FORBIDDEN_FUTURE_MARKER_CONTENT',
  'FORBIDDEN_EXPIRED_MARKER_CONTENT',
  'FORBIDDEN_ARCHIVED_MARKER_CONTENT',
];

test.beforeEach(() => {
  capturedPrompts.length = 0;
  sharedLiveChatQueue.clear();
  sharedChatSessions.clear();
});

test('chatbot: Gemini prompt for a Gil Puyat tenant includes only authorized announcements, never another branch, another tenant private, future, expired, or archived content', async () => {
  currentDb = fakeDb({
    announcements: fixtureAnnouncements(),
    reservations: [GIL_PUYAT_RESERVATION],
    requesterUserId: 'tenant-gil',
  });

  const req = {
    user: { user_id: 'tenant-gil', name: 'Gil Tenant', email: 'gil@example.com' },
    body: { message: 'What are the latest announcements at the dorm?', session_id: 'tenant-gil_isolation-test' },
  };
  const res = fakeRes();
  await sendMessage(req, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(capturedPrompts.length > 0, true, 'sendGeminiMessage must have been called at least once');

  const fullPromptText = capturedPrompts.join('\n---\n');

  for (const marker of ALLOWED_MARKERS) {
    assert.equal(fullPromptText.includes(marker), true, `expected authorized marker "${marker}" to be present in the prompt`);
  }
  for (const marker of FORBIDDEN_MARKERS) {
    assert.equal(fullPromptText.includes(marker), false, `forbidden marker "${marker}" must NEVER appear in the Gemini prompt`);
  }
  // Also assert on the announcement titles themselves, as an independent check.
  assert.equal(fullPromptText.includes('FORBIDDEN'), false, 'no title tagged FORBIDDEN may appear anywhere in the prompt');
});

test('chatbot: unauthenticated-branch (no resolvable occupancy) tenant only gets the global announcement in the prompt', async () => {
  currentDb = fakeDb({
    announcements: fixtureAnnouncements(),
    reservations: [],
    requesterUserId: 'tenant-no-branch',
  });

  const req = {
    user: { user_id: 'tenant-no-branch', name: 'No Branch Tenant', email: 'nobranch@example.com' },
    body: { message: 'What are the latest announcements at the dorm?', session_id: 'tenant-no-branch_isolation-test' },
  };
  const res = fakeRes();
  await sendMessage(req, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const fullPromptText = capturedPrompts.join('\n---\n');
  assert.equal(fullPromptText.includes('GLOBAL_MARKER_CONTENT'), true);
  for (const marker of [...FORBIDDEN_MARKERS, 'BRANCH_GIL_MARKER_CONTENT', 'PRIVATE_MINE_MARKER_CONTENT']) {
    assert.equal(fullPromptText.includes(marker), false, `marker "${marker}" must not leak to a tenant with no resolvable branch/ownership`);
  }
});

test('chatbot: with zero visible announcements, the prompt omits the "Recent announcements" section entirely', async () => {
  currentDb = fakeDb({ announcements: [], requesterUserId: 'tenant-empty' });
  const req = {
    user: { user_id: 'tenant-empty', name: 'Empty Tenant', email: 'empty@example.com' },
    body: { message: 'What are the latest announcements at the dorm?', session_id: 'tenant-empty_isolation-test' },
  };
  const res = fakeRes();
  await sendMessage(req, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const fullPromptText = capturedPrompts.join('\n---\n');
  assert.equal(fullPromptText.includes('Recent announcements:'), false);
});
