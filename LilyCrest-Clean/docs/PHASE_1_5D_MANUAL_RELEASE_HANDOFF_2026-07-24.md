# Phase 1.5D — Manual Release Handoff

Prepared: 2026-07-24 (Asia/Singapore)

## Handoff decision

READY FOR MANUAL RELEASE ACTIONS

This means the instructions and test sheets are ready. It does not mean Phase 1.5
has passed. The EAS build is still queued and the health endpoint is not deployed.

## Current evidence

- EAS build: `e41251cf-feba-4f98-ad04-d11c479e8466`
- Current EAS state: `IN_QUEUE`
- Remote artifact: unavailable
- Device: TECNO CLA5 is now ADB-authorized (`device`)
- Installed app: `com.lilycrest.lilycrestdorm`, version 1.0.0, build 1
- Local APK and installed app signing certificate: matching
- Live health endpoint: HTTP 200, legacy verbose response
- Isolated health commit: `3874afd7f74876bb457c3c62f8aa1ff55025bcab`
- Automated regression checks: passing

## 1. EAS monitoring guide

From `D:\LilyCrest\LilyCrest-Clean\frontend`:

```powershell
npx.cmd eas-cli build:view e41251cf-feba-4f98-ad04-d11c479e8466 --json
```

Dashboard:

`https://expo.dev/accounts/leigh_23/projects/frontend/builds/e41251cf-feba-4f98-ad04-d11c479e8466`

Status meanings:

- `IN_QUEUE`: accepted but no builder assigned. Keep waiting.
- `IN_PROGRESS`: builder is running. Follow the Run Gradle/build phases.
- `FINISHED`: build completed; confirm an APK artifact exists.
- `ERRORED`: retrieve logs and identify the first actionable error.
- `CANCELED`: no artifact; determine who canceled it before resubmitting.

Do not run another `eas build` while this record is `IN_QUEUE` or `IN_PROGRESS`.

### Download after `FINISHED`

This PowerShell sequence downloads without printing the signed artifact URL:

```powershell
$build = npx.cmd eas-cli build:view e41251cf-feba-4f98-ad04-d11c479e8466 --json 2>$null |
  Out-String |
  ConvertFrom-Json

if ($build.status -ne 'FINISHED' -or -not $build.artifacts.buildUrl) {
  throw "EAS APK is not ready."
}

$releaseDir = 'D:\LilyCrest\LilyCrest-Clean\frontend\builds'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$remoteApk = Join-Path $releaseDir 'LilyCrest-Preview-e41251cf.apk'
Invoke-WebRequest -Uri $build.artifacts.buildUrl -OutFile $remoteApk
```

Verify APK—not AAB:

```powershell
$aapt = Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk\build-tools" -Recurse -Filter aapt.exe |
  Sort-Object FullName -Descending |
  Select-Object -First 1

& $aapt.FullName dump badging $remoteApk | Select-Object -First 4
Get-Item $remoteApk | Format-List Name,Length,LastWriteTime
Get-FileHash -Algorithm SHA256 $remoteApk
```

Expected badging:

- package: `com.lilycrest.lilycrestdorm`
- version name: `1.0.0`
- version code: `1`
- file extension/type: `.apk`

### Queue decision checklist

KEEP WAITING when:

- Expo reports EAS Build operational;
- the record is active and has not exceeded the account's normal queue range;
- no cancellation/failure exists;
- queue timestamps continue to be plausible.

CANCEL AND RESUBMIT only after release-owner approval when:

- the queue is materially beyond the normal historical range;
- Expo support/status identifies a stuck record;
- EAS advises cancellation;
- build configuration changed after submission and the queued archive is obsolete.

CONTACT EXPO SUPPORT when:

- the queue is unusually long while later comparable builds start;
- the record has contradictory/stale state;
- cancellation fails;
- the dashboard or CLI cannot retrieve the build.

Record the decision, approver, timestamp, and reason. Never create repeated
duplicates to test the queue.

## 2. Temporary local APK test guide

Label every result:

**LOCAL RELEASE BUILD — NOT THE FINAL REMOTE EAS ARTIFACT**

Verified local artifact:

