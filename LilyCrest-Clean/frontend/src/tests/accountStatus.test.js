/* global test */
const { resolveAccountStatus, isTenantRole } = require('../utils/accountStatus');

// resolveAccountStatus is the single source of truth for the tenant account
// status badge on Home and Profile. It mirrors the backend's canonical
// `tenantAccountStatus` (backend/utils/tenantEligibility.js): a well-formed
// serialized `accountStatus` always wins; otherwise a live authenticated
// session with a server-owned tenant/resident role resolves to
// "Active Tenant", with explicit non-active lifecycle states taking
// precedence. It never guesses from client-only fields (tenantStatus,
// moveInDate, reservation data).

describe('resolveAccountStatus — serialized backend status wins', () => {
  test('returns the backend accountStatus object verbatim when well-formed', () => {
    const user = {
      role: 'tenant',
      accountStatus: { code: 'active', label: 'Active Tenant' },
    };
    expect(resolveAccountStatus(user, { isAuthenticated: true })).toEqual({
      code: 'active',
      label: 'Active Tenant',
    });
  });

  test('a richer backend label is preserved, not normalized to the fallback', () => {
    const user = {
      role: 'tenant',
      status: 'active',
      accountStatus: { code: 'active', label: 'Active Tenant · Unit 4B' },
    };
    expect(resolveAccountStatus(user, { isAuthenticated: true })).toEqual({
      code: 'active',
      label: 'Active Tenant · Unit 4B',
    });
  });

  test('a well-formed pending/inactive backend status is returned as-is', () => {
    expect(
      resolveAccountStatus(
        { role: 'tenant', accountStatus: { code: 'pending', label: 'Pending Tenant' } },
        { isAuthenticated: true },
      ),
    ).toEqual({ code: 'pending', label: 'Pending Tenant' });
    expect(
      resolveAccountStatus(
        { role: 'tenant', accountStatus: { code: 'inactive', label: 'Inactive Tenant' } },
        { isAuthenticated: true },
      ),
    ).toEqual({ code: 'inactive', label: 'Inactive Tenant' });
  });

  test('a malformed accountStatus object is ignored and the session is used instead', () => {
    // empty strings / missing fields -> not well-formed -> fall through
    expect(
      resolveAccountStatus(
        { role: 'tenant', accountStatus: { code: '', label: '' } },
        { isAuthenticated: true },
      ),
    ).toEqual({ code: 'active', label: 'Active Tenant' });
    expect(
      resolveAccountStatus(
        { role: 'tenant', accountStatus: 'active' },
        { isAuthenticated: true },
      ),
    ).toEqual({ code: 'active', label: 'Active Tenant' });
  });
});

describe('resolveAccountStatus — authenticated tenant session fallback', () => {
  test('a verified authenticated tenant with no serialized accountStatus resolves to Active Tenant', () => {
    expect(
      resolveAccountStatus({ role: 'tenant' }, { isAuthenticated: true }),
    ).toEqual({ code: 'active', label: 'Active Tenant' });
  });

  test('the legacy "resident" role is treated as a tenant', () => {
    expect(
      resolveAccountStatus({ role: 'resident' }, { isAuthenticated: true }),
    ).toEqual({ code: 'active', label: 'Active Tenant' });
  });

  test('does NOT infer status from client-only lifecycle fields', () => {
    // tenantStatus / moveInDate must not change the verdict — only the
    // authenticated tenant session matters.
    const futureMoveIn = { role: 'tenant', tenantStatus: 'pending', moveInDate: '2099-01-01' };
    expect(resolveAccountStatus(futureMoveIn, { isAuthenticated: true })).toEqual({
      code: 'active',
      label: 'Active Tenant',
    });
    const pastMoveIn = { role: 'tenant', moveInDate: '2020-01-01' };
    expect(resolveAccountStatus(pastMoveIn, { isAuthenticated: true })).toEqual({
      code: 'active',
      label: 'Active Tenant',
    });
  });
});

