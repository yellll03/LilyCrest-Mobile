# Phase 4B — Tenant Survey and Feedback Module

## Decision

**SURVEY MODULE NOT PASSED**

The implementation and automated checks pass, but a physical-device run was intentionally not performed because the phase specification says to finish the remaining approved mobile updates before producing one fresh final build. The existing web admin panel also does not yet expose the new management APIs as interactive controls.

## Created and modified files

### Backend

- `domain/surveys/surveyEnums.js`
- `domain/surveys/surveyValidation.js`
- `services/surveyEligibility.service.js`
- `services/survey.service.js`
- `services/surveyNotification.service.js`
- `middleware/surveyAccess.js`
- `controllers/survey.controller.js`
- `routes/survey.routes.js`
- `routes/index.js`
- `server.js`
- `tests/surveyModule.test.js`

### Tenant mobile

- `app/surveys.jsx`
- `app/survey-form.jsx`
- `app/(tabs)/profile.jsx`
- `app/_layout.jsx`
- `src/services/api.js`
- `src/services/surveyDrafts.js`
- `src/tests/surveyDrafts.test.js`

## Data model and indexes

`survey_definitions` stores the survey ID/type, title, description, optional branch scope, period, submission window, lifecycle status, canonical questions, creator, and timestamps.

`survey_responses` stores only response identity references, canonical answers, response status, branch scope, and timestamps. It does not duplicate tenant profile data or store admin notes in tenant responses.

Indexes created at backend startup:

```javascript
survey_definitions: { surveyId: 1 } unique
survey_responses: { tenantId: 1, surveyId: 1 } unique
survey_responses: { surveyId: 1, status: 1, branchId: 1 }
```

The tenant ID, user ID, and branch ID are always resolved from the authenticated account and authoritative occupancy records. Client-supplied identity or branch fields are ignored.

## Eligibility rules

Quarterly:

- active/current/occupied/checked-in stay; or
- completed stay whose dates overlap the survey period.

Move-out:

- approved move-out request;
- expired/completed contract;
- completed stay; or
- an authorized exit-survey enable flag;
- and a verified stay or contract relationship must still be resolved.

Pending/rejected applicants, cancelled reservations, unrelated branches, and users without a verified tenant relationship are excluded.

## Tenant endpoints

```text
GET  /api/surveys/me
GET  /api/surveys/:surveyId/me
PUT  /api/surveys/:surveyId/draft
POST /api/surveys/:surveyId/submit
GET  /api/surveys/:surveyId/response/me
```

The dashboard groups active, pending, submitted, and expired/history records. Submitted responses use the response endpoint and are read-only.

## Admin endpoints

```text
POST /api/surveys/admin/manage
GET  /api/surveys/admin/manage
PUT  /api/surveys/admin/manage/:surveyId
POST /api/surveys/admin/manage/:surveyId/activate
POST /api/surveys/admin/manage/:surveyId/close
GET  /api/surveys/admin/manage/:surveyId/results
GET  /api/surveys/admin/manage/:surveyId/responses
POST /api/surveys/admin/move-out/:requestId/survey-skip
```

Owner/super-admin access is explicit. Admin access requires `survey_manage` or `survey_management`. Branch administrators are constrained to their own branch for definitions, results, and individual responses.

## Forms and validation

Both forms contain the nine required 1–5 ratings, canonical recommendation choice, and optional 1000-character feedback. Move-out adds canonical reason, required OTHER explanation, return intention, and move-out experience rating.

Frontend validation keeps completed answers intact and displays field errors. Backend validation independently rechecks all required answers, canonical choices, lengths, current availability, ownership, eligibility, and duplicate state.

The UI uses consistent English labels; stored values remain stable uppercase canonical values.

## Duplicate and draft safety

- One unique response record exists per tenant and survey.
- Final submission uses an atomic conditional update.
- Duplicate-key races and subsequent submissions return: `This survey has already been submitted.`
- Local draft keys contain both authenticated user ID and survey ID.
- Backend drafts are similarly scoped and validate question IDs, choices, rating ranges, and text lengths.
- The local draft is removed only after confirmed backend submission.
- Submitted responses cannot be changed through the draft or submit endpoints.

## Analytics and privacy

Admin summaries provide eligible, submitted, pending, completion percentage, category averages, recommendation breakdown, move-out reason breakdown, and a `smallSample` warning below ten responses.

Aggregate output contains no tenant identity. Individual response projections omit tenant profile details and internal notes. Branch administrators cannot query another branch.

The survey is advisory to move-out. No move-out operation is blocked by an incomplete survey. An authorized skip records the reason, approver, and approval timestamp.

## Notifications

Activation creates one deduplicated in-app notification per eligible tenant:

- `A new tenant satisfaction survey is available.`
- `Your move-out feedback survey is now available.`

A six-hour lifecycle check creates one deduplicated due-soon reminder during the last three days, excluding submitted tenants. No SMS channel was added.

## Automated results

- Backend: 91/91 tests passed.
- Frontend: 56/56 tests passed.
- Expo lint: passed.
- Node syntax checks: passed.

Covered survey tests include eligibility, ineligible applicants, period overlap, move-out conditions, branch scope, ratings, recommendation, OTHER explanation, feedback length and wording, duplicate submission, closed/expired rejection, permissions, branch restriction, and local draft isolation/removal.

## Physical-device status and blockers

Physical-device testing: **not run in this phase**, as explicitly required to avoid reinstalling/rebuilding before the remaining approved mobile updates are complete.

Before release:

1. Add interactive survey-management screens to the existing web admin application or connect another approved admin client to the completed APIs.
2. Seed a controlled quarterly and move-out definition with test tenant/stay data.
3. Verify form scrolling, keyboard behavior, rotation, offline draft recovery, double-tap submission, account switching, push/in-app navigation, and read-only history on the final physical-device build.
4. Verify reminder scheduling in the deployed multi-instance environment; event keys prevent duplicate records, but production scheduler ownership should be confirmed.
