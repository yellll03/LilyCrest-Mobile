'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isAccountActive, isTenantMobileRole, normalizeRole, tenantAccountStatus } = require('../utils/tenantEligibility');
const fs = require('node:fs');
const path = require('node:path');

test('tenant and legacy resident roles are eligible', () => {
  assert.equal(isTenantMobileRole('tenant'), true);
  assert.equal(isTenantMobileRole(' Resident '), true);
});

for (const role of ['applicant', 'admin', 'superadmin', 'branch_admin', 'owner', 'staff', '', null]) {
  test(`${String(role)} is not tenant-mobile eligible`, () => {
    assert.equal(isTenantMobileRole(role), false);
  });
}

test('role normalization does not inspect client-side metadata', () => {
  assert.equal(normalizeRole({ role: 'tenant' }), '[object object]');
  assert.equal(isTenantMobileRole({ role: 'tenant' }), false);
});

test('authoritative tenant account status uses server-owned role and activation fields', () => {
  assert.deepEqual(tenantAccountStatus({ role: 'tenant', status: 'active', is_active: true }), {
    code: 'active', label: 'Active Tenant',
  });
  assert.deepEqual(tenantAccountStatus({ role: 'resident', status: 'pending' }), {
    code: 'pending', label: 'Pending Tenant',
  });
  assert.equal(tenantAccountStatus({ role: 'applicant', status: 'active' }), null);
  assert.equal(isAccountActive({ status: 'suspended' }), false);
});

test('tenantMiddleware returns a stable 403 code for a non-tenant session', () => {
  const { tenantMiddleware } = require('../middleware/auth');
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;
  tenantMiddleware({ user: { role: 'applicant' } }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'TENANT_ACCESS_REQUIRED');
});

test('Change Password mounts the strict tenant-password middleware server-side', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.routes.js'), 'utf8');
  assert.match(
    source,
    /router\.post\('\/change-password', authLimiter, authMiddleware, tenantPasswordMiddleware, authController\.changePassword\)/,
  );
});

test('session profile and every tenant chatbot action use the canonical tenant role gate', () => {
  const authRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.routes.js'), 'utf8');
  const chatbotRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chatbot.routes.js'), 'utf8');
  assert.match(authRoutes, /router\.get\('\/me', authMiddleware, tenantMiddleware, authController\.getMe\)/);
  assert.match(chatbotRoutes, /router\.post\('\/close-live-chat', authMiddleware, tenantMiddleware, chatbotController\.closeLiveChat\)/);
});
