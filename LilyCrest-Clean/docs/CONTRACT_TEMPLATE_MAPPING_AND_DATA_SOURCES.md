# Contract Template Selection and Tenant Data Mapping

Status: Read-only Phase 2 preparation  
Reviewed: 2026-07-23  
Implementation performed: None

## Official Template Inventory

Each supplied PDF is one page. The source PDFs remain unchanged in `C:\Users\leigh\Downloads`.

| Template key | Official file | SHA-256 | Regular rent | Promo | Promo rent | Advance | Deposit | Reservation fee |
|---|---|---|---:|---:|---:|---:|---:|---:|
| `PRIVATE_ROOM_SHORT_TERM` | `Lease_Private_Room_ShortTerm.pdf` | `503ca04f7e954b5112418cf58732fe4e57e0475404eb764cb053c10f5379533c` | ₱16,000 | 10% | ₱14,400 | ₱14,400 | ₱14,400 | ₱2,000 |
| `PRIVATE_ROOM_LONG_TERM` | `Lease_Private_Room_LongTerm.pdf` | `da2d514a498ace822e791438c8aae5cb123f9466d7090521bf116734356c34cf` | ₱15,000 | 10% | ₱13,500 | ₱13,500 | ₱13,500 | ₱2,000 |
| `DOUBLE_SHARING_SHORT_TERM` | `Lease_Double_Sharing_ShortTerm.pdf` | `cb31224d8da20a77112bf8d852e43b87e6d11ebd9baf64c9236df9b3793e5f82` | ₱10,000 | 20% | ₱8,000 | ₱8,000 | ₱8,000 | ₱2,000 |
| `DOUBLE_SHARING_LONG_TERM` | `Lease_Double_Sharing_LongTerm.pdf` | `2237ce7724a05fad558a0f584b77c6871f6d516591867cd080a903a0136f81bf` | ₱9,000 | 20% | ₱7,200 | ₱7,200 | ₱7,200 | ₱2,000 |
| `QUADRUPLE_SHARING_SHORT_TERM` | `Lease_Quadruple_Sharing_ShortTerm.pdf` | `9f80573491518335c0dc10b21274257c02fa4e4a538fcae71c2ea9716da62b91` | ₱7,000 | 10% | ₱6,300 | ₱6,300 | ₱6,300 | ₱2,000 |
| `QUADRUPLE_SHARING_LONG_TERM` | `Lease_Quadruple_Sharing_LongTerm.pdf` | `37c678867452a7b1c6fff6a2146f11d5454d035db58e91d906ad273bbb0a6856` | ₱6,000 | 10% | ₱5,400 | ₱5,400 | ₱5,400 | ₱2,000 |

Every template also states a ₱1,000 unreturned-key charge. This is a legal clause, not a tenant-specific generation field.

## Deterministic Selection

| Verified room type | Verified lease type | Template key |
|---|---|---|
| `PRIVATE_ROOM` | `SHORT_TERM` | `PRIVATE_ROOM_SHORT_TERM` |
| `PRIVATE_ROOM` | `LONG_TERM` | `PRIVATE_ROOM_LONG_TERM` |
| `DOUBLE_SHARING` | `SHORT_TERM` | `DOUBLE_SHARING_SHORT_TERM` |
| `DOUBLE_SHARING` | `LONG_TERM` | `DOUBLE_SHARING_LONG_TERM` |
| `QUADRUPLE_SHARING` | `SHORT_TERM` | `QUADRUPLE_SHARING_SHORT_TERM` |
| `QUADRUPLE_SHARING` | `LONG_TERM` | `QUADRUPLE_SHARING_LONG_TERM` |

No default branch, room type, lease type, duration, template, or rate is permitted. `SHORT_TERM` requires at least one month and less than six months. `LONG_TERM` requires six months or more. Stored lease type and dates must agree before selection.

## Material Legal/Layout Findings

All six templates contain blanks for:

- execution day and month;
- lessee legal name;
- lessee postal/residential address;
- room number;
- bed/slot number;
- numeric and written lease duration;
- contract start and end dates;
- advance-rent coverage dates;
- lessee/lessor signatures and witnesses;
- acknowledgment venue/date, page count, and notarial register fields.

