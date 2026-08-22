// Coverage for the AI assistant's "what does my contract say about X"
// capability: domain/contracts/contractDocumentQA.js (text extraction +
// keyword-passage retrieval) and routes/contracts.routes.js's
// fetchContractDocumentForRequest/fetchCurrentContractForRequest helpers,
// which the chatbot uses to fetch the tenant's own document. Same
// axios-mocking technique as contractsBridge.test.js — no live network.

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { findRelevantContractExcerpts } = require('../domain/contracts/contractDocumentQA');
const { __test, fetchCurrentContractForRequest, fetchContractDocumentForRequest } = require('../routes/contracts.routes');
const { CONTRACT_ID_PATTERN } = __test;

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

// ── findRelevantContractExcerpts: paragraph-level keyword retrieval ───────

const FIXTURE_CONTRACT_TEXT = `
SECTION 1 - PURPOSE. This Contract of Lease is entered into by and between the Lessor and the Lessee for the lease of a bed space unit.

SECTION 3 - VISITORS. Visitors and guests are allowed in common areas only between 8:00 AM and 9:00 PM. Overnight guests are strictly prohibited without prior written approval from the branch admin.

SECTION 4 - DEPOSITS AND ADVANCES. The Lessee shall pay an advance rent and a security deposit prior to move-in. The security deposit is refundable within thirty (30) days after move-out, subject to deductions for damages.

SECTION 7 - EXPIRATION OF LEASE. This lease shall automatically terminate upon expiration of its term unless renewed in writing by both parties at least thirty (30) days before the expiration date.
`;

test('findRelevantContractExcerpts returns the visitor clause for a visitor-related question', () => {
  const excerpts = findRelevantContractExcerpts(FIXTURE_CONTRACT_TEXT, 'What does my contract say about visitors?');
  assert.equal(excerpts.length > 0, true);
  assert.match(excerpts[0], /Visitors and guests are allowed/);
});

test('findRelevantContractExcerpts returns the termination clause for a termination-related question', () => {
  const excerpts = findRelevantContractExcerpts(FIXTURE_CONTRACT_TEXT, 'What does my contract say about termination?');
  assert.equal(excerpts.length > 0, true);
  assert.match(excerpts.join(' '), /automatically terminate upon expiration/);
});

test('findRelevantContractExcerpts returns nothing for a topic absent from the document (never fabricate)', () => {
  const excerpts = findRelevantContractExcerpts(FIXTURE_CONTRACT_TEXT, 'What does my contract say about parking?');
  assert.deepEqual(excerpts, []);
});

test('findRelevantContractExcerpts caps excerpt length and count', () => {
  const longParagraph = `SECTION X - LONG. ${'visitor rules and policy details here. '.repeat(60)}`;
  const excerpts = findRelevantContractExcerpts(longParagraph, 'visitor policy', { maxExcerpts: 1, maxCharsPerExcerpt: 100 });
  assert.equal(excerpts.length, 1);
  assert.equal(excerpts[0].length <= 101, true); // 100 chars + ellipsis
});

// ── fetchContractDocumentForRequest: contractId must be pre-resolved,  ────
// ── never taken from arbitrary/client-supplied text ────────────────────────

test('fetchContractDocumentForRequest rejects a malformed contractId without calling upstream', async () => {
  let called = false;
  await withMockedAxiosGet(async () => { called = true; return { status: 200, headers: {}, data: Buffer.from('') }; }, async () => {
    const req = { headers: { authorization: 'Bearer t' } };
    const result = await fetchContractDocumentForRequest(req, '../../etc/passwd', 'final');
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(called, false);
  });
});

test('fetchContractDocumentForRequest rejects an invalid document kind', async () => {
  const req = { headers: { authorization: 'Bearer t' } };
  const result = await fetchContractDocumentForRequest(req, '507f1f77bcf86cd799439011', 'draft');
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test('fetchContractDocumentForRequest requires authentication before calling upstream', async () => {
  let called = false;
  await withMockedAxiosGet(async () => { called = true; return { status: 200, headers: {}, data: Buffer.from('') }; }, async () => {
    const req = { headers: {} };
    const result = await fetchContractDocumentForRequest(req, '507f1f77bcf86cd799439011', 'final');
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(called, false);
  });
});

test('fetchContractDocumentForRequest fetches a valid, pre-resolved contractId and returns the buffered document', async () => {
  let capturedUrl;
  const { Readable } = require('node:stream');
  await withMockedAxiosGet(async (url, config) => {
    capturedUrl = url;
    assert.equal(config.headers.Authorization, 'Bearer tenant-token');
    return {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
      data: Readable.from([Buffer.from('%PDF-fake-contract-bytes')]),
    };
  }, async () => {
    const req = { headers: { authorization: 'Bearer tenant-token' } };
    const result = await fetchContractDocumentForRequest(req, '507f1f77bcf86cd799439011', 'final');
    assert.equal(result.ok, true);
    assert.equal(result.buffer.toString(), '%PDF-fake-contract-bytes');
    assert.match(capturedUrl, /\/api\/m\/contracts\/507f1f77bcf86cd799439011\/documents\/final$/);
  });
});

test('fetchCurrentContractForRequest forwards the real bearer header and relays the upstream contract', async () => {
  await withMockedAxiosGet(async (url, config) => {
    assert.match(url, /\/api\/m\/contracts\/current$/);
    assert.equal(config.headers.Authorization, 'Bearer tenant-token');
    return {
      status: 200,
      data: {
        contract: {
          id: '507f1f77bcf86cd799439011',
          displayStatus: 'Active',
          leaseStartDate: '2026-06-14',
          leaseEndDate: '2026-12-14',
          tenantDocument: { available: true, type: 'final_notarized' },
        },
        state: 'CONTRACT_AVAILABLE',
      },
    };
  }, async () => {
    const req = { headers: { authorization: 'Bearer tenant-token' } };
    const result = await fetchCurrentContractForRequest(req);
    assert.equal(result.ok, true);
    assert.equal(result.data.contract.id, '507f1f77bcf86cd799439011');
  });
});

test('CONTRACT_ID_PATTERN sanity check used by fetchContractDocumentForRequest', () => {
  assert.equal(CONTRACT_ID_PATTERN.test('507f1f77bcf86cd799439011'), true);
  assert.equal(CONTRACT_ID_PATTERN.test('not-an-id'), false);
});
