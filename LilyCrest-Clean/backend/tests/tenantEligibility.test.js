'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isTenantMobileRole, normalizeRole } = require('../utils/tenantEligibility');
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

test('Change Password mounts the strict tenant-password middleware server-side', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.routes.js'), 'utf8');
  assert.match(
    source,
    /router\.post\('\/change-password', authLimiter, authMiddleware, tenantPasswordMiddleware, authController\.changePassword\)/,
  );
});
