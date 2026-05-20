# LilyCrest System Manual

Comprehensive guide for the tenant mobile app, admin web portal, backend API, deployment workflow, and ongoing system operations

## 1. Purpose and Scope
This manual explains how the LilyCrest Dormitory Management System works as a complete platform. It is intended for:

- tenants using the mobile application
- dormitory staff handling daily operations
- administrators using the web portal
- testers validating release builds
- technical operators deploying and maintaining the system

This document covers the current codebase in this repository:

- the tenant mobile app built with Expo and React Native
- the admin web portal served from the backend at `/admin`
- the Node.js and Express backend API exposed through `/api` and `/api/m`
- the system integrations used for authentication, payments, AI support, notifications, and email

## 2. System Overview
LilyCrest is a dormitory operations platform designed to help tenants and staff manage day to day services, billing, communication, and account access from a single system.

### Main platform components
- `Tenant Mobile App` - the tenant facing application for Android devices
- `Admin Web Portal` - the browser based operations portal for staff and admins
- `Backend API` - the main service layer that handles business rules, authentication, data access, and integrations
- `Cloud and External Services` - MongoDB, Firebase, Google Gemini, PayMongo, Expo Push, SMTP email, and Cloudflare tunnel or another public HTTPS endpoint

### Core business modules
- authentication and access control
- tenant dashboard and room visibility
- billing, payment collection, and payment confirmation
- maintenance and service requests
- announcements and dormitory policy access
- document upload and download
- support tickets, live chat, and AI assistant flows
- notifications, email alerts, and operational monitoring

## 3. Roles and Access
The system separates user access by role and platform.

### Tenant
Tenants use the mobile app. They can:

- sign in with email and password or Google
- verify logins through OTP when required
- view room, billing, and maintenance information
- submit requests and support concerns
- access policy documents and personal uploads

Tenants do not have access to the admin web portal.

### Admin
Admins use the web portal served from the backend. They can:

- open the admin dashboard
- review tenant inquiries and support tickets
- handle live support conversations
- create announcements
- review maintenance requests and update status
- view tenant and admin user records

### Superadmin or Technical Operator
Technical operators and higher level admins maintain the environment and release process. They handle:

- environment configuration
- database and credential setup
- payment webhook health
- release APK generation
- public backend exposure for mobile release testing

### Access enforcement
The backend enforces role separation through authentication middleware and admin only middleware. The mobile app uses tenant flows, while the admin portal requires a valid admin or superadmin session.

## 4. Architecture and Integrations
LilyCrest combines a mobile frontend, a browser based admin interface, and a shared backend service layer.

### Backend stack
- `Node.js` runtime
- `Express` for routing and middleware
- `MongoDB` for persistent data
- `Firebase Admin SDK` for identity verification

### Frontend stack
- `Expo SDK 54`
- `React Native`
- `Expo Router`
- `AsyncStorage` and `SecureStore` for local device state
- `Expo Notifications`, `Expo Auth Session`, and `Expo Local Authentication`

### Key integrations
- `Firebase` for sign in, identity checks, and Google account verification
- `Google Gemini` for Lily Assistant conversations and support intent handling
- `PayMongo` for payment checkout, redirect flow, and webhook confirmation
- `Expo Push` and `Firebase messaging` helpers for device notifications
- `SMTP via Nodemailer` for OTP, password, and payment emails
- `Cloudflare Tunnel` or another public HTTPS host for mobile release testing and webhook callbacks

### Network model
The backend publishes two main API prefixes:

- `/api` for general clients, browser calls, and admin workflows
- `/api/m` as the mobile facing prefix that mirrors the same business routes

Health checks are available through the backend route group, allowing operators to confirm service availability before distributing builds or testing payments.

## 5. Tenant Mobile App
The mobile app is the tenant facing portion of the system.

### Main navigation
The bottom tab navigation uses five primary sections:

- `Services`
- `News`
- `Home`
- `Billings`
- `Profile`

Some additional screens are reachable through in app navigation rather than visible tabs, such as the chatbot, dashboard detail flows, payment pages, legal pages, and settings.

### Sign in and account access
Tenants can access the app through:

1. email and password login
2. Google sign in
3. OTP verification when the login flow requires a code
4. biometric login after the feature has been enabled in settings and a successful credential based login has been completed

### Home and dashboard
The `Home` screen acts as the tenant dashboard. It combines:

