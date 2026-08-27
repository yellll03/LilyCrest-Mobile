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
  normalizeRole,
  tenantAccountStatus,
};
