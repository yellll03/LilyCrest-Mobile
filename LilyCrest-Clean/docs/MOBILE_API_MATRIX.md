# LilyCrest Mobile API Matrix

Last reviewed: 2026-05-27

Mobile production base:

- `https://mobile-api.lilycrest.space/api/m`

Web/Admin production base:

- `https://api.lilycrest.space`
- This domain is not a mobile runtime base URL and must remain reserved for web/admin.

Auth header used by the mobile app:

```text
Authorization: Bearer <session_token>
Content-Type: application/json
```

The token is loaded from AsyncStorage key `session_token` by the Axios request interceptor.

## Connectivity

| Feature/screen | Method | Endpoint path | Production URL | Request body | Auth | Expected 200/201 | 401 behavior | 404 behavior | 500 behavior | Current app handling | Suggested improvement |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Startup smoke/API debug | GET | `/health` | `https://mobile-api.lilycrest.space/api/m/health` | None | No | Health payload with `ok:true` and `service:"LilyCrest Mobile Backend"` | Should not require auth | Wrong backend/path | Backend health failure | Dev smoke test logs fetch/Axios status/text/data | Remove temporary smoke test after Android issue is resolved; keep a manual debug command in docs |

## Auth And Session

| Feature/screen | Method | Endpoint path | Production URL | Request body | Auth | Expected 200/201 | 401 behavior | 404 behavior | 500 behavior | Current app handling | Suggested improvement |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Session hydration, biometric restore | GET | `/auth/me` | `https://mobile-api.lilycrest.space/api/m/auth/me` | None | Required | User object with `user_id` | Clears stored session; unauthenticated | Wrong backend/missing route | May restore cached user if available | `AuthProvider` and `checkAuth()` call this with 6s timeout | Add a visible "offline cached session" indicator when restored from cache |
| Email login | POST | `/auth/login` | `https://mobile-api.lilycrest.space/api/m/auth/login` | `{ email, password }` | No | Session payload or `{ otp_required, otp_token }` | Invalid credentials, attempts remaining | Missing route | Generic server error | Shows credential/access/rate/network messages | Log request ID in dev when available |
| OTP verify | POST | `/auth/login/verify-otp` | `https://mobile-api.lilycrest.space/api/m/auth/login/verify-otp` | `{ otp_token, otp_code }` | No | Session payload | Invalid/expired OTP | Missing route | Invalid verification response/server error | Shows error and clears digits on invalid code | Add explicit expired-code UI copy if backend returns a code |
| OTP resend | POST | `/auth/login/resend-otp` | `https://mobile-api.lilycrest.space/api/m/auth/login/resend-otp` | `{ otp_token }` | No | Resend confirmation | Invalid/expired token | Missing route | Resend unavailable | Shows alert/banner and cooldown | Disable resend while offline based on network state |
| Google session create/refresh | POST | `/auth/google` | `https://mobile-api.lilycrest.space/api/m/auth/google` | `{ idToken }` | No | Session payload | Invalid Firebase token | Missing route | Generic Google sign-in error | Google flow sends Firebase ID token; interceptor may use it to refresh session | Surface whether native Google or backend exchange failed |
| Forgot password | POST | `/auth/forgot-password` | `https://mobile-api.lilycrest.space/api/m/auth/forgot-password` | `{ email }` | No | Reset email accepted | Usually not applicable or generic | Missing route | Generic failure | Shows success state or error | Use same success text for unknown email to avoid account enumeration |
| Reset password | POST | `/auth/reset-password` | `https://mobile-api.lilycrest.space/api/m/auth/reset-password` | `{ token, newPassword }` | No | Password reset success | Invalid token | Missing route | Reset failure | Shows request error or success | Confirm backend token expiry copy |
| Change password | POST | `/auth/change-password` | `https://mobile-api.lilycrest.space/api/m/auth/change-password` | `{ current_password, new_password, notify_app, notify_email }` | Required | Password changed | Session invalid/current password invalid | Missing route | Change failed | Shows field/API error; logs out on success | Differentiate invalid current password from expired session |
| Logout | POST | `/auth/logout` | `https://mobile-api.lilycrest.space/api/m/auth/logout` | `{}` | Required when token exists | Logout acknowledged | Ignored after local logout | Missing route | Ignored fire-and-forget | Local session clears immediately | Add dev-only warning if route is missing |
| Register | POST | `/auth/register` | `https://mobile-api.lilycrest.space/api/m/auth/register` | `{ email, password, name, phone }` | No | Session payload | Not applicable/denied | Missing route | Register failed | Function exists in `AuthContext`; no current route found | Remove or expose intentionally after product decision |

