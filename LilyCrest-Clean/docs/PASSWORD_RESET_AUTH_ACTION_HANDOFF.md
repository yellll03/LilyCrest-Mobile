# Password Reset — `/auth-action` Integration Handoff

Status: **not yet implemented**. `/auth-action` lives in the separate
Capstone-Website repository, which this codebase does not contain. This
document is the contract that repository must follow when it is built. It
also records the current, still-active fallback so nobody mistakes it for
being broken.

## Current production state (today)

- `PASSWORD_RESET_WEB_URL` is **unset**.
- Password-reset emails link to this backend's own hosted reset page:

  ```
  https://api.lilycrest.space/api/auth/reset-password?token=<token>
  ```

- That page is fully functional today (deep-links into the mobile app, or
  falls back to an inline HTML form) and must **not** be changed or treated
  as deprecated. See `getResetPasswordPage` in
  `backend/controllers/auth.controller.js`.
- Do not set `PASSWORD_RESET_WEB_URL` to the canonical website's URL until
  `/auth-action` actually exists and has been deployed and tested. Until
  then it must stay unset so email links keep pointing at the working
  backend-hosted page above.

## Future flow (once `/auth-action` is built and `PASSWORD_RESET_WEB_URL` is set)

1. User requests a password reset from the mobile app.
2. Backend creates a single-use reset token.
3. The reset email links to:

   ```
   https://www.lilycrest.space/auth-action?token=<token>
   ```

   The token is legitimately in this URL — it's how the email delivers the
   secret from the inbox into the user's browser. See "Why the token is in
   one URL but not the other" below.

4. `/auth-action` reads `token` from its own page URL (client-side).
5. Before showing the new-password form, the website checks the token is
   still valid:

   ```
   POST https://api.lilycrest.space/api/auth/reset-password/status
   Content-Type: application/json

   { "token": "<token>" }
   ```

   The token travels in the POST body here, **not** appended to this API
   URL as a query string — see the security note below.

6. The backend responds with exactly one of:

   ```json
   { "valid": true }
   ```
   ```json
   { "valid": false }
   ```

   This is deliberately the entire contract. Do not design frontend logic
   that expects `email`, `userId`, `username`, `expiresAt`, `accountExists`,
   a `reason` code, or any other field — malformed, unknown, expired, and
   already-used tokens are all indistinguishable `valid: false` responses,
   by design (account-enumeration resistance). A reasonable user-facing
   message for `valid: false` is "This password reset link is invalid or
   has expired."

7. If `valid: true`, the website shows the new-password form.
8. On submit, the website performs the actual reset:

   ```
   POST https://api.lilycrest.space/api/auth/reset-password
   Content-Type: application/json

   { "token": "<token>", "newPassword": "<new password>" }
   ```

9. On success, show a confirmation state and route the user back to the
   appropriate Lilycrest login flow.

## Why the token is in one URL but not the other

- **Email → `/auth-action?token=...`**: legitimate. This is the only way to
  get a single-use secret out of an email and into a web page — there's no
  request body involved in following a link.
- **`/auth-action` → status API**: once the page has the token in hand and
  is making its own HTTP request, it must send the token as JSON in the
  POST body, not repeat it as a second URL. Raw secrets in query strings can
  leak via infrastructure/access logs, browser and proxy history, and other
  request metadata that a URL passes through but a POST body does not. The
  actual reset call (step 8) has always used the body for this reason; the
  status check (step 5) follows the same pattern.
- This is not a blanket rule that reset tokens can never appear in a URL —
  the email link is a legitimate, necessary exception. The rule is specific
  to API calls the website makes on the token's behalf.

## Backend routes referenced above

| Purpose | Route | Notes |
|---|---|---|
| Backend-hosted reset page (current production link) | `GET /api/auth/reset-password?token=...` | `getResetPasswordPage`; stays active regardless of `/auth-action` status. |
| Programmatic token status check | `POST /api/auth/reset-password/status` `{ token }` | `checkResetTokenValid`; read-only, non-consuming, generic `{ valid }` response, rate-limited. The equivalent `GET .../status?token=...` query-string form has been removed and must not be reintroduced. |
| Actual password reset | `POST /api/auth/reset-password` `{ token, newPassword }` | `resetPassword`; single-use, claims the token. |

See `backend/.env.example` for the `PASSWORD_RESET_WEB_URL` toggle and
`backend/tests/resetTokenStatus.test.js` for the behavioral contract of the
status endpoint (validation, privacy, non-consumption, rate limiting).
