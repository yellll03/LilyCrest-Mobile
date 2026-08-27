'use strict';

// Regression coverage for the chatbot redesign's data-sourcing correctness:
// contract facts come only from the canonical CONTRACT_UPSTREAM_URL bridge
// (never a locally-derived guess), maintenance/announcement context reuse
// the same canonical, ownership-scoped services the rest of the app uses,
// and no client-supplied id embedded in chat message text can ever
// influence which tenant's record gets fetched.

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

process.env.CONTRACT_UPSTREAM_URL = process.env.CONTRACT_UPSTREAM_URL || 'https://api.lilycrest.space';

async function withMockedAxiosGet(impl, fn) {
  const original = axios.get;
  axios.get = impl;
  try {
    await fn();
  } finally {
    axios.get = original;
  }
}

// Tiny Mongo-query matcher covering only the operators
// buildTenantAnnouncementQuery / buildUserMaintenanceFilter actually emit
// ($and, $or, plain equality, $ne, $exists) — enough to faithfully emulate
// how a real MongoDB would apply these specific filters against fixtures.
function matchesQuery(doc, query) {
  if (!query || typeof query !== 'object') return true;
  if (Array.isArray(query.$and)) return query.$and.every((q) => matchesQuery(doc, q));
  if (Array.isArray(query.$or)) return query.$or.some((q) => matchesQuery(doc, q));
  return Object.entries(query).every(([field, condition]) => {
    const value = doc[field];
    if (condition instanceof RegExp) return condition.test(String(value || ''));
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      if ('$ne' in condition) return value !== condition.$ne;
      if ('$in' in condition) return condition.$in.includes(value);
      if ('$exists' in condition) return condition.$exists ? value !== undefined : value === undefined;
      throw new Error(`unsupported query operator in test matcher: ${JSON.stringify(condition)}`);
    }
    return value === condition;
  });
}

function makeFakeDb(fixtures = {}) {
  return {
    collection(name) {
      const docs = fixtures[name] || [];
      return {
        find(query) {
          const matched = docs.filter((doc) => matchesQuery(doc, query));
          return { sort() { return this; }, limit() { return this; }, toArray: async () => matched };
        },
        findOne: async () => null,
        countDocuments: async () => 0,
        insertOne: async () => ({ insertedId: 'fake' }),
        updateOne: async () => ({}),
      };
    },
  };
}

function stubGeminiService() {
  const geminiPath = require.resolve('../services/gemini.service');
  const originalEntry = require.cache[geminiPath];
  const calls = [];
  const stub = {
    classifyIntent: async () => ({ intent: 'general', confidence: 0.4 }),
    sendGeminiMessage: async (sessionId, prompt) => {
      calls.push({ sessionId, prompt });
      return { text: 'Here is what I found for you po.' };
    },
    chatSessions: new Map(),
    isQuotaError: () => false,
  };
  require.cache[geminiPath] = { id: geminiPath, filename: geminiPath, loaded: true, exports: stub };
  const controllerPath = require.resolve('../controllers/chatbot.controller');
  delete require.cache[controllerPath];
  const chatbotController = require(controllerPath);
  return {
    chatbotController,
    calls,
    restore() {
      if (originalEntry) require.cache[geminiPath] = originalEntry;
      else delete require.cache[geminiPath];
      delete require.cache[controllerPath];
    },
  };
}

