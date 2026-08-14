# Mobile Screenshot Capture TODO

Last updated: 2026-05-27

Some screenshots were captured from the connected Android device. The remaining items need controlled app state, fresh install state, an unauthenticated session, an expired token, or a safe test account. Do not generate fake screenshots. Capture only actual PNG/JPEG screenshots from the running Expo app on an emulator or Android device.

Start clean:

```powershell
cd frontend
npx expo start -c
```

Check device:

```powershell
adb devices
```

Capture:

```powershell
adb exec-out screencap -p > ..\docs\mobile-screenshots\<filename>.png
```

Verify every screenshot opens, is not blank, shows the intended screen/state, and does not expose secrets, tokens, private user data, or credentials.

| Feature | Route/path | Screen state | Required login state | Filename | Steps to reach screen | Notes/blockers |
|---|---|---|---|---|---|---|
| Auth/Login | `/login` | Default login form | Logged out | `auth-login.png` | Fresh launch or logout, tap login/get started | Ensure no saved email if privacy-sensitive |
| Auth/Google Sign-In | `/login` | Google sign-in prompt/result | Logged out | `auth-google-signin.png` | Tap Continue with Google | Native sheet may need dev build; avoid exposing account emails |
| Auth loading | App startup | Session/auth loading | Any | `auth-loading.png` | Launch app during auth initialization | May require throttling/debug reload timing |
| Session hydration | App startup | Checking secure session | Stored session | `session-hydration.png` | Relaunch app with stored token | Capture before navigation completes |
| Dashboard loaded | `/(tabs)/home` | Loaded dashboard | Logged in | `dashboard-loaded.png` | Login and open Home | Redact sensitive resident/account details if needed |
| Dashboard empty | `/(tabs)/home` | No billing/maintenance activity | Logged in test user | `dashboard-empty.png` | Use tenant with minimal data | Needs suitable test account |
| Dashboard error | `/(tabs)/home` | Retry/error state | Logged in | `dashboard-error.png` | Disable network or use controlled failing test env | Do not leave production URL changed |
| Announcements list | `/(tabs)/announcements` | Public list loaded | Logged in or route-accessible | `announcements-list.png` | Open News tab | API confirmed public from curl |
| Announcements empty | `/(tabs)/announcements` | Empty filtered state | Logged in | `announcements-empty.png` | Select category/filter with no results | Use filter instead of backend changes |
| Announcements error | `/(tabs)/announcements` | Retry/error state | Logged in | `announcements-error.png` | Disable network temporarily | Restore network afterward |
| Notifications list | Header/News notification flow | Loaded protected notification data | Logged in | `notifications-list.png` | Open header notifications or News if mapped | Captured from header sheet; capture again with sanitized test data if needed |
| Notifications empty | Header/News notification flow | No protected notifications | Logged in | `notifications-empty.png` | Use tenant without notifications | Needs suitable test account |
| Notifications unauthorized | Protected notification route | Session expired/unauthorized | Expired session | `notifications-unauthorized.png` | Expire token or clear token while on protected route | Avoid exposing token values |
| Billing history | `/(tabs)/billing` | Billing records loaded | Logged in | `billing-history.png` | Open Billing tab | Use test resident data |
| Billing empty | `/(tabs)/billing` | No bills | Logged in | `billing-empty.png` | Use tenant with no billing records | Needs suitable test account |
| Bill details/payment | `/bill-details`, `/payment` | Bill details or payment checkout entry | Logged in | `payment-feature.png` | Open unpaid bill and tap details/pay | Do not complete real payment unless using sandbox |
| Profile/account | `/(tabs)/profile` | Profile loaded | Logged in | `profile-account.png` | Open Profile tab | Redact personal data if needed |
| Push settings | `/settings` | Notification toggle enabled/disabled | Logged in | `push-notification-settings.png` | Profile -> Settings | Captured; OS permission prompt still needs a fresh install/reset |
| Push permission | OS permission prompt | Permission prompt | Logged in or first launch | `push-notification-permission.png` | Fresh install or reset notification permission, enable notifications | OS prompt may not be capturable after already granted |
| Network error | Any protected screen | User-friendly retry state | Logged in | `network-error-state.png` | Temporarily block network and open Dashboard/Billing | Confirm no stack trace shown |
| Session expired | Protected route | Login/session expired behavior | Expired session | `session-expired.png` | Use expired token or force 401 | Confirm redirect/login state |
| Logout | `/(tabs)/profile` | Logout confirmation or logged-out result | Logged in | `logout.png` | Profile -> Logout | Capture confirmation or post-logout login |
| Services | `/(tabs)/services` | Maintenance list | Logged in | `services-maintenance.png` | Open Services tab | Capture empty or loaded state |
| Documents | `/my-documents` | Documents screen | Logged in | `documents-list.png` | Profile -> Documents | Avoid sensitive document previews |
| Lily Assistant | `/(tabs)/chatbot` | Assistant default/chat | Logged in | `lily-assistant.png` | Open assistant FAB/profile support | Avoid private chat content |