## Dashboard, Announcements, Notifications

| Feature/screen | Method | Endpoint path | Production URL | Request body | Auth | Expected 200/201 | 401 behavior | 404 behavior | 500 behavior | Current app handling | Suggested improvement |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Home dashboard | GET | `/dashboard/me` | `https://mobile-api.lilycrest.space/api/m/dashboard/me` | None | Required | Dashboard payload for resident | Show sign-in/session behavior | Missing route or wrong backend | Dashboard error | Home shows retryable load error | Define documented response shape including contract end |
| Announcements list | GET | `/announcements` | `https://mobile-api.lilycrest.space/api/m/announcements` | None | No token required in current production test | Array of announcements | Should still load while logged out if route remains public | Missing route | Load error | Announcements screen shows empty/error; tab badge polling is gated behind auth to avoid startup spam | Add backend unread-count or last-seen endpoint if the feature should be personalized |
| Notifications list | GET | `/notifications` | `https://mobile-api.lilycrest.space/api/m/notifications` | None | Required | Array of notifications | Expected when no token | Must not be `Cannot GET` on mobile domain | Load error | Home falls back to announcements; AuthContext preserves unread count | Add explicit notification route contract and unread count |

## Billing And Payments

| Feature/screen | Method | Endpoint path | Production URL | Request body | Auth | Expected 200/201 | 401 behavior | 404 behavior | 500 behavior | Current app handling | Suggested improvement |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Billing summary | GET | `/billing/me` | `https://mobile-api.lilycrest.space/api/m/billing/me` | None | Required | Resident billing summary | Session invalid | Missing route/no bill | Billing error | API method exists; no direct current screen reference found | Remove unused method or wire it clearly |
| Billing history | GET | `/billing/history` | `https://mobile-api.lilycrest.space/api/m/billing/history` | None | Required | Array/list of bills | Session invalid | Missing route | Billing load error | Billing and home use this | Include paid/unpaid fields consistently |
| Paid payment history | GET | `/billing/history/paid` | `https://mobile-api.lilycrest.space/api/m/billing/history/paid` | None | Required | Paid payment records | Session invalid | Paid history missing | Billing load error | Billing loads it beside history | If endpoint is optional, return empty array instead of 404 |
| Latest billing | GET | `/billing/me/latest` | `https://mobile-api.lilycrest.space/api/m/billing/me/latest` | None | Required | Latest bill | Session invalid | No latest bill | Billing load error | Billing summary uses it | Document empty/latest-none response |
| Bill details | GET | `/billing/:billingId` | `https://mobile-api.lilycrest.space/api/m/billing/:billingId` | None | Required | Bill detail | Session invalid | Bill not found | Detail error | Bill details/payment screens show unavailable state | Normalize not-found message |
| Update billing | PUT | `/billing/:billingId` | `https://mobile-api.lilycrest.space/api/m/billing/:billingId` | Billing update object | Required | Updated bill | Session invalid | Bill not found | Update failed | API method exists; no current route reference found | Remove from tenant app if admin-only |
| Billing PDF | GET | `/billing/:billingId/pdf` | `https://mobile-api.lilycrest.space/api/m/billing/:billingId/pdf` | None | Required | PDF/blob response | Login required alert | PDF not found | Download failed | `downloadBillPdf()` fetches with token and shows alerts | Add file-size and content-type logging in dev |
| Create checkout | POST | `/paymongo/checkout` | `https://mobile-api.lilycrest.space/api/m/paymongo/checkout` | `{ billingId }` | Required | Checkout URL/id | Session invalid | Bill/route not found | Checkout failed | Opens checkout URL and expects success/cancel redirect | Add explicit deep-link callback test cases |
| Checkout status | GET | `/paymongo/checkout/:checkoutId/status` | `https://mobile-api.lilycrest.space/api/m/paymongo/checkout/:checkoutId/status` | None | Required | Checkout status/payment state | Session invalid | Checkout not found | Verification failed | Payment success screen shows verification message | Poll/retry for delayed provider updates |

## Profile, Documents, Rooms

