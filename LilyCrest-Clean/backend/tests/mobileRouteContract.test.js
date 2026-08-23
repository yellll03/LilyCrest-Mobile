'use strict';

// Contract test: every canonical support-chat path the mobile app calls must
// resolve to a route this backend actually registers.
//
// This is the support-scoped check that was missing. Four support-chat
// endpoints and a Socket.IO channel shipped as client affordances without a
// registered server counterpart. A support client/server path mismatch is
// now a test failure at build time; unrelated API domains keep their own
// feature-level contract tests.
//
// Deliberately narrow: it compares paths and methods only. It does not
// validate request/response bodies, auth, or semantics — those belong to the
// per-feature tests. Keep it that way; the value here is that it cannot rot.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const FRONTEND_ROOT = path.resolve(BACKEND_ROOT, '..', 'frontend');

// Mobile call sites live in the axios client and in AuthContext, which calls
// a handful of /auth paths directly rather than through apiService.
const MOBILE_SOURCES = [
  path.join(FRONTEND_ROOT, 'src', 'services', 'api.js'),
  path.join(FRONTEND_ROOT, 'src', 'context', 'AuthContext.js'),
];

// Paths the mobile client resolves against a different origin (the canonical
// contract upstream, Firebase, PayMongo's hosted checkout) or that are not
// HTTP paths at all. Anything added here needs a reason.
const NON_BACKEND_PATH_PREFIXES = [
  'http://',
  'https://',
];

function collectRegisteredRoutes() {
  const indexSource = fs.readFileSync(path.join(BACKEND_ROOT, 'routes', 'index.js'), 'utf8');
  const registered = new Set();

  // Mounts are read from routes/index.js source rather than reverse-engineered
  // from Express's compiled mount regexps, which are an internal detail.
  const mountPattern = /router\.use\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g;
  const requirePattern = /const\s+(\w+)\s*=\s*require\('\.\/([\w.-]+)'\)/g;

  const moduleByVar = new Map();
  let requireMatch;
  while ((requireMatch = requirePattern.exec(indexSource)) !== null) {
    moduleByVar.set(requireMatch[1], requireMatch[2]);
  }

  let mountMatch;
  while ((mountMatch = mountPattern.exec(indexSource)) !== null) {
    const [, mountPath, varName] = mountMatch;
    const moduleName = moduleByVar.get(varName);
    if (!moduleName) continue;

    const router = require(path.join(BACKEND_ROOT, 'routes', moduleName));
    for (const layer of router.stack || []) {
      if (!layer.route) continue;
      const routePath = layer.route.path === '/' ? '' : layer.route.path;
      for (const method of Object.keys(layer.route.methods)) {
        registered.add(`${method.toUpperCase()} ${mountPath}${routePath}`);
      }
    }
  }

  // Routes defined directly on the index router (health, seed, ...).
  const directPattern = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
  let directMatch;
  while ((directMatch = directPattern.exec(indexSource)) !== null) {
    registered.add(`${directMatch[1].toUpperCase()} ${directMatch[2]}`);
  }

  return registered;
}

function collectMobileCalls() {
  const calls = [];
  for (const file of MOBILE_SOURCES) {
    const source = fs.readFileSync(file, 'utf8');
    const pattern = /\bapi\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const [, method, , rawPath] = match;
      if (!rawPath.startsWith('/')) continue;
      if (NON_BACKEND_PATH_PREFIXES.some((prefix) => rawPath.startsWith(prefix))) continue;
      calls.push({
        method: method.toUpperCase(),
        rawPath,
        file: path.relative(FRONTEND_ROOT, file).replace(/\\/g, '/'),
      });
    }
  }
  return calls;
}

// `/chat/${encodeURIComponent(id)}/messages` -> a matcher that treats any
// interpolated segment, and any registered :param segment, as a wildcard.
function segmentsOf(routePath) {
  return routePath.replace(/^\/+|\/+$/g, '').split('/');
}

