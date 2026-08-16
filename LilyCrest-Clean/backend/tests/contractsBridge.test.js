'use strict';

// Behavioral tests for the Contract server-side bridge (routes/contracts.routes.js),
// which relays authenticated mobile requests to Capstone-Website's authoritative
// Contract system. These tests never touch a live network: axios.get is
// monkey-patched per test (same technique as security-hardening.test.js),
// so upstream behavior — success, draft contracts, 401/403/404/500,
// timeouts — is fully simulated.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const { Readable } = require('node:stream');
const axios = require('axios');

const { __test } = require('../routes/contracts.routes');
const { proxyJson, proxyStream, forwardAuthHeader, resolveContractUpstreamBase, CONTRACT_ID_PATTERN } = __test;

// All tests below except the two "not configured" cases exercise proxy
// behavior against a configured upstream; those two save/restore this value
// around their own overrides.
process.env.CONTRACT_UPSTREAM_URL = process.env.CONTRACT_UPSTREAM_URL || 'https://api.lilycrest.space';

function fakeJsonRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function fakeStreamRes() {
  const chunks = [];
  const headers = {};
  const res = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  res.statusCode = null;
  res.jsonBody = null;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.jsonBody = payload; res.statusCode = res.statusCode; return res; };
  res.setHeader = (name, value) => { headers[name.toLowerCase()] = value; };
  res._headers = headers;
  res._body = () => Buffer.concat(chunks).toString('utf8');
  return res;
}

async function withMockedAxiosGet(impl, fn) {
  const original = axios.get;
  axios.get = impl;
  try {
    await fn();
  } finally {
    axios.get = original;
  }
}

test('forwardAuthHeader only recognizes a Bearer header, never a cookie or other client-supplied identity', () => {
  assert.equal(forwardAuthHeader({ headers: { authorization: 'Bearer token-a' } }), 'Bearer token-a');
  assert.equal(forwardAuthHeader({ headers: {}, cookies: { session_token: 'sneaky' } }), null);
  assert.equal(forwardAuthHeader({ headers: { authorization: 'Basic abc' } }), null);
  assert.equal(forwardAuthHeader({ headers: {} }), null);
});

test('resolveContractUpstreamBase reads CONTRACT_UPSTREAM_URL, not BACKEND_URL', () => {
  const originalUpstream = process.env.CONTRACT_UPSTREAM_URL;
  const originalBackend = process.env.BACKEND_URL;
  try {
    delete process.env.CONTRACT_UPSTREAM_URL;
    // BACKEND_URL is this server's own public URL elsewhere in the codebase
    // (paymongo.controller.js, auth.controller.js). Setting it must never
    // leak into the Contract upstream target — that was the self-proxy bug.
    process.env.BACKEND_URL = 'https://api.lilycrest.space';
    assert.equal(resolveContractUpstreamBase(), '');

    process.env.CONTRACT_UPSTREAM_URL = 'https://staging-capstone-website.example/';
    assert.equal(resolveContractUpstreamBase(), 'https://staging-capstone-website.example');
  } finally {
    if (originalUpstream === undefined) delete process.env.CONTRACT_UPSTREAM_URL;
    else process.env.CONTRACT_UPSTREAM_URL = originalUpstream;
    if (originalBackend === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = originalBackend;
  }
});

test('proxyJson fails closed with 502 when CONTRACT_UPSTREAM_URL is not configured, even if BACKEND_URL is set', async () => {
  const originalUpstream = process.env.CONTRACT_UPSTREAM_URL;
  const originalBackend = process.env.BACKEND_URL;
  delete process.env.CONTRACT_UPSTREAM_URL;
  process.env.BACKEND_URL = 'https://api.lilycrest.space';
  let called = false;
  try {
    await withMockedAxiosGet(async () => { called = true; return { status: 200, data: {} }; }, async () => {
      const res = fakeJsonRes();
      await proxyJson({ headers: { authorization: 'Bearer t' } }, res, '/api/m/contracts/current');
      assert.equal(res.statusCode, 502);
      assert.equal(called, false);
    });
  } finally {
    if (originalUpstream === undefined) delete process.env.CONTRACT_UPSTREAM_URL;
    else process.env.CONTRACT_UPSTREAM_URL = originalUpstream;
    if (originalBackend === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = originalBackend;
  }
});

test('CONTRACT_ID_PATTERN accepts a 24-char hex id and rejects anything else', () => {
  assert.equal(CONTRACT_ID_PATTERN.test('507f1f77bcf86cd799439011'), true);
  assert.equal(CONTRACT_ID_PATTERN.test('not-an-object-id'), false);
  assert.equal(CONTRACT_ID_PATTERN.test('../../etc/passwd'), false);
  assert.equal(CONTRACT_ID_PATTERN.test(''), false);
});

test('proxyJson rejects a request with no Authorization header without calling upstream', async () => {
  let called = false;
  await withMockedAxiosGet(async () => { called = true; return { status: 200, data: {} }; }, async () => {
    const res = fakeJsonRes();
    await proxyJson({ headers: {} }, res, '/api/m/contracts/current');
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.detail, 'Not authenticated');
    assert.equal(called, false);
  });
});

test('proxyJson forwards the exact client Authorization header and relays a draft Contract from upstream', async () => {
  let capturedHeaders;
  const draftContract = {
    contract: { id: 'c1', status: 'draft', displayStatus: 'Contract is being prepared.', preparedDocument: { available: false } },
    state: 'CONTRACT_AVAILABLE',
    emptyState: null,
  };
  await withMockedAxiosGet(async (url, config) => {
    capturedHeaders = config.headers;
    assert.equal(url, 'https://api.lilycrest.space/api/m/contracts/current');
    return { status: 200, data: draftContract };
  }, async () => {
    const res = fakeJsonRes();
    await proxyJson({ headers: { authorization: 'Bearer tenant-token-xyz' } }, res, '/api/m/contracts/current');
    assert.equal(capturedHeaders.Authorization, 'Bearer tenant-token-xyz');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.contract.status, 'draft');
    assert.equal(res.body.state, 'CONTRACT_AVAILABLE');
  });
});

