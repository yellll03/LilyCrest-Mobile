'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');

const dbModulePath = require.resolve('../config/database');
let currentDb = null;

if (!require.cache[dbModulePath]) {
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
} else {
  throw new Error('config/database.js was loaded before adminBrowserSecurity.test.js');
}

const {
  extractRequestCredential,
  generateAdminCsrfToken,
  hashAdminCsrfToken,
  issueAdminBrowserCookies,
} = require('../utils/adminBrowserSession');
const { authMiddleware } = require('../middleware/auth');
const {
  adminSecurityHeaders,
  buildAdminContentSecurityPolicy,
  commonSecurityHeaders,
} = require('../middleware/securityHeaders');
const { getAdminTicket } = require('../controllers/ticket.controller');
const { adminGetAllUsers } = require('../controllers/user.controller');
const { getAdminBrowserSession } = require('../controllers/auth.controller');
const authRoutes = require('../routes/auth.routes');
const ticketRoutes = require('../routes/ticket.routes');

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    cookies: [],
    clearedCookies: [],
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    cookie(name, value, options) { this.cookies.push({ name, value, options }); return this; },
    clearCookie(name, options) { this.clearedCookies.push({ name, options }); return this; },
  };
}

async function invokeAuth(req) {
  const res = response();
  let nextCalled = false;
  await authMiddleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

function validDb({ csrfToken = null } = {}) {
  const session = {
    _id: 'admin-session-row',
    user_id: 'admin-a',
    session_token: 'cookie-session-token',
    expires_at: new Date(Date.now() + 60_000),
    security_version: 4,
    ...(csrfToken ? { admin_csrf_hash: hashAdminCsrfToken(csrfToken) } : {}),
  };
  const user = {
    user_id: 'admin-a',
    role: 'admin',
    status: 'active',
    is_active: true,
    securityVersion: 4,
  };
  return {
    collection(name) {
      return {
        async findOne() { return name === 'user_sessions' ? session : user; },
        async deleteOne() { return { deletedCount: 1 }; },
        async deleteMany() { return { deletedCount: 1 }; },
      };
    },
  };
}

test('admin browser credentials come only from an opted-in HttpOnly cookie; bearer still wins', () => {
  assert.deepEqual(extractRequestCredential({
    headers: { 'x-lilycrest-admin': 'browser' },
    cookies: { session_token: 'cookie-token' },
  }), { token: 'cookie-token', transport: 'admin_cookie' });

  assert.deepEqual(extractRequestCredential({
    headers: {},
    cookies: { session_token: 'cookie-token' },
  }), { token: null, transport: null });

  assert.deepEqual(extractRequestCredential({
    headers: { authorization: 'Bearer mobile-token', 'x-lilycrest-admin': 'browser' },
    cookies: { session_token: 'cookie-token' },
  }), { token: 'mobile-token', transport: 'bearer' });
});

test('admin browser cookies are secure, HttpOnly for the session, and Strict same-site', () => {
  const res = response();
  const csrfToken = generateAdminCsrfToken();
  issueAdminBrowserCookies(res, { sessionToken: 'secret-session', csrfToken });

  const sessionCookie = res.cookies.find((cookie) => cookie.name === 'session_token');
  const csrfCookie = res.cookies.find((cookie) => cookie.name === 'lc_admin_csrf');
  assert.equal(sessionCookie.value, 'secret-session');
  assert.equal(sessionCookie.options.httpOnly, true);
  assert.equal(sessionCookie.options.sameSite, 'strict');
  assert.equal(csrfCookie.options.httpOnly, false);
  assert.equal(csrfCookie.options.sameSite, 'strict');
});

test('cookie-authenticated admin writes require the session-bound double-submit CSRF token', async () => {
  const csrfToken = generateAdminCsrfToken();
  currentDb = validDb({ csrfToken });

  const rejected = await invokeAuth({
    method: 'POST',
    headers: { 'x-lilycrest-admin': 'browser' },
    cookies: { session_token: 'cookie-session-token', lc_admin_csrf: csrfToken },
  });
  assert.equal(rejected.nextCalled, false);
  assert.equal(rejected.res.statusCode, 403);
  assert.equal(rejected.res.body.code, 'CSRF_INVALID');
  assert.equal(rejected.res.clearedCookies.length, 0, 'a CSRF failure does not revoke a valid session');

  const accepted = await invokeAuth({
    method: 'POST',
    headers: { 'x-lilycrest-admin': 'browser', 'x-csrf-token': csrfToken },
    cookies: { session_token: 'cookie-session-token', lc_admin_csrf: csrfToken },
  });
  assert.equal(accepted.nextCalled, true);
  assert.equal(accepted.res.statusCode, 200);
});

test('temporary database failure keeps the admin cookie while confirmed invalidation clears it', async () => {
  currentDb = {
    collection() {
      return { async findOne() { throw new Error('MongoServerSelectionError'); } };
    },
  };
  const retryable = await invokeAuth({
    method: 'GET',
    headers: { 'x-lilycrest-admin': 'browser' },
    cookies: { session_token: 'cookie-session-token' },
  });
  assert.equal(retryable.res.statusCode, 503);
  assert.equal(retryable.res.body.retryable, true);
  assert.equal(retryable.res.clearedCookies.length, 0);

  currentDb = {
    collection() {
      return {
        async findOne() { return null; },
        async deleteOne() { return { deletedCount: 0 }; },
        async deleteMany() { return { deletedCount: 0 }; },
      };
    },
  };
  const invalid = await invokeAuth({
    method: 'GET',
    headers: { 'x-lilycrest-admin': 'browser' },
    cookies: { session_token: 'unknown-session' },
  });
  assert.equal(invalid.res.statusCode, 401);
  assert.equal(invalid.res.body.code, 'SESSION_INVALID');
  assert.deepEqual(invalid.res.clearedCookies.map((cookie) => cookie.name).sort(), ['lc_admin_csrf', 'session_token']);
});

test('admin session restore rotates a missing CSRF token without exposing the bearer credential', async () => {
  let update = null;
  currentDb = {
    collection(name) {
      assert.equal(name, 'user_sessions');
      return {
        async updateOne(filter, value) {
          update = { filter, value };
          return { matchedCount: 1, modifiedCount: 1 };
        },
      };
    },
  };
  const res = response();
  await getAdminBrowserSession({
    authTransport: 'admin_cookie',
    authToken: 'http-only-session',
    headers: { 'x-lilycrest-admin': 'browser' },
    cookies: {},
    session: { _id: 'session-row', user_id: 'admin-a', expires_at: new Date(Date.now() + 60_000) },
    user: { user_id: 'admin-a', name: 'Admin A', role: 'admin', password_hash: 'never-return' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.auth_transport, 'cookie');
  assert.equal(res.body.user.name, 'Admin A');
  assert.equal(res.body.user.password_hash, undefined);
  assert.equal(res.body.session_token, undefined);
  assert.match(res.body.csrf_token, /^[A-Za-z0-9_-]+$/);
  assert.equal(update.filter._id, 'session-row');
  assert.equal(update.value.$set.admin_csrf_hash, hashAdminCsrfToken(res.body.csrf_token));
  assert.equal(res.cookies.find((cookie) => cookie.name === 'session_token').options.httpOnly, true);
});

test('admin and common security headers include a hash-bound CSP and anti-framing protections', () => {
  const res = response();
  commonSecurityHeaders({}, res, () => {});
  adminSecurityHeaders({}, res, () => {});

  const policy = buildAdminContentSecurityPolicy();
  const scriptDirective = policy.split(';').find((directive) => directive.trim().startsWith('script-src'));
  assert.match(scriptDirective, /'sha256-[A-Za-z0-9+/]+=*'/);
  assert.doesNotMatch(scriptDirective, /'unsafe-inline'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.equal(res.headers['X-Frame-Options'], 'DENY');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

function closingDivIndex(html, elementId) {
  const start = html.indexOf(`id="${elementId}"`);
  assert.notEqual(start, -1, `${elementId} must exist`);
  const open = html.lastIndexOf('<div', start);
  const tags = /<div\b[^>]*>|<\/div>/gi;
  tags.lastIndex = open;
  let depth = 0;
  let match;
  while ((match = tags.exec(html))) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return tags.lastIndex;
  }
  return -1;
}

test('admin HTML has sibling Tickets/Live Chat pages and no browser-stored bearer or inline handlers', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /localStorage|sessionToken|Authorization/);
  assert.doesNotMatch(html, /\son(?:click|change|input)=/i);
  assert.ok(closingDivIndex(html, 'page-tickets') < html.indexOf('id="page-livechat"'));
  assert.ok(closingDivIndex(html, 'page-livechat') < html.indexOf('id="page-announcements"'));
  assert.match(html, /\/tickets\/admin\/\$\{currentTicket\.ticket_id\}`/);
  assert.doesNotMatch(html, /\/tickets\/\$\{currentTicket\.ticket_id\}`/);
});

test('the admin ticket detail controller refreshes by ticket ID without the tenant-only route', async () => {
  currentDb = {
    collection(name) {
      assert.equal(name, 'tickets');
      return {
        async findOne(query) {
          assert.deepEqual(query, { ticket_id: 'ticket-a' });
          return { _id: 'mongo-id', ticket_id: 'ticket-a', user_id: 'tenant-a', responses: [] };
        },
      };
    },
  };
  const res = response();
  await getAdminTicket({ params: { ticketId: 'ticket-a' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ticket_id, 'ticket-a');
  assert.equal(res.body._id, undefined);
});

test('the admin users endpoint returns the safe allowlisted DTO, not the raw user document', async () => {
  currentDb = {
    collection(name) {
      assert.equal(name, 'users');
      return {
        find() {
          return {
            sort() {
              return {
                async toArray() {
                  return [{
                    _id: 'mongo-id',
                    user_id: 'tenant-a',
                    name: 'Tenant A',
                    email: 'tenant@example.com',
                    role: 'tenant',
                    room_number: '204',
                    password_hash: 'secret',
                    refresh_token_hash: 'secret-too',
                    internal_admin_note: 'private',
                  }];
                },
              };
            },
          };
        },
      };
    },
  };
  const res = response();
  await adminGetAllUsers({}, res);
  assert.deepEqual(res.body, [{
    user_id: 'tenant-a',
    email: 'tenant@example.com',
    name: 'Tenant A',
    role: 'tenant',
    room_number: '204',
  }]);
});

test('HTTP journey restores cookie session, rejects missing CSRF, replies, refreshes, and logs out', async (t) => {
  const csrfToken = generateAdminCsrfToken();
  const session = {
    _id: 'session-row',
    user_id: 'admin-a',
    session_token: 'browser-session',
    expires_at: new Date(Date.now() + 60_000),
    security_version: 2,
    admin_csrf_hash: hashAdminCsrfToken(csrfToken),
  };
  const user = {
    user_id: 'admin-a',
    name: 'Admin A',
    role: 'admin',
    status: 'active',
    securityVersion: 2,
  };
  const ticket = {
    ticket_id: 'ticket-a',
    user_id: 'tenant-a',
    subject: 'Internet issue',
    message: 'No connection',
    status: 'open',
    responses: [],
  };
  let sessionDeleted = false;

  currentDb = {
    collection(name) {
      if (name === 'user_sessions') {
        return {
          async findOne(query) {
            return !sessionDeleted && query.session_token === session.session_token ? session : null;
          },
          async updateOne() { return { matchedCount: 1, modifiedCount: 0 }; },
          async deleteOne() { sessionDeleted = true; return { deletedCount: 1 }; },
          async deleteMany() { sessionDeleted = true; return { deletedCount: 1 }; },
        };
      }
      if (name === 'users') return { async findOne() { return user; } };
      if (name === 'tickets') {
        return {
          async findOne(query) { return query.ticket_id === ticket.ticket_id ? ticket : null; },
          async updateOne(_query, update) {
            if (update.$push?.responses) ticket.responses.push(update.$push.responses);
            if (update.$set) Object.assign(ticket, update.$set);
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
  };

  const app = express();
  app.use(commonSecurityHeaders);
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/tickets', ticketRoutes);
  app.use('/admin', adminSecurityHeaders, express.static(path.join(__dirname, '..', 'public', 'admin')));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browserHeaders = {
    'X-LilyCrest-Admin': 'browser',
    Cookie: `session_token=${session.session_token}; lc_admin_csrf=${csrfToken}`,
  };

  const htmlResponse = await fetch(`${baseUrl}/admin/`);
  assert.equal(htmlResponse.status, 200);
  assert.match(htmlResponse.headers.get('content-security-policy'), /script-src 'self' 'sha256-/);
  assert.equal(htmlResponse.headers.get('x-frame-options'), 'DENY');

  const restoreResponse = await fetch(`${baseUrl}/api/auth/admin-session`, { headers: browserHeaders });
  const restoreBody = await restoreResponse.json();
  assert.equal(restoreResponse.status, 200);
  assert.equal(restoreBody.user.user_id, 'admin-a');
  assert.equal(restoreBody.session_token, undefined);

  const rejectedReply = await fetch(`${baseUrl}/api/tickets/admin/ticket-a/reply`, {
    method: 'POST',
    headers: { ...browserHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'We are checking.' }),
  });
  assert.equal(rejectedReply.status, 403);
  assert.equal((await rejectedReply.json()).code, 'CSRF_INVALID');
  assert.equal(ticket.responses.length, 0);

  const acceptedReply = await fetch(`${baseUrl}/api/tickets/admin/ticket-a/reply`, {
    method: 'POST',
    headers: { ...browserHeaders, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ message: 'We are checking.' }),
  });
  assert.equal(acceptedReply.status, 200);
  assert.equal(ticket.responses.length, 1);

  const refreshed = await fetch(`${baseUrl}/api/tickets/admin/ticket-a`, { headers: browserHeaders });
  const refreshedBody = await refreshed.json();
  assert.equal(refreshed.status, 200);
  assert.equal(refreshedBody.responses[0].message, 'We are checking.');

  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { ...browserHeaders, 'X-CSRF-Token': csrfToken },
  });
  assert.equal(logoutResponse.status, 200);
  assert.equal(sessionDeleted, true);

  const afterLogout = await fetch(`${baseUrl}/api/auth/admin-session`, { headers: browserHeaders });
  assert.equal(afterLogout.status, 401);
  assert.equal((await afterLogout.json()).code, 'SESSION_INVALID');
});
