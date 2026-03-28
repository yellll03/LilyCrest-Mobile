const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/me', authMiddleware, ticketController.getMyTickets);
router.post('/', authMiddleware, ticketController.createTicket);

module.exports = router;
