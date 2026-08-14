# Phase 2A Stage 1B — Identity and Branch Approval Preparation Result

Date: 2026-07-23  
Mode: Lockdown  
Production writes: None  
Stage 2 started: No

## Implemented

- Manual identity-review queue with controlled review statuses.
- Exact-evidence-only candidate and approval rules.
- Guarded identity approval command that stores a separate crosswalk decision.
- Stale source-state detection using a SHA-256 source-state hash.
- Inactive/deleted user protection.
- Idempotent identity decisions and structured audit records.
- JSON, CSV, and Markdown administrator-review exports.
- Identity-resolution coverage report.
- Gil Puyat and Guadalupe legal approval worksheets.
- Exact Gil Puyat template-wording verification.
- Guadalupe template isolation.
- Guarded, idempotent branch approval command.
- Tests covering Stage 1B safety and no-guessing requirements.

No tenant, stay, pricing, contract, readiness endpoint, PDF, or template work was added.

## Identity review results

| Metric | Result |
|---|---:|
| Total identity records | 176 |
| Automatically resolved | 101 |
| Pending manual review | 75 |
| Unresolved with no exact candidate | 75 |
| Ambiguous | 0 |
| Deleted-account candidates | 0 |
| Approved manual resolutions | 0 |
| Records in fields with mixed ID storage types | 175 |

Pending queue:

| Source | Count | Blocker |
|---|---:|---|
| `reservations` | 70 | `RESERVATION_OWNER_UNRESOLVED` |
| `bedhistories` | 4 | `TENANT_IDENTITY_UNRESOLVED` |
| `rooms.beds[].occupiedBy.userId` | 1 | `TENANT_IDENTITY_UNRESOLVED` |

No email, username, display name, phone, room, branch, or fuzzy match was used. All 75 pending records remain unresolved because no exact candidate exists.

Exports:

- `backend/reports/phase2a-stage1b/identity-manual-review-queue.json`
- `backend/reports/phase2a-stage1b/identity-manual-review-queue.csv`
- `backend/reports/phase2a-stage1b/identity-review-summary.md`
- `backend/reports/phase2a-stage1b/identity-resolution-coverage.json`

The Markdown summary excludes raw identity values and contacts. JSON/CSV review exports preserve source IDs and raw identity IDs for controlled administrator review. Candidate contact values, if present in a future ambiguous case, are masked.

## Identity approval command

```text
npm run identity-crosswalk:approve -- \
  --source-collection <reservations|bedhistories|stays|rooms> \
  --source-record-id <source-id> \
  --selected-user-id <users._id> \
  --administrator "<name>" \
  --approval-reference <reference> \
  --reason "<review reason>" \
  --evidence-type <APPROVED_EXPLICIT_MAPPING|VERIFIED_RESERVATION_USER_MIGRATION> \
  --evidence-reference <reference> \
  --expected-source-hash <queue sourceStateHash> \
  --backup-reference <verified backup> \
  --batch-id <migration batch> \
  --confirm
```

Before writing, the command:

1. validates every approval and backup input;
2. rereads the source record;
3. compares its current hash with the review queue;
4. rereads the selected canonical user;
5. rejects inactive/deleted targets unless explicitly authorized;
6. reruns automatic exact-identifier resolution;
7. rejects stale or conflicting decisions;
8. writes only `contract_identity_crosswalk`;
9. writes a redacted `IDENTITY_CROSSWALK_RESOLVED` audit event;
10. does not modify the source identity field.

The command was not executed with valid inputs. An intentionally incomplete invocation was rejected before database connection.

## Branch legal approval pack

Exports:

- `backend/reports/phase2a-stage1b/branch-legal-approval-worksheets.json`
- `backend/reports/phase2a-stage1b/branch-legal-approval-worksheets.csv`
- `backend/reports/phase2a-stage1b/branch-legal-approval-pack.md`

### Gil Puyat

The worksheet leaves canonical legal fields blank and provides the following comparison reference from the approved templates:

```text
LILYCREST GIL PUYAT
#7 Gil Puyat Ave. corner Marconi St., Makati City
```

Approval validation requires exact wording. It does not normalize or silently alter the wording.

Pending checklist:

- legal name match;
- legal address match;
- slug mapping;
- coordinates verification;
- template mapping;
- legal-owner approval;
- approval reference.

### Guadalupe

- Legal name remains blank.
- Legal address remains blank.
- Supported templates remain empty.
- Gil Puyat templates are explicitly rejected.
- Current blockers are `BRANCH_LEGAL_DATA_MISSING` and `TEMPLATE_BRANCH_MISMATCH`.

## Branch approval command

```text
npm run branches:approve -- \
  --branch-key <stable-id> \
  --slug <slug> \
  --legal-name "<verified legal name>" \
  --display-name "<approved display name>" \
  --address-line1 "<verified line>" \
  --barangay "<verified barangay>" \
  --city "<verified city>" \
  --country Philippines \
  --formatted-address "<exact approved wording>" \
  --status ACTIVE \
  --supported-template-keys <comma-separated keys> \
  --source-document-reference <reference> \
  --administrator-id <users._id> \
  --administrator "<name>" \
  --approval-reference <reference> \
  --backup-reference <verified backup> \
  --batch-id <migration batch> \
  --confirm
```

Optional address, coordinate, and approval-date arguments are supported. The command rejects blank legal data, unsupported templates, Guadalupe/Gil Puyat template inheritance, conflicting existing records, and missing approval gates. Repeating the same approved record is idempotent; changed legal data is never silently overwritten.

The command was not executed with valid inputs. An intentionally incomplete invocation was rejected before database connection.

## Audit structures

Identity resolution audit:

```javascript
{
  action: "IDENTITY_CROSSWALK_RESOLVED",
  sourceCollection,
  sourceRecordId,
  selectedUserId,
  administrator,
  approvalReference,
  reason,
  evidence,
  beforeStatus,
  afterStatus,
  migrationBatchId,
  sourceStateHash,
  createdAt
}
```

Branch approval uses the existing hash-based administrative audit structure and does not store full before/after legal records or source documents.

## Test result

```text
51 passed
0 failed
```

This includes all existing backend tests and new coverage for:

- exact canonical user selection;
- prohibited email-style evidence;
- stale review rejection;
- inactive/deleted target rejection;
- administrator, approval, confirmation, and backup gates;
- audit redaction;
- dry-run non-mutation;
- exact Gil Puyat wording;
- Guadalupe template isolation;
- blank legal address and unsupported-template rejection;
- identity and branch idempotency;
- conflicting branch overwrite prevention;
- source-ID preservation.

## Remaining blockers

1. Seventy reservation identities have no exact candidate.
2. Five assignment identities have no exact candidate.
3. No manual identity disposition has been approved.
4. Gil Puyat canonical legal data has not been approved.
5. Guadalupe legal data is missing and the branch has no approved templates.
6. Branch compatibility approvals are not recorded in production.
7. No verified backup or production-write authorization was supplied.
8. Private-room bed/slot policy remains unresolved for later stages.

## Decision

**NOT READY FOR PHASE 2A STAGE 2**

Stage 1B tooling is ready for controlled administrator/legal review, but Stage 2 gates remain open. Stage 2 was not started.

