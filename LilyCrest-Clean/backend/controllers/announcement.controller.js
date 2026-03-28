const { getDb } = require('../config/database');

// Get all announcements
async function getAllAnnouncements(req, res) {
  try {
    const db = getDb();
    const userId = req.user?.user_id || null;
    const visibilityFilter = [
      { is_private: { $ne: true } },
      ...(userId ? [{ is_private: true, user_id: userId }] : []),
    ];

    const announcements = await db.collection('announcements')
      .find({ is_active: true, $or: visibilityFilter })
      .sort({ created_at: -1 })
      .toArray();
    res.json(announcements.map(a => ({ ...a, _id: undefined })));
  } catch (error) {
    res.status(500).json({ detail: 'Failed to fetch announcements' });
  }
}

module.exports = {
  getAllAnnouncements
};
