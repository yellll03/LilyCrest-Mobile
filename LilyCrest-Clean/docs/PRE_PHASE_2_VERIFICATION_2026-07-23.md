# Pre-Phase 2 Migration and APK Verification Report

Date: 2026-07-23  
Environment: Production database (dry-run only), EAS preview build  
Readiness: **Not ready for Phase 2**

## Migration Result

The production database was inspected using the read-only command:

```text
npm run users:backfill-usernames:dry-run
```

| Metric | Result |
|---|---:|
| Total users scanned | 42 |
| Already normalized | 0 |
| Requiring update | 41 |
| Missing usernames | 0 |
| Invalid usernames | 1 |
| Duplicate groups | 0 |
| Updated | 0 (dry-run) |
| Failed updates | 0 |
| Unique index | Not attempted |

One applicant account uses a legacy username containing a hyphen:

| Field | Administrative review value |
|---|---|
| User ID | `user_6f4c47558038` |
| Current username | `lilycrest-test5084` |
| Masked email | `li************@mailinator.com` |
| Role | Applicant |
| Status | Unknown/legacy |
| Created | 2026-05-19T17:55:59.432Z |
| Invalid reason | Hyphens are not in the allowed username character set |

Availability was checked case-insensitively against all current usernames. These candidates are valid and currently available, but none has been assigned:

- `lilycrest_test5084`
- `lilycrest.test5084`
- `lilycresttest5084`

Production writes were not run because:

1. A legacy invalid username remains unresolved.
2. A verified database backup was not confirmed.
3. The unique index preconditions are not satisfied.

The configured deployment is MongoDB Atlas-compatible (`mongodb+srv`) and the production database is `lilycrest-dormitory`. Safe backup procedure:

1. In MongoDB Atlas, open the production cluster and confirm Cloud Backup is enabled.
2. Create an on-demand snapshot before migration, or verify a recent completed snapshot whose restore window covers the migration.
3. Record the snapshot ID/reference, completion timestamp, database/cluster, storage/region, and confirmer. Do not copy credentials into this report.
4. Verify the snapshot status is completed and that the project has a documented restore procedure.
5. Alternatively, from an access-controlled host with Database Tools installed, run `mongodump` with the protected Atlas URI, `--db lilycrest-dormitory`, and `--archive` plus `--gzip`; store the archive in approved encrypted storage and verify it with `mongorestore --dryRun` where supported or a restore into an isolated non-production database.

Backup verification fields remain pending: method, date/time, status, reference/location, and person confirming.

After administrative resolution and backup verification:

```text
npm run users:backfill-usernames:dry-run
npm run users:backfill-usernames
```

The write command requires `--confirm` through the package script and creates `username_normalized_unique` only when no duplicate, missing, invalid, failed, or interrupted records remain.

## APK Build

| Field | Value |
|---|---|
| Build type | EAS Android preview APK |
| Build ID | `8b1887b8-5d43-401e-97f5-f8261066b828` |
| Build date | 2026-07-23 |
| Package | `com.lilycrest.lilycrestdorm` |
| App version/build | `1.0.0` / `1` |
| SDK | Expo 54 |
| API environment | Preview using production mobile API |
| Backend domain | `mobile-api.lilycrest.space` |
| Firebase configuration | Android configuration present; package matches |
| Device detected | TECNO TECNO CLA5 (ADB authorized) |
| Android version | Android 15 / API 35 |

Preflight confirmed the selected API is public HTTPS. Runtime guards reject localhost/private production URLs. Source matches for localhost and HTTP are limited to URL-rejection logic, tests, Android XML namespaces, and license text.

## Physical Device and Network Test Report

An authorized TECNO CLA5 is now connected. The previous LilyCrest package is installed, but the fresh build remains queued and therefore has not yet been installed or tested. Consequently, none of the following cases is reported as passed.

