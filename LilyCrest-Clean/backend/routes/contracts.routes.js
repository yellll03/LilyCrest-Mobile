'use strict';

// Server-side bridge to the authoritative Contract system, which lives in
// Capstone-Website (Contract model + mobileContractRoutes.js), deployed as a
// separate service from this backend. The mobile app never calls that admin
// host directly — see frontend/src/config/api.js isDisallowedMobileRuntimeUrl
// — so this router relays the request server-to-server instead of
// duplicating Contract business logic here.
//
// CONTRACT_UPSTREAM_URL must name that separate Capstone-Website host. It is
// deliberately its own env var, not BACKEND_URL: BACKEND_URL is already used
// everywhere else in this codebase (paymongo.controller.js, auth.controller.js)
// to mean "this server's own public URL", used to build callback/redirect
// links back to itself. Reusing it here would silently point the Contract
// bridge at this same server instead of Capstone-Website whenever BACKEND_URL
// is set to this server's own host (the documented, correct value for its
// other purpose) — so there is no safe default to fall back to, and a
// missing/unset value fails the request rather than guessing.
//
// Identity is never trusted from the client or decoded locally: the
// Authorization header is forwarded byte-for-byte, and Capstone-Website's
// own mobileTenant middleware re-derives the tenant from that same bearer
// token against the shared user_sessions/users collections before it will
// return any Contract data. authMiddleware below only short-circuits
// obviously-unauthenticated requests before spending an upstream call.

const router = require('express').Router();
const axios = require('axios');
const { authMiddleware, tenantMiddleware } = require('../middleware/auth');

const CONTRACT_ID_PATTERN = /^[a-f0-9]{24}$/i;

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

// Server-controlled deployment setting — never derived from client input, so
// there is no SSRF surface here. Returns '' when unset; callers must treat
// that as "not configured" rather than substituting a guessed host.
function resolveContractUpstreamBase() {
  return normalizeBaseUrl(process.env.CONTRACT_UPSTREAM_URL);
}

function forwardAuthHeader(req) {
  const header = req.headers.authorization;
  return header && header.startsWith('Bearer ') ? header : null;
}

// res-free fetch helpers. These return plain result objects instead of
// writing to an Express response, so non-HTTP callers (e.g. the chatbot,
// which needs the tenant's own canonical contract to answer questions) can
// reuse the exact same upstream bridge logic instead of re-implementing it.
async function fetchContractJson(authorization, upstreamPath) {
  const upstreamBase = resolveContractUpstreamBase();
  if (!upstreamBase) {
    console.error('[Contracts bridge] CONTRACT_UPSTREAM_URL is not configured');
    return { ok: false, status: 502, detail: 'Contract service is not configured. Please try again later.' };
  }

  try {
    const upstream = await axios.get(`${upstreamBase}${upstreamPath}`, {
      headers: { Authorization: authorization },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (upstream.status >= 400) {
      // Capstone-Website's mobile-tenant routes (mobileTenantAuth, the
      // contract lookup itself) return a flat { detail } body, but errors
      // that fall through to its global error handler (e.g. the 409
      // MULTIPLE_CANONICAL_CONTRACTS conflict thrown by
      // tenantContractSelectionService) are wrapped as
      // { success: false, error: { code, message, details } } instead —
      // confirmed by reading both code paths directly. Accept either shape
      // rather than silently losing the real upstream message.
      const detail = upstream.data?.detail || upstream.data?.error?.message;
      return { ok: false, status: upstream.status, detail, data: upstream.data };
    }
    return { ok: true, status: upstream.status, data: upstream.data };
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      return { ok: false, status: 504, detail: 'Contract service timed out. Please try again.' };
    }
    console.error('[Contracts bridge] upstream error:', error.message);
    return { ok: false, status: 502, detail: 'Contract service is unavailable. Please try again.' };
  }
}

async function fetchContractDocumentBuffer(authorization, upstreamPath, { download = false } = {}) {
  const upstreamBase = resolveContractUpstreamBase();
  if (!upstreamBase) {
    console.error('[Contracts bridge] CONTRACT_UPSTREAM_URL is not configured');
    return { ok: false, status: 502, detail: 'Contract document service is not configured. Please try again later.' };
  }

  const query = download ? '?download=1' : '';

  let upstream;
  try {
    upstream = await axios.get(`${upstreamBase}${upstreamPath}${query}`, {
      headers: { Authorization: authorization },
      timeout: 20000,
      responseType: 'stream',
      validateStatus: () => true,
    });
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      return { ok: false, status: 504, detail: 'Contract document request timed out.' };
    }
    console.error('[Contracts bridge] upstream document error:', error.message);
    return { ok: false, status: 502, detail: 'Contract document is not available.' };
  }

  const chunks = [];
  for await (const chunk of upstream.data) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);

  if (upstream.status >= 400) {
    // Upstream error bodies are small JSON payloads; parse rather than
    // trying to treat them as document bytes.
    let detail = 'Contract document is not available.';
    try {
      const parsed = JSON.parse(buffer.toString('utf8'));
      if (parsed?.detail) detail = parsed.detail;
    } catch (_) {
      // Non-JSON upstream error body — keep the generic message.
    }
    return { ok: false, status: upstream.status, detail };
  }

  return {
    ok: true,
    status: upstream.status,
    buffer,
    contentType: upstream.headers['content-type'],
    headers: upstream.headers,
  };
}