| Feature/screen | Method | Endpoint path | Production URL | Request body | Auth | Expected 200/201 | 401 behavior | 404 behavior | 500 behavior | Current app handling | Suggested improvement |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Profile load | GET | `/users/me` | `https://mobile-api.lilycrest.space/api/m/users/me` | None | Required | User profile | Session invalid | Missing user/route | Profile load error | Profile screen shows pull-to-refresh error | Share response shape with dashboard/auth user |
| Profile update | PUT | `/users/me` | `https://mobile-api.lilycrest.space/api/m/users/me` | Profile fields or `{ picture }` | Required | Updated user/profile | Session invalid | User not found | Save failed | Updates local user on success | Split picture upload from profile metadata if payload grows |
| Save push token | POST | `/users/push-token` | `https://mobile-api.lilycrest.space/api/m/users/push-token` | `{ push_token, notifications_enabled, provider, device_platform }` | Required, or override token on logout | Token sync accepted | May be suppressed during logout | Missing route | Push sync failed | Warnings logged; settings toggle can restore previous value | Return stable token sync status and request ID |
| User documents list | GET | `/users/documents` | `https://mobile-api.lilycrest.space/api/m/users/documents` | None | Required | Array of uploaded docs | Session invalid | Missing route | Docs load error | My Documents loading/empty states | Document required-category contract |
| User document upload | POST | `/users/documents` | `https://mobile-api.lilycrest.space/api/m/users/documents` | Document metadata/file URL/category | Required | Uploaded document | Session invalid | Missing route | Upload failed | Upload spinner/status, then refreshes list | Clarify whether file bytes go via Firebase only |
| User document metadata/file | GET | `/users/documents/:docId` | `https://mobile-api.lilycrest.space/api/m/users/documents/:docId` | None | Required | Document metadata/file URL | Session invalid | Doc not found | Fetch failed | Used before opening/downloading a document | Normalize `doc_id` vs `id` fields |
| Delete user document | DELETE | `/users/documents/:docId` | `https://mobile-api.lilycrest.space/api/m/users/documents/:docId` | None | Required | Delete success | Session invalid | Doc not found | Delete failed | Delete spinner and refresh | Confirm delete prompt copy |
| Download document | GET | `/documents/:docId` | `https://mobile-api.lilycrest.space/api/m/documents/:docId` | None | Required | File/blob response | Login required/fetch failure | Document not found | Download failed | Manual fetch with bearer token | Standardize downloads through one helper |
| Rooms list | GET | `/rooms` | `https://mobile-api.lilycrest.space/api/m/rooms` | Query params | Required | Room list | Session invalid | Missing route | Load failed | API method exists; no route reference found | Add route or remove service method |
| Room details | GET | `/rooms/:roomId` | `https://mobile-api.lilycrest.space/api/m/rooms/:roomId` | None | Required | Room details | Session invalid | Room not found | Load failed | API method exists; no route reference found | Document room payload if dashboard depends on it |

## Maintenance And Services

| Feature/screen | Method | Endpoint path | Production URL | Request body | Auth | Expected 200/201 | 401 behavior | 404 behavior | 500 behavior | Current app handling | Suggested improvement |
|---|---|---|---|---|---|---|---|---|---|---|---|
| My maintenance | GET | `/maintenance/me` | `https://mobile-api.lilycrest.space/api/m/maintenance/me` | Optional `status` param | Required | Request list | Session invalid | Missing route | Load failed | Services full-screen loading or empty state | Add pagination if list grows |
| Maintenance detail | GET | `/maintenance/:requestId` | `https://mobile-api.lilycrest.space/api/m/maintenance/:requestId` | None | Required | Request detail/thread | Session invalid | Request not found | Detail failed | Detail modal error banner | Include tenant-visible progress contract |
| Create maintenance | POST | `/maintenance` | `https://mobile-api.lilycrest.space/api/m/maintenance` | `{ request_type, description, urgency, attachments }` | Required | Created request | Session invalid | Missing route | Submit failed | Validates fields/uploads then refreshes list | Share accepted type/urgency enums with frontend |
| Reply to maintenance | POST | `/maintenance/:requestId/replies` | `https://mobile-api.lilycrest.space/api/m/maintenance/:requestId/replies` | `{ message, attachments }` | Required | Reply added | Session invalid | Request not found | Send failed | Shows upload/send status and refreshes detail | Add optimistic retry queue for attachments |
| Mark maintenance read | PATCH | `/maintenance/:requestId/read` | `https://mobile-api.lilycrest.space/api/m/maintenance/:requestId/read` | None | Required | Read marker updated | Session invalid | Request not found | Ignored/non-critical | Failure is caught and ignored | Add dedicated unread endpoint |
| Confirm resolved | PATCH | `/maintenance/:requestId/confirm-resolved` | `https://mobile-api.lilycrest.space/api/m/maintenance/:requestId/confirm-resolved` | None | Required | Request resolved/confirmed | Session invalid | Request not found | Confirm failed | Shows error banner | Confirm eligible statuses in UI |
| Update maintenance | PUT | `/maintenance/:requestId` | `https://mobile-api.lilycrest.space/api/m/maintenance/:requestId` | `{ description }` and possibly other editable fields | Required | Updated request | Session invalid | Request not found | Save failed | Description min 10 validation | Backend should reject edits when status disallows |
| Cancel maintenance | PATCH | `/maintenance/:requestId/cancel` | `https://mobile-api.lilycrest.space/api/m/maintenance/:requestId/cancel` | None | Required | Request cancelled | Session invalid | Request not found | Cancel failed | Shows confirmation/error state | Consider cancellation reason |
| Reopen maintenance | PATCH | `/maintenance/:requestId/reopen` | `https://mobile-api.lilycrest.space/api/m/maintenance/:requestId/reopen` | `{ reopen_note }` optional | Required | Request reopened | Session invalid | Request not found | Reopen failed | Shows error banner | Make reopen note requirement explicit |