| Feature | Test Case | Network | Expected Result | Actual Result | Status | Notes |
|---|---|---|---|---|---|---|
| Login | Valid credentials | Primary Wi-Fi | Tenant signs in | Not executed | Could not be tested | Physical device and test credentials unavailable |
| Login | Incorrect password and field validation | Primary Wi-Fi | Safe error; invalid input blocked | Not executed | Could not be tested | Physical device unavailable |
| Login | Repeated taps | Primary Wi-Fi | One request; loading shown | Not executed | Could not be tested | Physical device unavailable |
| Login | Offline/server unavailable/slow | Offline/unstable | Correct safe network error; no crash | Not executed | Could not be tested | Physical device unavailable |
| Login | Cross-network access | Other Wi-Fi/mobile data | Login works outside local network | Not executed | Could not be tested | Physical device unavailable |
| Forgot password | Registered and unregistered email | Primary Wi-Fi | Enumeration-safe success response | Not executed | Could not be tested | Physical device and mailbox unavailable |
| Forgot password | Invalid/empty/repeated taps | Primary Wi-Fi | Validation and single request | Not executed | Could not be tested | Physical device unavailable |
| Forgot password | Reset email and link | Wi-Fi/mobile data | Email received; link opens | Not executed | Could not be tested | Mailbox and physical device unavailable |
| Profile | Approved address/read-only/missing address | Primary Wi-Fi | Authoritative safe display | Not executed | Could not be tested | Seed accounts and physical device unavailable |
| Branch | Correct branch and Maps navigation | Primary Wi-Fi | Correct tenant branch opens | Not executed | Could not be tested | Physical device unavailable |
| Username | Validation, duplicate and cooldown cases | Primary Wi-Fi | Frontend/backend enforcement | Not executed | Could not be tested | Production mutation not appropriate; device unavailable |
| Contract | Empty and partial states | Primary Wi-Fi | Safe tenant-scoped rendering | Not executed | Could not be tested | Seed accounts and physical device unavailable |
| Survey | Empty/quarterly/move-out states | Primary Wi-Fi | UI-only safe rendering | Not executed | Could not be tested | Seed accounts and physical device unavailable |
| Profile suite | Data fetches | Other Wi-Fi/mobile/offline/slow | Consistent behavior and safe errors | Not executed | Could not be tested | Physical device unavailable |

## Issues

### Invalid legacy username blocks migration

- Steps: Run the username backfill dry-run against production.
- Expected: Every username satisfies the current 3–30 character `[A-Za-z0-9_.]` rule.
- Actual: One applicant username contains a hyphen.
- Severity: High (release gate).
- Error: Reported under `invalidUsernames`; no secret data is stored in this report.
- Suggested fix: Administrator assigns an approved valid username, then re-run the dry-run.

### Production backup and migration confirmation unavailable

- Steps: Review prerequisites for production write mode.
- Expected: Verified backup and explicit confirmation before writes.
- Actual: Neither was confirmed during this run.
- Severity: High (operational safety gate).
- Suggested fix: Create and verify a backup, then run the confirmed migration.

### Fresh physical Android verification pending

- Steps: Run `adb devices -l`.
- Expected: Fresh preview APK installed on an authorized physical Android device.
- Actual: TECNO CLA5 running Android 15 is authorized, but the fresh EAS artifact is not yet available.
- Severity: High (release gate).
- Suggested fix: When the queued artifact completes, install it and execute the matrix above on primary Wi-Fi, another Wi-Fi, mobile data, offline, and slow/unstable connections.

## Readiness Decision

**Not ready for Phase 2.**

The database dry-run found no duplicates, but one invalid username remains, the unique index has not been created, and login/password reset/profile behavior has not been verified on a physical Android device across the required networks.

## Contract Template Preparation

No lease contract template file was present in the workspace or supplied as an attachment in this run. The following is the required selection matrix, but template filenames remain unverified until the actual read-only templates are provided.

| Room Type | Lease Type | Contract Template |
|---|---|---|
| Private Room | Short Term | Private Room — Short Term (template file pending) |
| Private Room | Long Term | Private Room — Long Term (template file pending) |
| Double Sharing | Short Term | Double Sharing — Short Term (template file pending) |
| Double Sharing | Long Term | Double Sharing — Long Term (template file pending) |
| Quadruple Sharing | Short Term | Quadruple Sharing — Short Term (template file pending) |
| Quadruple Sharing | Long Term | Quadruple Sharing — Long Term (template file pending) |

Selection must use canonical database enums for `roomType` and `leaseType`, reject unsupported combinations, and never guess a template from display text.

Required dynamic fields:

- Tenant name and approved-application address
- Contract generation/signing date
- Room number and bed/slot number
- Branch name and complete branch address
- Standard monthly rental and applicable promo rate
- Security deposit, advance rent, and reservation fee
- Contract start date, end date, and calculated lease duration
- Contract status
- Stable tenant, reservation, room, branch, and contract identifiers for traceability (not necessarily displayed)

Before Phase 2 implementation, each real template must be inspected for exact labels, date/currency formatting, repeated fields, signature blocks, conditional clauses, page layout, and whether a promo or bed/slot field is applicable.