- room and tenancy details
- billing summary
- maintenance summary
- recent announcements or notifications
- quick search and quick access areas
- entry points to Lily Assistant

### Billing and payments
The billing flow supports:

- current bill viewing
- historical billing review
- bill detail breakdown pages
- PayMongo checkout launch
- payment success and cancel return screens
- receipt or billing PDF download and sharing

The backend confirms payment status through webhook and status lookup logic, so the mobile app can reflect payment results after the payment provider redirects back.

### Maintenance and service requests
Tenants can:

- create a maintenance request
- select request type and urgency
- provide issue details
- attach supporting media when needed
- edit pending requests
- cancel requests
- reopen completed or resolved requests when follow up is required

### Announcements and policy access
The app allows tenants to:

- read dormitory announcements
- see urgency or category tagging
- review rules and policy documents
- open house rules, privacy policy, and terms pages
- access downloadable dormitory documents

### Documents
The profile related flows support document handling such as:

- viewing dormitory provided documents
- downloading policy or reference PDFs
- uploading personal supporting documents
- previewing uploaded items
- deleting uploaded files when necessary

### Profile and settings
The mobile app supports:

- profile viewing and editing
- password change
- dark mode toggle
- push notification toggle
- biometric login toggle
- legal and policy page access

### Lily Assistant and support
The app includes AI assisted support through Lily Assistant. Tenants can:

- ask billing, maintenance, policy, and account questions
- receive FAQ style answers
- continue threaded chatbot sessions
- escalate a concern to human admin support
- use ticket and live chat style follow up flows

### Notifications
The mobile app contains device registration and notification preference flows. The codebase supports push token registration and server side notification handling for:

- announcements
- chat updates
- billing events
- maintenance updates
- reservation update helpers

Actual delivery still depends on device permission, token registration, and the relevant server workflow being triggered.

## 6. Admin Web Portal
The admin web portal is served as a static page from the backend under `/admin`.

### Access flow
Admins typically use the portal after signing in with a valid account that has an `admin` or `superadmin` role. If the session belongs to a tenant or is missing, the portal blocks access.

### Dashboard
The admin dashboard provides a quick operations summary such as:

- total users
- open or pending tickets
- pending maintenance counts
- recent activity context for support handling

### Tenant inquiries and support tickets
The ticket section allows admins to:

- filter ticket lists
- search by tenant or subject
- open a ticket detail panel
- review threaded tenant responses
- reply as admin
- update ticket status

### Live support conversations
The live support area is used when Lily Assistant or a tenant support flow escalates to a human. Admins can:

- review waiting conversations
- mark a conversation as in review
- exchange messages with the tenant
- refresh and monitor live status
- resolve or close the conversation

### Announcements management
Admins can publish announcements to the tenant population through the backend announcement creation flow. These notices are intended to appear in the tenant app and may also trigger notification logic.

### Maintenance management
The maintenance section supports:

- list review
- status filtering
- search
- opening request details
- updating status through the admin maintenance endpoint
- optional staff notes during status changes

### User management
The admin portal includes a user directory for operational review. Admins can inspect:

- tenant records
- admin records
- role grouped user lists
- profile and access related context for support decisions

## 7. Support, Communication, and Notification Flows
LilyCrest provides several communication layers so tenants can receive help in the channel that best fits the issue.

### AI chatbot workflow
1. The tenant opens Lily Assistant from the app.
2. The message is sent to the chatbot backend.
3. The backend routes the request through FAQ, knowledge prompts, or Gemini powered response generation.
4. The tenant receives an answer, suggested actions, or an escalation path.

### Live chat escalation workflow
1. The tenant requests human support from the chatbot or support flow.
2. A conversation record is created in the backend.
3. Admin staff review the live chat queue in the web portal.
4. An admin marks the conversation in review and starts replying.
5. The tenant receives updates in the app and can continue the conversation until it is closed or resolved.

### Ticket workflow
1. A tenant creates a support ticket.
2. The backend stores the ticket with its status.
3. Admin staff review the ticket in the portal.
4. Admin replies and status changes are synced back to the tenant view.

### Email communication
The backend email service supports branded transactional messages for:

- login OTP delivery
- password reset link delivery
- password changed confirmation
- payment receipt confirmation

### Push notification workflow
The backend includes notification helper functions and token persistence. Notifications can be prepared for:

- new announcements
- admin chat acceptance or reply
- billing creation and payment confirmation
- maintenance status updates
- reservation status changes

## 8. Backend Services and API
The backend acts as the shared service layer for both the mobile app and the admin portal.

### Key route groups
- `/auth`
- `/users`
- `/dashboard`
- `/rooms`
- `/billing`
- `/maintenance`
- `/announcements`
- `/notifications`
- `/faqs`
- `/tickets`
- `/chat`
- `/documents`
- `/chatbot`
- `/paymongo`

### Data responsibilities
The backend stores or coordinates:

- user profiles and roles
- session tokens and login validation
- maintenance requests
- bills and payment state
- support tickets and support conversations
- announcement records
- uploaded documents
- notification records

### Security and protections
The service includes:

- request rate limiting
- authenticated route protection
- admin only route protection
- CORS control
- session token validation
- proxy aware deployment settings when configured

### Health and operational checks
The backend exposes a health endpoint through the route group so operators can confirm the API is reachable before:

- testing the mobile app
- exposing the service through a tunnel
- running payment tests
- distributing a release APK

## 9. Setup and Environment Configuration
This repository supports local development and controlled release testing.

### Prerequisites
- Node.js 18 or newer
- a reachable MongoDB instance
- a Firebase project and service credentials
- Google AI or Gemini API access
- PayMongo credentials for payment testing
- SMTP credentials for transactional email
- Android tooling if building native release APKs

### Backend setup
1. Open the `backend` directory.
2. Install dependencies with `npm install`.
3. Create `.env` from `.env.example`.
4. Fill in database, Firebase, payment, email, and public URL values.
5. Start the server with `npm start` or `npm run dev`.

### Frontend setup
1. Open the `frontend` directory.
2. Install dependencies with `npm install`.
3. Configure the frontend `.env` with public keys and backend settings.
4. Start development with `npm start` or another Expo script that matches the test target.

### Important backend environment values
- `PORT`
- `MONGO_URL`
- `DB_NAME`
- `FIREBASE_*`
- `GOOGLE_AI_API_KEY` or `GEMINI_API_KEY`
- `PAYMONGO_SECRET_KEY`
- `BACKEND_URL`
- `FRONTEND_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

### Important frontend environment values
- `EXPO_PUBLIC_BACKEND_PORT`
- `EXPO_PUBLIC_BACKEND_URL`
- `EXPO_PUBLIC_FIREBASE_*`
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`

### Release and test networking
For native release style builds, the app requires a public backend URL. The codebase expects `EXPO_PUBLIC_BACKEND_URL` to be set for release or test APK use. This URL should point to:

- a stable public domain, or
- a temporary HTTPS tunnel such as Cloudflare Tunnel during test distribution

## 10. Release Build and APK Distribution
The repository supports native Android release APK generation through the Android Gradle project inside the frontend.

### Development usage
For development, staff or testers can use:

1. the backend on port `8001`
2. Expo based frontend scripts for dev client or Expo Go
3. local or tunneled backend access depending on the device used for testing

### Release APK workflow
1. Start the backend and confirm the health endpoint responds.
2. Expose the backend through a public HTTPS URL if the APK will run outside local development.
3. Set `BACKEND_URL` in the backend and `EXPO_PUBLIC_BACKEND_URL` in the frontend to the same public host when needed.
4. Build the Android release APK from the frontend Android project.
5. Distribute the generated `app-release.apk` to testers or dormitory staff.

### Payment and webhook note
Payment callback and webhook flows rely on the public backend URL. If the URL changes, payment return links and webhook registration should be reviewed before running payment tests.

### Signing note
The current release build configuration should be reviewed before production rollout. A real production keystore and a stable public domain are recommended for any deployment beyond internal testing.

## 11. Operations and Monitoring
The system requires light but regular operational checks to remain healthy.

### Daily or pre test checks
- verify the backend is running
- verify the health endpoint responds
- confirm the public backend URL is still live if a tunnel is used
- confirm admin staff can open `/admin`
- confirm critical integrations such as Firebase and MongoDB are reachable

### Routine operational checks
- review maintenance backlog
- review unresolved support tickets
- review waiting live support conversations
- publish or remove announcements as needed
- confirm payment callbacks are updating billing status correctly

### Operational logging
Useful logs include:

- backend startup logs
- MongoDB connection success
- Firebase initialization success
- PayMongo webhook registration results
- notification warnings or invalid token cleanup messages
- email delivery warnings

