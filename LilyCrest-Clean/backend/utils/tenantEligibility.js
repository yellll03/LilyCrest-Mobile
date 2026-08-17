'use strict';

// `resident` is the standalone backend's legacy tenant alias. Every other
// role fails closed for tenant-only mobile password operations.
const TENANT_MOBILE_ROLES = new Set(['tenant', 'resident']);

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isTenantMobileRole(role) {
  return TENANT_MOBILE_ROLES.has(normalizeRole(role));
}

module.exports = { TENANT_MOBILE_ROLES, isTenantMobileRole, normalizeRole };
