'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAnnouncementVisibleForBranch,
  resolveRequesterBranchCode,
} = require('../services/announcementAudience.service');

function cursor(records) {
  return { sort() { return this; }, limit() { return this; }, async toArray() { return records; } };
}

// Mirrors the fakeDb shape from tests/branchLocation.test.js so
// resolveRequesterBranchCode is exercised against the real resolveTenantBranch tiers.
function fakeDb({ stays = [], reservations = [], branches = [] } = {}) {
  return {
    collection(name) {
      return {
        find(query) {
          if (name === 'stays') return cursor(stays);
          if (name !== 'reservations') return cursor([]);
          const contractTier = JSON.stringify(query).includes('contractStatus');
          return cursor(reservations.filter((record) => contractTier
            ? Boolean(record.contractStatus || record.leaseStatus || record.contractApproved)
            : Boolean(record.status || record.applicationStatus || record.approvalStatus || record.isApproved)));
        },
        async findOne(query) {
          if (name !== 'branches') return null;
          const values = query.$or.map((entry) => String(Object.values(entry)[0]));
          return branches.find((branch) => values.includes(String(branch.branchId))
            || values.includes(String(branch.branchCode))
            || values.includes(String(branch.slug))) || null;
        },
      };
    },
  };
}

test('global announcement (no branch field) is visible regardless of requester branch', () => {
  assert.equal(isAnnouncementVisibleForBranch({ branch: null }, null), true);
  assert.equal(isAnnouncementVisibleForBranch({ branch: '' }, 'gil-puyat'), true);
  assert.equal(isAnnouncementVisibleForBranch({}, 'guadalupe'), true);
});

test('branch-restricted announcement is visible only to a matching requester branch', () => {
  assert.equal(isAnnouncementVisibleForBranch({ branch: 'gil-puyat' }, 'gil-puyat'), true);
  assert.equal(isAnnouncementVisibleForBranch({ branch: 'Gil Puyat' }, 'gil-puyat'), true, 'display-name casing normalizes to the same code');
  assert.equal(isAnnouncementVisibleForBranch({ branch: 'guadalupe' }, 'gil-puyat'), false);
});

test('branch-restricted announcement is hidden when requester branch is unresolved', () => {
  assert.equal(isAnnouncementVisibleForBranch({ branch: 'guadalupe' }, null), false);
});

test('private announcements still require branch eligibility when a branch restriction is present', () => {
  assert.equal(isAnnouncementVisibleForBranch({ is_private: true, branch: 'guadalupe' }, 'gil-puyat'), false);
  assert.equal(isAnnouncementVisibleForBranch({ isPrivate: true, branch: 'guadalupe' }, null), false);
  assert.equal(isAnnouncementVisibleForBranch({ is_private: true }, null), true);
});

test('resolveRequesterBranchCode returns null for unauthenticated requests', async () => {
  const code = await resolveRequesterBranchCode(fakeDb(), null);
  assert.equal(code, null);
});

test('resolveRequesterBranchCode returns the tenant branch code from an active stay', async () => {
  const code = await resolveRequesterBranchCode(fakeDb({
    stays: [{ branchId: 'BRANCH_GIL_PUYAT', status: 'active' }],
    branches: [{ branchId: 'BRANCH_GIL_PUYAT', branchCode: 'gil-puyat', branchName: 'Gil Puyat', branchAddress: 'x', googleMapsUrl: 'https://maps', isActive: true }],
  }), { user_id: 'tenant-a' });
  assert.equal(code, 'gil-puyat');
});

test('resolveRequesterBranchCode returns null (not an error) when no occupancy can be resolved', async () => {
  const code = await resolveRequesterBranchCode(fakeDb(), { user_id: 'tenant-with-no-records' });
  assert.equal(code, null);
});

test('resolveRequesterBranchCode returns null on conflicting branch assignments rather than throwing', async () => {
  const code = await resolveRequesterBranchCode(fakeDb({
    stays: [{ branchId: 'BRANCH_A', status: 'active' }, { branchId: 'BRANCH_B', status: 'active' }],
    branches: [
      { branchId: 'BRANCH_A', branchCode: 'a', branchName: 'A', branchAddress: 'x', googleMapsUrl: 'https://maps', isActive: true },
      { branchId: 'BRANCH_B', branchCode: 'b', branchName: 'B', branchAddress: 'x', googleMapsUrl: 'https://maps', isActive: true },
    ],
  }), { user_id: 'tenant-a' });
  assert.equal(code, null);
});
