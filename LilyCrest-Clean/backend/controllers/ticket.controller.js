const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');

// Get user's tickets
async function getMyTickets(req, res) {
  try {
    const db = getDb();
    const tickets = await db.collection('tickets')
      .find({ user_id: req.user.user_id })
      .sort({ created_at: -1 })
      .toArray();
    res.json(tickets.map(t => ({ ...t, _id: undefined })));
  } catch (error) {
    res.status(500).json({ detail: 'Failed to fetch tickets' });
  }
}

// Create ticket
async function createTicket(req, res) {
  try {
    const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const categoryInput = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const category = categoryInput || 'General';

    if (!subject || !message) {
      return res.status(400).json({ detail: 'Subject and message are required' });
    }
    if (subject.length > 120) {
      return res.status(400).json({ detail: 'Subject must be 120 characters or fewer' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ detail: 'Message must be 2000 characters or fewer' });
    }
    if (category.length > 40) {
      return res.status(400).json({ detail: 'Category must be 40 characters or fewer' });
    }

    const newTicket = {
      ticket_id: `ticket_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
      user_id: req.user.user_id,
      subject,
      message,
      category: category || 'General',
      status: 'open',
      responses: [],
      created_at: new Date(),
      updated_at: new Date()
    };

    const db = getDb();
    await db.collection('tickets').insertOne(newTicket);
    res.status(201).json({ ...newTicket, _id: undefined });
  } catch (error) {
    res.status(500).json({ detail: 'Failed to create ticket' });
  }
}

module.exports = {
  getMyTickets,
  createTicket
};