## 12. Data and Security Controls
LilyCrest handles user identity, support messages, and financial context, so operational security matters.

### Security controls already present
- Firebase backed identity verification
- session token checks on protected routes
- admin role checks for elevated functions
- rate limiting on general and chatbot routes
- CORS configuration
- password reset and change email alerts

### Mobile security considerations
- session tokens are stored locally for signed in use
- biometric login is optional and device dependent
- release builds should use HTTPS for backend traffic

### Operational security expectations
- keep `.env` files private
- rotate secrets when credentials are exposed or replaced
- use a stable production domain for long term deployment
- avoid using temporary quick tunnels for permanent operations

## 13. Current Scope and Known Limitations
This section describes the current implemented scope so teams do not assume features that are not yet present in this repository.

### Current scope
- the mobile app is tenant only
- the admin portal focuses on support, maintenance, announcements, and user review
- the backend supports billing, chatbot, ticketing, documents, and payment integrations

### Known limitations
- reservation helper logic exists in notification code, but the mobile app does not currently expose a dedicated reservation module
- some reporting and owner level analytics are outside the direct tenant mobile scope
- release APK testing depends on a reachable public backend URL
- push notifications depend on successful device token registration and enabled user permission
- temporary tunnel based deployments are suitable for testing, not long term production hosting

## 14. Troubleshooting and Support
The following checks are useful when something does not behave as expected.

### Mobile app cannot log in
- verify the backend is online
- verify Firebase credentials and public frontend keys are correct
- verify the tenant account exists and is active
- check the email inbox and spam folder for OTP or reset messages

### Admin portal shows access denied
- confirm the account role is `admin` or `superadmin`
- confirm the session is valid
- confirm the backend is running and `/admin` is being served from the correct environment

### Bills, maintenance, or announcements do not load
- verify the mobile app points to the correct backend URL
- confirm `/api/m/health` responds
- check backend logs for MongoDB or authentication errors

### Payment completed but status did not update
- confirm the public backend URL used for PayMongo is still reachable
- check backend logs for webhook registration or webhook processing errors
- refresh the bill detail screen after a short wait

### Release APK opens but cannot reach the server
- confirm the public backend URL in the frontend build is still live
- restart the backend or public tunnel if a temporary URL has expired
- rebuild the APK if the public host has changed

### Notifications or email are missing
- confirm device notification permission is enabled
- confirm push token registration succeeded
- confirm SMTP settings are valid for email delivery
- check backend logs for push or email warnings

## 15. Appendix: Key Endpoints
The following endpoints are the main operational entry points for the current system.

### General health
- `GET /api/health`
- `GET /api/m/health`

### Authentication
- `POST /api/auth/login`
- `POST /api/auth/google`
- `POST /api/auth/change-password`
- `POST /api/auth/forgot-password`

### Tenant profile and documents
- `GET /api/users/me`
- `PUT /api/users/me`
- `POST /api/users/push-token`
- `POST /api/users/documents`
- `GET /api/users/documents`

### Billing and payments
- `GET /api/billing/me`
- `GET /api/billing/me/latest`
- `GET /api/billing/history`
- `POST /api/paymongo/checkout`
- `POST /api/paymongo/webhook`

### Maintenance and announcements
- `GET /api/maintenance/me`
- `POST /api/maintenance`
- `PATCH /api/maintenance/:requestId/cancel`
- `PATCH /api/maintenance/:requestId/reopen`
- `GET /api/announcements`
- `POST /api/announcements`

### Support and chatbot
- `GET /api/tickets/me`
- `POST /api/tickets`
- `POST /api/tickets/:ticketId/respond`
- `POST /api/chat/start`
- `GET /api/chat/me`
- `POST /api/chat/:conversationId/messages`
- `POST /api/chatbot/message`
- `POST /api/chatbot/request-admin`

### Admin operations
- `GET /api/tickets/admin/all`
- `POST /api/tickets/admin/:ticketId/reply`
- `PUT /api/tickets/admin/:ticketId/status`
- `GET /api/maintenance/admin/all`
- `PATCH /api/maintenance/admin/:requestId/status`
- `GET /api/users/admin/all`
- `GET /api/chat/admin/conversations`
- `POST /api/chat/admin/:conversationId/messages`
- `PATCH /api/chat/admin/:conversationId/status`
