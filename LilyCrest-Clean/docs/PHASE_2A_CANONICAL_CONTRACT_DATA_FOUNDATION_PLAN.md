# Phase 2A — Canonical Contract Data Foundation Implementation Plan

Status: Implementation-ready design; no deployment performed  
Prepared: 2026-07-23  
Source of truth: Phase 2 canonical contract audit and verified template mapping  
Contract-generation readiness: **NO**  
Canonical-data implementation readiness: **YES, with the gates and unresolved decisions in this document**

## 1. Scope and safety boundaries

This plan defines the database and application contracts required before lease-contract generation can be implemented.

This phase does not:

- generate a contract;
- modify an official PDF template;
- write to production;
- deploy a schema or create an index;
- infer missing tenant, address, branch, assignment, date, or price data;
- treat a preference, display value, username, email, room number, or branch name as ownership evidence.

Every future migration specified here must default to dry-run mode. Production apply mode requires a verified backup, an explicit confirmation flag, a unique batch ID, a conflict report, and an audit record.

## 2. Canonical enums

Enums are stored using the uppercase values below. Comparisons are exact and case-sensitive after validation. Unknown values do not receive a default.

### 2.1 Room type

```text
PRIVATE_ROOM
DOUBLE_SHARING
QUADRUPLE_SHARING
```

Exact legacy mapping:

| Legacy `rooms.type` | Canonical value |
|---|---|
| `private` | `PRIVATE_ROOM` |
| `double-sharing` | `DOUBLE_SHARING` |
| `quadruple-sharing` | `QUADRUPLE_SHARING` |

Null, blank, differently spelled, or otherwise unknown values produce `ROOM_TYPE_UNSUPPORTED`.

`reservations.preferredRoomType` is a preference and is never assignment authority.

### 2.2 Lease type

```text
SHORT_TERM
LONG_TERM
```

Rules:

- `SHORT_TERM`: at least one complete contractual month and fewer than six complete contractual months.
- `LONG_TERM`: six or more complete contractual months.
- Classification is prohibited until approved start and end dates exist.
- A stored lease type must agree with the dates and canonical duration.
- An exact whole-month period is required for automatic classification. Non-whole-month terms require an approved exception record; they are not rounded.

### 2.3 Contract status

```text
DRAFT
UNDER_REVIEW
APPROVED
ACTIVE
EXPIRED
TERMINATED
VOID
```

### 2.4 Supporting enums

```text
BRANCH_STATUS       = ACTIVE | INACTIVE
TENANT_STATUS       = ACTIVE | INACTIVE | MOVED_OUT
IDENTITY_STATUS     = PENDING | VERIFIED | REJECTED
ASSIGNMENT_STATUS   = PENDING | ACTIVE | TRANSFERRED | COMPLETED | CANCELLED
RESOLUTION_STATUS   = RESOLVED | UNRESOLVED | AMBIGUOUS | DELETED_ACCOUNT
PRICING_SOURCE      = APPROVED_RESERVATION | APPROVED_RATE_CARD | APPROVED_EXCEPTION
```

## 3. Contract state machine

The service must reject every transition not listed here.

| From | To | Authorized role | Preconditions |
|---|---|---|---|
| none | `DRAFT` | Contract Admin, System Service acting for Contract Admin | Readiness passed; source IDs and template hash recorded |
| `DRAFT` | `UNDER_REVIEW` | Contract Admin | Draft snapshot complete; no unresolved blocker |
| `DRAFT` | `VOID` | Contract Admin | Reason required |
| `UNDER_REVIEW` | `DRAFT` | Contract Reviewer | Rejection/correction reason required; approved snapshot does not yet exist |
| `UNDER_REVIEW` | `APPROVED` | Contract Approver | Reviewer is authorized; immutable snapshot atomically persisted |
| `UNDER_REVIEW` | `VOID` | Contract Approver | Reason required |
| `APPROVED` | `ACTIVE` | Contract Approver | Required signatures/execution evidence recorded according to approved workflow |
| `APPROVED` | `VOID` | Contract Approver | Legal/admin reason required; never delete the record |
| `ACTIVE` | `EXPIRED` | System Service or Contract Admin | Contract end date has passed under the date policy |
| `ACTIVE` | `TERMINATED` | Contract Approver | Effective date, authority, and reason required |
| `ACTIVE` | `VOID` | Legal Administrator only | Exceptional legal invalidation; reason and audit event required |

Terminal statuses are `EXPIRED`, `TERMINATED`, and `VOID`. A terminal contract cannot return to a non-terminal state. A correction requires a new contract version linked to the superseded record.