## Assistant, Chat, Tickets, FAQs

| Feature/screen | Method | Endpoint path | Production URL | Request body | Auth | Expected 200/201 | 401 behavior | 404 behavior | 500 behavior | Current app handling | Suggested improvement |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AI message | POST | `/chatbot/message` | `https://mobile-api.lilycrest.space/api/m/chatbot/message` | `{ message, session_id }` | Required | Bot response, intent, metadata, suggestions | Session invalid | Missing route | Network/chat error | Shows network error and bot error message | Add structured chatbot error codes |
| Reset AI session | POST | `/chatbot/reset` | `https://mobile-api.lilycrest.space/api/m/chatbot/reset` | `{ session_id }` | Required | Reset success | Session invalid | Missing route | Reset failed | Hook clears local session as applicable | Add explicit UI action visibility |
| Request admin chat | POST | `/chatbot/request-admin` | `https://mobile-api.lilycrest.space/api/m/chatbot/request-admin` | `{ session_id, reason }` | Required | Admin chat requested | Session invalid | Missing route | Request failed | API method exists; current assistant uses `/chat/start` for support | Remove duplicate or document legacy use |
| Live chat status | GET | `/chatbot/live-status/:sessionId` | `https://mobile-api.lilycrest.space/api/m/chatbot/live-status/:sessionId` | None | Required | Live status | Session invalid | Missing route | Status failed | API method exists; no clear current route reference | Remove duplicate or wire explicitly |
| Close live chat | POST | `/chatbot/close-live-chat` | `https://mobile-api.lilycrest.space/api/m/chatbot/close-live-chat` | `{ session_id }` | Required | Closed | Session invalid | Missing route | Close failed | API method exists; no clear current route reference | Prefer unified `/chat/:id/close` |
| Start support chat | POST | `/chat/start` | `https://mobile-api.lilycrest.space/api/m/chat/start` | Support category/priority/reason data | Required | Conversation created | Session invalid | Missing route | Start failed | Assistant shows support error message | Document exact support payload schema |
| My support chats | GET | `/chat/me` | `https://mobile-api.lilycrest.space/api/m/chat/me` | None | Required | Conversations list | Session invalid | Missing route | Support load failed | Assistant logs/sets support refresh error | Add pagination/status filters |
| Support messages | GET | `/chat/:conversationId/messages` | `https://mobile-api.lilycrest.space/api/m/chat/:conversationId/messages` | None | Required | Conversation and messages | Session invalid | Conversation not found | Thread load failed | Assistant logs warning or shows error | Normalize message timestamp/sender fields |
| Send support message | POST | `/chat/:conversationId/messages` | `https://mobile-api.lilycrest.space/api/m/chat/:conversationId/messages` | `{ message }` | Required | Message stored | Session invalid | Conversation not found | Send failed | Optimistic UI with failure warning | Add attachment support if required |
| Close support chat | PATCH | `/chat/:conversationId/close` | `https://mobile-api.lilycrest.space/api/m/chat/:conversationId/close` | `{ note }` | Required | Conversation closed | Session invalid | Conversation not found | Close failed | Warning logged; UI returns where possible | Expose close result to user |
| FAQs | GET | `/faqs` | `https://mobile-api.lilycrest.space/api/m/faqs` | Optional `category` param | Likely required | FAQ list | Session invalid | Missing route | Load failed | API method exists; no current route reference found | Wire to assistant/help or remove |
| FAQ categories | GET | `/faqs/categories` | `https://mobile-api.lilycrest.space/api/m/faqs/categories` | None | Likely required | Category list | Session invalid | Missing route | Load failed | API method exists; no current route reference found | Wire to assistant/help or remove |
| My tickets | GET | `/tickets/me` | `https://mobile-api.lilycrest.space/api/m/tickets/me` | Optional `status` param | Required | Ticket list | Session invalid | Missing route | Load failed | API method exists; no current route reference found | Product decision: tickets vs support chat |
| Ticket detail | GET | `/tickets/:ticketId` | `https://mobile-api.lilycrest.space/api/m/tickets/:ticketId` | None | Required | Ticket detail | Session invalid | Ticket not found | Load failed | API method exists; no current route reference found | Product decision |
| Create ticket | POST | `/tickets` | `https://mobile-api.lilycrest.space/api/m/tickets` | Ticket data | Required | Ticket created | Session invalid | Missing route | Create failed | API method exists; no current route reference found | Product decision |
| Respond to ticket | POST | `/tickets/:ticketId/respond` | `https://mobile-api.lilycrest.space/api/m/tickets/:ticketId/respond` | Response data | Required | Response added | Session invalid | Ticket not found | Send failed | API method exists; no current route reference found | Product decision |
| Update ticket status | PUT | `/tickets/:ticketId/status` | `https://mobile-api.lilycrest.space/api/m/tickets/:ticketId/status` | `{ status }` | Required | Status updated | Session invalid | Ticket not found | Update failed | API method exists; no current route reference found | Product decision |
| Admin tickets | GET/POST/PUT | `/tickets/admin/...` | `https://mobile-api.lilycrest.space/api/m/tickets/admin/...` | Admin ticket bodies | Admin token expected | Admin ticket result | Unauthorized | Missing route | Admin failure | API methods exist; no mobile admin screen found | Remove from tenant client or guard behind admin role |
| Seed data | POST | `/seed` | `https://mobile-api.lilycrest.space/api/m/seed` | None | Needs verification | Seed result | Unauthorized | Missing route | Seed failure | API method exists; no current route reference found | Remove from production client if not needed |