describe('resolveAccountStatus — explicit non-active server state takes precedence', () => {
  test('status: "pending" overrides the active fallback', () => {
    expect(
      resolveAccountStatus({ role: 'tenant', status: 'pending' }, { isAuthenticated: true }),
    ).toEqual({ code: 'pending', label: 'Pending Tenant' });
    expect(
      resolveAccountStatus({ role: 'tenant', account_status: 'pending_approval' }, { isAuthenticated: true }),
    ).toEqual({ code: 'pending', label: 'Pending Tenant' });
  });

  test('status: "suspended" / "inactive" overrides the active fallback', () => {
    expect(
      resolveAccountStatus({ role: 'tenant', status: 'suspended' }, { isAuthenticated: true }),
    ).toEqual({ code: 'inactive', label: 'Inactive Tenant' });
    expect(
      resolveAccountStatus({ role: 'tenant', status: 'inactive' }, { isAuthenticated: true }),
    ).toEqual({ code: 'inactive', label: 'Inactive Tenant' });
  });

  test('hard-negative flags (is_active:false / deleted) resolve to inactive', () => {
    expect(
      resolveAccountStatus({ role: 'tenant', is_active: false }, { isAuthenticated: true }),
    ).toEqual({ code: 'inactive', label: 'Inactive Tenant' });
    expect(
      resolveAccountStatus({ role: 'tenant', deleted_at: '2026-01-01' }, { isAuthenticated: true }),
    ).toEqual({ code: 'inactive', label: 'Inactive Tenant' });
  });
});

describe('resolveAccountStatus — no badge cases', () => {
  test('unauthenticated session returns null even for a tenant-shaped user', () => {
    expect(resolveAccountStatus({ role: 'tenant' }, { isAuthenticated: false })).toBeNull();
    expect(resolveAccountStatus({ role: 'tenant' }, {})).toBeNull();
  });

  test('stale / missing user returns null', () => {
    expect(resolveAccountStatus(null, { isAuthenticated: true })).toBeNull();
    expect(resolveAccountStatus(undefined, { isAuthenticated: true })).toBeNull();
  });

  test('a non-tenant role returns null', () => {
    expect(resolveAccountStatus({ role: 'admin' }, { isAuthenticated: true })).toBeNull();
    expect(resolveAccountStatus({ role: 'applicant' }, { isAuthenticated: true })).toBeNull();
    expect(resolveAccountStatus({ role: 'staff' }, { isAuthenticated: true })).toBeNull();
    expect(resolveAccountStatus({}, { isAuthenticated: true })).toBeNull();
  });
});

describe('resolveAccountStatus — authentication provider does not influence tenancy', () => {
  test('a Google/OAuth-authenticated tenant is still a tenant', () => {
    const googleTenant = {
      role: 'tenant',
      provider: 'google',
      authProvider: 'google.com',
      firebaseProvider: 'google.com',
    };
    expect(resolveAccountStatus(googleTenant, { isAuthenticated: true })).toEqual({
      code: 'active',
      label: 'Active Tenant',
    });
  });

  test('a Google/OAuth-authenticated NON-tenant does not become a tenant', () => {
    const googleAdmin = { role: 'admin', provider: 'google', authProvider: 'google.com' };
    expect(resolveAccountStatus(googleAdmin, { isAuthenticated: true })).toBeNull();
  });
});

describe('isTenantRole', () => {
  test('tenant and resident are tenant roles; casing/whitespace tolerant', () => {
    expect(isTenantRole('tenant')).toBe(true);
    expect(isTenantRole('resident')).toBe(true);
    expect(isTenantRole(' Tenant ')).toBe(true);
    expect(isTenantRole('RESIDENT')).toBe(true);
  });

  test('every other role is not a tenant role', () => {
    expect(isTenantRole('admin')).toBe(false);
    expect(isTenantRole('applicant')).toBe(false);
    expect(isTenantRole('')).toBe(false);
    expect(isTenantRole(undefined)).toBe(false);
  });
});
