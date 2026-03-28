# LilyCrest Dormitory Management System

A full-stack dormitory management application with a Node.js backend and React Native (Expo) frontend.

## Project Structure

```
LilyCrest-Clean/
├── backend/                    # Node.js/Express API server
│   ├── server.js              # Main server file
│   ├── package.json           # Backend dependencies
│   ├── .env.example           # Environment variable template
│   └── firebase-credentials.json  # Firebase service account
│
├── frontend/                   # React Native (Expo) app
│   ├── app/                   # Expo Router pages
│   │   ├── _layout.jsx        # Root layout
│   │   ├── index.jsx          # Splash/landing screen
│   │   ├── login.jsx          # Login screen
│   │   ├── forgot-password.jsx
│   │   ├── change-password.jsx
│   │   ├── auth-callback.jsx
│   │   ├── about.jsx
│   │   ├── billing-history.jsx
│   │   ├── documents.jsx
│   │   ├── house-rules.jsx
│   │   ├── my-documents.jsx
│   │   ├── privacy-policy.jsx
│   │   ├── settings.jsx
│   │   ├── terms-of-service.jsx
│   │   └── (tabs)/            # Tab navigation screens
│   │       ├── _layout.jsx    # Tab layout
│   │       ├── home.jsx       # Home screen
│   │       ├── billing.jsx    # Billing screen
│   │       ├── services.jsx   # Services/maintenance
│   │       ├── announcements.jsx  # News & announcements
│   │       ├── profile.jsx    # User profile
│   │       ├── chatbot.jsx    # AI chatbot & live support
│   │       └── dashboard.jsx  # Dashboard
│   ├── src/
│   │   ├── components/        # Reusable components
│   │   │   ├── AppHeader.js
│   │   │   └── GoogleSignInButton.js
│   │   ├── config/            # Configuration files
│   │   │   ├── firebase.js
│   │   │   ├── googleSignIn.js
│   │   │   └── maps.js
│   │   ├── context/           # React Context providers
│   │   │   ├── AuthContext.js
│   │   │   └── ThemeContext.js
│   │   └── services/          # API services
│   │       └── api.js
│   ├── assets/                # Images, fonts, etc.
│   ├── app.json               # Expo config
│   ├── metro.config.js        # Metro bundler config
│   ├── eslint.config.js       # ESLint config
│   └── package.json           # Frontend dependencies
│
└── package.json               # Root package.json (workspace scripts)
```

## Tech Stack

### Backend
- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB
- **Authentication:** Firebase Admin SDK
- **AI Chatbot:** Google Gemini 1.5 Flash

### Frontend
- **Framework:** React Native (Expo SDK 54)
- **Navigation:** Expo Router v6 (file-based routing)
- **Auth:** Firebase (Google Sign-In + Email/Password)
- **State:** React Context API
- **Styling:** React Native StyleSheet (no TypeScript)

## Getting Started

### Prerequisites
- Node.js 18+
- MongoDB running locally or a cloud instance
- Firebase project with credentials
- Google AI API key (for chatbot)

### Backend Setup

```bash
cd backend
npm install

# Copy .env.example to .env and fill in your values
cp .env.example .env

# Start the server
npm start
```

### Frontend Setup

```bash
cd frontend
npm install

# Start with Expo
npx expo start
```

### Environment Variables (Backend)

See `backend/.env.example` for all required variables:
- `MONGO_URL` - MongoDB connection string
- `FIREBASE_API_KEY` - Firebase Web API key
- `GOOGLE_AI_API_KEY` - Google Gemini API key
- `PORT` - Server port (default: 8001)

## Features
- **Authentication:** Firebase Google Sign-In + Email/Password
- **Dashboard:** Room info, billing summary, maintenance stats
- **Billing:** View bills, payment status, QR code payments
- **Services:** Submit maintenance requests with urgency levels
- **Announcements:** News feed with categories and priorities
- **AI Chatbot:** Gemini-powered assistant with live admin escalation
- **Profile:** Edit profile, avatar, settings
- **Dark/Light Theme:** Persistent theme toggle
- **Documents:** View and download tenant documents