## Current Error Handling Summary

- Axios base URL is `MOBILE_API_BASE_URL`.
- Request interceptor attaches `session_token`.
- Response interceptor retries protected `401` once by refreshing Firebase session through `/auth/google` when possible.
- If refresh fails, it clears `session_token` and `session_user`.
- Active fallback retry code has been removed from the mobile Axios client. The direct Render URL is available only in dev diagnostics and documentation, not as an automatic runtime fallback.
- Network, timeout, and 502/503/504 map to "The server is starting. Please try again in a few seconds."
- Known route issues should now surface directly as normalized `route` errors instead of silently switching hosts.

## Implemented Improvements In This Pass

| Area | Implemented improvement | Remaining suggested improvement |
|---|---|---|
| Runtime base URL | Mobile runtime remains pinned to `https://mobile-api.lilycrest.space`; admin/onrender/tunnel values are rejected by `frontend/src/config/api.js` | Keep web/admin domain references only in backend/web docs/config |
| Fallback behavior | Removed automatic Axios fallback retry behavior so the app cannot silently switch to old domains | Keep direct Render tests manual/dev-only |
| Diagnostics | Added dev-only `frontend/src/utils/mobileDiagnostics.js` with native fetch and raw Axios health tests | Capture Android logs from a real device/emulator |
| Error normalization | Added `normalizeApiError()` for auth, route, server, and network errors | Wire normalized errors into every remaining screen-specific message |
| Session hydration | AuthProvider waits for Firebase auth initial state before session hydration | Confirm email/password session behavior with a real tenant account |
| Protected startup calls | Root layout blocks protected routes when unauthenticated; billing/services/profile/documents gate protected fetches | Extend same guard checks to any newly added protected screen |
| Push token sync | Existing AuthProvider sync still waits for authenticated user; Settings now requires authenticated user before push-token save | Add a visible disabled state while auth is not ready |

## Suggested Cross-Cutting Improvements

- Add a documented mobile API OpenAPI/schema file for `/api/m`.
- Add a backend unread-count endpoint for notifications/announcements.
- Return empty arrays for optional lists instead of 404 where the route exists.
- Include `x-request-id` in client dev logs when available.
- Add a device network diagnostics screen behind a dev flag.
- Remove service methods that are not used by any mobile route, or mark them as intentionally reserved.