function callMatchesRoute(callPath, routePath) {
  const callSegments = segmentsOf(callPath.replace(/\$\{[^}]*\}/g, '*'));
  const routeSegments = segmentsOf(routePath);
  if (callSegments.length !== routeSegments.length) return false;

  return callSegments.every((callSegment, index) => {
    const routeSegment = routeSegments[index];
    if (routeSegment.startsWith(':')) return true;
    if (callSegment.includes('*')) return true;
    return callSegment === routeSegment;
  });
}

test('every canonical mobile support API path resolves to a registered Express route', () => {
  const registered = collectRegisteredRoutes();
  const calls = collectMobileCalls().filter((call) => (
    call.rawPath === '/chat/start'
    || call.rawPath === '/chat/me'
    || call.rawPath.startsWith('/chat/${')
  ));

  assert.ok(calls.length >= 8, `expected to find the mobile support API surface, found ${calls.length} calls`);

  const registeredByMethod = new Map();
  for (const entry of registered) {
    const [method, routePath] = entry.split(' ');
    if (!registeredByMethod.has(method)) registeredByMethod.set(method, []);
    registeredByMethod.get(method).push(routePath);
  }

  const unmatched = calls.filter((call) => !(registeredByMethod.get(call.method) || [])
    .some((routePath) => callMatchesRoute(call.rawPath, routePath)));

  assert.deepEqual(
    unmatched.map((call) => `${call.method} ${call.rawPath}  (${call.file})`),
    [],
    'these mobile calls have no matching registered backend route',
  );
});

test('the support-chat endpoints the mobile UI exposes buttons for are registered', () => {
  const registered = collectRegisteredRoutes();
  for (const route of [
    'PATCH /chat/:conversationId/resolution',
    'PATCH /chat/:conversationId/reopen',
    'POST /chat/:conversationId/attachments',
    // The one protected read path. MessageBubble builds
    // `${MOBILE_API_BASE_URL}${attachment.url}` with a bearer header and
    // chatAttachmentViewer.openChatAttachment downloads through it, so an
    // unregistered route here means every attachment tile silently fails.
    'GET /chat/:conversationId/attachments/:attachmentId',
    'PATCH /chat/:conversationId/close',
  ]) {
    assert.ok(registered.has(route), `${route} must be registered`);
  }
});

test('attachment bytes have no unauthenticated or storage-URL alternative', () => {
  const registered = collectRegisteredRoutes();
  const attachmentReads = [...registered].filter((route) => /^GET .*attachments/.test(route));
  assert.deepEqual(
    attachmentReads.sort(),
    [
      'GET /chat/:conversationId/attachments/:attachmentId',
      'GET /chat/admin/:conversationId/attachments/:attachmentId',
    ],
    'the only ways to read attachment bytes are the two authenticated, conversation-bound routes',
  );

  // Neither the serializer nor the client contract may hand out a provider URL.
  const controller = fs.readFileSync(
    path.join(BACKEND_ROOT, 'controllers', 'chat.controller.js'),
    'utf8',
  );
  assert.match(
    controller,
    /function serializeAttachment[\s\S]*?\n}/,
    'serializeAttachment must exist',
  );
  const serializer = controller.match(/function serializeAttachment[\s\S]*?\n}/)[0];
  for (const leak of ['storagePath', 'downloadUrl', 'storageUrl', 'bucket']) {
    assert.ok(
      !serializer.includes(leak),
      `serializeAttachment must not expose ${leak} to a client`,
    );
  }
});

test('no client-side realtime transport survives without a server counterpart', () => {
  // The mobile app connected a Socket.IO client to a server that has never
  // existed. If someone reintroduces a realtime client, this fails until a
  // matching server is stood up.
  assert.equal(
    fs.existsSync(path.join(FRONTEND_ROOT, 'src', 'services', 'realtime.js')),
    false,
    'frontend/src/services/realtime.js is a dead Socket.IO client — see the realtime architecture decision',
  );
  const frontendPackage = JSON.parse(fs.readFileSync(path.join(FRONTEND_ROOT, 'package.json'), 'utf8'));
  assert.equal(
    Boolean(frontendPackage.dependencies?.['socket.io-client']),
    false,
    'socket.io-client has no server to talk to; polling + OS push is the supported architecture',
  );
});