| Field | Value |
|---|---|
| Path | `D:\LilyCrest\LilyCrest-Clean\frontend\android\app\build\outputs\apk\release\app-release.apk` |
| Size | 53,603,807 bytes |
| Package | `com.lilycrest.lilycrestdorm` |
| Version/build | 1.0.0 / 1 |
| Backend | `https://mobile-api.lilycrest.space` |
| SHA-256 | `0FD8E0FDE0430E5FE306ACF29FCEAB4C41B23EF146793C25ADA62C5E85C8E6E8` |
| Signer | Android Debug certificate |
| Certificate SHA-256 | `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |

The currently installed app has the same certificate, version, and build number.
A replacement install should therefore preserve data and avoid signature conflict.

The local APK may test:

- startup/runtime behavior;
- validation, rapid-tap guards, loading indicators, and navigation;
- authorized login, Forgot Password, session restoration, and logout;
- Wi-Fi/mobile/offline behavior;
- Android 15 and TECNO compatibility.

The local APK cannot approve:

- EAS credential signing;
- remote EAS artifact integrity;
- EAS artifact installation;
- final remote-build release acceptance.

## 3. TECNO CLA5 connection checklist

- [ ] Use a known USB data cable, not a charge-only cable.
- [ ] Unlock the phone.
- [ ] Open Settings → About phone and enable Developer Options if needed.
- [ ] Open Developer Options and enable USB debugging.
- [ ] Set the USB connection to File Transfer/MTP.
- [ ] Accept “Allow USB debugging” for this computer.
- [ ] Optionally select “Always allow” only if this is a trusted test computer.
- [ ] Check Windows Device Manager for Android/ADB or unknown devices.
- [ ] Reconnect the cable.
- [ ] Run the following:

```powershell
adb kill-server
adb start-server
adb devices -l
```

Status interpretation:

- `device`: authorized and ready.
- `unauthorized`: unlock the phone and accept the authorization prompt.
- `offline`: reconnect, change USB port/cable, then restart ADB.
- no device listed: check cable, USB mode, debugging, driver, and active ADB.

Current result:

```text
12782374AY101914  device  model:TECNO_CLA5
```

State: **AUTHORIZED**

## 4. Safe Windows ADB troubleshooting

Locate the active executable:

```powershell
Get-Command adb | Format-List Source
where.exe adb
```

Expected active path:

`C:\Users\leigh\AppData\Local\Android\Sdk\platform-tools\adb.exe`

Restart stale ADB:

```powershell
adb kill-server
adb start-server
adb devices -l
```

If Device Manager shows Unknown Device:

1. Disconnect and reconnect using a different known data cable/USB port.
2. Select File Transfer on the phone.
3. Check for an installed Android Composite ADB Interface/TECNO driver.
4. Ask the system administrator to install the manufacturer or approved Android USB
   driver. Do not install an unknown driver package.

If multiple ADB copies exist, close Android tooling and invoke the expected SDK copy
explicitly:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" kill-server
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" start-server
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices -l
```

If authorization never appears, use Developer Options → Revoke USB debugging
authorizations, reconnect, and accept the new prompt. This resets computer
authorization only; it does not wipe the phone. Do not factory-reset the device.

## 5. Local APK installation

First record the existing package:

```powershell
adb shell pm path com.lilycrest.lilycrestdorm
adb shell dumpsys package com.lilycrest.lilycrestdorm |
  Select-String 'versionCode=|versionName=|firstInstallTime=|lastUpdateTime='
```

Safe replacement:

```powershell
$localApk = 'D:\LilyCrest\LilyCrest-Clean\frontend\android\app\build\outputs\apk\release\app-release.apk'
adb install -r $localApk
```

Expected result: `Success`.

If `INSTALL_FAILED_UPDATE_INCOMPATIBLE` or a certificate mismatch occurs, stop.
Uninstalling clears LilyCrest's local tokens, preferences, and cached app data.
Obtain explicit confirmation before:

```powershell
adb uninstall com.lilycrest.lilycrestdorm
adb install $localApk
```

Installation evidence:

| Field | Record |
|---|---|
| Build label | LOCAL RELEASE BUILD — NOT THE FINAL REMOTE EAS ARTIFACT |
| Command | |
| Result | |
| Package | |
| Version/build | |
| Test timestamp/timezone | |
| Tester | |

## 6. Test-account requirements

Before starting authentication testing, obtain:

- [ ] authorized registered test email;
- [ ] current test password;
- [ ] inbox access;
- [ ] permission to reset the password;
- [ ] confirmation this is not a real tenant account;
- [ ] optional second authorized test account for cache-isolation testing;
- [ ] approved unregistered test address for enumeration testing.

Never paste credentials into the report, logs, screenshots, shell history, or chat.

## 7. Physical test sheet

Allowed results: `PASSED`, `FAILED`, `PARTIALLY PASSED`,
`COULD NOT BE TESTED`.

Record test timestamp, network, build label, and sanitized evidence for each row.

