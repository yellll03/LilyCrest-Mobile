'use strict';

// Regression coverage for dashboard tenancy authority (P1).
//
// /dashboard/me must derive the tenant's current room/bed/lease from the
// authoritative `stays` collection (Capstone-Website's Stay lifecycle),
// restricted to genuinely in-effect statuses. A completed/terminated Stay,
// or a stale historical bed/occupancy row, must never resurrect an "active"
// tenancy — that was the source of Home/Profile disagreeing with the
// Contract screen after move-out / termination / transfer.
//
// resolveCurrentStayAssignment takes a db-like object, so these tests run a
// tiny in-memory stub instead of a live Mongo connection.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveCurrentStayAssignment,
  CURRENT_STAY_STATUSES,
} = require('../controllers/dashboard.controller');

const ROOM_A_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ROOM_B_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const ROOM_A = {
  _id: { toString: () => ROOM_A_ID },
  roomNumber: 'A-101',
  type: 'private-room',
  beds: [],
  floor: 1,
  capacity: 1,
  monthlyPrice: 9000,
  images: ['a.jpg'],
  name: 'Room A',
};
const ROOM_B = {
  _id: { toString: () => ROOM_B_ID },
  roomNumber: 'B-202',
  type: 'quadruple-sharing',
  beds: [{ id: 'bed-3', label: 'Bed 3', position: 'upper' }],
  floor: 2,
  capacity: 4,
  monthlyPrice: 6000,
  images: ['b.jpg'],
  name: 'Room B',
};

