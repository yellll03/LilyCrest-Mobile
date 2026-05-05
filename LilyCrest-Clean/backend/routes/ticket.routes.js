const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Tenant routes
router.get('/me', authMiddleware, ticketController.getMyTickets);
router.post('/', authMiddleware, ticketController.createTicket);
router.get('/:ticketId', authMiddleware, ticketController.getTicket);
router.post('/:ticketId/respond', authMiddleware, ticketController.respondToTicket);
router.put('/:ticketId/status', authMiddleware, ticketController.updateTicketStatus);

// Admin routes
router.get('/admin/all', authMiddleware, adminMiddleware, ticketController.getAllTickets);
router.post('/admin/:ticketId/reply', authMiddleware, adminMiddleware, ticketController.adminReplyToTicket);
router.put('/admin/:ticketId/status', authMiddleware, adminMiddleware, ticketController.adminUpdateTicketStatus);

module.exports = router;