// Public helpers for other backend modules (e.g. chatbot.controller.js).
// Take req, not a raw authorization string, so callers can never accidentally
// source the bearer token from anywhere except the authenticated request
// itself — identity is still never trusted from client-supplied fields.
async function fetchCurrentContractForRequest(req) {
  const authorization = forwardAuthHeader(req);
  if (!authorization) return { ok: false, status: 401, detail: 'Not authenticated' };
  return fetchContractJson(authorization, '/api/m/contracts/current');
}

// contractId must have been resolved from this same tenant's own
// fetchCurrentContractForRequest() response — never from client input such
// as chat message text — since it is forwarded to the upstream document
// route unchecked beyond the ID-shape pattern below.
async function fetchContractDocumentForRequest(req, contractId, kind) {
  if (kind !== 'prepared' && kind !== 'final') {
    return { ok: false, status: 400, detail: 'Invalid document kind' };
  }
  if (!CONTRACT_ID_PATTERN.test(contractId || '')) {
    return { ok: false, status: 404, detail: `${kind === 'final' ? 'Final' : 'Prepared'} Contract is not available` };
  }
  const authorization = forwardAuthHeader(req);
  if (!authorization) return { ok: false, status: 401, detail: 'Not authenticated' };
  return fetchContractDocumentBuffer(authorization, `/api/m/contracts/${contractId}/documents/${kind}`, {
    download: false,
  });
}

async function proxyJson(req, res, upstreamPath) {
  const authorization = forwardAuthHeader(req);
  if (!authorization) {
    return res.status(401).json({ detail: 'Not authenticated' });
  }
  const result = await fetchContractJson(authorization, upstreamPath);
  if (!result.ok) {
    return res.status(result.status).json({ detail: result.detail });
  }
  return res.status(result.status).json(result.data);
}

// Client-facing: streams the document straight through without buffering it
// server-side (documents can be large, and the tenant's browser/app is the
// only consumer). Kept separate from fetchContractDocumentBuffer, which
// buffers — that one is for internal callers (contract document Q&A) that
// need the full bytes to extract text from.
async function proxyStream(req, res, upstreamPath) {
  const authorization = forwardAuthHeader(req);
  if (!authorization) {
    return res.status(401).json({ detail: 'Not authenticated' });
  }

  const upstreamBase = resolveContractUpstreamBase();
  if (!upstreamBase) {
    console.error('[Contracts bridge] CONTRACT_UPSTREAM_URL is not configured');
    return res.status(502).json({ detail: 'Contract document service is not configured. Please try again later.' });
  }

  const query = req.query?.download === '1' ? '?download=1' : '';

  let upstream;
  try {
    upstream = await axios.get(`${upstreamBase}${upstreamPath}${query}`, {
      headers: { Authorization: authorization },
      timeout: 20000,
      responseType: 'stream',
      validateStatus: () => true,
    });
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({ detail: 'Contract document request timed out.' });
    }
    console.error('[Contracts bridge] upstream document error:', error.message);
    return res.status(502).json({ detail: 'Contract document is not available.' });
  }

  if (upstream.status >= 400) {
    // Upstream error bodies are small JSON payloads; buffer and re-emit them
    // as normal JSON instead of trying to stream an error as a "PDF".
    const chunks = [];
    for await (const chunk of upstream.data) chunks.push(chunk);
    let detail = 'Contract document is not available.';
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (parsed?.detail) detail = parsed.detail;
    } catch (_) {
      // Non-JSON upstream error body — keep the generic message.
    }
    return res.status(upstream.status).json({ detail });
  }

  res.status(upstream.status);
  ['content-type', 'content-length', 'content-disposition', 'cache-control', 'pragma'].forEach((header) => {
    if (upstream.headers[header]) res.setHeader(header, upstream.headers[header]);
  });
  upstream.data.pipe(res);
}

router.use(authMiddleware, tenantMiddleware);

router.get('/current', (req, res) => proxyJson(req, res, '/api/m/contracts/current'));

router.get('/:contractId/documents/prepared', (req, res) => {
  if (!CONTRACT_ID_PATTERN.test(req.params.contractId)) {
    return res.status(404).json({ detail: 'Prepared Contract is not available' });
  }
  return proxyStream(req, res, `/api/m/contracts/${req.params.contractId}/documents/prepared`);
});

router.get('/:contractId/documents/final', (req, res) => {
  if (!CONTRACT_ID_PATTERN.test(req.params.contractId)) {
    return res.status(404).json({ detail: 'Final Contract is not available' });
  }
  return proxyStream(req, res, `/api/m/contracts/${req.params.contractId}/documents/final`);
});

router.__test = {
  resolveContractUpstreamBase,
  forwardAuthHeader,
  proxyJson,
  proxyStream,
  CONTRACT_ID_PATTERN,
};

module.exports = router;
module.exports.fetchCurrentContractForRequest = fetchCurrentContractForRequest;
module.exports.fetchContractDocumentForRequest = fetchContractDocumentForRequest;