All six templates hardcode:

- lessor `FIRST JRAC PARTNERSHIP CO.`;
- representative `JOANNE ONG`;
- lessor principal office;
- establishment `LILYCREST GIL PUYAT`;
- branch address `#7 Gil Puyat Ave. corner Marconi St., Makati City`;
- room category, lease category, rental rates, discount, deposit, advance, reservation fee, and legal clauses.

Consequences:

1. The supplied PDFs are only directly compatible with the Gil Puyat branch.
2. They contain no branch-name or branch-address placeholder.
3. A tenant assigned to another branch must be blocked until a legally approved template for that branch exists. Runtime text substitution into an official source is not authorized by this analysis.
4. Every template, including private-room templates, contains a Bed/Slot blank. Product/legal review must decide whether private rooms have an actual assigned bed/slot or need an approved private-room template without that field. The generator must not invent `N/A`.
5. Promo/custom rates must match the selected template exactly or require administrator/legal review.

## Authoritative Database Sources

The following is the required canonical source contract. Existing records currently use mixed legacy identifiers (`user_id`, `userId`, `tenantId`, `_id`) and must not be joined by a permissive “first match” query.

| Contract value | Required source | Validation |
|---|---|---|
| Account owner | authenticated session `user_id` | Session must be active |
| Approved reservation | `reservations.userId`, `reservations.reservationId`, approval status | Exactly one intended approved reservation; owner equals session user |
| Tenant | `tenants.tenantId`, `tenants.userId`, `tenants.reservationId` | All IDs match account/reservation |
| Legal name | `approvedReservation.applicantName`, else verified `tenant.legalFullName` | Never username, nickname, or email |
| Residential address | `approvedReservation.residentialAddress` | Must be non-empty; never branch/profile fallback |
| Assignment | active tenant assignment by `tenantId` | Must be current and unambiguous |
| Branch | assignment/tenant `branchId` → `branches.branchId` | Branch must exist and match template’s legally supported branch |
| Room | assignment `roomId` → `rooms.roomId` | Room belongs to branch |
| Room type | resolved room `roomType` | Exact enum only |
| Bed/slot | assignment `bedId` or `slotId` → room bed/slot | Required for shared rooms; must belong to room |
| Lease type | approved contract/reservation `leaseType` | Exact enum and date-derived duration agree |
| Start/end dates | approved `contractStartDate`, `contractEndDate` | Valid dates; end after start |
| Duration | calculated from approved dates | Must agree with lease type and stored duration |
| Approved rent | approved reservation/tenant/contract rate record | Must match selected template unless admin confirms exception |
| Contract date | workflow `generatedAt`, `approvedAt`, or execution date | Reservation creation date is not a fallback |
| Contract identity | `contractId`, `tenantId`, `reservationId` | Ownership chain must be preserved |

Fields such as `applicantName`, `legalFullName`, `residentialAddress`, canonical `roomType`, and canonical `leaseType` are requirements from the approved contract design; the current repository does not consistently expose them. Phase 2 must first define/backfill canonical schema rather than silently mapping uncertain legacy fields.

## Ownership Validation

Generation/viewing is allowed only when all applicable checks pass:

```text
reservation.userId == authenticatedUser.userId
tenant.userId == authenticatedUser.userId
tenant.reservationId == reservation.reservationId
assignment.tenantId == tenant.tenantId
room.roomId == assignment.roomId
room.branchId == assignment.branchId
bedOrSlot belongs to room
contract.tenantId == tenant.tenantId
contract.reservationId == reservation.reservationId
contract.userId == authenticatedUser.userId
```

Client-supplied `tenantId`, `reservationId`, or `contractId` is only a lookup hint. Authorization must be reconstructed on the backend from the authenticated account.

## Required Fields and Blockers

Required before draft generation:

- authenticated `userId`;
- approved reservation and verified tenant;
- legal name and approved residential address;
- branch and legal branch-compatible template;
- final room assignment and room type;
- bed/slot assignment for shared rooms;
- lease type, start/end dates, calculated duration;
- approved rental, promo, deposit, advance, and reservation-fee values;
- deterministic template key and verified source hash.

