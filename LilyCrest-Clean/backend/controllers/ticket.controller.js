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

// Get a single ticket by ticket_id
async function getTicket(req, res) {
  try {
    const { ticketId } = req.params;
    const db = getDb();
    const ticket = await db.collection('tickets').findOne({
      ticket_id: ticketId,
      user_id: req.user.user_id,
    });
    if (!ticket) return res.status(404).json({ detail: 'Ticket not found' });
    res.json({ ...ticket, _id: undefined });
  } catch (error) {
    res.status(500).json({ detail: 'Failed to fetch ticket' });
  }
}

// Tenant adds a follow-up reply to their own ticket
async function respondToTicket(req, res) {
  try {
    const { ticketId } = req.params;
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) return res.status(400).json({ detail: 'Message is required' });
    if (message.length > 2000) return res.status(400).json({ detail: 'Message must be 2000 characters or fewer' });

    const db = getDb();
    const ticket = await db.collection('tickets').findOne({
      ticket_id: ticketId,
      user_id: req.user.user_id,
    });
    if (!ticket) return res.status(404).json({ detail: 'Ticket not found' });

    const response = {
      response_id: `resp_${uuidv4().replace(/-/g, '').substring(0, 10)}`,
      author: req.user.name || 'Tenant',
      author_role: 'tenant',
      message,
      created_at: new Date(),
    };

    await db.collection('tickets').updateOne(
      { ticket_id: ticketId },
      { $push: { responses: response }, $set: { updated_at: new Date(), status: 'open' } }
    );

    res.json({ message: 'Response added', response });
  } catch (error) {
    res.status(500).json({ detail: 'Failed to add response' });
  }
}

// Update ticket status (tenant can only close their own ticket)
async function updateTicketStatus(req, res) {
  try {
    const { ticketId } = req.params;
    const status = typeof req.body?.status === 'string' ? req.body.status.toLowerCase() : '';
    const allowed = ['open', 'closed'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ detail: `Status must be one of: ${allowed.join(', ')}` });
    }

    const db = getDb();
    const result = await db.collection('tickets').updateOne(
      { ticket_id: ticketId, user_id: req.user.user_id },
      { $set: { status, updated_at: new Date() } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ detail: 'Ticket not found' });

    res.json({ message: 'Ticket status updated', status });
  } catch (error) {
    res.status(500).json({ detail: 'Failed to update ticket status' });
  }
}

module.exports = {
  getMyTickets,
  createTicket,
  getTicket,
  respondToTicket,
  updateTicketStatus,
};
