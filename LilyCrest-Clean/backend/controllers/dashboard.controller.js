const { getDb } = require('../config/database');

// Get dashboard data
async function getDashboard(req, res) {
  try {
    const userId = req.user.user_id;
    const db = getDb();

    const assignment = await db.collection('room_assignments').findOne(
      { user_id: userId, status: 'active' }
    );

    let room = null;
    if (assignment) {
      room = await db.collection('rooms').findOne({ room_id: assignment.room_id });
    }

    const billingCursor = db.collection('billing')
      .find({ user_id: userId })
      .sort({ due_date: -1, created_at: -1 })
      .limit(10);

    const billing = await billingCursor.toArray();
    const latestBill = billing[0] || null;

    const activeMaintenanceCount = await db.collection('maintenance_requests').countDocuments({
      user_id: userId,
      status: { $in: ['pending', 'in_progress'] }
    });

    res.json({
      user: { ...req.user, _id: undefined },
      assignment,
      room,
      billing: billing.map((b) => ({ ...b, _id: undefined })),
      latest_bill: latestBill ? { ...latestBill, _id: undefined } : null,
      active_maintenance_count: activeMaintenanceCount
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ detail: 'Failed to fetch dashboard data' });
  }
}

module.exports = {
  getDashboard
};
