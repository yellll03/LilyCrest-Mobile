# LilyCrest Backend - Refactored Structure

## 📁 Folder Structure

```
backend/
├── config/
│   ├── database.js          # MongoDB connection and configuration
│   └── firebase.js          # Firebase Admin SDK initialization
├── middleware/
│   └── auth.js             # Authentication middleware
├── controllers/
│   ├── auth.controller.js          # Authentication logic
│   ├── user.controller.js          # User management logic
│   ├── dashboard.controller.js     # Dashboard data logic
│   ├── room.controller.js          # Room management logic
│   ├── billing.controller.js       # Billing logic
│   ├── maintenance.controller.js   # Maintenance requests logic
│   ├── announcement.controller.js  # Announcements logic
│   ├── faq.controller.js           # FAQ logic
│   ├── ticket.controller.js        # Support tickets logic
│   ├── chatbot.controller.js       # AI chatbot and live chat logic
│   └── seed.controller.js          # Database seeding logic
├── routes/
│   ├── index.js                    # Main route aggregator
│   ├── auth.routes.js              # Authentication routes
│   ├── user.routes.js              # User routes
│   ├── dashboard.routes.js         # Dashboard routes
│   ├── room.routes.js              # Room routes
│   ├── billing.routes.js           # Billing routes
│   ├── maintenance.routes.js       # Maintenance routes
│   ├── announcement.routes.js      # Announcement routes
│   ├── faq.routes.js               # FAQ routes
│   ├── ticket.routes.js            # Ticket routes
│   └── chatbot.routes.js           # Chatbot routes
├── services/
│   └── gemini.service.js   # Google Gemini AI service
├── utils/
├── .env
├── .env.example
├── firebase-credentials.json
├── package.json
├── server.js               # Main entry point (clean and simple)
└── README.md              # This file
```

## 🎯 Key Improvements

### 1. **Separation of Concerns**
- **Config**: All configuration logic (DB, Firebase) in one place
- **Middleware**: Reusable middleware functions
- **Controllers**: Business logic separated from routes
- **Routes**: Clean route definitions with proper structure
- **Services**: External services like AI/ML models

### 2. **Maintainability**
- Each file has a single responsibility
- Easy to locate and modify specific functionality
- Reduced file size (from 933 lines to ~50 lines per file)

### 3. **Scalability**
- Easy to add new routes and controllers
- Modular structure allows for team collaboration
- Clear naming conventions

### 4. **Testability**
- Controllers can be unit tested independently
- Mock services and configs for testing
- Isolated business logic

## 🚀 Getting Started

### Installation
```bash
npm install
```

### Environment Setup
Create a `.env` file with:
```
PORT=8001
MONGO_URL=mongodb://localhost:27017
DB_NAME=lilycrest_db
FIREBASE_API_KEY=your_firebase_api_key
GOOGLE_AI_API_KEY=your_google_ai_api_key
```

### Running the Server
```bash
# Development
npm run dev

# Production
npm start
```

## 📚 API Routes

All routes are prefixed with `/api`

### Authentication
- `POST /api/auth/google` - Google Sign-In
- `POST /api/auth/login` - Email/Password Login
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout
- `POST /api/auth/change-password` - Change password
- `POST /api/auth/forgot-password` - Request password reset

### Users
- `GET /api/users/me` - Get user profile
- `PUT /api/users/me` - Update user profile

### Dashboard
- `GET /api/dashboard/me` - Get dashboard data

### Rooms
- `GET /api/rooms` - Get all rooms
- `GET /api/rooms/:roomId` - Get specific room

### Billing
- `GET /api/billing/me` - Get user's bills
- `POST /api/billing` - Create new bill

### Maintenance
- `GET /api/maintenance/me` - Get user's maintenance requests
- `POST /api/maintenance` - Create maintenance request

### Announcements
- `GET /api/announcements` - Get all announcements

### FAQs
- `GET /api/faqs` - Get all FAQs

### Tickets
- `GET /api/tickets/me` - Get user's tickets
- `POST /api/tickets` - Create new ticket

### Chatbot
- `POST /api/chatbot/message` - Send message to AI chatbot
- `POST /api/chatbot/request-admin` - Request live chat with admin
- `GET /api/chatbot/live-status/:sessionId` - Get live chat status
- `POST /api/chatbot/close-live-chat` - Close live chat session
- `GET /api/chatbot/history` - Get chat history

### Admin (Chatbot)
- `GET /api/chatbot/admin/live-chats` - Get pending live chats
- `POST /api/chatbot/admin/live-chat/accept` - Accept live chat
- `POST /api/chatbot/admin/live-chat/message` - Send admin message

### Utility
- `GET /api` - Root endpoint
- `GET /api/health` - Health check
- `POST /api/seed` - Seed database with sample data

## 🔧 Adding New Features

### Adding a New Route

1. Create controller in `controllers/`:
```javascript
// controllers/example.controller.js
const { getDb } = require('../config/database');

async function getExample(req, res) {
  // Your logic here
}

module.exports = { getExample };
```

2. Create route in `routes/`:
```javascript
// routes/example.routes.js
const express = require('express');
const router = express.Router();
const exampleController = require('../controllers/example.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, exampleController.getExample);

module.exports = router;
```

3. Register route in `routes/index.js`:
```javascript
const exampleRoutes = require('./example.routes');
router.use('/example', exampleRoutes);
```

## 📝 Notes

- The old monolithic `server.js` is backed up as `server.js.old`
- All authentication uses Firebase Admin SDK
- Chat sessions are stored in-memory (use Redis for production)
- MongoDB is used for data persistence
