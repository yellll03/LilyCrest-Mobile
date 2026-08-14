# Phase 1.5C — Build Completion, Device Testing, and Health Deployment

Date: 2026-07-24 (Asia/Singapore)

## Final decision

AUTHENTICATION AND NETWORK STABILITY NOT PASSED

The fresh EAS build remains queued, no physical Android device is detected, and the
isolated health change has no authorized production deployment path. No queued
build, local APK, or automated test is treated as physical-device evidence.

## EAS build status

Build ID: `e41251cf-feba-4f98-ad04-d11c479e8466`

| Field | Verified value |
|---|---|
| Current status | `IN_QUEUE` |
| Queue record created | 2026-07-23 16:37:21 UTC |
| Build start | Not started |
| Completion | Not completed |
| Profile | preview |
| Platform | Android |
| Distribution | internal |
| Version | 1.0.0 |
| Android build number | 1 |
| Base Git commit | `4c9728a0823d0856fbff9a752eaff934ef593dfd` |
| Submitted source fingerprint | `d55247570b59aad50c88cbcea36ae56ac64e4e34` |
| Requested artifact | APK |
| Artifact availability | Unavailable while queued |

The EAS record has no builder logs or start timestamp yet. Expo's public status page
reports EAS Build operational; the degraded component is npm package installation,
not EAS Build. The observed queue duration is not yet enough to justify cancellation
or a duplicate submission.

Expected native package and runtime configuration remain:

- package `com.lilycrest.lilycrestdorm`
- backend `https://mobile-api.lilycrest.space`
- no localhost, emulator, or LAN fallback in preview configuration

## APK artifact

No remote EAS artifact exists yet, so no EAS filename, size, checksum, or package
inspection can be recorded.

The previously verified local release-test APK remains:

- file: `frontend/android/app/build/outputs/apk/release/app-release.apk`
- format: APK
- package: `com.lilycrest.lilycrestdorm`
- version/build: 1.0.0 / 1
- size: 53,603,807 bytes
- SHA-256:
  `0FD8E0FDE0430E5FE306ACF29FCEAB4C41B23EF146793C25ADA62C5E85C8E6E8`

It is not substituted for the pending signed EAS artifact.

## Device connectivity

The Android SDK ADB executable was used to run:

```text
adb kill-server
adb start-server
adb devices -l
```

The server restarted successfully, but the device list was empty.

Final ADB state: **NOT DETECTED**

No device reset, data wipe, uninstall, driver mutation, or unsafe developer setting
was performed. Cable data capability, USB mode, device-side USB debugging, the
authorization prompt, and the TECNO Windows driver require hands-on access.

## Installation and runtime

| Gate | Result |
|---|---|
| Existing installed package/signature | COULD NOT BE TESTED |
| EAS APK replacement installation | COULD NOT BE TESTED |
| Package version on TECNO CLA5 | COULD NOT BE TESTED |
| Application launch | COULD NOT BE TESTED |
| Sanitized crash/log review | COULD NOT BE TESTED |
| Runtime backend verification | COULD NOT BE TESTED |

## Physical authentication results

No authorized test account or connected physical APK was available.

| Login test | Result |
|---|---|
| Valid credentials | COULD NOT BE TESTED |
| Incorrect password | COULD NOT BE TESTED |
| Invalid email | COULD NOT BE TESTED |
| Empty email/password | COULD NOT BE TESTED |
| Rapid taps/loading state | COULD NOT BE TESTED |
| Successful navigation | COULD NOT BE TESTED |
| Force-close restoration | COULD NOT BE TESTED |
| Invalid/expired session | COULD NOT BE TESTED |
| Different-account cache isolation | COULD NOT BE TESTED |

