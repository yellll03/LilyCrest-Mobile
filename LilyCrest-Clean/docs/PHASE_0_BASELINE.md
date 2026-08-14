# Phase 0 Baseline

Date: 2026-07-12

Repository root: `D:\LilyCrest\LilyCrest-Clean`

Branch: `master`

## Git Status Summary

The working tree already had substantial uncommitted changes before Phase 0/Phase 2 work began. These were not discarded, reset, or overwritten.

Pre-change `git status --short` included:

```text
 M ../.claude/settings.local.json
 M MOBILE_RENDER_MIGRATION_CHECKLIST.md
 M backend/config/chatbot.presets.js
 M backend/controllers/chat.controller.js
 M backend/controllers/chatbot.controller.js
 M backend/controllers/maintenance.controller.js
 M backend/package-lock.json
 M backend/public/admin/index.html
 M backend/routes/maintenance.routes.js
 M frontend/android/app/src/main/AndroidManifest.xml
 M frontend/app.config.js
 M frontend/app/(tabs)/_layout.jsx
 M frontend/app/(tabs)/announcements.jsx
 M frontend/app/(tabs)/profile.jsx
 M frontend/app/(tabs)/services.jsx
 M frontend/app/_layout.jsx
 M frontend/app/about.jsx
 M frontend/app/billing-history.jsx
 M frontend/app/change-password.jsx
 M frontend/app/documents.jsx
 M frontend/app/forgot-password.jsx
 M frontend/app/house-rules.jsx
 M frontend/app/login.jsx
 M frontend/app/my-documents.jsx
 M frontend/app/otp-verify.jsx
 M frontend/app/payment.jsx
 M frontend/app/privacy-policy.jsx
 M frontend/app/reset-password.jsx
 M frontend/app/settings.jsx
 M frontend/app/terms-of-service.jsx
 M frontend/src/config/api.js
 M frontend/src/context/AuthContext.js
 M frontend/src/hooks/useAssistantChat.js
 M frontend/src/screens/LilyAssistantScreen.jsx
 M frontend/src/services/api.js
 M frontend/src/services/firebaseStorageUpload.js
 M frontend/src/tests/useAssistantChat.test.js
?? LILYCREST_CODEBASE_AUDIT.md
?? LILYCREST_FIX_PHASES.md
?? LILYCREST_IOS_READINESS_MATRIX.md
?? LILYCREST_SAFE_FIRST_FIXES.md
?? docs/
?? frontend/app/debug/
?? frontend/src/services/mobileApiReadiness.js
?? frontend/src/utils/mobileDiagnostics.js
?? frontend/src/utils/navigation.js
```

## Tool Versions

```text
node v22.14.0
npm 10.9.2
```

## Dependency Baseline

Before Phase 2 patch alignment:

```text
expo@54.0.34
expo-file-system@19.0.22
expo-font@14.0.11
expo-router@6.0.23
```

## Frontend Lint Baseline

Command:

```text
npm.cmd run lint
```

Result: Passed.

Key output:

```text
> frontend@1.0.0 lint
> expo lint
```

## Frontend Jest Baseline

Command:

```text
npm.cmd test -- --runInBand
```

Result: Passed.

Key output:

```text
PASS src/tests/useAssistantChat.test.js
PASS src/tests/attachmentPicker.test.js

Test Suites: 2 passed, 2 total
Tests:       6 passed, 6 total
Snapshots:   0 total
```

## Backend Syntax-Check Baseline

Command:

```text
Get-ChildItem -Recurse -Filter *.js | Where-Object {$_.FullName -notmatch '\\node_modules\\'} | ForEach-Object { node --check $_.FullName }
```

Result: Passed.

Key output:

```text
backend syntax checks completed
```

## Expo Doctor Baseline

Command:

```text
npx.cmd expo-doctor
```

Result: Failed with one known dependency-alignment issue.

Key output:

```text
Running 17 checks on your project...
16/17 checks passed. 1 checks failed.

✖ Check that packages match versions required by installed Expo SDK

package           expected  found
expo              ~54.0.35  54.0.34
expo-file-system  ~19.0.23  19.0.22
expo-font         ~14.0.12  14.0.11
expo-router       ~6.0.24   6.0.23
```

Known pre-existing warning:

```text
The appConfigFieldsNotSyncedCheck is disabled.
```

## Behavior Confirmation

No runtime behavior was intentionally changed during Phase 0 baseline capture. Phase 0 only recorded the current state before approved low-risk Phase 2 fixes.
