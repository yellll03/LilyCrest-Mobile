# LilyCrest Mobile Troubleshooting

Last reviewed: 2026-05-27

## Confirmed Facts

- Web/Admin API remains `https://api.lilycrest.space`.
- Mobile API is `https://mobile-api.lilycrest.space`.
- Direct Render mobile backend is `https://lilycrest-mobile.onrender.com`.
- Mobile API routes are under `/api/m`.
- `GET /api/m/health` should return `ok:true` and `service:"LilyCrest Mobile Backend"`.
- `GET /api/m/notifications` may return `401 Unauthorized` when no token is provided. That is acceptable.
- The Android app has a dev-only diagnostics screen at `/debug/api-health`, reachable from the login screen in dev mode.

## Latest Android Diagnostic Result

Observed on 2026-05-27 with the Android dev client connected to clean Metro port `8081`.

- The latest Android JS bundle did load from Metro `8081`.
- On the first cold custom-domain attempt, `https://mobile-api.lilycrest.space/api/m/health` could stall long enough that native fetch timed out and raw Axios reported `Network Error`.
- In the same run, direct Render health at `https://lilycrest-mobile.onrender.com/api/m/health` returned `200 OK`, which isolated the issue to the custom-domain first connection path rather than the app client code.
- After the custom-domain connection warmed, native fetch health, raw Axios health, and the app API client health all returned `200 OK`.
- `GET /api/m/notifications` without auth returned `401`, which is expected.
- Raw requests using a Firebase ID token returned `401 Invalid or expired session`; the current mobile API client uses the stored backend session token for protected app routes.
- App API client requests using the stored session token returned `200` for `auth/me`, notifications, and dashboard.

Implemented mitigation:

- Startup session hydration now waits for mobile API health readiness before calling protected endpoints.
- The old automatic startup diagnostics were removed to reduce startup noise.
- Push-token save remains gated behind authenticated state.

If the issue returns:

1. Open `/debug/api-health` from the dev login screen.
2. Confirm Metro says port `8081`.
3. Run diagnostics once immediately after launch and once again after 30-60 seconds.
4. If direct Render succeeds but `mobile-api` fails only on the first run, investigate Android DNS/TLS/custom-domain cold start.
5. If both direct Render and `mobile-api` fail, investigate phone connectivity, VPN, private DNS, or Android network security.
6. If health works but protected app-client routes fail, inspect stored session token injection rather than Firebase ID token injection.

## Error Types

| Symptom | Meaning | Example | Main fix area |
|---|---|---|---|
| Wrong URL | App is calling the wrong host or path | Mobile calls `https://api.lilycrest.space/api/m/...` | Frontend mobile API config |
| Wrong domain mapping | Custom domain points to wrong Render service | `mobile-api` returns web/admin backend content | DNS/Render custom domain |
| Backend route 404 | HTTP response exists but route is not mounted | `Cannot GET /api/m/notifications` | Backend route mounting/deploy |
| Auth 401 | Route exists and requires token | `/notifications` returns 401 without token | Login/session/auth header |
| CORS/origin 500 | Backend throws while handling an Origin | Curl with Origin returns 500 | Backend CORS/origin handling |
| Axios Network Error | Axios got no HTTP response | Error has no `response.status` | Device DNS/TLS/network, stale app bundle, Axios adapter/config |

Important distinction:

- A `401`, `404`, or `500` means the device received an HTTP response.
- Axios `Network Error` means Axios did not receive an HTTP response.
- Native Android requests are not normally blocked by browser CORS, so a native Android Axios `Network Error` should be investigated as transport, SSL, DNS, stale bundle, timeout, or adapter behavior.

## Curl Tests From Desktop

Health:

```powershell
curl.exe -i https://mobile-api.lilycrest.space/api/m/health
```

Expected:

- HTTP 200
- JSON includes `ok:true`
- JSON includes `service:"LilyCrest Mobile Backend"`

