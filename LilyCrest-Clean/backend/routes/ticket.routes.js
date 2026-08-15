const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');
const { authMiddleware, adminMiddleware, tenantMiddleware } = require('../middleware/auth');

// Admin routes
router.get('/admin/all', authMiddleware, adminMiddleware, ticketController.getAllTickets);
router.post('/admin/:ticketId/reply', authMiddleware, adminMiddleware, ticketController.adminReplyToTicket);
router.put('/admin/:ticketId/status', authMiddleware, adminMiddleware, ticketController.adminUpdateTicketStatus);

// Tenant routes
router.get('/me', authMiddleware, tenantMiddleware, ticketController.getMyTickets);
router.post('/', authMiddleware, tenantMiddleware, ticketController.createTicket);
router.get('/:ticketId', authMiddleware, tenantMiddleware, ticketController.getTicket);
router.post('/:ticketId/respond', authMiddleware, tenantMiddleware, ticketController.respondToTicket);
router.put('/:ticketId/status', authMiddleware, tenantMiddleware, ticketController.updateTicketStatus);

module.exports = router;
