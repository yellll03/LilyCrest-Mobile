const { getDb } = require('../config/database');

// Get all rooms
async function getAllRooms(req, res) {
  try {
    const db = getDb();
    const rooms = await db.collection('rooms').find({}).toArray();
    res.json(rooms.map(r => ({ ...r, _id: undefined })));
  } catch (error) {
    res.status(500).json({ detail: 'Failed to fetch rooms' });
  }
}

// Get room by ID
async function getRoomById(req, res) {
  try {
    const db = getDb();
    const room = await db.collection('rooms').findOne({ room_id: req.params.roomId });
    if (!room) {
      return res.status(404).json({ detail: 'Room not found' });
    }
    res.json({ ...room, _id: undefined });
  } catch (error) {
    res.status(500).json({ detail: 'Failed to fetch room' });
  }
}

module.exports = {
  getAllRooms,
  getRoomById
};
