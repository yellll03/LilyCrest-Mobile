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

function isAccountActive(user = {}) {
  if (user.deleted_at || user.deletedAt || user.is_deleted === true || user.isDeleted === true) return false;
  if (user.is_active === false || user.isActive === false || user.disabled === true || user.is_disabled === true) return false;
  const status = String(user.status || user.account_status || '').trim().toLowerCase();
  return !['inactive', 'disabled', 'deleted', 'suspended', 'blocked', 'terminated', 'pending', 'pending_approval'].includes(status);
}

// A user may be sent a tenant password reset only when they are a real
// tenant/resident AND their account is active. Missing user => not eligible.
// This is the single check the mobile forgot-password proxy uses to decide
// whether to forward to the canonical upstream — the response to the caller
// is identical either way (enumeration-safe).
function isTenantResetEligible(user) {
  if (!user || typeof user !== 'object') return false;
  return isTenantMobileRole(user.role) && isAccountActive(user);
}

function tenantAccountStatus(user = {}) {
  if (!isTenantMobileRole(user.role)) return null;
  if (isAccountActive(user)) return { code: 'active', label: 'Active Tenant' };
  const status = String(user.status || user.account_status || '').trim().toLowerCase();
  if (['pending', 'pending_approval'].includes(status)) return { code: 'pending', label: 'Pending Tenant' };
  return { code: 'inactive', label: 'Inactive Tenant' };
}

module.exports = {
  TENANT_MOBILE_ROLES,
  isAccountActive,
  isTenantMobileRole,
  isTenantResetEligible,
  normalizeRole,
  tenantAccountStatus,
};
