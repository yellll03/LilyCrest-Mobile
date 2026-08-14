# LilyCrest Mobile Flow Diagrams

Last reviewed: 2026-05-27

Mobile API base:

- `https://mobile-api.lilycrest.space/api/m`

## Login, Auth, And Session Hydration

```mermaid
flowchart TD
  A[App launch] --> B[RootLayout mounts providers]
  B --> C[AuthProvider initializes]
  C --> D[Read session_token from AsyncStorage]
  D -->|No token| E[Set unauthenticated]
  D -->|Token exists| F[GET /api/m/auth/me]
  F -->|200 valid user| G[Store session_user]
  G --> H[Set authenticated]
  H --> I[Route/show Home]
  F -->|401| J[Clear session_token and session_user]
  J --> K[Set unauthenticated]
  F -->|Network/timeout/other| L[Read cached session_user]
  L -->|Valid cached user| M[Set authenticated from cache]
  L -->|No cached user| K
  K --> N[Show onboarding/login flow]

  N --> O[Email/password login]
  O --> P[POST /api/m/auth/login]
  P -->|Session payload| H
  P -->|OTP required| Q[Route /otp-verify]
  Q --> R[POST /api/m/auth/login/verify-otp]
  R -->|Session payload| H
  R -->|Invalid/expired| Q

  N --> S[Google Sign-In]
  S --> T[Native Google/Firebase ID token]
  T --> U[POST /api/m/auth/google]
  U -->|Session payload| H
  U -->|403 or 401| N
```

## Mobile API Request Flow

```mermaid
flowchart TD
  A[Screen or service calls apiService] --> B[Axios instance]
  B --> C[Base URL: mobile-api.lilycrest.space/api/m]
  C --> D[Request interceptor reads session_token]
  D -->|Token found| E[Attach Authorization bearer token]
  D -->|No token| F[Send without Authorization]
  E --> G[Mobile backend]
  F --> G
  G -->|2xx| H[Return response to screen]
  G -->|401 protected route| I[Response interceptor checks auth endpoint]
  I -->|Not auth endpoint and not retried| J[Try Firebase session refresh]
  J -->|Fresh token| K[Retry original request]
  K --> G
  J -->|No fresh token| L[Clear session storage]
  L --> M[Reject with auth error]
  I -->|Auth endpoint or already retried| M
  G -->|404| N[Reject with route/resource error]
  G -->|500| O[Reject with server error]
  G -->|No HTTP response| P[Axios Network Error]
  P --> Q[Screen shows network/cold-start message]
  N --> R[Screen-specific error or empty state]
  O --> R
```

## Notifications And Push Token Flow

```mermaid
flowchart TD
  A[AuthProvider mounts] --> B[initializeNotificationHandler]
  B --> C[requestPushPermissionOnFirstLaunch]
  C --> D{Platform supports expo-notifications?}
  D -->|No| E[Skip push registration]
  D -->|Yes| F[Check notification setting]
  F -->|Disabled| E
  F -->|Enabled| G[Create Android channel if Android]
  G --> H[Check/request permission]
  H -->|Denied| E
  H -->|Granted| I[Get Expo push token with EAS project ID]
  I -->|Expo token unavailable on Android| J[Get native device token]
  I -->|Token acquired| K[Store @lilycrest_push_token]
  J -->|Token acquired| K
  J -->|No token| E
  K --> L{Authenticated user?}
  L -->|No| M[Wait for login]
  L -->|Yes| N[POST /api/m/users/push-token]
  N --> O[Token sync signature stored]

  P[Foreground push received] --> Q[Increment unread count]
  Q --> R[Show in-app banner]
  R --> S[User taps banner]
  S --> T[Resolve route from notification data]
  T --> U[router.push destination]

  V[Logout] --> W[Clear local session]
  W --> X[POST /api/m/users/push-token enabled false]
```

## Dashboard Data Loading Flow

```mermaid
flowchart TD
  A[HomeScreen focus/load] --> B{User authenticated?}
  B -->|No| C[Show sign-in required load error]
  B -->|Yes| D[Set loading/refreshing]
  D --> E[GET /api/m/dashboard/me]
  D --> F[GET /api/m/notifications]
  D --> G[GET /api/m/billing/history]
  F -->|Fails| H[Fallback GET /api/m/announcements]
  E --> I[Normalize dashboard data]
  G --> J[Normalize billing history]
  F --> K[Normalize notifications]
  H --> K
  I --> L[Build resident/room/contract summary]
  J --> M[Build billing card and insights]
  K --> N[Build recent updates]
  L --> O[Render Home dashboard]
  M --> O
  N --> O
  E -->|Failure| P[Set dashboard loadError]
  G -->|Failure| P
  P --> Q[Show retry/pull-to-refresh path]
```

## Billing And Payment Flow

```mermaid
flowchart TD
  A[Open Billing tab] --> B[GET /api/m/billing/me/latest]
  A --> C[GET /api/m/billing/history]
  A --> D[GET /api/m/billing/history/paid]
  B --> E[Render latest bill summary]
  C --> F[Render bill list]
  D --> G[Render payment history]
  F --> H[User opens bill details]
  H --> I[GET /api/m/billing/:billingId]
  I --> J[Render bill details]
  J --> K[User taps Pay Now]
  K --> L[POST /api/m/paymongo/checkout]
  L --> M[Open checkout URL]
  M -->|Success return| N[/payment-success]
  M -->|Cancel return| O[/payment-cancel]
  N --> P[GET /api/m/paymongo/checkout/:checkoutId/status]
  P --> Q[Emit billing refresh]
  Q --> A
```

## Error Handling Flow

```mermaid
flowchart TD
  A[API call fails] --> B{HTTP response exists?}
  B -->|No| C[Axios Network Error]
  C --> D[Check fetch smoke test]
  D -->|Fetch fails too| E[Device DNS/TLS/network/stale build investigation]
  D -->|Fetch works| F[Axios config/adapter/interceptor/header investigation]

  B -->|Yes| G{Status}
  G -->|401| H{Endpoint type}
  H -->|Auth/login endpoint| I[Show credential/auth message]
  H -->|Protected endpoint| J[Try session refresh once]
  J -->|Refresh succeeds| K[Retry request]
  J -->|Refresh fails| L[Clear session and show login/auth state]

  G -->|404| M[Route/resource missing]
  M --> N[Verify mobile domain and backend route mount]

  G -->|500| O[Backend internal error]
  O --> P[Check Render logs and request ID]

  G -->|502/503/504| Q[Cold start or gateway issue]
  Q --> R[Show server starting message and retry]
```

## Screenshot Capture And Manual Update Flow

```mermaid
flowchart TD
  A[Need screenshot for feature/state] --> B{Android device or emulator available?}
  B -->|No| C[Record item in MOBILE_SCREENSHOT_CAPTURE_TODO.md]
  C --> D[Mark status Needs capture in MOBILE_SCREENSHOT_INDEX.md]
  B -->|Yes| E[Start Expo with npx expo start -c]
  E --> F[Open route and reproduce exact state]
  F --> G[Capture PNG with adb screencap]
  G --> H[Open screenshot and verify nonblank]
  H --> I{Secrets or private data visible?}
  I -->|Yes| J[Retake with safe test account/state]
  I -->|No| K[Save under docs/mobile-screenshots]
  K --> L[Update screenshot index status to Captured]
  L --> M[Add or confirm manual image link]
```
