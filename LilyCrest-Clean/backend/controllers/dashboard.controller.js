const { getDb } = require('../config/database');
const { ObjectId } = require('mongodb');

// Convert slug like 'quadruple-sharing' → 'Quadruple Sharing'
function formatRoomType(type) {
  if (!type) return 'Standard';
  return type.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Get dashboard data
async function getDashboard(req, res) {
  try {
    const userId = req.user.user_id;   // string ID, e.g. 'user_95f39d5b4ea4'
    const mongoId = req.user._id;      // MongoDB ObjectId from auth middleware
    const db = getDb();

    // ── Room Assignment ──────────────────────────────────────────────────────
    // The real data lives in roomoccupancyhistories, keyed by MongoDB ObjectId
    let assignment = null;
    let room = null;

    if (mongoId) {
      const occupancy = await db.collection('roomoccupancyhistories').findOne({
        tenantId: mongoId,
        stayStatus: 'active',
      });

      if (occupancy) {
        // Get the room document by its ObjectId
        const roomDoc = await db.collection('rooms').findOne({ _id: occupancy.roomId });

        // Find the specific bed this tenant is assigned to
        const bed = roomDoc?.beds?.find((b) => b.id === occupancy.bedId);

        // Normalise assignment into the shape the frontend expects
        assignment = {
          assignment_id: occupancy._id?.toString(),
          user_id: userId,
          room_id: occupancy.roomId?.toString(),
          status: 'active',
          move_in_date: occupancy.moveInDate || null,
          move_out_date: occupancy.moveOutDate || null,
          bed_id: occupancy.bedId,
          branch: occupancy.branchId,
        };

        // Normalise room into the shape the frontend expects
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

    // ── Billing ──────────────────────────────────────────────────────────────
    // Primary: 'bills' collection (keyed by MongoDB ObjectId userId)
    let billing = [];

    if (mongoId) {
      const bills = await db.collection('bills')
        .find({ userId: mongoId })
        .sort({ dueDate: -1 })
        .limit(10)
        .toArray();

      billing = bills.map((b) => ({
        billing_id: b._id?.toString(),
        user_id: userId,
        description: b.billingMonth || b.description || 'Bill',
        billing_type: 'consolidated',
        due_date: b.dueDate,
        release_date: b.billingCycleStart,
        billing_period: b.billingMonth,
        status: b.status,
        amount: b.totalAmount,
        total: b.totalAmount,
        gross_amount: b.grossAmount,
        remaining_amount: b.remainingAmount,
        payment_method: b.paymentMethod,
        payment_date: b.paidAt,
        charges: b.charges,
        additional_charges: b.additionalCharges,
        reservation_id: b.reservationId?.toString(),
        created_at: b.createdAt,
      }));
    }

    // Fallback: old 'billing' collection (keyed by string user_id)
    if (!billing.length) {
      const oldBilling = await db.collection('billing')
        .find({ user_id: userId })
        .sort({ due_date: -1, created_at: -1 })
        .limit(10)
        .toArray();
      billing = oldBilling.map((b) => ({ ...b, _id: undefined }));
    }

    const latestBill = billing[0] || null;

    // ── Maintenance ──────────────────────────────────────────────────────────
    // Collection is 'maintenancerequests' (no underscore)
    const activeMaintenanceCount = await db.collection('maintenancerequests').countDocuments({
      $or: [
        { user_id: userId },
        ...(mongoId ? [{ userId: mongoId }] : []),
      ],
      status: { $in: ['pending', 'in_progress'] },
    }).catch(() =>
      // Fallback to old 'maintenance_requests' collection
      db.collection('maintenance_requests').countDocuments({
        user_id: userId,
        status: { $in: ['pending', 'in_progress'] },
      }).catch(() => 0)
    );

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