Blocker codes:

- `TENANT_RECORD_NOT_FOUND`
- `APPROVED_RESERVATION_NOT_FOUND`
- `ACCOUNT_OWNERSHIP_MISMATCH`
- `ADDRESS_MISSING`
- `BRANCH_MISSING`
- `ROOM_ASSIGNMENT_MISSING`
- `BED_SLOT_MISSING`
- `LEASE_DATES_MISSING`
- `LEASE_TYPE_MISMATCH`
- `RENTAL_RATE_MISMATCH`
- `CONTRACT_DATA_INCOMPLETE`
- `TEMPLATE_NOT_FOUND`
- `TEMPLATE_INTEGRITY_MISMATCH`
- `TEMPLATE_BRANCH_MISMATCH`
- `AMBIGUOUS_APPROVED_RESERVATION`
- `ASSIGNMENT_OWNERSHIP_MISMATCH`

## Admin Review and Immutable Snapshot

1. Resolve ownership-linked records.
2. Validate every required field and template hash.
3. Generate `DRAFT`.
4. Admin reviews legal name, address, branch, room, bed/slot, lease type/dates, all amounts, and selected template.
5. Record reviewer, timestamp, and any approved exception.
6. On approval, atomically save `APPROVED`/`ACTIVE`, immutable snapshot, source IDs, template key/hash, and final PDF reference.
7. Tenant viewing revalidates contract ownership. Active PDFs are never rebuilt from mutable profile data.

```js
contractSnapshot: {
  tenantName,
  residentialAddress,
  branchName,
  branchAddress,
  roomType,
  roomNumber,
  bedOrSlotNumber,
  leaseType,
  leaseDurationMonths,
  contractStartDate,
  contractEndDate,
  regularRentalRate,
  promoRentalRate,
  securityDeposit,
  advanceRent,
  reservationFee,
  templateKey,
  templateSha256,
  generatedAt,
  approvedAt
}
```

The snapshot should additionally retain source `userId`, `reservationId`, `tenantId`, `branchId`, `roomId`, `bedId`/`slotId`, and `contractId` in non-display metadata for auditability.

## Future Backend Surface (Not Implemented)

No endpoint was changed during this analysis. Phase 2 should design authenticated/admin-authorized endpoints equivalent to:

- tenant: read own contract metadata/final PDF;
- admin: validate generation readiness;
- admin: create draft;
- admin: approve/finalize draft;
- admin: retrieve blocker details and audit history.

Every route must derive ownership from server-side records and must not accept client-selected room type, branch, lease type, rate, or template as authoritative.

## No-Guessing Security Tests

1. A tenant requests another tenant’s `contractId` → reject without contract data.
2. Client supplies another `tenantId`/`reservationId` → ignore as authority and reject ownership mismatch.
3. Multiple approved reservations exist → `AMBIGUOUS_APPROVED_RESERVATION`.
4. Reservation is unapproved → `APPROVED_RESERVATION_NOT_FOUND`.
5. Address absent → `ADDRESS_MISSING`; no profile/branch fallback.
6. Assignment room belongs to another branch → `ASSIGNMENT_OWNERSHIP_MISMATCH`.
7. Shared room lacks bed/slot → `BED_SLOT_MISSING`.
8. Stored short-term lease spans six months → `LEASE_TYPE_MISMATCH`.
9. Rate differs from official template → `RENTAL_RATE_MISMATCH`; no silent substitution.
10. Non-Gil-Puyat branch uses supplied template → `TEMPLATE_BRANCH_MISMATCH`.
11. Template bytes do not match registered hash → `TEMPLATE_INTEGRITY_MISMATCH`.
12. Unknown room/lease enum → `TEMPLATE_NOT_FOUND`; no default.
13. Profile name/address differs from approved snapshot → active contract remains unchanged.
14. Draft approval writes immutable snapshot and subsequent profile/assignment changes do not mutate it.
15. Malformed/missing survey or contract metadata never exposes another tenant’s record.
