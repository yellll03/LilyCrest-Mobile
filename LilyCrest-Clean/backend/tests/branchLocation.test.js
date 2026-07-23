'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { publicBranchLocation, resolveTenantBranch } = require('../services/branchLocation.service');

function cursor(records) {
  return { sort() { return this; }, limit() { return this; }, async toArray() { return records; } };
}

function fakeDb({ stays = [], occupancies = [], assignments = [], rooms = [], reservations = [], branches = [] } = {}) {
  return {
    collection(name) {
      return {
        find(query) {
          if (name === 'stays') return cursor(stays);
          if (name === 'roomoccupancyhistories') return cursor(occupancies);
          if (name === 'room_assignments') return cursor(assignments);
          if (name !== 'reservations') return cursor([]);
          const contractTier = JSON.stringify(query).includes('contractStatus');
          return cursor(reservations.filter((record) => contractTier
            ? Boolean(record.contractStatus || record.leaseStatus || record.contractApproved)
            : Boolean(record.status || record.applicationStatus || record.approvalStatus || record.isApproved)));
        },
        async findOne(query) {
          if (name === 'rooms') {
            return rooms.find((room) => query.$or.some((entry) => (
              String(Object.values(entry)[0]) === String(room._id || room.roomId)
            ))) || null;
          }
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

const gil = {
  branchId: 'BRANCH_GIL_PUYAT', branchCode: 'gil-puyat',
  branchName: 'LilyCrest Residences – Gil Puyat',
  branchAddress: '#7 Gil Puyat Ave. corner Marconi St., Makati City',
  googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=gil',
  isActive: true,
};
const guadalupe = {
  branchId: 'BRANCH_GUADALUPE', branchCode: 'guadalupe',
  branchName: 'LilyCrest Residences – Guadalupe',
  branchAddress: '1212, 9431 Magallanes, Makati, 1212 Metro Manila',
  googleMapsUrl: 'https://maps.app.goo.gl/zEQJECzxDY4qdhYp6',
  isActive: true,
};

test('current stay wins over approved contract and reservation', async () => {
  const result = await resolveTenantBranch(fakeDb({
    stays: [{ branchId: gil.branchId, status: 'active' }],
    reservations: [{ branchId: guadalupe.branchId, status: 'approved', contractStatus: 'signed' }],
    branches: [gil, guadalupe],
  }), { user_id: 'tenant-a' });
  assert.equal(result.source, 'current_stay');
  assert.equal(result.branch.branchCode, 'gil-puyat');
});

test('conflicting branches at the same authority tier are rejected', async () => {
  await assert.rejects(() => resolveTenantBranch(fakeDb({
    stays: [{ branchId: gil.branchId }, { branchId: guadalupe.branchId }],
    branches: [gil, guadalupe],
  }), { user_id: 'tenant-a' }), (error) => error.code === 'BRANCH_ASSIGNMENT_CONFLICT');
});

test('Guadalupe exposes its exact configured destination and address', () => {
  const branch = publicBranchLocation(guadalupe);
  assert.equal(branch.branchAddress, '1212, 9431 Magallanes, Makati, 1212 Metro Manila');
  assert.equal(branch.googleMapsUrl, 'https://maps.app.goo.gl/zEQJECzxDY4qdhYp6');
});

test('incomplete, inactive, and missing assignments never default to another branch', async () => {
  assert.throws(() => publicBranchLocation({ ...gil, isActive: false }), /not available/i);
  assert.throws(() => publicBranchLocation({ ...gil, googleMapsUrl: '' }), /not available/i);
  await assert.rejects(() => resolveTenantBranch(fakeDb({ branches: [gil] }), { user_id: 'tenant-a' }),
    (error) => error.code === 'BRANCH_ASSIGNMENT_MISSING');
});

test('active room assignment resolves through its room before reservation', async () => {
  const result = await resolveTenantBranch(fakeDb({
    assignments: [{ roomId: 'room-1', status: 'active' }],
    rooms: [{ roomId: 'room-1', branch: 'guadalupe' }],
    reservations: [{ branch: 'gil-puyat', status: 'approved' }],
  }), { user_id: 'tenant-a' });
  assert.equal(result.source, 'active_room_assignment');
  assert.equal(result.branch.branchCode, 'guadalupe');
});

test('production occupancy branch name resolves before room and reservation', async () => {
  const result = await resolveTenantBranch(fakeDb({
    occupancies: [{
      tenantId: 'tenant-a',
      stayStatus: 'active',
      roomId: 'room-gp-205',
      branchName: 'LilyCrest Residences – Gil Puyat',
    }],
    reservations: [{ branch: 'guadalupe', status: 'approved' }],
  }), { _id: 'tenant-a', user_id: 'user-a' });
  assert.equal(result.source, 'active_room_assignment');
  assert.equal(result.branch.branchCode, 'gil-puyat');
});

test('known branch slug resolves through canonical location without a database branch record', async () => {
  const result = await resolveTenantBranch(fakeDb({
    reservations: [{ branch: 'guadalupe', status: 'approved' }],
  }), { user_id: 'tenant-a' });
  assert.equal(result.branch.branchName, 'LilyCrest Residences – Guadalupe');
  assert.equal(result.branch.googleMapsUrl, 'https://maps.app.goo.gl/zEQJECzxDY4qdhYp6');
});

test('future complete branch records require no resolver changes', async () => {
  const future = { ...gil, branchId: 'BRANCH_FUTURE', branchCode: 'future', branchName: 'Future Branch' };
  const result = await resolveTenantBranch(fakeDb({
    reservations: [{ branchId: future.branchId, status: 'approved' }],
    branches: [future],
  }), { user_id: 'tenant-a' });
  assert.equal(result.branch.branchName, 'Future Branch');
});
