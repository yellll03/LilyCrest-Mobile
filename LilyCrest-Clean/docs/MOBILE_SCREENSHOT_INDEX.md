# Mobile Screenshot Index

Last updated: 2026-05-27

Screenshots are actual PNG captures from the connected Android device unless marked otherwise. Do not use SVG, PDF, WEBP, generated mockups, or fabricated UI images.

| Feature | Screen/state | Route/path | Source file path | Screenshot filename | Format | Capture status | Notes |
|---|---|---|---|---|---|---|---|
| Auth/Login | Default login | `/login` | `frontend/app/login.jsx` | `auth-login.png` | PNG | Needs capture | Logged-out state |
| Auth/Google | Google Sign-In | `/login` | `frontend/app/login.jsx`, `frontend/src/config/googleSignIn.js` | `auth-google-signin.png` | PNG | Needs capture | Native prompt may require dev build |
| Auth loading | Loading | App startup | `frontend/src/context/AuthContext.js` | `auth-loading.png` | PNG | Needs capture | New loading state added |
| Session hydration | Checking session | App startup | `frontend/src/context/AuthContext.js` | `session-hydration.png` | PNG | Needs capture | Capture during startup |
| Dashboard | Loaded | `/(tabs)/home` | `frontend/app/(tabs)/home.jsx` | `dashboard-loaded.png` | PNG | Captured | Protected; current account data visible |
| Dashboard | Empty | `/(tabs)/home` | `frontend/app/(tabs)/home.jsx` | `dashboard-empty.png` | PNG | Needs capture | Needs test account/data |
| Dashboard | Error/retry | `/(tabs)/home` | `frontend/app/(tabs)/home.jsx` | `dashboard-error.png` | PNG | Needs capture | Network/error state |
| Announcements | List | `/(tabs)/announcements` | `frontend/app/(tabs)/announcements.jsx` | `announcements-list.png` | PNG | Captured | Public API confirmed; UI title is `Notifications` |
| Announcements | Empty | `/(tabs)/announcements` | `frontend/app/(tabs)/announcements.jsx` | `announcements-empty.png` | PNG | Needs capture | Use filter |
| Announcements | Error | `/(tabs)/announcements` | `frontend/app/(tabs)/announcements.jsx` | `announcements-error.png` | PNG | Needs capture | Network/error state |
| Notifications | List | Header/announcements flow | `frontend/src/components/AppHeader.js`, `frontend/src/context/AuthContext.js` | `notifications-list.png` | PNG | Captured | Protected data; current account amounts/masked email visible |
| Notifications | Empty | Header/announcements flow | `frontend/src/components/AppHeader.js` | `notifications-empty.png` | PNG | Needs capture | Needs test account |
| Notifications | Unauthorized | Protected notification flow | `frontend/src/context/AuthContext.js` | `notifications-unauthorized.png` | PNG | Needs capture | 401 expected without token |
| Billing | History | `/(tabs)/billing` | `frontend/app/billing-history.jsx` | `billing-history.png` | PNG | Captured | Protected; current account billing amounts visible |
| Billing | Empty | `/(tabs)/billing` | `frontend/app/billing-history.jsx` | `billing-empty.png` | PNG | Needs capture | Needs test account |
| Payment | Bill/payment | `/bill-details`, `/payment` | `frontend/app/bill-details.jsx`, `frontend/app/payment.jsx` | `payment-feature.png` | PNG | Needs capture | Avoid real payment |
| Profile | Account | `/(tabs)/profile` | `frontend/app/(tabs)/profile.jsx` | `profile-account.png` | PNG | Captured | Menu-only view; no token/secrets |
| Push | Settings toggle | `/settings` | `frontend/app/settings.jsx`, `frontend/src/services/notifications.js` | `push-notification-settings.png` | PNG | Captured | OS permission prompt still needs fresh-install capture |
| Network | Error/retry | Any protected route | `frontend/src/services/api.js` plus screen | `network-error-state.png` | PNG | Needs capture | User-friendly state |
| Session | Expired | Protected route/login | `frontend/src/context/AuthContext.js`, `frontend/app/_layout.jsx` | `session-expired.png` | PNG | Needs capture | 401 flow |
| Logout | Confirmation/result | `/(tabs)/profile` | `frontend/app/(tabs)/profile.jsx` | `logout.png` | PNG | Needs capture | Protected |
| Services | Maintenance | `/(tabs)/services` | `frontend/app/(tabs)/services.jsx` | `services-maintenance.png` | PNG | Captured | Protected; current maintenance data visible |
| Documents | Documents list | `/my-documents` | `frontend/app/my-documents.jsx` | `documents-list.png` | PNG | Needs capture | Protected |
| Assistant | Lily Assistant | `/(tabs)/chatbot` | `frontend/src/screens/LilyAssistantScreen.jsx` | `lily-assistant.png` | PNG | Needs capture | Protected |
