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

// Get dashboard data
async function getDashboard(req, res) {
  try {
    const userId = req.user.user_id;   // string ID, e.g. 'user_95f39d5b4ea4'
    const mongoId = req.user._id;      // MongoDB ObjectId from auth middleware
    const db = getDb();

    // ── Room Assignment ──────────────────────────────────────────────────────
    // Try multiple sources: roomoccupancyhistories → bedhistories → reservations
    let assignment = null;
    let room = null;

    if (mongoId) {
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

      // Source 3: reservations (web admin reservation flow — status moveIn/active)
      const reservation = await db.collection('reservations').findOne(
        { userId: mongoId, status: { $in: ['moveIn', 'active', 'completed', 'confirmed', 'paid'] } },
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
};
