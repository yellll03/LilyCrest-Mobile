# Phase 4C — Tenant Mobile Survey Polish and Validation

## Final decision

**TENANT SURVEY MOBILE NOT PASSED**

Tenant-mobile implementation and automated validation pass. Final release approval remains blocked by the explicitly deferred consolidated APK and authorized physical-device test, and by the absence of controlled live survey definitions/accounts needed to exercise quarterly, move-out, history, and cross-account scenarios.

No web admin, admin analytics UI, backend survey domain, contract, billing, chatbot, canonical migration, PDF, or iOS files were modified.

## Modified and created files

- `frontend/app/surveys.jsx`
- `frontend/app/survey-form.jsx`
- `frontend/app/(tabs)/announcements.jsx`
- `frontend/src/services/surveyDrafts.js`
- `frontend/src/services/notifications.js`
- `frontend/src/utils/surveyForm.js`
- `frontend/src/tests/surveyDrafts.test.js`
- `frontend/src/tests/surveyMobilePolish.test.js`

## Dashboard changes

The dashboard now separates:

- Available
- In Progress
- Submitted
- History

Cards retain title, type, availability period, due date, status, and the correct Start, Continue, or View Response action. Each section has a distinct empty state. The move-out explanation uses the approved wording and no admin-only fields are rendered.

The most recent authenticated-tenant dashboard is cached. Offline opening shows the cached list with a clear offline banner instead of silently presenting it as current server state.

## Quarterly and move-out forms

Quarterly rendering explicitly filters every move-out-only question, even if a malformed definition contains one.

Move-out rendering includes reason, conditional OTHER explanation, return intention, move-out-process rating, common recommendation, and optional feedback. OTHER explanation appears only after OTHER is selected.

Rating targets have a minimum 44-pixel width and 48-pixel height, visible selected state, 1–5 meaning labels, screen-reader radio roles, selected/disabled state, and descriptive accessibility labels.

Long prompts wrap. The form uses safe-area layout, a keyboard-avoiding wrapper, drag-to-dismiss keyboard behavior, responsive wrapping choices, and reachable actions at the end of the scroll view.

## Validation UX

- Required fields use `Please answer this question.`
- OTHER uses `Please provide a reason.`
- Oversized feedback uses `Your feedback must not exceed 1000 characters.`
- Invalid cards receive a red border.
- Submission scrolls to the first invalid question.
- Existing answers remain unchanged after validation or network failure.
- Feedback displays a character counter and is capped at 1000 characters.
- Submit is gated while a confirmation or network submission is active.
- Success appears only after the API confirms persistence.

## Draft and offline behavior

Draft, cached definition, and cached-dashboard keys are isolated by the authenticated tenant key and survey ID. The tenant key prefers the authoritative `tenantId`/`tenant_id` profile value and otherwise uses the stable authenticated `user_id`.

On form opening:

1. local draft and cached definition are restored;
2. the backend is refreshed when reachable;
3. a network failure retains the locally restored answers and displays an offline message.

The local draft is deleted only after confirmed submission. Logout/account switching cannot load the previous account's keys.

Final submission is never queued offline. Network/timeout failures show:

`Unable to submit your survey. Please check your connection and try again.`

## Read-only history

Submitted responses display survey title, type, submitted date, question labels, ratings, recommendation, feedback, and applicable move-out answers. Controls are disabled and the screen states that submitted responses are read-only.

Internal response IDs, tenant IDs, admin notes, and backend metadata are not rendered.

If a notification targets a closed or submitted survey, the form tries the active endpoint first and then the authenticated response endpoint, producing read-only history when a response exists and a safe unavailable state otherwise.

## Notifications

Survey URLs such as `/surveys/survey_q3` are converted to the actual mobile route:

```text
/survey-form?surveyId=survey_q3
```

Push taps, foreground notification banners, and the in-app notification detail action use the shared route resolver. Survey notifications receive a dedicated icon/color and an accessible Open Survey action.

Backend duplicate prevention remains unchanged. This phase did not alter notification generation.

## Privacy and safe errors

- No tenant or branch identity is sent in survey requests.
- Manually changed survey IDs still pass through authenticated backend ownership checks.
- Local caches are tenant-scoped.
- A defensive mobile sanitizer blocks MongoDB, duplicate-key, Node.js, stack trace, ObjectId, and collection implementation details even if an upstream response is malformed.
- Recognized safe survey messages remain visible.

## Automated results

- Expo lint: passed without errors or warnings.
- Frontend suites: 10/10 passed.
- Frontend tests: 66/66 passed.

Added coverage includes:

- required dashboard sections and empty-state source contracts;
- quarterly exclusion of move-out questions;
- move-out required-question visibility;
- missing and invalid ratings;
- first-invalid-field selection;
- OTHER explanation;
- feedback length;
- tenant-isolated draft/form/dashboard restoration;
- draft removal after confirmed submission;
- raw backend error suppression;
- survey notification routing;
- read-only history source contract;
- repeat-submission gating;
- keyboard avoidance and minimum tap size.

Backend Phase 4B coverage remains responsible for closed/expired rejection, ownership, duplicate atomicity, and cross-tenant response protection; those backend files were intentionally not modified in Phase 4C.

## Physical-device status

Not run. The instruction requires one authorized-device test after all approved mobile changes are included in a consolidated build, without uninstalling the current app yet. No new APK was produced or installed in this phase.

Required final device matrix:

- available, empty, in-progress, submitted, and history dashboards;
- complete quarterly and move-out forms;
- first-error scrolling, OTHER, length limit, and rapid Submit;
- force-close draft recovery and account switching;
- Wi-Fi, mobile data, offline, timeout, reconnection, and retry;
- notification taps for available, submitted, and closed surveys;
- small/large screen, landscape, keyboard, safe area, and TalkBack;
- Tenant A/Tenant B isolation and manually altered survey ID.

## Remaining blockers

1. Confirm all approved mobile work is complete and produce the single final Android build.
2. Provision controlled eligible/ineligible Tenant A and Tenant B accounts plus active, closed, submitted, quarterly, and move-out survey records.
3. Run the physical-device matrix without uninstalling until the planned final clean-reinstall checkpoint.
4. Record screenshots, API outcomes, device/OS/build identifiers, and pass/fail evidence before changing the decision.