| Forgot Password test | Result |
|---|---|
| Registered test email | COULD NOT BE TESTED |
| Unregistered email/same message | COULD NOT BE TESTED |
| Invalid/empty email | COULD NOT BE TESTED |
| Rapid taps | COULD NOT BE TESTED |
| Offline and mobile data | COULD NOT BE TESTED |
| Actual email receipt | COULD NOT BE TESTED |
| Reset link/password change | COULD NOT BE TESTED |
| Login with new password | COULD NOT BE TESTED |

Forgot Password is not passed because no email was received and no reset was
completed.

## Session and logout results

| Test | Result |
|---|---|
| Authentication loading/no protected flash | COULD NOT BE TESTED |
| Force-close session restoration | COULD NOT BE TESTED |
| Invalid session rejection | COULD NOT BE TESTED |
| Offline cross-account isolation | COULD NOT BE TESTED |
| Logout token/cache cleanup | COULD NOT BE TESTED |
| Back button protection | COULD NOT BE TESTED |
| Second-account isolation | COULD NOT BE TESTED |

## Physical network matrix

| Feature | Primary Wi-Fi | Mobile data | Offline | Alternative Wi-Fi | Slow/unstable |
|---|---|---|---|---|---|
| Login | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Forgot Password | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Session restore | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Profile load | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Logout | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |

## Isolated health-endpoint release

A clean worktree was created from base commit `4c9728a0` on local branch:

`codex/phase-1.5c-health-only`

Local isolated commit:

`3874afd7f74876bb457c3c62f8aa1ff55025bcab`

The branch changes exactly one file:

```diff
diff --git a/LilyCrest-Clean/backend/routes/index.js b/LilyCrest-Clean/backend/routes/index.js
@@
 router.get('/health', (req, res) => {
-  res.json({
-    ok: true,
-    service: 'LilyCrest Mobile Backend',
-    status: 'healthy',
-    timestamp: new Date().toISOString(),
-    backend: 'Node.js/Express',
-    auth: 'Firebase-only'
-  });
+  res.json({ status: 'ok' });
 });
```

Validation:

- diff: one file, one insertion, eight deletions
- syntax: `node --check routes/index.js` passed
- secrets/infrastructure response fields: removed
- isolated baseline backend tests: unavailable because base commit `4c9728a0` has no
  npm `test` script
- current development backend suite: 60/60 passed

No Render manifest, deployment workflow, deploy hook, or connected deployment tool
was found. Pushing the branch alone would not prove or safely cause a production
deployment, and merging into the dirty main worktree would risk unrelated release
content.

Deployment result:

**DEPLOYMENT BLOCKED — APPROVAL OR CLEAN RELEASE PATH REQUIRED**

## Live health verification

Endpoint:
`https://mobile-api.lilycrest.space/api/m/health`

- HTTP reachability: available
- Current body: legacy verbose response with `status: "healthy"`
- Required body `{ "status": "ok" }`: not deployed
- Safe-response verification: FAILED

The live response still exposes service/framework/auth metadata and a timestamp, so
the endpoint gate remains open.

## Regression results

| Check | Result |
|---|---|
| Frontend Jest | 46 passed, 0 failed |
| Backend Node tests | 60 passed, 0 failed |
| Focused auth/config Jest | 30 passed, 0 failed |
| Expo lint | Passed |
| Expo Doctor | 17/17 passed |
| Expo dependency check | Dependencies up to date |
| Local Android release assembly | Previously passed |

The known Jest native-module and SecureStore fallback warnings are test-environment
warnings; they did not fail tests.

## Remaining blockers

1. EAS must start and complete build `e41251cf-feba-4f98-ad04-d11c479e8466`.
2. Download and inspect the resulting signed APK.
3. Connect the TECNO CLA5 in data mode with USB debugging and accept authorization.
4. Install the EAS APK and collect sanitized launch/runtime evidence.
5. Provide authorized test accounts and reset mailbox access.
6. Execute the physical authentication, session/logout, and network matrices.
7. Provide an approved production deployment mechanism for isolated commit
   `3874afd7`, then verify the live safe health response.
