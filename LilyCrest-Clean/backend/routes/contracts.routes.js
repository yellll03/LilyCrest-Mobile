'use strict';

// Server-side bridge to the authoritative Contract system, which lives in
// Capstone-Website (Contract model + mobileContractRoutes.js), deployed
// separately at BACKEND_URL (default https://api.lilycrest.space). The
// mobile app only ever talks to this host (mobile-api.lilycrest.space) — see
// frontend/src/config/api.js isDisallowedMobileRuntimeUrl, which refuses to
// let the app call the admin host directly. This router relays the request
// server-to-server instead of duplicating Contract business logic here.
//
// Identity is never trusted from the client or decoded locally: the
// Authorization header is forwarded byte-for-byte, and Capstone-Website's
// own mobileTenant middleware re-derives the tenant from that same bearer
// token against the shared user_sessions/users collections before it will
// return any Contract data. authMiddleware below only short-circuits
// obviously-unauthenticated requests before spending an upstream call.

const router = require('express').Router();
const axios = require('axios');
const { authMiddleware } = require('../middleware/auth');

const DEFAULT_CONTRACT_UPSTREAM = 'https://api.lilycrest.space';
const CONTRACT_ID_PATTERN = /^[a-f0-9]{24}$/i;

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

// BACKEND_URL is a server-controlled deployment setting (already used by
// paymongo.controller.js and auth.controller.js for the same host) — never
// derived from client input, so there is no SSRF surface here.
function resolveContractUpstreamBase() {
  return normalizeBaseUrl(process.env.BACKEND_URL) || DEFAULT_CONTRACT_UPSTREAM;
}

function forwardAuthHeader(req) {
  const header = req.headers.authorization;
  return header && header.startsWith('Bearer ') ? header : null;
}

async function proxyJson(req, res, upstreamPath) {
  const authorization = forwardAuthHeader(req);
  if (!authorization) {
    return res.status(401).json({ detail: 'Not authenticated' });
  }

  try {
    const upstream = await axios.get(`${resolveContractUpstreamBase()}${upstreamPath}`, {
      headers: { Authorization: authorization },
      timeout: 15000,
      validateStatus: () => true,
    });
    return res.status(upstream.status).json(upstream.data);
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({ detail: 'Contract service timed out. Please try again.' });
    }
    console.error('[Contracts bridge] upstream error:', error.message);
    return res.status(502).json({ detail: 'Contract service is unavailable. Please try again.' });
  }
}

async function proxyStream(req, res, upstreamPath) {
  const authorization = forwardAuthHeader(req);
  if (!authorization) {
    return res.status(401).json({ detail: 'Not authenticated' });
  }

  const query = req.query?.download === '1' ? '?download=1' : '';

  let upstream;
  try {
    upstream = await axios.get(`${resolveContractUpstreamBase()}${upstreamPath}${query}`, {
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

router.use(authMiddleware);

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