Protected notifications route without token:

```powershell
curl.exe -i https://mobile-api.lilycrest.space/api/m/notifications
```

Expected:

- HTTP 401 Unauthorized is acceptable.
- HTTP 404 `Cannot GET /api/m/notifications` is not acceptable on the mobile API domain.

Web/admin domain sanity check:

```powershell
curl.exe -i https://api.lilycrest.space/api/m/health
```

Expected:

- This is not the mobile app runtime domain.
- Do not change web/admin configuration while debugging mobile.

## Origin Header Tests

Use these to verify that dev origins do not trigger backend 500s.

```powershell
curl.exe -i -H "Origin: http://localhost:8081" https://mobile-api.lilycrest.space/api/m/health
curl.exe -i -H "Origin: http://localhost:8081" https://mobile-api.lilycrest.space/api/m/notifications
```

Expected:

- `/health` should not return 500.
- `/notifications` may return 401 without token.
- Rejected or unknown origins should never throw backend 500.

If these return 500:

1. Check Render logs for the request ID.
2. Inspect backend CORS/origin callback code.
3. Ensure localhost/Expo development origins are allowed or rejected safely.
4. Fix backend origin handling, not the mobile API domain.

## Phone Browser Test

On the same Android device running Expo, open:

```text
https://mobile-api.lilycrest.space/api/m/health
```

Expected:

- Browser displays health JSON.

If phone browser fails:

- Check Wi-Fi/mobile data.
- Disable VPN.
- Disable private DNS/ad blocker.
- Try another network.
- Reboot device to clear DNS cache.
- Compare direct Render URL.

If phone browser works but Expo Axios fails:

- Compare native `fetch` and raw Axios smoke logs.
- Check stale bundle/dev build.
- Check Axios interceptor/baseURL/header behavior.
- Check timeout.
- Check whether any request header is invalid on React Native.

## Direct Render URL Test

Direct Render mobile backend:

```text
https://lilycrest-mobile.onrender.com/api/m/health
```

Use only for diagnosis or documentation. It should not be an active runtime fallback in production mobile config.

Interpretation:

- Direct Render works and custom domain fails on Android: investigate custom-domain DNS/TLS propagation, certificate, or Android DNS cache.
- Both fail on Android but desktop works: investigate device network, VPN/private DNS, Android trust store, or Expo/dev build.
- Both work with native `fetch` but Axios fails: investigate Axios config/adapter/interceptors/headers.

## Custom Domain URL Test

Custom mobile domain:

```text
https://mobile-api.lilycrest.space/api/m/health
```

Expected:

- Desktop curl works.
- Phone browser works.
- Native `fetch` smoke test works.
- Raw Axios smoke test works.

If only Axios fails, capture:

- `error.message`
- `error.code`
- Whether `error.response` exists
- Whether `error.request` exists
- `Platform.OS`
- Exact URL
- Axios timeout value

## Fetch Vs Axios Comparison

Temporary smoke test location:

- `frontend/app/_layout.jsx`

The test should log for native `fetch`:

- URL label
- `Platform.OS`
- HTTP status
- Response text
- Error name
- Error message

The test should log for raw Axios:

- URL label
- `Platform.OS`
- HTTP status
- Response data
- `error.message`
- `error.code`
- `error.response` exists
- `error.request` exists

Interpretation:

- Fetch fails and Axios fails: device/app transport, DNS, SSL, network security, VPN/private DNS, or stale build.
- Fetch works and Axios fails: Axios adapter/config/header/interceptor/timeout/baseURL issue.
- Custom domain fails and direct Render works: custom-domain DNS/TLS propagation or device DNS cache.
- Both work on health but protected routes fail with 401: auth/session token issue, not network.
- Protected routes fail with 404: backend route mounting/deploy issue.

## Clear Expo Cache

From `frontend`:

```powershell
npx expo start -c
```

Then fully reload the app.

If the app still behaves like an old version:

