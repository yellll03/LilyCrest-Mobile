# LilyCrest Mobile QA Checklist

Last reviewed: 2026-05-27

Mobile API under test:

- `https://mobile-api.lilycrest.space/api/m`

Expected baseline:

- `GET /health` returns `ok:true` and `service:"LilyCrest Mobile Backend"`.
- Protected routes may return `401` when no token is provided.
- Protected routes must not return Axios `Network Error` when the Android device can reach the API.
- `/notifications` must not return `404 Cannot GET /api/m/notifications` on the mobile API domain.

| Test case | Preconditions | Steps | Expected result | Pass/Fail |
|---|---|---|---|---|
| Fresh app launch | Clean install or cleared app storage; network available | Open app | App shows onboarding/login path; no crash; dev logs show mobile API base URL | |
| Fresh app launch with no network | App storage cleared; device offline | Open app | App remains usable enough to show logged-out/onboarding state; no crash | |
| Logged-out protected route | No session token | Deep link or navigate to a protected tab if possible | App does not expose tenant data; protected API calls may return 401 and show sign-in/retry state | |
| Email login validation | Logged out | Enter invalid email/password combinations and tap Sign In | Inline validation blocks bad email, blank password, whitespace password, too-short password | |
| Email login success | Valid tenant credentials | Sign in with email/password | Session token/user stored; app routes to Home | |
| Email login OTP required | Backend configured to require OTP | Sign in with email/password | App routes to OTP screen with masked email and pending token | |
| OTP verify success | Pending OTP token and current code | Enter 6 digit code and submit | App stores session and routes to Home | |
| OTP verify invalid | Pending OTP token and bad code | Enter invalid 6 digit code | Error shown; digits clear; user can retry | |
| OTP resend | Pending OTP token; cooldown complete | Tap resend | New code confirmation shown; cooldown restarts | |
| Google Sign-In success | Dev client/production build with native module and Google config | Tap Continue with Google and complete account selection | Firebase ID token exchanged with backend; session stored; routes Home | |
| Google Sign-In cancelled | Google Sign-In available | Start Google Sign-In then cancel | No session created; login screen remains stable | |
| Google module unavailable | Expo Go or build without native module | Tap Continue with Google | User sees rebuild/install latest dev client style message | |
| Session restore valid token | App has valid `session_token` | Force close and reopen app | `GET /auth/me` succeeds; Home loads without login | |
| Session restore expired token | App has expired/invalid `session_token` | Reopen app | `/auth/me` returns 401; app clears session and shows logged-out flow | |
| Session restore network error with cached user | Cached `session_user`; network issue reproduced | Reopen app | Cached user may be restored; dashboard data may show retry errors | |
| Dashboard load | Logged in; API reachable | Open Home | Dashboard, room/tenancy, billing, maintenance, and notification summaries load | |
| Dashboard refresh | Logged in; Home loaded | Pull to refresh | Dashboard data reloads; refresh indicator stops | |
| Contract end display | Logged in tenant with contract end in backend data | Open Home | Contract end is visible if backend response includes expected field | |
| Missing contract end | Logged in tenant whose backend response omits contract end | Open Home | UI does not fabricate contract end; mark backend response issue | |
| Announcements load | Logged in; announcements exist | Open News tab | Announcements list renders; filters/sort work | |
| Announcements empty | Logged in; no announcements for filter | Open News tab and filter | Empty state displays without error | |
| Announcements error | Backend unavailable or forced 500 | Open News tab | Error/empty state instructs refresh; app does not crash | |
| Notifications route auth | No token in curl or test client | Call `/notifications` | Returns 401, not 404 | |
| Notifications in app | Logged in; notifications exist | Open Home/header/News | Notification list or announcement fallback displays; unread count behaves | |
| Billing history load | Logged in tenant with bills | Open Billing tab | Latest bill/history render; filters and counts work | |
| Paid payment history load | Logged in tenant with paid payments | Open Billing tab | Paid payment records appear from `/billing/history/paid` | |
| Billing empty | Logged in tenant with no bills | Open Billing tab | Empty state appears; no crash | |
| Bill details | Logged in; bill exists | Tap a bill | Bill details load with breakdown/actions | |
| Billing PDF download | Logged in; bill has PDF support | Tap PDF/receipt download | File downloads/opens/shares; loading state clears | |
| Payment checkout | Logged in; unpaid bill | Tap Pay Now | Checkout URL opens; app handles success/cancel return | |
| Payment success verification | Checkout success with checkout ID | Return to `/payment-success` | Status verification message appears; billing refresh emitted | |
| Payment cancel | Checkout cancelled | Return to `/payment-cancel` | Cancel screen offers Billing/Home navigation | |
| Push permission first launch | Fresh install; notifications enabled | Open app and respond to permission prompt | Permission state stored; no crash if denied | |
| Push token save logged in | Logged in; permission granted | Open app/settings; watch logs | Token sync calls `POST /users/push-token`; success or controlled warning logged | |
| Push toggle off | Logged in; token stored | Settings -> disable Push Notifications | App sends disabled token state; toggle remains off | |
| Push toggle on | Logged in; permission available | Settings -> enable Push Notifications | Permission requested if needed; token saved; toggle remains on | |
| Profile load | Logged in | Open Profile | Profile data loads; refresh works | |
| Profile validation | Logged in; edit profile | Enter invalid email/phone/username/address | Field validation blocks save and shows errors | |
| Profile save | Logged in; valid profile edits | Save changes | Backend updates profile; local auth user updated | |
| Profile photo update | Logged in; media permission available | Choose/update photo | Image uploads through profile update; UI refreshes | |
| Documents list | Logged in | Open My Documents | Uploaded docs list or empty state displays | |
| Document upload | Logged in; valid file | Choose document type and upload | Upload status appears; list refreshes | |
| Document delete | Logged in; uploaded document exists | Delete document | Confirmation/action succeeds; list refreshes | |
| Contract/document download | Logged in; document route available | Open `/documents` or download document | Authenticated file fetch works | |
| Services list | Logged in | Open Services | Active/resolved/cancelled tabs load; empty state if none | |
| Create maintenance validation | Logged in | Submit with missing type/short description | Required field warnings appear | |
| Create maintenance success | Logged in; valid type/description | Submit request | Request appears in list/detail; modal resets | |
| Maintenance attachment limits | Logged in | Add unsupported, oversize, duplicate, or too many files | App blocks invalid attachments with clear error | |
| Maintenance detail | Logged in; request exists | Tap request | Detail modal loads; read marker attempted | |
| Maintenance reply | Logged in; request open | Add reply text/attachment and send | Thread refreshes; reply appears | |
| Maintenance cancel/reopen/confirm | Logged in; eligible request statuses | Use cancel, reopen, confirm resolved actions | Backend status changes and UI refreshes | |
| Lily Assistant AI message | Logged in | Open Assistant and send question | Bot response appears or user-friendly network error appears | |
| Lily Assistant attachment | Logged in; valid attachment | Add attachment and send | Attachment uploads in AI mode or error is shown | |
| Support chat start | Logged in | Request admin support from Assistant | Support conversation starts and appears in inquiries | |
| Support chat reply | Logged in; conversation exists | Send support message/reply | Message appears in thread; polling updates | |
| Support chat close | Logged in; conversation active | Close/return to assistant | Conversation closes or warning is logged without crash | |
| Settings biometric on | Device supports biometrics; logged in | Enable biometric login | Local authentication succeeds; setting persists | |
| Settings biometric off | Biometric setting enabled | Disable biometric login | Setting persists as false | |
| Change password success | Logged in; current password known | Change to valid new password | Success alert; app logs out; login required | |
| Forgot/reset password | Email delivery configured | Request reset, open link, submit strong password | Success state displayed; user can log in | |
| Logout | Logged in | Logout from Profile | Session clears immediately; app returns login/onboarding; push disabled call attempted | |
| Backend unreachable | Logged in or logged out | Block domain/network and open app | App shows network/cold-start messages; no HTTP status expected only if transport fails | |
| Backend 401 | Use expired token or no token | Open protected screens | Session clears or screen shows auth error; no crash | |
| Backend 404 | Temporarily call missing mobile path | Trigger request | App treats as route/resource missing; logs status 404, not Network Error | |
| Backend 500 | Force backend internal error in staging | Trigger request | App shows generic/server message; Render logs contain request ID | |
| Axios Network Error | Reproduce Android issue | Compare smoke test logs for fetch and Axios | Fetch failure implies device/DNS/TLS/network; fetch success with Axios failure implies Axios config/adapter/interceptor issue | |
| Slow Render cold start | Let service sleep if applicable | Open app and load screen | Timeout/cold-start message appears; retry later succeeds | |
| Android phone browser test | Same Android device as Expo app | Open `https://mobile-api.lilycrest.space/api/m/health` in browser | Browser displays health JSON | |
| Direct Render test | Android device/app smoke test enabled | Test `https://lilycrest-mobile.onrender.com/api/m/health` | If Render works but custom domain fails, investigate custom-domain DNS/TLS | |
| Custom domain test | Android device/app smoke test enabled | Test `https://mobile-api.lilycrest.space/api/m/health` | Fetch and Axios should both get HTTP status/data | |
| Expo Go test | Expo Go installed | Run app in Expo Go | Core JS screens work; native Google/push limitations may apply | |
| Dev build test | Fresh dev client installed | Run app in dev build | Native Google and push modules available if configured | |
| Clean Metro cache | Local dev machine | Stop Expo, run `npx expo start -c`, reload app | Logs reflect current bundle and mobile API base | |
| Stale bundle/dev build | Suspect old app bundle | Uninstall Android app, reinstall/rebuild dev client, run clean cache | Old base URLs and old smoke-test behavior disappear | |

## Screenshot QA Notes

| Test case | Preconditions | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| Screenshot capture setup | Android emulator/device connected | Run `adb devices` | Device is listed and authorized | | Blocked in this pass because `adb devices` timed out |
| Clean Expo screenshot run | Device available; Metro stopped | Run `cd frontend; npx expo start -c`; open app | Current bundle loads and diagnostics logs are current | | Capture screenshots only after cache clear |
| Screenshot privacy review | Screenshots captured | Open each PNG/JPEG | No secrets, tokens, private user details, or credentials visible | | Retake with a safe test account if private data appears |
| Before/after comparison | Screenshots from before and after a fix | Compare matching files/routes | Fixed screen shows intended state and no regression | | Store only approved final screenshots in `docs/mobile-screenshots` |