Role names are capability labels, not assumptions about the current `users.role` values. Phase 2 implementation must map capabilities to the existing authorization system explicitly.

## 4. Canonical date policy

### 4.1 Meaning and storage

- Contract start and end dates are **date-only business values**, not instants selected by a client device.
- MongoDB stores them as BSON `Date` values normalized to `00:00:00.000Z`.
- Only the server converts approved `YYYY-MM-DD` input to BSON dates.
- The legal/display timezone is `Asia/Manila`.
- API date-only fields serialize as `YYYY-MM-DD`, not locale-dependent timestamps.
- Client timezone, device clock, and browser locale are never authoritative.

The UTC-midnight convention is a storage encoding for a date-only value. Application code must not display it through generic local-time formatting.

### 4.2 Inclusivity

- `contractStartDate` is inclusive.
- `contractEndDate` is inclusive.
- A tenant occupies the assignment on both boundary dates unless a separately approved termination/transfer event changes the occupancy.

### 4.3 Duration calculation

`leaseDurationMonths` is calculated only from approved dates:

1. Confirm both values are valid canonical date-only values.
2. Confirm end date is on or after start date.
3. Find the positive integer month count whose inclusive contractual end matches the end date.
4. The ordinary end is the day immediately before the same day-of-month after `N` calendar months.
5. When that day-of-month does not exist in the target month, the contractual month ends on the target month's final calendar day.
6. Do not round days to months and do not use a fixed 30-day month.

Examples:

| Start | Duration | Valid inclusive end |
|---|---:|---|
| 2026-01-01 | 1 | 2026-01-31 |
| 2026-01-15 | 1 | 2026-02-14 |
| 2026-01-31 | 1 | 2026-02-28 |
| 2028-01-31 | 1 | 2028-02-29 |
| 2026-08-31 | 6 | 2027-02-28 |

Leap days are real calendar dates. A period beginning on February 29 uses the same last-day-of-month rule in a non-leap target year.

If an approved legal term intentionally does not fit this whole-month policy, store the explicit dates and an approved exception. Do not silently manufacture a month count or lease type.

### 4.4 Invalid handling

| Condition | Blocker |
|---|---|
| Start or end missing | `LEASE_DATES_MISSING` |
| Unparseable value, impossible date, end before start, or noncanonical time | `LEASE_DATE_INVALID` |
| Stored duration differs from calculated duration | `LEASE_DURATION_MISMATCH` |
| Stored lease type differs from calculated category | `LEASE_TYPE_MISMATCH` |

An end date must never be calculated from a nullable or unapproved legacy duration.

## 5. Canonical currency policy

### 5.1 Representation

All contract money is stored as integer centavos using a signed 64-bit integer representation (`Long` in MongoDB).

Example: PHP 14,400.00 is stored as `1440000`.

Reasons:

- no IEEE-754 floating-point error;
- exact equality with approved template amounts;
- deterministic comparison and audit hashing;
- sufficient range for contract pricing.

API input and output use decimal strings such as `"14400.00"` at administrative boundaries. Conversion to centavos occurs on the server.

### 5.2 Pricing object

```javascript
pricing: {
  regularMonthlyRentalCentavos: Long,
  promoMonthlyRentalCentavos: Long | null,
  approvedMonthlyRentalCentavos: Long,
  securityDepositCentavos: Long,
  advanceRentCentavos: Long,
  reservationFeeCentavos: Long,
  currency: "PHP",
  pricingSource: "APPROVED_RESERVATION"
    | "APPROVED_RATE_CARD"
    | "APPROVED_EXCEPTION",
  pricingSourceId: ObjectId | null,
  pricingApprovedBy: ObjectId,
  pricingApprovedAt: Date,
  exception: {
    reason: string,
    approvedBy: ObjectId,
    approvedAt: Date
  } | null
}
```

Required fields:

- regular monthly rental;
- approved monthly rental;
- security deposit;
- advance rent;
- reservation fee;
- currency;
- pricing source, approver, and approval time.

Promo handling:

- A promo is optional.
- No discount is represented by `promoMonthlyRentalCentavos: null` and `approvedMonthlyRentalCentavos == regularMonthlyRentalCentavos`.
- Zero does not mean “no promo” and is rejected unless a formally approved free-rent exception exists.
- When a promo applies, the approved monthly amount must equal the promo amount unless an approved exception explains the difference.

Rounding and validation:

- Values with more than two decimal places are rejected; they are not silently rounded.
- Percentage calculations use exact integer arithmetic and must produce an exact centavo result.
- If a formally approved calculation requires rounding, use round-half-up to the nearest centavo and record the unrounded inputs and rule in the pricing source.
- Negative values are invalid.
- Current `rooms.price`, `rooms.monthlyPrice`, or a later bill cannot overwrite an approved snapshot.
- Conflicting legacy amounts produce `PRICING_CONFLICT` and require review.

## 6. Canonical branch design

Collection: `branches`

```javascript
{
  _id: ObjectId,
  branchId: string,                  // stable public/internal business ID
  slug: string,                      // stable routing/display slug
  legalName: string,
  displayName: string,
  legalAddress: {
    addressLine1: string,
    addressLine2: string | null,
    barangay: string,
    city: string,
    province: string | null,
    postalCode: string | null,
    country: "Philippines",
    formattedAddress: string
  },
  coordinates: {
    latitude: number,
    longitude: number
  } | null,
  status: "ACTIVE" | "INACTIVE",
  supportedContractTemplates: [{
    templateKey: string,
    templateSha256: string,
    templateVersion: string,
    effectiveFrom: Date,
    effectiveTo: Date | null,
    verifiedBy: ObjectId,
    verifiedAt: Date
  }],
  legalDetailsVerifiedBy: ObjectId,
  legalDetailsVerifiedAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

Rules:

- `branchId` and `slug` are unique and immutable.
- Legal name/address require administrator or legal verification.
- `formattedAddress` is produced from verified structured components and stored for review; it is never built from a room slug.
- Room records must reference `branches._id` through canonical `branchId:ObjectId`. The legacy `rooms.branch` slug remains a migration alias.
- Template compatibility is explicit and hash-specific.
- The verified Gil Puyat branch may register the six approved Gil Puyat templates.
- Guadalupe returns `TEMPLATE_BRANCH_MISMATCH` until its legally approved templates are registered.

No actual branch legal name/address values are supplied by this plan.

## 7. Canonical tenant design

Collection: `tenants`

```javascript
{
  _id: ObjectId,
  tenantId: string,
  userId: ObjectId,
  sourceReservationId: ObjectId,
  legalIdentity: {
    legalFullName: string,
    firstName: string,
    middleName: string | null,
    lastName: string,
    suffix: string | null
  },
  residentialAddress: {
    addressLine1: string,
    addressLine2: string | null,
    barangay: string,
    city: string,
    province: string,
    postalCode: string | null,
    country: "Philippines",
    formattedAddress: string
  },
  identityVerification: {
    status: "PENDING" | "VERIFIED" | "REJECTED",
    verifiedBy: ObjectId | null,
    verifiedAt: Date | null,
    sourceDocumentIds: ObjectId[]
  },
  status: "ACTIVE" | "INACTIVE" | "MOVED_OUT",
  canonicalDataVersion: string,
  migrationBatchId: string | null,
  createdAt: Date,
  updatedAt: Date
}
```

Rules:

- `userId` references `users._id`, not `users.user_id`.
- `sourceReservationId` references the approved source reservation.
- Username, email prefix, nickname, and profile display name are prohibited legal-name sources.
- Editable profile address is prohibited as contract authority.
- `legalFullName` is rendered from separately reviewed components and is itself reviewed.
- Address formatting must operate on known scalar components. Passing an object into string coercion is prohibited.
- Contract readiness requires `identityVerification.status == VERIFIED`.
- A tenant update never mutates an approved contract snapshot.

## 8. Identity crosswalk

Temporary collection: `contract_identity_crosswalk`

```javascript
{
  _id: ObjectId,
  migrationBatchId: string,
  sourceCollection: string,
  sourceRecordId: string,
  sourceField: string,
  legacyIdentityValueHash: string,
  legacyIdentityType: "string" | "objectId" | "other",
  resolvedUserObjectId: ObjectId | null,
  resolutionStatus: "RESOLVED"
    | "UNRESOLVED"
    | "AMBIGUOUS"
    | "DELETED_ACCOUNT",
  evidence: [{
    type: string,
    sourceCollection: string,
    sourceRecordId: string,
    sourceField: string
  }],
  blockerCodes: string[],
  reviewedBy: ObjectId | null,
  reviewedAt: Date | null,
  createdAt: Date,
  updatedAt: Date
}
```

The collection stores a hash rather than duplicating a sensitive raw identifier in reports. An access-controlled conflict artifact may retain the original value where operationally necessary.

Allowed automated evidence:

- exact `ObjectId` equality with `users._id`;
- exact match to a unique, indexed `users.user_id`;
- an existing explicit record reference whose ownership chain is independently valid.

Prohibited evidence:

- display name;
- username;
- email equality, email similarity, or email prefix;
- phone-number similarity;
- room number;
- branch name or slug;
- reservation preference.

Each of the 149 reservations receives exactly one classification. Failure codes:

- `RESERVATION_OWNER_UNRESOLVED`
- `RESERVATION_OWNER_AMBIGUOUS`
- `TENANT_IDENTITY_UNRESOLVED`

No tenant record is created automatically for unresolved or ambiguous ownership.

## 9. Canonical stay and assignment design

Collection: `stays`

The existing collection is treated as legacy until migrated records satisfy this canonical version.

```javascript
{
  _id: ObjectId,
  stayId: string,
  tenantId: ObjectId,
  reservationId: ObjectId,
  branchId: ObjectId,
  roomId: ObjectId,
  bedId: string | null,
  slotNumber: string | null,
  roomType: "PRIVATE_ROOM" | "DOUBLE_SHARING" | "QUADRUPLE_SHARING",
  leaseType: "SHORT_TERM" | "LONG_TERM",
  leaseDurationMonths: number,
  contractStartDate: Date,
  contractEndDate: Date,
  assignmentStatus: "PENDING"
    | "ACTIVE"
    | "TRANSFERRED"
    | "COMPLETED"
    | "CANCELLED",
  sourceAssignmentRecords: [{
    collection: string,
    recordId: string
  }],
  approvedBy: ObjectId,
  approvedAt: Date,
  canonicalDataVersion: string,
  migrationBatchId: string | null,
  createdAt: Date,
  updatedAt: Date
}
```

Validation:

- Tenant's `sourceReservationId` equals `reservationId`.
- Reservation's resolved owner equals tenant's `userId`.
- Room exists and its canonical branch equals `branchId`.
- Non-null bed exists in `room.beds[]`.
- Shared rooms require a verified bed/slot.
- Reservation preference is not final assignment authority.
- No tenant has overlapping `PENDING` or `ACTIVE` occupancy periods unless an explicitly modeled transfer transaction permits a same-day boundary.
- No room/bed has overlapping active occupancy.
- Competing sources (`stays`, `bedhistories`, reservation assignment, embedded occupancy) produce `ASSIGNMENT_CONFLICT`.
- A migration never selects the “latest” competing source without review.

## 10. Private-room bed/slot decision record

Decision key: `PRIVATE_ROOM_BED_SLOT_POLICY`

Allowed decisions:

1. Private rooms have a real, inventory-backed bed/slot identifier.
2. Legally approved private-room templates remove the Bed/Slot field.
3. The contract owner formally approves another explicit value or deterministic rule.

Required decision record:

```javascript
{
  decisionKey: "PRIVATE_ROOM_BED_SLOT_POLICY",
  status: "PENDING" | "APPROVED" | "REJECTED",
  selectedOption: string | null,
  decisionText: string | null,
  approvedBy: ObjectId | null,
  approvedAt: Date | null,
  supportingDocumentIds: ObjectId[],
  effectiveFrom: Date | null,
  createdAt: Date,
  updatedAt: Date
}
```

Until approved, private-room readiness returns `PRIVATE_ROOM_BED_SLOT_UNRESOLVED`. The values `N/A`, blank, room number, or an invented bed number are prohibited.

## 11. Contract entity design

Collection: `contracts`

```javascript
{
  _id: ObjectId,
  contractId: string,
  version: number,
  supersedesContractId: ObjectId | null,
  tenantId: ObjectId,
  userId: ObjectId,
  reservationId: ObjectId,
  stayId: ObjectId,
  branchId: ObjectId,
  roomId: ObjectId,
  bedId: string | null,
  templateKey: string,
  templateSha256: string,
  templateVersion: string,
  status: "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "ACTIVE"
    | "EXPIRED" | "TERMINATED" | "VOID",
  snapshot: {
    tenantLegalFullName: string,
    residentialAddress: {
      addressLine1: string,
      addressLine2: string | null,
      barangay: string,
      city: string,
      province: string,
      postalCode: string | null,
      country: "Philippines",
      formattedAddress: string
    },
    branchLegalName: string,
    branchLegalAddress: object,
    roomNumber: string,
    roomType: string,
    bedOrSlotNumber: string,
    leaseType: string,
    leaseDurationMonths: number,
    contractStartDate: Date,
    contractEndDate: Date,
    pricing: object
  },
  draftFileUrl: string | null,
  finalFileUrl: string | null,
  generatedAt: Date | null,
  generatedBy: ObjectId | null,
  approvedAt: Date | null,
  approvedBy: ObjectId | null,
  activatedAt: Date | null,
  terminatedAt: Date | null,
  terminationReason: string | null,
  voidedAt: Date | null,
  voidReason: string | null,
  sourceDataVersion: string,
  sourceDataHash: string,
  migrationBatchId: string | null,
  createdAt: Date,
  updatedAt: Date
}
```

Invariants:

- All ownership IDs are resolved server-side.
- The selected template is derived only from verified room type, lease type, and branch compatibility.
- `templateSha256` must match the registered source before draft creation and approval.
- Approval atomically persists the immutable snapshot and approval audit event.
- Snapshot content cannot be updated after status becomes `APPROVED`.
- Profile, branch, room, assignment, rate-card, or template-registry changes do not rebuild an approved snapshot.
- Corrections create a new version and preserve the previous contract.

## 12. Readiness API contract

Proposed endpoints:

```text
GET /api/contracts/readiness/me
GET /api/admin/contracts/readiness?reservationId=<ObjectId>
```

No endpoint is implemented in this phase.

Tenant response:

```json
{
  "ready": false,
  "tenantId": "tenant_...",
  "reservationId": "64...",
  "stayId": null,
  "templateKey": null,
  "blockers": [
    {
      "code": "LEASE_DATES_MISSING",
      "field": "contractEndDate",
      "message": "Approved contract end date is missing."
    }
  ],
  "evaluatedAt": "2026-07-23T00:00:00.000Z",
  "dataVersion": "contract-foundation-v1"
}
```

Rules:

- Tenant identity comes only from the authenticated server session.
- The tenant endpoint accepts no tenant, user, reservation, stay, or contract ownership ID from the client.
- The admin endpoint requires explicit contract-read permission and resolves the supplied reservation through the canonical chain.
- Unauthorized/not-owned records return a generic not-found or forbidden result without existence or personal-data disclosure.
- Evaluation returns all blockers in deterministic code/field order.
- It never selects a fallback template.
- It exposes public blocker messages, not internal evidence, document IDs, conflicting values, or another tenant's data.
- `ready` is true only when the blocker list is empty.
- Readiness does not create a draft and has no write side effect.

## 13. Migration specifications

All migration commands follow this interface:

```text
node <migration> --dry-run --batch-id <unique-id>
node <migration> --apply --confirm-production --backup-ref <verified-ref> --batch-id <unique-id>
```

Apply mode must refuse to run without all apply flags. Batch IDs are immutable and unique. Every operation uses compare-and-set filters or upserts keyed by canonical unique identifiers.

### 13.1 Branch registry creation

- Input: legally verified branch registry file approved outside the migration.
- Dry run: validate unique IDs/slugs, address completeness, branch-slug mappings, and template hashes.
- Conflicts: unknown room branch slug, duplicate ID/slug, missing verification, invalid template mapping.
- Idempotency: upsert by `branchId`; reject material differences unless an explicit revision mode is approved.
- Audit: source checksum, verifier, counts, conflicts, batch ID.
- Rollback: delete batch-created records only when unreferenced; otherwise restore prior version from the batch journal.
- Zero-guess rule: do not derive legal address or name from `rooms.branch`.

### 13.2 Identity crosswalk

- Input: every reservation plus exact indexed user identities.
- Dry run: classify all 149 reservations and report resolved/unresolved/ambiguous/deleted counts.
- Conflicts: multiple exact targets, missing user, malformed identifier type.
- Idempotency: unique `(migrationBatchId, sourceCollection, sourceRecordId, sourceField)`.
- Audit: evidence types and value hashes, never public PII.
- Rollback: remove crosswalk rows for the batch; no source mutation.

### 13.3 Tenant canonicalization

- Input: resolved reservation owner, approved application, identity-verification decision.
- Dry run: validate name/address scalars, completeness, verification, and uniqueness.
- Conflicts: incomplete names/address, reservation/user mismatch, multiple approved sources, identity rejection.
- Idempotency: upsert by `sourceReservationId`; immutable source association after verification.
- Audit: source IDs, normalized-data hash, reviewer, batch ID.
- Rollback: remove unreferenced batch-created tenants; restore prior version from journal.

### 13.4 Assignment reconciliation

- Input: legacy `stays`, `bedhistories`, reservation assignments, and embedded room bed occupancy.
- Dry run: construct candidate chains and detect overlaps/competing sources.
- Conflicts: unresolved tenant, mismatched reservation, missing room/bed, branch mismatch, overlapping occupancy.
- Idempotency: unique `stayId`; source-record set hash prevents duplicates.
- Audit: all source record IDs and reviewer decision.
- Rollback: remove batch-created stays or restore journaled canonical fields.

### 13.5 Lease-date backfill

- Input: administratively approved start/end dates only.
- Dry run: parse dates, calculate duration, classify lease type, compare legacy values.
- Conflicts: missing/invalid dates, non-whole-month period without exception, type/duration mismatch.
- Idempotency: update only when canonical date fields are absent or equal.
- Audit: approved input record, calculated results, policy version.
- Rollback: restore previous fields from the batch journal.

### 13.6 Pricing snapshot backfill

- Input: approved reservation/rate-card/exception source.
- Dry run: exact decimal-to-centavo conversion and comparison with template registry.
- Conflicts: missing amount, negative amount, excessive precision, source disagreement, template mismatch.
- Idempotency: pricing source ID plus pricing hash.
- Audit: source ID/hash, approver, conversion policy version.
- Rollback: restore prior pricing object; never recalculate an approved contract snapshot.

### 13.7 Contract-readiness dry run

- Input: canonical user/tenant/reservation/stay/branch/room/bed/pricing/template chain.
- Operation: read-only blocker evaluation.
- Output: aggregate counts and access-controlled per-record blocker report.
- Idempotency: naturally read-only; report identified by batch ID and source-data version.
- Audit: evaluator version, execution time, counts, report checksum.
- Rollback: none required; report artifacts may be archived under retention policy.
- This migration never creates `contracts`.

## 14. Index plan

These indexes are recommendations only.

### 14.1 Branches

```javascript
{ branchId: 1 } // unique
{ slug: 1 }     // unique
{ status: 1 }
```

Both business identifiers must be unique because they are stable registry keys.

### 14.2 Tenants

```javascript
{ tenantId: 1 }             // unique
{ userId: 1 }               // non-unique by default
{ sourceReservationId: 1 }  // unique
{ status: 1 }
```

`userId` remains non-unique unless the business formally guarantees that one account can never have multiple historical tenant identities. `sourceReservationId` is unique because one approved reservation creates at most one canonical tenant.

### 14.3 Identity crosswalk

```javascript
{ migrationBatchId: 1, sourceCollection: 1, sourceRecordId: 1, sourceField: 1 } // unique
{ resolutionStatus: 1, migrationBatchId: 1 }
{ resolvedUserObjectId: 1 }
```

### 14.4 Stays

```javascript
{ stayId: 1 }                                  // unique
{ tenantId: 1, assignmentStatus: 1 }
{ reservationId: 1 }
{ branchId: 1, roomId: 1, bedId: 1, assignmentStatus: 1 }
{ roomId: 1, contractStartDate: 1, contractEndDate: 1 }
```

Recommended partial uniqueness:

```javascript
{ tenantId: 1 }
unique: true
partialFilterExpression: { assignmentStatus: "ACTIVE" }
```

```javascript
{ roomId: 1, bedId: 1 }
unique: true
partialFilterExpression: {
  assignmentStatus: "ACTIVE",
  bedId: { $type: "string" }
}
```

The partial bed index excludes private/null-bed records. Indexes alone cannot prevent arbitrary date-range overlap; application transaction checks remain required.

### 14.5 Contracts

```javascript
{ contractId: 1 }             // unique
{ tenantId: 1, status: 1 }
{ reservationId: 1 }
{ stayId: 1 }
{ templateKey: 1 }
{ branchId: 1, status: 1 }
```

Recommended partial uniqueness:

```javascript
{ stayId: 1 }
unique: true
partialFilterExpression: {
  status: { $in: ["DRAFT", "UNDER_REVIEW", "APPROVED", "ACTIVE"] }
}
```

Before deployment, confirm the target MongoDB version supports the intended partial expression. If `$in` is unsupported for partial indexes in that environment, use a materialized `isCurrentContract:true` flag with a unique partial index.

## 15. Blocker code registry

| Code | Meaning |
|---|---|
| `ACCOUNT_OWNERSHIP_MISMATCH` | Authenticated account does not own the resolved chain |
| `APPROVED_RESERVATION_NOT_FOUND` | No qualifying approved reservation exists |
| `AMBIGUOUS_APPROVED_RESERVATION` | More than one reservation could be authoritative |
| `RESERVATION_OWNER_UNRESOLVED` | Reservation owner has no verified user target |
| `RESERVATION_OWNER_AMBIGUOUS` | Reservation owner resolves to multiple targets |
| `TENANT_IDENTITY_UNRESOLVED` | Canonical tenant cannot be verified |
| `TENANT_IDENTITY_NOT_VERIFIED` | Identity verification is not `VERIFIED` |
| `LEGAL_NAME_MISSING` | Approved legal full name is absent |
| `ADDRESS_MISSING` | Approved residential address is absent/incomplete |
| `BRANCH_MISSING` | Canonical branch is absent |
| `BRANCH_INACTIVE` | Branch cannot issue a new contract |
| `ROOM_ASSIGNMENT_MISSING` | No authoritative stay/room assignment exists |
| `ASSIGNMENT_CONFLICT` | Multiple assignment sources conflict |
| `ASSIGNMENT_OWNERSHIP_MISMATCH` | Assignment does not belong to tenant/reservation |
| `ROOM_BRANCH_MISMATCH` | Room does not belong to the stay branch |
| `BED_SLOT_MISSING` | Required shared-room bed/slot is absent |
| `BED_ROOM_MISMATCH` | Bed does not belong to assigned room |
| `PRIVATE_ROOM_BED_SLOT_UNRESOLVED` | Legal/product policy is not approved |
| `ROOM_TYPE_UNSUPPORTED` | Room type has no exact enum mapping |
| `LEASE_DATES_MISSING` | Approved start or end date is missing |
| `LEASE_DATE_INVALID` | Date is invalid or violates canonical date rules |
| `LEASE_DURATION_MISMATCH` | Stored and calculated durations disagree |
| `LEASE_TYPE_MISMATCH` | Stored lease category disagrees with dates |
| `PRICING_MISSING` | A required approved amount is absent |
| `PRICING_CONFLICT` | Authoritative candidates disagree |
| `PRICING_PRECISION_INVALID` | Amount cannot be represented exactly in centavos |
| `RENTAL_RATE_MISMATCH` | Approved rent does not match the selected template |
| `PRICING_APPROVAL_MISSING` | Pricing approver/evidence is absent |
| `TEMPLATE_NOT_FOUND` | Exact room/lease combination has no template |
| `TEMPLATE_INTEGRITY_MISMATCH` | Template hash differs from registry |
| `TEMPLATE_BRANCH_MISMATCH` | Template is not approved for the branch |
| `CONTRACT_DATA_INCOMPLETE` | One or more required snapshot values are absent |

Readiness may return several specific blockers plus `CONTRACT_DATA_INCOMPLETE`; clients must not rely on the aggregate code alone.

## 16. No-guessing test plan

### Identity and authorization

1. An unresolved string owner ID returns `RESERVATION_OWNER_UNRESOLVED`.
2. Multiple exact crosswalk targets return `RESERVATION_OWNER_AMBIGUOUS`.
3. An email matching a user's email does not resolve ownership.
4. A username or email prefix matching a name does not create a tenant.
5. Mixed string/ObjectId values without an explicit crosswalk remain blocked.
6. A tenant requesting another tenant's reservation returns no foreign details.
7. A tenant requesting another tenant's stay or contract returns no foreign details.
8. An admin lacking contract-read capability is denied.

### Legal identity and address

9. Missing legal name returns `LEGAL_NAME_MISSING`.
10. Missing required address component returns `ADDRESS_MISSING`.
11. An editable `users.address` does not satisfy contract readiness.
12. Passing a nested address object to the formatter never yields `"[object Object]"`; it is rejected or formatted from scalar components.
13. Username, nickname, and email never appear in the legal-name snapshot.

### Assignment and template selection

14. Unknown room type returns `ROOM_TYPE_UNSUPPORTED`.
15. Reservation room preference cannot replace an absent assignment.
16. Room/branch mismatch returns `ROOM_BRANCH_MISMATCH`.
17. Bed outside the assigned room returns `BED_ROOM_MISMATCH`.
18. Competing active assignment sources return `ASSIGNMENT_CONFLICT`.
19. Guadalupe plus a Gil Puyat template returns `TEMPLATE_BRANCH_MISMATCH`.
20. Unknown room/lease combination returns `TEMPLATE_NOT_FOUND`; no default is selected.
21. Changed template bytes return `TEMPLATE_INTEGRITY_MISMATCH`.
22. Private room without an approved bed/slot decision returns `PRIVATE_ROOM_BED_SLOT_UNRESOLVED`.

### Dates and lease classification

23. Missing end date returns `LEASE_DATES_MISSING` and no lease type.
24. End before start returns `LEASE_DATE_INVALID`.
25. Invalid leap date is rejected.
26. January 31 and leap-year month boundaries follow the documented calendar rule.
27. Stored duration conflicting with calculated duration returns `LEASE_DURATION_MISMATCH`.
28. Five-month dates plus `LONG_TERM` return `LEASE_TYPE_MISMATCH`.
29. Six-month dates plus `SHORT_TERM` return `LEASE_TYPE_MISMATCH`.
30. Client timezone/device clock cannot alter the stored date-only values.

### Pricing and immutability

31. Missing deposit, advance, reservation fee, or approved rent returns `PRICING_MISSING`.
32. Amount with more than two decimals returns `PRICING_PRECISION_INVALID`.
33. Conflicting room/reservation/rate-card values return `PRICING_CONFLICT`.
34. Current room price cannot overwrite an approved pricing snapshot.
35. A no-discount contract stores null promo and approved rent equal to regular rent.
36. An exception without approver/reason/time returns `PRICING_APPROVAL_MISSING`.
37. Profile name/address changes do not modify an approved snapshot.
38. Room number/type/price changes do not modify an approved snapshot.
39. Branch or template-registry changes do not mutate an approved snapshot.
40. Attempted direct update to an approved snapshot is rejected.

### State machine

41. A draft cannot become approved without `UNDER_REVIEW`.
42. An unauthorized reviewer cannot transition status.
43. An approved contract cannot return to draft.
44. A terminal contract cannot reactivate.
45. Correction creates a new version and preserves the previous snapshot.

## 17. Recommended implementation sequence

1. Add shared enum, date-only, centavo, blocker, and validation modules with unit tests.
2. Add repository-level schema validators/types for the proposed entities without production deployment.
3. Implement branch registry administration and verification workflow in a non-production environment.
4. Implement identity-crosswalk dry run and classify all reservations.
5. Resolve ownership conflicts administratively.
6. Implement tenant canonicalization dry run and identity/address review workflow.
7. Implement assignment reconciliation dry run and overlap detection.
8. Record the private-room bed/slot legal/product decision.
9. Implement date and lease classification with boundary tests.
10. Implement approved pricing registry/snapshot workflow.
11. Implement the read-only readiness evaluator and authorization tests.
12. Run full dry-run reports against production after backup readiness is confirmed; still perform no writes without separate approval.
13. Review conflicts and secure explicit production migration authorization.
14. Apply canonical migrations batch by batch with verification and rollback checkpoints.
15. Create recommended indexes only after duplicate/conflict prechecks pass.
16. Re-run readiness until eligible records have zero blockers.
17. Design contract draft generation as a later phase.

## 18. Remaining legal and administrator decisions

The following are not technical defaults and must be supplied by authorized owners:

1. Verified branch IDs, legal names, and complete legal addresses.
2. Confirmation that the six registered templates apply only to the verified Gil Puyat branch.
3. Legally approved templates for Guadalupe, if contracts will be issued there.
4. `PRIVATE_ROOM_BED_SLOT_POLICY`.
5. Authoritative lease start/end dates for incomplete records.
6. Authoritative security deposit, advance rent, promo, and approved monthly rent values.
7. Pricing exception approval authority and evidence requirements.
8. Definition of when `APPROVED` becomes `ACTIVE` in relation to signatures and execution.
9. Signature, witness, notarization, retention, and final-file storage workflow.
10. Authorization-role mapping for Contract Admin, Reviewer, Approver, and Legal Administrator.
11. Whether one user account may have multiple historical canonical tenant records.
12. Approval of the whole-calendar-month date policy for nonstandard legal terms.

## 19. Readiness decisions

### Ready to begin actual canonical-data implementation?

**YES, conditionally.**

Engineering can begin implementing enums, validators, schemas/types, dry-run migration tooling, conflict reports, authorization checks, and readiness evaluation in a non-production environment using this plan. Branch legal data, private-room policy, pricing approvals, and record-specific conflict decisions remain gates for completing production backfill.

### Ready to generate contracts?

**NO.**

Contract generation remains blocked until canonical entities are deployed through a separately authorized migration, ownership is resolved, required legal/admin decisions are recorded, pricing and dates are approved, branch/template compatibility is verified, private-room policy is resolved, and the readiness evaluator returns no blockers for the intended contract.