1. Stop Metro.
2. Run `npx expo start -c`.
3. Close Expo Go/dev client on Android.
4. Reopen from QR/dev launcher.
5. If using a dev build, uninstall the app and reinstall the current build.
6. If native config changed, rebuild the dev client.

## Identify A Stale Bundle Or Dev Build

Signs of a stale bundle:

- Expo logs show an old API base URL.
- Old fallback URLs still appear in logs.
- Startup smoke test changes do not appear.
- Screens show old copy/components after code changes.

Actions:

- Run `npx expo start -c`.
- Reload from the developer menu.
- Clear app data on Android.
- Uninstall/reinstall the dev build.
- Rebuild the dev client if native modules or app config changed.

## Android-Specific Checks

On the Android device:

- Open mobile health URL in Chrome.
- Test on Wi-Fi and mobile data.
- Disable VPN.
- Disable Private DNS.
- Disable ad blocker/security filtering apps.
- Confirm date/time are correct.
- Reboot the phone if DNS/cert cache seems stale.
- Confirm Expo Go or dev build is the one actually loading the local Metro bundle.

Android network security notes:

- HTTPS domains with valid public certificates should work without cleartext settings.
- `usesCleartextTraffic` affects HTTP, not HTTPS.
- A custom domain TLS/certificate issue can appear as a network error before HTTP status exists.

## Logs To Collect From Expo

Collect these lines in order:

- `API base URL: ...`
- `[NetworkSmoke][mobile-custom][fetch] ...`
- `[NetworkSmoke][mobile-custom][axios] ...`
- `[NetworkSmoke][direct-render][fetch] ...`
- `[NetworkSmoke][direct-render][axios] ...`
- `API error: { message, status, method, url, code, detail }`
- `Session hydration failed: ...`
- `Fetch announcements error: ...`
- `Dashboard fetch error: ...`
- `[Notifications] Expo push token acquired`
- `[Notifications] Failed to save token to server: ...`

Also collect:

- Android device model and OS version.
- Expo Go vs dev build.
- Network type: Wi-Fi/mobile data.
- VPN/private DNS state.
- Whether phone browser can open the health URL.

Do not collect or paste:

- Firebase private keys.
- MongoDB URI.
- API secrets.
- Session tokens.
- Push tokens.

## Logs To Check In Render

For each failed app request, check:

- Did the request reach Render?
- Which service received it?
- HTTP method and path.
- Response status.
- Request ID, if present.
- Any backend stack trace.
- CORS/origin warnings.
- Cold start or timeout logs.

Interpretation:

- Request appears in Render with 401/404/500: app reached backend; debug auth/routes/backend.
- Request does not appear in Render: device/app never reached backend; debug DNS/TLS/network/stale build.
- Request reaches wrong Render service: custom domain mapping issue.

## Production Domain Rules

Keep these boundaries:

- Mobile runtime must use `https://mobile-api.lilycrest.space/api/m`.
- Web/admin must continue using `https://api.lilycrest.space`.
- Direct Render URL can be documented and tested manually.
- Direct Render URL should not be active fallback runtime config unless explicitly approved.
- Old Cloudflare tunnel URLs should not be in runtime config.

## Screenshot Capture For Error States

Use screenshots only from the running app on a device/emulator.

1. Start with a clean bundle: `cd frontend; npx expo start -c`.
2. Reproduce the state, such as Dashboard network error or session expired.
3. Capture with `adb exec-out screencap -p > ..\docs\mobile-screenshots\network-error-state.png`.
4. Open the PNG and verify it is not blank.
5. Confirm it shows a user-friendly message and retry/login action, not a stack trace.
6. Retake using a safe test account if personal data is visible.

After clearing Expo cache, compare screenshots before/after the fix by matching route and state. The expected improvement for the current Android issue is that protected routes show auth/session/network states cleanly, and health diagnostics show whether native fetch and raw Axios can reach the mobile API.