test('proxyJson relays an upstream 401/403 verbatim instead of masking it', async () => {
  await withMockedAxiosGet(async () => ({ status: 403, data: { detail: 'Tenant Contract access denied' } }), async () => {
    const res = fakeJsonRes();
    await proxyJson({ headers: { authorization: 'Bearer expired' } }, res, '/api/m/contracts/current');
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.detail, 'Tenant Contract access denied');
  });
});

test('proxyJson normalizes an upstream timeout to 504 without leaking internals', async () => {
  await withMockedAxiosGet(async () => {
    const err = new Error('timeout of 15000ms exceeded');
    err.code = 'ECONNABORTED';
    throw err;
  }, async () => {
    const res = fakeJsonRes();
    await proxyJson({ headers: { authorization: 'Bearer t' } }, res, '/api/m/contracts/current');
    assert.equal(res.statusCode, 504);
  });
});

test('proxyJson normalizes an unreachable upstream to 502', async () => {
  await withMockedAxiosGet(async () => { throw new Error('connect ECONNREFUSED'); }, async () => {
    const res = fakeJsonRes();
    await proxyJson({ headers: { authorization: 'Bearer t' } }, res, '/api/m/contracts/current');
    assert.equal(res.statusCode, 502);
  });
});

test('proxyStream pipes a prepared PDF through with content-type/disposition preserved', async () => {
  await withMockedAxiosGet(async (url) => {
    assert.match(url, /\/documents\/prepared$/);
    return {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-length': '4',
        'content-disposition': 'inline; filename="lease.pdf"',
        'cache-control': 'private, no-store',
      },
      data: Readable.from([Buffer.from('%PDF')]),
    };
  }, async () => {
    const res = fakeStreamRes();
    await proxyStream({ headers: { authorization: 'Bearer t' }, query: {} }, res, '/api/m/contracts/c1/documents/prepared');
    await new Promise((resolve) => res.on('finish', resolve));
    assert.equal(res.statusCode, 200);
    assert.equal(res._headers['content-type'], 'application/pdf');
    assert.equal(res._headers['content-disposition'], 'inline; filename="lease.pdf"');
    assert.equal(res._body(), '%PDF');
  });
});

test('proxyStream relays the canonical current-document endpoint without selecting a lifecycle variant locally', async () => {
  let capturedUrl;
  await withMockedAxiosGet(async (url) => {
    capturedUrl = url;
    return {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'cache-control': 'private, no-store' },
      data: Readable.from([Buffer.from('%PDF')]),
    };
  }, async () => {
    const res = fakeStreamRes();
    await proxyStream(
      { headers: { authorization: 'Bearer tenant-token' }, query: {} },
      res,
      '/api/m/contracts/current/document',
    );
    await new Promise((resolve) => res.on('finish', resolve));
    assert.equal(capturedUrl, 'https://api.lilycrest.space/api/m/contracts/current/document');
    assert.equal(res._headers['cache-control'], 'private, no-store');
    assert.equal(res._body(), '%PDF');
  });
});

test('proxyStream normalizes an upstream 404 (no prepared document yet) to a JSON error, not a broken PDF stream', async () => {
  await withMockedAxiosGet(async () => ({
    status: 404,
    headers: {},
    data: Readable.from([Buffer.from(JSON.stringify({ detail: 'Contract not found.' }))]),
  }), async () => {
    const res = fakeStreamRes();
    await proxyStream({ headers: { authorization: 'Bearer t' }, query: {} }, res, '/api/m/contracts/c1/documents/prepared');
    assert.equal(res.statusCode, 404);
    assert.equal(res.jsonBody.detail, 'Contract not found.');
  });
});

test('proxyStream falls back to a generic message when the upstream error body is not JSON', async () => {
  await withMockedAxiosGet(async () => ({
    status: 500,
    headers: {},
    data: Readable.from([Buffer.from('<html>Internal Server Error</html>')]),
  }), async () => {
    const res = fakeStreamRes();
    await proxyStream({ headers: { authorization: 'Bearer t' }, query: {} }, res, '/api/m/contracts/c1/documents/final');
    assert.equal(res.statusCode, 500);
    assert.equal(res.jsonBody.detail, 'Contract document is not available.');
  });
});

test('proxyStream rejects an unauthenticated document request without calling upstream', async () => {
  let called = false;
  await withMockedAxiosGet(async () => { called = true; return { status: 200, headers: {}, data: Readable.from([]) }; }, async () => {
    const res = fakeStreamRes();
    await proxyStream({ headers: {}, query: {} }, res, '/api/m/contracts/c1/documents/final');
    assert.equal(res.statusCode, 401);
    assert.equal(called, false);
  });
});

test('proxyStream appends ?download=1 only when the client explicitly requested it', async () => {
  let capturedUrl;
  await withMockedAxiosGet(async (url) => {
    capturedUrl = url;
    return { status: 200, headers: { 'content-type': 'application/pdf' }, data: Readable.from([Buffer.from('x')]) };
  }, async () => {
    const res = fakeStreamRes();
    await proxyStream({ headers: { authorization: 'Bearer t' }, query: { download: '1' } }, res, '/api/m/contracts/c1/documents/final');
    await new Promise((resolve) => res.on('finish', resolve));
    assert.match(capturedUrl, /\?download=1$/);
  });
});
