# Phase 1.5E — Email Authentication Diagnosis

Date: 2026-07-24

## Final decision

**EMAIL AUTHENTICATION FIX NOT VERIFIED**

The code defects are fixed and automated checks pass, but the required TECNO CLA5 test, reset-email delivery, reset completion, and Google regression test cannot be performed from this workspace.

## Exact root cause

There were two client defects:

1. Email login is not a Firebase-client login like Google. It posts to `/api/m/auth/login`; the backend then authenticates the credential against Firebase REST, resolves the tenant, and sends OTP. In the login UI, any returned `errorType` not handled by a short status list was forced to the `network` presentation. Profile, provider-configuration, and unexpected states could therefore appear as network failures even when Firebase or the backend had returned a definite result.
2. Forgot password unnecessarily depended on `/api/m/auth/forgot-password`, MongoDB lookup, backend email delivery, and backend reset-token creation. Any failure in that chain appeared as a reset network failure even though Firebase Auth was available.

Forgot password now calls `sendPasswordResetEmail(auth, email)` directly. Login retains the existing backend/Firebase/OTP architecture so it does not bypass the application's second-factor behavior.

## Flow comparison

```text
Google
Google provider -> shared Firebase Auth -> Firebase ID token
-> POST /auth/google -> tenant lookup -> app session

Email/password
POST /auth/login -> backend Firebase REST password authentication
-> tenant lookup -> OTP email -> OTP verification -> app session

Forgot password (fixed)
email form -> shared Firebase Auth -> sendPasswordResetEmail
-> enumeration-safe result
```

Email/password therefore differs before Firebase authentication: the credential is sent to the LilyCrest backend, while Google first authenticates in the app.

## Error mapping

| Source | Visible result |
|---|---|
| `auth/invalid-credential`, backend 401 | Incorrect email or password |
| `auth/network-request-failed` | No internet connection |
| `auth/invalid-email` | Valid-email guidance |
| `auth/user-disabled` | Account disabled |
| `auth/too-many-requests`, HTTP 429 | Too many attempts |
| `auth/operation-not-allowed` | Email/password sign-in unavailable/configuration |
| HTTP 403 | Account/access state; not network |
| HTTP 404 | Tenant profile missing; not network |
| HTTP 502/503/504 | Server unavailable |
| Axios/Firebase timeout | Timed-out request |
| Unverified-email policy | Dedicated verification message; not network |

## Provider, project, and auth-instance verification

- Local environment project ID matches `google-services.json`.
- One Android Firebase client is present.
- Firebase app/Auth is cached globally and initialized once with AsyncStorage persistence.
- Google and password reset import the same Firebase module/Auth singleton.
- No `connectAuthEmulator` call was found.
- No client App Check initialization/enforcement path was found.
- Email/password provider enablement, test-user existence/disabled state, API-key console restrictions, server-side App Check enforcement, and password policy require Firebase project-administrator access.

## Network/preflight findings

- Live `GET /api/m/health`: HTTP 200.
- Sanitized synthetic `POST /api/m/auth/login`: HTTP 403, proving the route/host is reachable and returns an application response.
- Invalid-input `POST /api/m/auth/forgot-password`: HTTP 400, proving route reachability without sending mail.
- No health preflight blocks an explicit email login.
- Forgot password no longer requires backend health, tenant profile, reservation, branch, or session state.

## Files modified

- `frontend/app/login.jsx`
- `frontend/app/forgot-password.jsx`
- `frontend/src/utils/authStability.js`
- `frontend/src/tests/authStability.test.js`
- `frontend/src/tests/authFlowContracts.test.js`

## Automated results

- Focused ESLint: passed.
- Jest: 2 suites, 24 tests passed.
- Covered invalid credentials, real network failure, provider disabled, disabled account, backend 403/404 separation, verification-message separation, rapid-tap locking, password preservation, enumeration-safe reset UI, no reset backend dependency, singleton Auth usage, session handling, and Google source regression contracts.

## Physical test status and blockers

Not run: valid credential login, wrong-password display, registered/unregistered reset delivery, email receipt, reset-link opening, new-password login, Wi-Fi/mobile data/offline behavior, unverified account, or Google Sign-In regression on TECNO CLA5. No app was uninstalled and no APK/release build was created.

Before release, run those cases on the existing development installation and capture sanitized Firebase/Axios codes, stage, host, and HTTP status. Only after they pass should a new APK be produced and its package, version, build number, and SHA-256 recorded.