// Minimal Mongo-collection stub: supports findOne({ tenantId, status:{$in} })
// with a { sort } option, and findOne({ _id }) for rooms.
function makeDb({ stays = [], rooms = [] }) {
  return {
    collection(name) {
      if (name === 'stays') {
        return {
          async findOne(query, options = {}) {
            const statusIn = query?.status?.$in || null;
            let matches = stays.filter((s) => {
              if (String(s.tenantId) !== String(query.tenantId)) return false;
              if (statusIn && !statusIn.includes(s.status)) return false;
              return true;
            });
            const sortKey = options.sort ? Object.keys(options.sort)[0] : null;
            if (sortKey) {
              const dir = options.sort[sortKey];
              matches = matches.slice().sort((x, y) => {
                const xv = new Date(x[sortKey]).getTime();
                const yv = new Date(y[sortKey]).getTime();
                return dir < 0 ? yv - xv : xv - yv;
              });
            }
            return matches[0] || null;
          },
        };
      }
      if (name === 'rooms') {
        return {
          async findOne(query) {
            const wanted = String(query._id?.toString?.() ?? query._id);
            return rooms.find((r) => String(r._id.toString()) === wanted) || null;
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

const TENANT = 'tenant-1';

test('CURRENT_STAY_STATUSES mirrors Capstone and excludes lapsed/terminal statuses', () => {
  assert.deepEqual(CURRENT_STAY_STATUSES, ['active', 'ending_soon']);
  assert.equal(CURRENT_STAY_STATUSES.includes('completed'), false);
  assert.equal(CURRENT_STAY_STATUSES.includes('terminated'), false);
  assert.equal(CURRENT_STAY_STATUSES.includes('renewed'), false);
  assert.equal(CURRENT_STAY_STATUSES.includes('expired_occupancy_continuing'), false);
});

test('active Stay resolves to that room/bed and lease window', async () => {
  const db = makeDb({
    stays: [{
      _id: { toString: () => 'stayB' },
      tenantId: TENANT,
      roomId: ROOM_B_ID,
      bedId: 'bed-3',
      branch: 'guadalupe',
      status: 'active',
      leaseStartDate: '2026-01-01T00:00:00.000Z',
      leaseEndDate: '2026-12-31T00:00:00.000Z',
      monthlyRent: 6000,
    }],
    rooms: [ROOM_B],
  });
  const { assignment, room } = await resolveCurrentStayAssignment(db, TENANT, TENANT);
  assert.ok(assignment);
  assert.equal(assignment.source, 'stay');
  assert.equal(assignment.room_id, ROOM_B_ID);
  assert.equal(assignment.bed_id, 'bed-3');
  assert.equal(assignment.move_in_date, '2026-01-01T00:00:00.000Z');
  assert.equal(assignment.contract_end_date, '2026-12-31T00:00:00.000Z');
  assert.equal(assignment.move_out_date, '2026-12-31T00:00:00.000Z');
  assert.equal(room.room_number, 'B-202');
  assert.equal(room.bed_type, 'Bed 3');
});

test('ending_soon Stay is still current', async () => {
  const db = makeDb({
    stays: [{
      _id: { toString: () => 's' }, tenantId: TENANT, roomId: ROOM_B_ID, bedId: 'bed-3',
      branch: 'guadalupe', status: 'ending_soon',
      leaseStartDate: '2026-01-01T00:00:00.000Z', leaseEndDate: '2026-12-31T00:00:00.000Z',
    }],
    rooms: [ROOM_B],
  });
  const { assignment } = await resolveCurrentStayAssignment(db, TENANT, TENANT);
  assert.ok(assignment);
  assert.equal(assignment.stay_status, 'ending_soon');
});

test('completed Stay does NOT resolve as an active assignment', async () => {
  const db = makeDb({
    stays: [{
      _id: { toString: () => 's' }, tenantId: TENANT, roomId: ROOM_B_ID, bedId: 'bed-3',
      branch: 'guadalupe', status: 'completed',
      leaseStartDate: '2025-01-01T00:00:00.000Z', leaseEndDate: '2025-12-31T00:00:00.000Z',
    }],
    rooms: [ROOM_B],
  });
  const { assignment, room } = await resolveCurrentStayAssignment(db, TENANT, TENANT);
  assert.equal(assignment, null);
  assert.equal(room, null);
});

test('terminated Stay does NOT resolve as an active assignment', async () => {
  const db = makeDb({
    stays: [{
      _id: { toString: () => 's' }, tenantId: TENANT, roomId: ROOM_B_ID, bedId: 'bed-3',
      branch: 'guadalupe', status: 'terminated',
      leaseStartDate: '2025-01-01T00:00:00.000Z', leaseEndDate: '2025-06-30T00:00:00.000Z',
    }],
    rooms: [ROOM_B],
  });
  const { assignment } = await resolveCurrentStayAssignment(db, TENANT, TENANT);
  assert.equal(assignment, null);
});

test('transfer: current active Stay in Room B wins over an older Room A stay', async () => {
  const db = makeDb({
    stays: [
      {
        _id: { toString: () => 'stayA' }, tenantId: TENANT, roomId: ROOM_A_ID, bedId: null,
        branch: 'guadalupe', status: 'completed',
        leaseStartDate: '2025-01-01T00:00:00.000Z', leaseEndDate: '2025-12-31T00:00:00.000Z',
      },
      {
        _id: { toString: () => 'stayB' }, tenantId: TENANT, roomId: ROOM_B_ID, bedId: 'bed-3',
        branch: 'guadalupe', status: 'active',
        leaseStartDate: '2026-01-01T00:00:00.000Z', leaseEndDate: '2026-12-31T00:00:00.000Z',
      },
    ],
    rooms: [ROOM_A, ROOM_B],
  });
  const { assignment, room } = await resolveCurrentStayAssignment(db, TENANT, TENANT);
  assert.equal(assignment.room_id, ROOM_B_ID);
  assert.equal(room.room_number, 'B-202');
});

test('Private room with no bed on the Stay is valid — no error, bed_id null', async () => {
  const db = makeDb({
    stays: [{
      _id: { toString: () => 's' }, tenantId: TENANT, roomId: ROOM_A_ID, bedId: '',
      branch: 'guadalupe', status: 'active',
      leaseStartDate: '2026-01-01T00:00:00.000Z', leaseEndDate: '2026-12-31T00:00:00.000Z',
    }],
    rooms: [ROOM_A],
  });
  const { assignment, room } = await resolveCurrentStayAssignment(db, TENANT, TENANT);
  assert.ok(assignment);
  assert.equal(assignment.bed_id, null);
  assert.equal(room.room_type, 'Private Room');
});

test('no Stay at all → null (caller falls back to legacy non-terminal reconstruction)', async () => {
  const db = makeDb({ stays: [], rooms: [ROOM_A] });
  const { assignment, room } = await resolveCurrentStayAssignment(db, TENANT, TENANT);
  assert.equal(assignment, null);
  assert.equal(room, null);
});

test('legacy reservation fallback no longer treats a completed reservation as active (source guard)', () => {
  // The reservation fallback query is only reached when there is no current
  // Stay, and its status set must exclude the terminal `completed`.
  const src = require('fs').readFileSync(
    require.resolve('../controllers/dashboard.controller.js'), 'utf8',
  );
  const match = src.match(/status:\s*\{\s*\$in:\s*\[([^\]]+)\]\s*\}\s*\}\s*,\s*\n\s*\{\s*sort:\s*\{\s*createdAt/);
  assert.ok(match, 'reservation fallback query should still exist');
  assert.equal(/['"]completed['"]/.test(match[1]), false, 'completed must not be an "active" reservation status');
  assert.equal(/['"]moveIn['"]/.test(match[1]), true);
});
