const { getDb } = require('../config/database');
const { ObjectId } = require('mongodb');
const { fetchUserBills } = require('./billing.controller');
const { countActiveMaintenanceForUser } = require('./maintenance.controller');

// Convert slug like 'quadruple-sharing' → 'Quadruple Sharing'
function formatRoomType(type) {
  if (!type) return 'Standard';
  return type.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
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

function parseLeaseDurationMonths(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const numeric = Number.parseInt(trimmed, 10);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
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

  const moveIn = deriveAssignmentMoveIn(record);
  const leaseDurationMonths = parseLeaseDurationMonths(
    record.leaseDuration
      ?? record.lease_duration
      ?? record.durationMonths
      ?? record.duration_months
      ?? record.contractDurationMonths
      ?? record.contract_duration_months
      ?? record.stayDurationMonths
      ?? record.stay_duration_months
  );

  if (!moveIn || !leaseDurationMonths) return null;

  const endDate = new Date(moveIn);
  endDate.setMonth(endDate.getMonth() + leaseDurationMonths);
  return endDate;
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
      const occupancy = await db.collection('roomoccupancyhistories').findOne({
        tenantId: mongoId,
        stayStatus: 'active',
      });

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
          branch: occupancy.branchId,
        };

        if (roomDoc) {
          room = {
            room_id: roomDoc._id?.toString(),
            room_number: roomDoc.roomNumber,
            room_type: formatRoomType(roomDoc.type),
            bed_type: bed
              ? bed.position === 'upper'
                ? 'Upper Bed'
                : 'Lower Bed'
              : 'N/A',
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
            branch: bedHistory.branch,
          };

          if (roomDoc) {
            room = {
              room_id: roomDoc._id?.toString(),
              room_number: roomDoc.roomNumber,
              room_type: formatRoomType(roomDoc.type),
              bed_type: bed
                ? bed.position === 'upper'
                  ? 'Upper Bed'
                  : 'Lower Bed'
                : 'N/A',
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
        { userId: mongoId, status: { $in: ['moveIn', 'active', 'completed', 'confirmed'] } },
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
            branch: reservation.branch,
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
            room_number: roomDoc.roomNumber,
            room_type: formatRoomType(roomDoc.type),
            bed_type: bed
              ? bed.position === 'upper'
                ? 'Upper Bed'
                : selectedBed.position === 'upper'
                  ? 'Upper Bed'
                  : 'Lower Bed'
              : selectedBed.position === 'upper'
                ? 'Upper Bed'
                : selectedBed.position === 'lower'
                  ? 'Lower Bed'
                  : 'N/A',
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
      user: { ...req.user, _id: undefined },
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
