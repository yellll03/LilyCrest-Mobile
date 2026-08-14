# LilyCrest Mobile Render Migration Checklist

## 1. Final Backend URL

Current APK backend:

```text
https://lilycrest-mobile.onrender.com
```

The mobile app now reads the backend URL from:

```text
EXPO_PUBLIC_BACKEND_URL=https://lilycrest-mobile.onrender.com
```

## 2. URL Audit Result

Cloudflare references found:

- `frontend/.env` had Cloudflare tunnel build instructions in comments.
- `backend/.env` had Cloudflare tunnel values for `BACKEND_URL` and `FRONTEND_URL`.
- `backend/.latest-tunnel-url` contained a `trycloudflare.com` URL.
- `backend/cloudflared*.log`, Expo export check folders, frontend logs, Android build caches, and `frontend/dist` contained stale generated Cloudflare/local output.
- Old manuals/audit docs still mention Cloudflare as historical setup documentation.

Cloudflare references removed:

- Removed active mobile Cloudflare instructions from `frontend/.env`.
- Replaced backend local env `BACKEND_URL` with `https://lilycrest-mobile.onrender.com`.
- Cleared old backend `FRONTEND_URL`/`CORS_ORIGINS` tunnel values.
- Removed `.latest-tunnel-url`, Cloudflare logs, stale Expo export check bundles, frontend logs, Android build caches, and `dist`.
- Removed Cloudflare/local fallback logic from active mobile API URL resolution.

Localhost/ngrok/LAN references found:

- No active mobile source, main Android source, `.env`, `.env.example`, or `eas.json` references remain.
- Remaining `localhost` references are backend-only local database defaults, backend development CORS handling, backend README/local scripts, and historical documentation.

Remaining references and why they are safe:

- `.gitignore`, `STRUCTURE_AUDIT.md`, and system manuals are documentation/ignore metadata only.
- Backend MongoDB local fallbacks and migration scripts are server-side local development utilities, not APK backend URLs.
- Backend CORS local-origin handling only applies outside production or when `ALLOW_LOCAL_CORS=true`.

## 3. Files Changed

- `frontend/src/config/api.js`
- `frontend/src/services/api.js`
- `frontend/.env`
- `frontend/.env.example`
- `frontend/eas.json`
- `frontend/android/app/src/main/res/xml/network_security_config.xml`
- `frontend/src/utils/downloadBillPdf.js`
- `frontend/src/context/AuthContext.js`
- `frontend/src/hooks/useAsyncCall.js`
- `frontend/src/services/billingState.js`
- `frontend/src/screens/LilyAssistantScreen.jsx`
- `frontend/src/components/LilyChatbot.js`
- `frontend/app/(tabs)/home.jsx`
- `frontend/app/(tabs)/announcements.jsx`
- `frontend/app/(tabs)/profile.jsx`
- `frontend/app/(tabs)/services.jsx`
- `frontend/app/documents.jsx`
- `frontend/app/forgot-password.jsx`
- `frontend/app/my-documents.jsx`
- `frontend/app/otp-verify.jsx`
- `frontend/app/reset-password.jsx`
- `frontend/src/tests/useAssistantChat.test.js`
- `backend/server.js`
- `backend/routes/index.js`
- `backend/controllers/auth.controller.js`
- `backend/controllers/paymongo.controller.js`
- `backend/.env`
- `backend/.env.example`

## 4. Central API Config

Central config file:

```text
frontend/src/config/api.js
```

Exports:

- `API_BASE_URL`
- `MOBILE_API_BASE_URL`
- `MOBILE_HEALTH_URL`

All axios mobile API calls use `MOBILE_API_BASE_URL`, which resolves to:

```text
https://lilycrest-mobile.onrender.com/api/m
```

## 5. Env Variables Updated

Updated mobile env files:

- `frontend/.env`
- `frontend/.env.example`
- `frontend/eas.json`

Official mobile env:

```text
EXPO_PUBLIC_BACKEND_URL=https://lilycrest-mobile.onrender.com
```

Removed mobile backend env competition:

- `EXPO_PUBLIC_BACKEND_PORT`
- `EXPO_PUBLIC_DEV_HOST`
- Expo host/local IP fallback resolution

## 6. Routes Corrected

Changed routes:

- Auth refresh: `/api/auth/google` -> `/api/m/auth/google`
- Billing PDF download: `/api/billing/:billingId/pdf` -> `/api/m/billing/:billingId/pdf`
- PayMongo checkout redirects: `/api/paymongo/redirect/...` -> `/api/m/paymongo/redirect/...`

Verified mobile service base:

- Auth: `/api/m/auth/...`
- Dashboard/profile/users/documents: `/api/m/...`
- Billing/payment status: `/api/m/billing/...`, `/api/m/paymongo/...`
- Maintenance requests: `/api/m/maintenance/...`
- Uploads: `/api/m/upload/firebase-storage`
- Announcements/notifications: `/api/m/announcements`, `/api/m/notifications`
- Lily Assistant/chat: `/api/m/chatbot/...`, `/api/m/chat/...`

## 7. Render Health Check Result

Checked on 2026-05-26 Asia/Singapore:

- `https://lilycrest-mobile.onrender.com/health` -> `404 Not Found`
- `https://lilycrest-mobile.onrender.com/api/health` -> `200`, `status: healthy`
- `https://lilycrest-mobile.onrender.com/api/m/health` -> `200`, `status: healthy`

Local backend code now returns `ok: true` and `service: LilyCrest Mobile Backend` on the shared health route after deployment.

## 8. Features Tested

Live unauthenticated route checks against Render:

- Room browsing: `GET /api/m/rooms` returned OK with 115 rooms.
- Announcements: `GET /api/m/announcements` returned OK with 7 announcements.
- Login route: `POST /api/m/auth/login` with empty body returned expected `400`.
- Dashboard route: `GET /api/m/dashboard/me` returned expected unauthenticated `401`.
- Billing route: `GET /api/m/billing/history` returned expected unauthenticated `401`.

Inspected source routes:

- Login/register/logout/session validation use `/api/m/auth`.
- OTP send/verify/resend use `/api/m/auth/login/...`.
- Tenant dashboard/profile/documents use `/api/m`.
- Billing/payment/PayMongo status use `/api/m`.
- Maintenance request routes use `/api/m`.
- Firebase Storage uploads use `/api/m/upload/firebase-storage`.
- Notifications/announcements use `/api/m`.
- Lily Assistant and support chat use `/api/m/chatbot` and `/api/m/chat`.

Not fully exercised without real tenant credentials/payment fixtures:

- Real tenant login/OTP verification.
- Authenticated profile, billing, maintenance, upload, notification read/unread, and chat flows.
- PayMongo checkout creation, webhook receipt, and payment settlement.

## 9. Render Env Verification

Confirmed by live server behavior:

- Render backend is deployed and reachable.
- Required startup env for database/server boot is present enough for health, rooms, announcements, and protected route auth handling.

Not directly visible from the local repository:

- Render dashboard secret values.
- EAS hosted secrets.
- PayMongo, SMTP, Firebase Admin, ImageKit/Firebase Storage secret completeness beyond routes that can be reached unauthenticated.

No required key was proven missing during this migration. Before APK build, dashboard-only checks should still confirm that Render and EAS do not contain any old Cloudflare URL values.

## 10. Known Issues Remaining

- Historical manuals still mention Cloudflare Tunnel as old release-testing documentation. They do not affect APK builds.
- Authenticated end-to-end tenant flows require valid test credentials and were not executed.
- Payment/upload secret correctness cannot be proven without authenticated checkout/upload tests or Render dashboard access.

## 11. APK Build Readiness

Status: Ready from source and route migration.

Reason:

- Active mobile code resolves to Render only.
- Active mobile API routes use `/api/m`.
- EAS build profiles now set `EXPO_PUBLIC_BACKEND_URL`.
- Live Render health and public/protected route reachability checks pass.

Do not build from stale caches. Start with:

```powershell
cd frontend
npm install
npx expo start --clear
```

APK preview build:

```powershell
eas build -p android --profile preview
```

Production build:

```powershell
eas build -p android --profile production
```