// Must be called BEFORE stubGeminiService() (which re-requires
// chatbot.controller.js): chatbot.controller.js destructures `{ getDb }` at
// require time, so the mock has to already be in place on the shared
// config/database module before that require runs, or the stale reference
// baked into the freshly-required controller will ignore it.
function withFakeDb(db, fn) {
  const databasePath = require.resolve('../config/database');
  const databaseModule = require(databasePath);
  const original = databaseModule.getDb;
  databaseModule.getDb = () => db;
  return Promise.resolve().then(fn).finally(() => {
    databaseModule.getDb = original;
  });
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const TENANT_A = { user_id: 'tenant-a', email: 'a@example.com', name: 'Tenant A', role: 'tenant', _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' };

// ── resolveCanonicalContractContext: contract facts come only from the ────
// ── upstream bridge, never a local reservations/user.contract derivation ──

test('resolveCanonicalContractContext maps the canonical upstream contract, never touching db', async () => {
  const { chatbotController, restore } = stubGeminiService();
  try {
    await withMockedAxiosGet(async () => ({
      status: 200,
      data: {
        contract: {
          id: '507f1f77bcf86cd799439011',
          displayStatus: 'Active',
          leaseStartDate: '2026-06-14',
          leaseEndDate: '2026-12-14',
          leaseType: 'six_month',
          approvedMonthlyRate: 5400,
          securityDepositAmount: 5400,
          advanceRentAmount: 5400,
          reservationFeeAmount: 1000,
          tenantDocument: { available: true, type: 'final_notarized' },
        },
        state: 'CONTRACT_AVAILABLE',
      },
    }), async () => {
      const req = { headers: { authorization: 'Bearer t' } };
      const ctx = await chatbotController.__test.resolveCanonicalContractContext(req);
      assert.equal(ctx.available, true);
      assert.equal(ctx.contractId, '507f1f77bcf86cd799439011');
      assert.equal(ctx.contractStart, '2026-06-14');
      assert.equal(ctx.contractEnd, '2026-12-14');
      assert.equal(ctx.monthlyRent, 5400);
      assert.equal(ctx.documentAvailable, true);
      assert.equal(ctx.documentKind, 'final');
      assert.equal(ctx.moveInFinancials.remainingBalance, 5400 + 5400 - 1000);
    });
  } finally {
    restore();
  }
});

test('resolveCanonicalContractContext fails honest (available: false) when upstream has no contract, never fabricating dates', async () => {
  const { chatbotController, restore } = stubGeminiService();
  try {
    await withMockedAxiosGet(async () => ({ status: 404, data: { detail: 'No contract found.' } }), async () => {
      const req = { headers: { authorization: 'Bearer t' } };
      const ctx = await chatbotController.__test.resolveCanonicalContractContext(req);
      assert.equal(ctx.available, false);
      assert.equal(ctx.contract, null);
      assert.equal(ctx.errorKind, 'unavailable', 'a 404 from the bridge is a real access failure, not proof the tenant has no contract');
    });
  } finally {
    restore();
  }
});

// ── Regression: distinct failure kinds must never be presented to the ─────
// ── tenant as an undifferentiated "you have no contract" message ──────────

test('resolveCanonicalContractContext classifies each upstream outcome distinctly (mirrors useTenantContract.js)', async () => {
  const { chatbotController, restore } = stubGeminiService();
  try {
    const req = { headers: { authorization: 'Bearer t' } };

    await withMockedAxiosGet(async () => ({ status: 200, data: { contract: null, state: 'NO_PUBLISHED_CONTRACT' } }), async () => {
      const ctx = await chatbotController.__test.resolveCanonicalContractContext(req);
      assert.equal(ctx.errorKind, 'not_found', 'a successful response with no contract is the genuine no-contract-yet case');
    });

    await withMockedAxiosGet(async () => ({ status: 409, data: { detail: 'Multiple active contracts found.' } }), async () => {
      const ctx = await chatbotController.__test.resolveCanonicalContractContext(req);
      assert.equal(ctx.errorKind, 'conflict');
    });

    await withMockedAxiosGet(async () => ({ status: 401, data: { detail: 'Session invalid.' } }), async () => {
      const ctx = await chatbotController.__test.resolveCanonicalContractContext(req);
      assert.equal(ctx.errorKind, 'unauthorized');
    });

    await withMockedAxiosGet(async () => ({ status: 502, data: { detail: 'Contract service is unavailable.' } }), async () => {
      const ctx = await chatbotController.__test.resolveCanonicalContractContext(req);
      assert.equal(ctx.errorKind, 'unavailable');
    });
  } finally {
    restore();
  }
});

test('contractUnavailabilityResponse gives distinct, non-misleading wording per failure kind, and null for a genuine no-contract-yet case', () => {
  const { chatbotController, restore } = stubGeminiService();
  try {
    const conflict = chatbotController.__test.contractUnavailabilityResponse('conflict');
    assert.match(conflict.message, /more than one active contract/i);
    assert.doesNotMatch(conflict.message, /no approved lease contract/i);

    const unauthorized = chatbotController.__test.contractUnavailabilityResponse('unauthorized');
    assert.match(unauthorized.message, /sign in again/i);

    const unavailable = chatbotController.__test.contractUnavailabilityResponse('unavailable');
    assert.match(unavailable.message, /try again shortly/i);

    assert.equal(chatbotController.__test.contractUnavailabilityResponse('not_found'), null);
    assert.equal(chatbotController.__test.contractUnavailabilityResponse(undefined), null);
  } finally {
    restore();
  }
});

test('buildContractResponse surfaces the conflict/unauthorized/unavailable message instead of "no contract yet" when that is not actually true', () => {
  const { chatbotController, restore } = stubGeminiService();
  try {
    const conflictResult = chatbotController.__test.buildContractResponse(
      { contractFileAvailable: false, contractErrorKind: 'conflict' },
      'When will my contract expire?'
    );
    assert.match(conflictResult.message, /more than one active contract/i);

    const genuineNoContract = chatbotController.__test.buildContractResponse(
      { contractFileAvailable: false, contractErrorKind: 'not_found' },
      'When will my contract expire?'
    );
    assert.match(genuineNoContract.message, /No approved lease contract is available yet/i);
  } finally {
    restore();
  }
});

// ── Maintenance: chatbot reuses the canonical, ownership-scoped loader ────

test('fetchMaintenanceRequestsForUser only returns this tenant\'s own requests, deduped across primary/legacy collections', async () => {
  const { chatbotController, restore } = stubGeminiService();
  try {
    const db = makeFakeDb({
      maintenance_requests: [
        { _id: 'r1', request_id: 'req-1', user_id: 'tenant-a', request_type: 'leak', status: 'pending', created_at: '2026-08-01' },
        { _id: 'r2', request_id: 'req-2', user_id: 'tenant-b', request_type: 'other tenant issue', status: 'pending', created_at: '2026-08-02' },
      ],
      maintenancerequests: [
        { _id: 'r1-legacy', request_id: 'req-1', user_id: 'tenant-a', request_type: 'leak (legacy dup)', status: 'pending', created_at: '2026-08-01' },
      ],
    });
    const requests = await chatbotController.__test.fetchMaintenanceRequestsForUser(db, TENANT_A);
    assert.equal(requests.length, 1, 'duplicate primary/legacy records for the same request_id must be deduped');
    assert.equal(requests[0].request_id, 'req-1');
    assert.ok(!requests.some((r) => r.user_id === 'tenant-b'), 'another tenant\'s request must never be returned');
  } finally {
    restore();
  }
});

// ── Announcements: branch/private scoping applied, matching the tenant ────
// ── News-tab endpoint's own visibility rule ────────────────────────────────

test('sendMessage context never includes another branch\'s or another tenant\'s private announcement', async () => {
  const db = makeFakeDb({
    announcements: [
      { announcement_id: 'ann_global', title: 'Global Notice', content: 'Visible to everyone', is_active: true },
      { announcement_id: 'ann_own_branch', title: 'Own Branch Notice', content: 'Visible to Branch A', is_active: true, branch: 'gil-puyat' },
      { announcement_id: 'ann_other_branch', title: 'Other Branch Only', content: 'Should not leak', is_active: true, branch: 'guadalupe' },
      { announcement_id: 'ann_private_mine', title: 'Private For Me', content: 'Visible to target', is_active: true, is_private: true, user_id: 'tenant-a', branch: 'gil-puyat' },
      { announcement_id: 'ann_private_other', title: 'Private For Someone Else', content: 'Should not leak', is_active: true, is_private: true, user_id: 'tenant-b' },
      { announcement_id: 'ann_future', title: 'Future Notice', content: 'Should not leak', is_active: true, publishedAt: new Date('2099-01-01T00:00:00Z') },
      { announcement_id: 'ann_expired', title: 'Expired Notice', content: 'Should not leak', is_active: true, expiresAt: new Date('2000-01-01T00:00:00Z') },
    ],
    reservations: [{ user_id: 'tenant-a', branch: 'gil-puyat', status: 'approved' }],
    maintenance_requests: [],
    maintenancerequests: [],
    billing: [],
    bills: [],
    chat_conversations: [],
  });
  await withFakeDb(db, async () => {
    const { chatbotController, calls, restore } = stubGeminiService();
    try {
      await withMockedAxiosGet(async () => ({ status: 404, data: { detail: 'No contract found.' } }), async () => {
        const req = {
          body: { message: 'Are there any announcements I should know about?', session_id: null, attachments: [] },
          user: TENANT_A,
          headers: { authorization: 'Bearer tenant-a-token' },
        };
        const res = response();
        await chatbotController.sendMessage(req, res);
        assert.equal(calls.length, 1, 'expected the AI to be invoked for this in-scope general question');
        const prompt = calls[0].prompt;
        assert.match(prompt, /Global Notice/);
        assert.match(prompt, /Own Branch Notice/);
        assert.match(prompt, /Private For Me/);
        assert.doesNotMatch(prompt, /Other Branch Only/);
        assert.doesNotMatch(prompt, /Private For Someone Else/);
        assert.doesNotMatch(prompt, /Future Notice/);
        assert.doesNotMatch(prompt, /Expired Notice/);
      });
    } finally {
      restore();
    }
  });
});

// ── Security: a client-supplied id embedded in chat text must never ───────
// ── influence which tenant's contract document gets fetched ───────────────

test('an ObjectId belonging to another tenant, pasted into the chat message, never gets used as the contract id to fetch', async () => {
  const db = makeFakeDb({
    announcements: [], maintenance_requests: [], maintenancerequests: [], billing: [], bills: [], chat_conversations: [],
  });
  await withFakeDb(db, async () => {
    const { chatbotController, restore } = stubGeminiService();
    try {
      const OWN_CONTRACT_ID = '111111111111111111111111';
      const FOREIGN_CONTRACT_ID = '507f1f77bcf86cd799439099'; // pasted by the tenant, belongs to someone else
      const capturedDocumentUrls = [];

      await withMockedAxiosGet(async (url) => {
        capturedDocumentUrls.push(url);
        if (url.endsWith('/api/m/contracts/current')) {
          return {
            status: 200,
            data: {
              contract: {
                id: OWN_CONTRACT_ID,
                displayStatus: 'Active',
                leaseStartDate: '2026-06-14',
                leaseEndDate: '2026-12-14',
                tenantDocument: { available: true, type: 'generated_draft' },
              },
              state: 'CONTRACT_AVAILABLE',
            },
          };
        }
        // Any documents/:id request — simulate a small PDF response so
        // extraction doesn't throw; the assertion below checks the id in the URL.
        const { Readable } = require('node:stream');
        return { status: 200, headers: { 'content-type': 'application/pdf' }, data: Readable.from([Buffer.from('%PDF-x')]) };
      }, async () => {
        const req = {
          body: {
            message: `What does my contract say about visitors? For reference my contract id is ${FOREIGN_CONTRACT_ID}.`,
            session_id: null,
            attachments: [],
          },
          user: TENANT_A,
          headers: { authorization: 'Bearer tenant-a-token' },
        };
        const res = response();
        await chatbotController.sendMessage(req, res);

        const documentUrls = capturedDocumentUrls.filter((url) => url.includes('/documents/'));
        assert.ok(documentUrls.length > 0, 'expected a document fetch to have been attempted');
        assert.ok(
          documentUrls.every((url) => url.includes(OWN_CONTRACT_ID)),
          `document fetch must only ever use the authenticated tenant's own contract id (${OWN_CONTRACT_ID}), got: ${documentUrls.join(', ')}`
        );
        assert.ok(
          documentUrls.every((url) => !url.includes(FOREIGN_CONTRACT_ID)),
          'a contract id pasted into chat text must never be used to fetch a document'
        );
      });
    } finally {
      restore();
    }
  });
});

// ── Regression: reservation rows must never define lease/Contract status ──
// After a move-out or renewal the tenant's reservation row can still carry a
// stale `leaseStatus`/`contractStatus`. resolveTenantAccountContext must not
// read those — the authoritative current-Contract fetch owns lease lifecycle.

test('resolveTenantAccountContext never derives leaseStatus from a reservation row', async () => {
  const { chatbotController, restore } = stubGeminiService();
  try {
    const reservationWithStaleContractStatus = {
      userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'moveOut',
      leaseStatus: 'active',
      contractStatus: 'active',
      roomNumber: '204',
      selectedBed: { position: 'upper' },
      branch: 'guadalupe',
    };
    const db = {
      collection(name) {
        if (name === 'reservations') {
          return {
            findOne: async () => reservationWithStaleContractStatus,
          };
        }
        // branchLocation.service + any other lookups: degrade gracefully
        return {
          findOne: async () => null,
          find() { return { sort() { return this; }, limit() { return this; }, toArray: async () => [] }; },
          countDocuments: async () => 0,
        };
      },
    };

    await withFakeDb(db, async () => {
      const ctx = await chatbotController.__test.resolveTenantAccountContext(db, TENANT_A);
      assert.equal(ctx.leaseStatus, '', 'leaseStatus must stay empty — reservation rows are not the lease authority');
      // occupancyStatus may still carry the reservation stage, but only as a
      // reservation-stage hint, never as the lease lifecycle answer.
      assert.equal(ctx.occupancyStatus, 'moveOut');
    });
  } finally {
    restore();
  }
});
