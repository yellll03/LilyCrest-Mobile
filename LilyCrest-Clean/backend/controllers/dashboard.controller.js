const { getDb } = require('../config/database');
const { ObjectId } = require('mongodb');
const { fetchUserBills } = require('./billing.controller');
const { countActiveMaintenanceForUser } = require('./maintenance.controller');
const { sanitizeUserForClient } = require('../utils/normalizeUser');

// Convert slug like 'quadruple-sharing' → 'Quadruple Sharing'
function formatRoomType(type) {
  if (!type) return 'Standard';
  return type.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatBedLabel(bed, fallback = {}) {
  const explicit = bed?.label || bed?.name || fallback?.label || fallback?.name;
  if (explicit && !ObjectId.isValid(String(explicit).trim())) return String(explicit).trim();
  const position = String(bed?.position || fallback?.position || '').toLowerCase();
  if (position === 'upper') return 'Upper Bed';
  if (position === 'lower') return 'Lower Bed';
  return 'Bed not assigned';
}

function formatRoomNumber(value) {
  const roomNumber = String(value || '').trim();
  return roomNumber && !ObjectId.isValid(roomNumber) ? roomNumber : null;
}

function formatBranchName(value) {
  const branch = String(value || '').trim();
  if (!branch || ObjectId.isValid(branch)) return 'Branch information unavailable';
  return branch.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeDateCandidate(...values) {
  for (const value of values) {
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return value;
    }
  }
  return null;
}

function deriveAssignmentMoveIn(record) {
  if (!record || typeof record !== 'object') return null;

  return normalizeDateCandidate(
    record.moveInDate,
    record.move_in_date,
    record.checkInDate,
    record.checkinDate,
    record.targetMoveInDate,
    record.startDate,
    record.start_date,
    record.effectiveStartDate,
    record.effective_start_date,
  );
}

function deriveAssignmentContractEnd(record) {
  if (!record || typeof record !== 'object') return null;

  const explicitMoveOut = normalizeDateCandidate(
    record.moveOutDate,
    record.move_out_date,
    record.contractEnd,
    record.contractEndDate,
    record.contract_end_date,
    record.leaseEndDate,
    record.lease_end_date,
    record.endDate,
    record.end_date,
    record.checkOutDate,
    record.checkoutDate,
    record.targetMoveOutDate,
    record.effectiveEndDate,
    record.effective_end_date,
  );
  if (explicitMoveOut) {
    return explicitMoveOut;
  }

  // A duration is not an approved legal end date. Contract metadata must remain
  // unavailable until an authoritative record supplies an explicit end date.
  return null;
}

// The single authoritative definition of "the tenant currently has a lease in
// effect" — mirrors Capstone-Website's tenantContractSelectionService.js
// CURRENT_STAY_STATUSES. `expired_occupancy_continuing` is deliberately NOT
// here: it means the lease term lapsed and the tenant is still physically
// present pending an admin decision — not a normal current tenancy — and
// Capstone's own current-Stay resolver excludes it too. Terminal statuses
// (completed/terminated/renewed) are never current.
const CURRENT_STAY_STATUSES = ['active', 'ending_soon'];

// Resolve the tenant's authoritative current Stay from the shared `stays`
// collection (written by Capstone-Website's Stay lifecycle — move-in, renewal
// activation, transfer, move-out, termination). This is the source of truth
// for the tenant's current room/bed and lease dates. Returns null when the
// tenant has no in-effect Stay (moved out, terminated, or a legacy tenancy
// that predates the Stay model — the caller then falls back to the legacy
// occupancy/reservation reconstruction, which is scoped to non-terminal rows).
async function resolveCurrentStayAssignment(db, mongoId, userId) {
  if (!mongoId) return { assignment: null, room: null };

  const stay = await db.collection('stays').findOne(
    { tenantId: mongoId, status: { $in: CURRENT_STAY_STATUSES } },
    { sort: { leaseStartDate: -1 } },
  );
  if (!stay) return { assignment: null, room: null };

  const roomOid = typeof stay.roomId === 'string' ? new ObjectId(stay.roomId) : stay.roomId;
  const roomDoc = roomOid ? await db.collection('rooms').findOne({ _id: roomOid }) : null;
  const bed = roomDoc?.beds?.find((b) => b.id === stay.bedId);

  const leaseEnd = normalizeDateCandidate(stay.leaseEndDate);
  const assignment = {
    assignment_id: stay._id?.toString(),
    user_id: userId,
    room_id: stay.roomId?.toString(),
    status: 'active',
    stay_status: stay.status,
    move_in_date: normalizeDateCandidate(stay.leaseStartDate),
    // The Stay's own lease window is an authoritative approved date range, so
    // (unlike the legacy reservation/occupancy fallback) it is safe to surface
    // as the contract/move-out end here.
    move_out_date: leaseEnd,
    contract_end_date: leaseEnd,
    bed_id: stay.bedId || null,
    branch: formatBranchName(stay.branch),
    source: 'stay',
  };

  const room = roomDoc
    ? {
        room_id: roomDoc._id?.toString(),
        room_number: formatRoomNumber(roomDoc.roomNumber),
        room_type: formatRoomType(roomDoc.type),
        bed_type: formatBedLabel(bed),
        floor: roomDoc.floor,
        capacity: roomDoc.capacity,
        price: roomDoc.monthlyPrice ?? stay.monthlyRent,
        amenities: roomDoc.amenities || [],
        policies: roomDoc.policies || [],
        description: roomDoc.description || '',
        images: roomDoc.images || [],
        name: roomDoc.name,
      }
    : null;

  return { assignment, room };
}

// Get dashboard data
async function getDashboard(req, res) {
  try {
    const userId = req.user.user_id;   // string ID, e.g. 'user_95f39d5b4ea4'
    const mongoId = req.user._id;      // MongoDB ObjectId from auth middleware
    const db = getDb();

    // ── Room Assignment ──────────────────────────────────────────────────────
    // Authoritative source first: the tenant's current Stay (Capstone-Website's
    // Stay lifecycle). Only when there is no in-effect Stay do we fall back to
    // the legacy occupancy/reservation reconstruction below — and that fallback
    // is now scoped to non-terminal rows so a completed/terminated tenancy can
    // never be resurrected as "active".
    let assignment = null;
    let room = null;

    const authoritative = await resolveCurrentStayAssignment(db, mongoId, userId);
    if (authoritative.assignment) {
      assignment = authoritative.assignment;
      room = authoritative.room;
    }

    if (!assignment && mongoId) {
      // Source 1: roomoccupancyhistories (legacy)
      const occupancy = await db.collection('roomoccupancyhistories').findOne(
        { tenantId: mongoId, stayStatus: 'active' },
        { sort: { moveInDate: -1, createdAt: -1 } },
      );

      if (occupancy) {
        const roomDoc = await db.collection('rooms').findOne({ _id: occupancy.roomId });
        const bed = roomDoc?.beds?.find((b) => b.id === occupancy.bedId);
        const occupancyMoveIn = deriveAssignmentMoveIn(occupancy);
        const occupancyContractEnd = deriveAssignmentContractEnd(occupancy);

        assignment = {
          assignment_id: occupancy._id?.toString(),
          user_id: userId,
          room_id: occupancy.roomId?.toString(),
          status: 'active',
          move_in_date: occupancyMoveIn,
          move_out_date: occupancyContractEnd,
          contract_end_date: occupancyContractEnd,
          bed_id: occupancy.bedId,
          branch: formatBranchName(occupancy.branchName || occupancy.branch || occupancy.branchId),
        };

        if (roomDoc) {
          room = {
            room_id: roomDoc._id?.toString(),
            room_number: formatRoomNumber(roomDoc.roomNumber),
            room_type: formatRoomType(roomDoc.type),
            bed_type: formatBedLabel(bed),
            floor: roomDoc.floor,
            capacity: roomDoc.capacity,
            price: roomDoc.monthlyPrice,
            amenities: roomDoc.amenities || [],
            policies: roomDoc.policies || [],
            description: roomDoc.description || '',
            images: roomDoc.images || [],
            name: roomDoc.name,
          };
        }
      }

      // Source 2: bedhistories (web admin creates these on move-in)
      if (!assignment) {
        const bedHistory = await db.collection('bedhistories').findOne(
          { tenantId: mongoId, status: 'active' },
          { sort: { moveInDate: -1 } }
        );

        if (bedHistory) {
          const roomOid = typeof bedHistory.roomId === 'string'
            ? new ObjectId(bedHistory.roomId)
            : bedHistory.roomId;
          const roomDoc = await db.collection('rooms').findOne({ _id: roomOid });
          const bed = roomDoc?.beds?.find((b) => b.id === bedHistory.bedId);
          const bedMoveIn = deriveAssignmentMoveIn(bedHistory);
          const bedContractEnd = deriveAssignmentContractEnd(bedHistory);

          assignment = {
            assignment_id: bedHistory._id?.toString(),
            user_id: userId,
            room_id: bedHistory.roomId?.toString(),
            status: 'active',
            move_in_date: bedMoveIn,
            move_out_date: bedContractEnd,
            contract_end_date: bedContractEnd,
            bed_id: bedHistory.bedId,
            branch: formatBranchName(bedHistory.branchName || bedHistory.branch),
          };

          if (roomDoc) {
            room = {
              room_id: roomDoc._id?.toString(),
              room_number: formatRoomNumber(roomDoc.roomNumber),
              room_type: formatRoomType(roomDoc.type),
              bed_type: formatBedLabel(bed),
              floor: roomDoc.floor,
              capacity: roomDoc.capacity,
              price: roomDoc.monthlyPrice,
              amenities: roomDoc.amenities || [],
              policies: roomDoc.policies || [],
              description: roomDoc.description || '',
              images: roomDoc.images || [],
              name: roomDoc.name,
            };
          }
        }
      }

      // Source 3: reservations (web admin reservation flow). Only non-terminal
      // statuses — a `completed` reservation is a past tenancy and must never
      // reconstruct an "active" assignment. (`moveOut`/`terminated`/`cancelled`
      // were never in this set; `completed` is removed here.) This path is only
      // reached at all when there is no current Stay, so it now serves genuine
      // pre-Stay legacy tenancies rather than shadowing the authoritative Stay.
      const reservation = await db.collection('reservations').findOne(
        { userId: mongoId, status: { $in: ['moveIn', 'active', 'confirmed', 'paid'] } },
        { sort: { createdAt: -1 } }
      );

      if (reservation?.roomId) {
        const roomOid = typeof reservation.roomId === 'string'
          ? new ObjectId(reservation.roomId)
          : reservation.roomId;
        const roomDoc = await db.collection('rooms').findOne({ _id: roomOid });
        const selectedBed = reservation.selectedBed || {};
        const bed = roomDoc?.beds?.find((b) => b.id === selectedBed.id);
        const reservationMoveIn = deriveAssignmentMoveIn(reservation);
        const reservationMoveOut = deriveAssignmentContractEnd(reservation);

        if (!assignment) {
          assignment = {
            assignment_id: reservation._id?.toString(),
            user_id: userId,
            room_id: reservation.roomId?.toString(),
            status: 'active',
            move_in_date: reservationMoveIn,
            move_out_date: reservationMoveOut,
            contract_end_date: reservationMoveOut,
            bed_id: selectedBed.id || null,
            branch: formatBranchName(reservation.branchName || reservation.branch),
          };
        } else {
          assignment.move_in_date = normalizeDateCandidate(
            assignment.move_in_date,
            reservationMoveIn,
          );
          assignment.move_out_date = normalizeDateCandidate(
            assignment.move_out_date,
            reservationMoveOut,
          );
          assignment.contract_end_date = normalizeDateCandidate(
            assignment.contract_end_date,
            assignment.move_out_date,
            reservationMoveOut,
          );
          assignment.move_out_date = assignment.contract_end_date;
          if (!assignment.bed_id && selectedBed.id) assignment.bed_id = selectedBed.id;
          if (!assignment.branch && reservation.branch) assignment.branch = reservation.branch;
        }

        if (!room && roomDoc) {
          room = {
            room_id: roomDoc._id?.toString(),
            room_number: formatRoomNumber(roomDoc.roomNumber),
            room_type: formatRoomType(roomDoc.type),
            bed_type: formatBedLabel(bed, selectedBed),
            floor: roomDoc.floor,
            capacity: roomDoc.capacity,
            price: roomDoc.monthlyPrice || reservation.monthlyRent,
            amenities: roomDoc.amenities || [],
            policies: roomDoc.policies || [],
            description: roomDoc.description || '',
            images: roomDoc.images || [],
            name: roomDoc.name,
          };
        }
      }
    }

    // ── Billing ──────────────────────────────────────────────────────────────
    const billing = await fetchUserBills(db, req.user, { limit: 10 });

    const latestBill = billing[0] || null;

    // ── Maintenance ──────────────────────────────────────────────────────────
    const activeMaintenanceCount = await countActiveMaintenanceForUser(db, req.user);

    res.json({
      user: sanitizeUserForClient(req.user),
      assignment,
      room,
      billing,
      latest_bill: latestBill,
      active_maintenance_count: activeMaintenanceCount,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ detail: 'Failed to fetch dashboard data' });
  }
}

module.exports = {
  getDashboard,
  // Exported for targeted regression tests: the authoritative current-Stay
  // resolver and the status set that defines "lease currently in effect".
  resolveCurrentStayAssignment,
  CURRENT_STAY_STATUSES,
};
