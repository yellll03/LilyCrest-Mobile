# Phase 4A — Branch Location Management

## Outcome

The tenant application now consumes one backend-resolved branch location object. Branch selection is never performed by a screen or by the chatbot.

Current release status: **BRANCH LOCATION MANAGEMENT NOT PASSED**

The code and automated verification pass, but the production database has no canonical `gil-puyat` or `guadalupe` branch record. A dry run therefore cannot attach the approved location metadata. The Gil Puyat direct official Google Maps URL and approved coordinates also remain unavailable.

## Authoritative data model

The `branches` collection is authoritative. Its mobile-safe location projection is:

```text
branchId
branchCode
branchName
branchAddress
latitude
longitude
googleMapsUrl
isActive
```

Canonical branch writes now populate these fields while retaining the existing legal-name, legal-address, coordinates, approval, and audit fields. A branch is not exposed unless it is active and has an ID, code, name, address, and approved HTTPS Google Maps URL.

## Resolution flow

```text
Authenticated tenant
        |
        v
Current active stay
        |
        v (when absent)
Approved contract
        |
        v (when absent)
Approved reservation
        |
        +--> no assignment: safe unavailable state
        +--> multiple branches at one tier: 409 conflict
        +--> one branch: resolve canonical branches record
```

Only exact authenticated-user identifiers are queried. Email matching, profile fallbacks, and guessed/default branches are not used.

## Consumer updates

- Profile displays the canonical name and complete address. The Maps action opens only `googleMapsUrl`, verifies it can be opened, and is disabled when branch data is unavailable.
- Home and About use the same authenticated profile projection and safe empty state.
- Contract Viewer reads branch name and address only from the canonical profile branch.
- Document preview metadata uses that same branch projection.
- Authentication/session hydration refreshes `/users/me`, so all mobile consumers receive the resolved branch rather than a stale login payload.
- The chatbot detects branch/location questions and returns a deterministic response from the same resolver. It does not ask the language model to infer a branch.

## Validation rules

| Condition | Result |
|---|---|
| No authoritative assignment | `Branch location is not available yet.` |
| Multiple branches in the same priority tier | HTTP 409; contact-admin message |
| Missing canonical branch | Safe unavailable state |
| Inactive or incomplete branch | Safe unavailable state |
| Invalid or non-HTTPS Maps URL during canonical write | Validation failure |
| Maps URL cannot be opened by the device | User-friendly alert; no fallback destination |

## Data deployment

`backend/scripts/applyBranchLocations.js` is dry-run by default and updates existing approved canonical records only when invoked with `--confirm`. It deliberately does not create canonical branches or bypass branch approval.

Dry-run result on 2026-07-24:

```text
gil-puyat  BLOCKED_MISSING_CANONICAL_BRANCH
guadalupe  BLOCKED_MISSING_CANONICAL_BRANCH
```

## Verification

- Backend: 71/71 tests passed.
- Frontend: 54/54 tests passed.
- Expo lint: passed.
- Node syntax checks: passed.
- UI source scan: no hardcoded Maps URLs, geo URLs, Gil Puyat address, or Maps fallback remained in UI components.
- Resolver coverage includes priority, conflict rejection, Guadalupe mapping, missing/inactive/incomplete data, and a future branch added without UI changes.

## Remaining blockers

1. Create and approve canonical branch records for Gil Puyat and Guadalupe through the existing administrative approval process.
2. Confirm the official direct Gil Puyat Google Maps URL; the staging record currently contains an address-search URL because no previously configured official URL was found.
3. Approve latitude/longitude values for both branches.
4. Run the location application script with `--confirm`, then verify both branches on physical devices.

No authentication policy, reservation workflow, payment logic, survey logic, contract-generation logic, or canonical migration workflow was changed for this phase.
