// Single source of truth for the tenant "account status" badge shown on Home
// and Profile. These two screens previously derived the badge independently:
// Profile rendered `user.accountStatus.label` verbatim (nothing when the
// backend object was absent), while Home inferred an "Active Tenant" label
// from the presence of a room assignment. A verified tenant whose serialized
// `accountStatus` had not yet synced (fresh OAuth login, a cached user
// document, an older serialization) therefore saw a status on one screen and
// a blank on the other.
//
// resolveAccountStatus mirrors the backend's canonical contract
// (backend/utils/tenantEligibility.js `tenantAccountStatus`): it prefers a
// well-formed serialized `accountStatus`, and otherwise reconstructs the same
// verdict from the authenticated session + the server-owned role. It never
// guesses from client-only lifecycle fields such as `tenantStatus` or
// `moveInDate` — the only inputs are the auth session and the role/lifecycle
// state the backend actually owns.

// `resident` is the standalone backend's legacy tenant alias; every other
// role is not a mobile tenant and resolves to no badge.
const TENANT_ROLES = new Set(['tenant', 'resident']);

// Explicit non-active lifecycle/account states the server may report. These
// take precedence over the "authenticated tenant ⇒ active" fallback.
const PENDING_STATES = new Set(['pending', 'pending_approval']);
const INACTIVE_STATES = new Set([
  'inactive', 'disabled', 'deleted', 'suspended', 'blocked', 'terminated',
]);

function normalize(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function isTenantRole(role) {
  return TENANT_ROLES.has(normalize(role));
}

// True when a serialized accountStatus object is shaped like the backend's
// ({ code, label } with non-empty strings). Anything else is treated as
// "not provided" and falls through to session-based resolution.
function isWellFormedAccountStatus(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.code === 'string' && value.code.trim().length > 0
    && typeof value.label === 'string' && value.label.trim().length > 0;
}

// Mirrors backend isAccountActive(): hard-negative flags first, then an
// explicit non-active status string.
function explicitLifecycleStatus(user) {
  if (!user || typeof user !== 'object') return null;
  if (user.deleted_at || user.deletedAt || user.is_deleted === true || user.isDeleted === true) {
    return { code: 'inactive', label: 'Inactive Tenant' };
  }
  if (user.is_active === false || user.isActive === false || user.disabled === true || user.is_disabled === true) {
    return { code: 'inactive', label: 'Inactive Tenant' };
  }
  const status = normalize(user.status || user.account_status);
  if (PENDING_STATES.has(status)) return { code: 'pending', label: 'Pending Tenant' };
  if (INACTIVE_STATES.has(status)) return { code: 'inactive', label: 'Inactive Tenant' };
  return null;
}

/**
 * Resolve the tenant account-status badge for the current session.
 *
 * @param {object|null} user  The serialized user (may carry `accountStatus`).
 * @param {{ isAuthenticated?: boolean }} [session]
 * @returns {{ code: string, label: string } | null}
 *   `null` for unauthenticated / stale sessions and non-tenant roles.
 */
function resolveAccountStatus(user, { isAuthenticated } = {}) {
  // A well-formed serialized status is always authoritative — even for a
  // session we cannot otherwise verify here — because the backend only emits
  // it for a real tenant account and it already encodes the lifecycle state.
  if (isWellFormedAccountStatus(user && user.accountStatus)) {
    const { code, label } = user.accountStatus;
    return { code: code.trim(), label: label.trim() };
  }

  // No usable serialized status: reconstruct the verdict from the session.
  // Requires a live authenticated session AND a server-owned tenant role.
  // The authentication provider (password, Google/OAuth, …) is irrelevant.
  if (!isAuthenticated) return null;
  if (!user || typeof user !== 'object') return null;
  if (!isTenantRole(user.role)) return null;

  // Honor an explicit non-active lifecycle/account state before falling back.
  const explicit = explicitLifecycleStatus(user);
  if (explicit) return explicit;

  return { code: 'active', label: 'Active Tenant' };
}

module.exports = {
  resolveAccountStatus,
  isTenantRole,
};
