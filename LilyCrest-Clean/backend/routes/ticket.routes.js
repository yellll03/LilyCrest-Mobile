const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/me', authMiddleware, ticketController.getMyTickets);
router.post('/', authMiddleware, ticketController.createTicket);
router.get('/:ticketId', authMiddleware, ticketController.getTicket);
router.post('/:ticketId/respond', authMiddleware, ticketController.respondToTicket);
router.put('/:ticketId/status', authMiddleware, ticketController.updateTicketStatus);

module.exports = router;