| Area | Test | Expected | Result | Evidence/notes |
|---|---|---|---|---|
| Login | Valid credentials | Login and OTP/session flow succeeds | | |
| Login | Incorrect password | Safe incorrect-credentials message | | |
| Login | Invalid email | Frontend blocks request | | |
| Login | Empty email | Required-field validation | | |
| Login | Empty password | Required-field validation | | |
| Login | Rapid taps | One request/navigation only | | |
| Login | Loading | Button disabled and spinner shown | | |
| Login | Navigation | Correct authenticated home | | |
| Login | Force-close/reopen | Valid session restored after loading | | |
| Forgot Password | Registered address | Required enumeration-safe message | | |
| Forgot Password | Unregistered address | Identical safe message | | |
| Forgot Password | Invalid address | Validation error, no request | | |
| Forgot Password | Empty address | Required-field error | | |
| Forgot Password | Rapid taps | One reset request | | |
| Forgot Password | Email delivery | Actual reset email received | | |
| Forgot Password | Reset link | Opens correct compatible page | | |
| Forgot Password | Change password | Reset succeeds | | |
| Forgot Password | New password | Login succeeds | | |
| Session | Protected flash | No protected UI before auth resolution | | |
| Session | Invalid session | Returns safely to Login | | |
| Logout | Clear session/data | Returns to Login with cache cleared | | |
| Logout | Android Back | Protected screens do not reopen | | |
| Account isolation | Second account | No previous profile/tenant data | | |

Required reset success text:

`If an account exists for this email, a password reset link has been sent.`

## 8. Network test sheet

| Feature | Primary Wi-Fi | Mobile data | Offline | Alternative Wi-Fi | Slow/unstable |
|---|---|---|---|---|---|
| Login | | | | | |
| Forgot Password | | | | | |
| Profile load | | | | | |
| Session restore | | | | | |
| Logout | | | | | |

For every cell use only `PASSED`, `FAILED`, `PARTIALLY PASSED`, or
`COULD NOT BE TESTED`. Record the network name/type and timestamp separately.

Offline expectations:

- login/reset shows the safe offline message;
- the app does not crash or loop;
- no other account's cached profile appears;
- retry becomes possible after reconnection.

## 9. Health deployment handoff

| Field | Value/to complete |
|---|---|
| Branch | `codex/phase-1.5c-health-only` |
| Commit | `3874afd7f74876bb457c3c62f8aa1ff55025bcab` |
| Exact file | `LilyCrest-Clean/backend/routes/index.js` |
| Scope | One file; one insertion; eight deletions |
| Expected response | `{ "status": "ok" }` |
| Syntax check | Passed |
| Development backend tests | 60 passed |
| Unrelated files | None in isolated commit |
| Hosting platform | `[RELEASE OWNER TO COMPLETE]` |
| Deployment command/workflow | `[RELEASE OWNER TO COMPLETE]` |
| Release owner | `[RELEASE OWNER TO COMPLETE]` |
| Approval reference | `[RELEASE OWNER TO COMPLETE]` |
| Deployment time | `[RELEASE OWNER TO COMPLETE]` |
| Rollback method | `[RELEASE OWNER TO COMPLETE]` |

The clean base commit has no npm test script; the 60-test development suite passed
against the current development tree. The release owner must apply the organization's
normal production verification gate before deployment.

Post-deployment verification:

```powershell
$response = Invoke-WebRequest `
  -Uri 'https://mobile-api.lilycrest.space/api/m/health' `
  -Method Get `
  -TimeoutSec 30

$response.StatusCode
$response.Headers['Content-Type']
$response.Content
```

Required:

- HTTP 200;
- JSON content type;
- exactly `{"status":"ok"}` semantically;
- no database, environment, server path, framework/auth, build, stack, or private
  configuration details.

## 10. Release-owner request

> Subject: Approval needed — isolated LilyCrest health endpoint release
>
> Please confirm the production backend hosting platform and authorized deployment
> workflow for `mobile-api.lilycrest.space`. I request approval to deploy only
> commit `3874afd7f74876bb457c3c62f8aa1ff55025bcab` from branch
> `codex/phase-1.5c-health-only`. It changes only the public health response to
> `{"status":"ok"}`. Please provide the release approval reference, required
> access, rollback procedure, and the authorized method for verifying production.

## 11. Remaining manual actions

1. Continue monitoring the existing EAS build; do not duplicate it.
2. Optionally install and test the labeled local APK using `adb install -r`.
3. Obtain authorized test accounts and mailbox/reset permission.
4. Complete the physical login, Forgot Password, session/logout, and network sheets.
5. When EAS finishes, download, verify, preserve, and install its APK separately.
6. Obtain release-owner approval and deploy only isolated health commit `3874afd7`.
7. Verify the live health response.
8. Re-evaluate Phase 1.5 only after all completion gates have evidence.

Phase 1.5 remains:

`AUTHENTICATION AND NETWORK STABILITY NOT PASSED`
