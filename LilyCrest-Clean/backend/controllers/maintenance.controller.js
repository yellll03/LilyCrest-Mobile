const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { notifyMaintenanceStatusChange } = require('../services/pushService');

// Get user's maintenance requests
async function getMyMaintenance(req, res) {
  try {
    const db = getDb();
    const requests = await db.collection('maintenance_requests')
      .find({ user_id: req.user.user_id })
      .sort({ created_at: -1 })
      .toArray();
    res.json(requests.map(r => ({ ...r, _id: undefined })));
  } catch (error) {
    res.status(500).json({ detail: 'Failed to fetch maintenance requests' });
  }
}

// Create maintenance request
async function createMaintenance(req, res) {
  try {
    const { request_type, description, urgency, attachments } = req.body;

    const newRequest = {
      request_id: `maint_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
      user_id: req.user.user_id,
      request_type,
      description,
      urgency: urgency || 'normal',
      status: 'pending',
      assigned_to: null,
      notes: null,
      attachments: Array.isArray(attachments) ? attachments : [],
      created_at: new Date(),
      updated_at: new Date()
    };

    const db = getDb();
    await db.collection('maintenance_requests').insertOne(newRequest);
    res.status(201).json({ ...newRequest, _id: undefined });
  } catch (error) {
    res.status(500).json({ detail: 'Failed to create maintenance request' });
  }
}

// Update maintenance request (only when pending)
async function updateMaintenance(req, res) {
  try {
    const { requestId } = req.params;
    const { request_type, description, urgency } = req.body;
    const db = getDb();

    const existing = await db.collection('maintenance_requests').findOne({
      request_id: requestId,
      user_id: req.user.user_id,
    });

    if (!existing) {
      return res.status(404).json({ detail: 'Request not found' });
    }
    if (existing.status !== 'pending') {
      return res.status(400).json({ detail: 'Only pending requests can be edited' });
    }

    const updates = { updated_at: new Date() };
    if (request_type) updates.request_type = request_type;
    if (description !== undefined) updates.description = description;
    if (urgency) updates.urgency = urgency;

    await db.collection('maintenance_requests').updateOne(
      { request_id: requestId },
      { $set: updates }
    );

    const updated = await db.collection('maintenance_requests').findOne({ request_id: requestId });
    res.json({ ...updated, _id: undefined });
  } catch (error) {
    console.error('Update maintenance error:', error);
    res.status(500).json({ detail: 'Failed to update maintenance request' });
  }
}

// Cancel maintenance request (only when pending)
async function cancelMaintenance(req, res) {
  try {
    const { requestId } = req.params;
    const db = getDb();

    const existing = await db.collection('maintenance_requests').findOne({
      request_id: requestId,
      user_id: req.user.user_id,
    });

    if (!existing) {
      return res.status(404).json({ detail: 'Request not found' });
    }
    if (existing.status !== 'pending') {
      return res.status(400).json({ detail: 'Only pending requests can be cancelled' });
    }

    await db.collection('maintenance_requests').updateOne(
      { request_id: requestId },
      { $set: { status: 'cancelled', cancelled_at: new Date(), updated_at: new Date() } }
    );

    const updated = await db.collection('maintenance_requests').findOne({ request_id: requestId });
    res.json({ ...updated, _id: undefined });
  } catch (error) {
    console.error('Cancel maintenance error:', error);
    res.status(500).json({ detail: 'Failed to cancel maintenance request' });
  }
}

// Reopen a resolved/completed request
async function reopenMaintenance(req, res) {
  try {
    const { requestId } = req.params;
    const { reopen_note } = req.body;
    const db = getDb();

    const existing = await db.collection('maintenance_requests').findOne({
      request_id: requestId,
      user_id: req.user.user_id,
    });

    if (!existing) {
      return res.status(404).json({ detail: 'Request not found' });
    }
    const reopenableStatuses = ['resolved', 'completed'];
    if (!reopenableStatuses.includes((existing.status || '').toLowerCase())) {
      return res.status(400).json({ detail: 'Only resolved or completed requests can be reopened' });
    }

    const updates = {
      status: 'pending',
      reopened_at: new Date(),
      updated_at: new Date(),
    };
    if (reopen_note) {
      updates.reopen_note = reopen_note;
    }
    // Append to reopen history
    const reopenHistory = existing.reopen_history || [];
    reopenHistory.push({
      reopened_at: new Date(),
      previous_status: existing.status,
      note: reopen_note || null,
    });
    updates.reopen_history = reopenHistory;

    await db.collection('maintenance_requests').updateOne(
      { request_id: requestId },
      { $set: updates }
    );

    const updated = await db.collection('maintenance_requests').findOne({ request_id: requestId });
    res.json({ ...updated, _id: undefined });
  } catch (error) {
    console.error('Reopen maintenance error:', error);
    res.status(500).json({ detail: 'Failed to reopen maintenance request' });
  }
}

module.exports = {
  getMyMaintenance,
  createMaintenance,
  updateMaintenance,
  cancelMaintenance,
  reopenMaintenance,
};
