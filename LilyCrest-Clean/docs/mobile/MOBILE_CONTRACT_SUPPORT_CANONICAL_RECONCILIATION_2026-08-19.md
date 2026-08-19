# Mobile Contract + Support Canonical Reconciliation

Date: 2026-08-19 (Asia/Singapore)
Target canonical commit: `b91101ad3503edfff05909455e9ce059b309c01b`

> Promotion audit note: this document preserves the source-verification
> snapshot before commit/merge/deployment. The later promotion review found
> one non-functional diff addition: `server/mobile/mobileRoutes.mjs` received
> a comment-only cleanup removing the stale name of the deleted vendored chat
> controller. No claimed runtime behavior differed from the audited source.

## A. Executive Verdict

**PARTIALLY COMPLETE — SOURCE VERIFIED ONLY.**

The source reconciliation is implemented in isolated mobile and canonical-backend worktrees and passes the repository-wide automated regression gates. The mobile `/api/m/chat/*` transport is now a thin adapter over the canonical chat controller; the React Native app consumes canonical context, lifecycle, notification, realtime, attachment, profile-image, ticket-ID, and contract-document state.

This is **not yet an APK/IPA or real-device completion claim**:

- The reconciliation changes are uncommitted local changes in two worktrees.
- The post-`b91101ad` backend adapter changes are not merged or deployed.
- Production is healthy at `b91101ad3`, but that deployed revision predates the local adapter cutover described here.
- No APK/IPA was built, installed, or launched.
- Foreground/background/terminated push behavior and responsive UI were not exercised on physical devices.

Therefore the next valid gate is: review and commit both worktrees, merge/deploy the canonical backend changes, verify the health SHA has advanced to that deployment, then create a traceable mobile build and begin real-device QA.

## B. Canonical Base Proof

| Proof item | Verified value | State |
|---|---|---|
| Canonical remote branch | `origin/main` | Verified |
| Canonical target SHA | `b91101ad3503edfff05909455e9ce059b309c01b` | Verified |
| Canonical isolated branch | `fix/mobile-contract-support-adapter-20260819` | Local worktree |
| Canonical isolated HEAD | `b91101ad3503edfff05909455e9ce059b309c01b` | Exact target |
| Target ancestor of `origin/main` | Yes | Verified with `git merge-base --is-ancestor` |
| Mobile remote branch | `origin/master` (this repository has no `origin/main`) | Verified |
| Mobile isolated branch | `fix/mobile-contract-support-canonical-20260819` | Local worktree |
| Mobile isolated HEAD | `a50be38985b24b73e7f0824ebd1e5e28a774e2d7` | Equals `origin/master` before local edits |
| Canonical API host | `https://api.lilycrest.space` | Release verifier passed |
| Production health response | `status=healthy`, `commit=b91101ad3`, `env=production` | Verified 2026-08-19 12:51 SGT |
| App version metadata | `1.2.1`, Android `versionCode=20` | Source verified |

Production health evidence:

```json
{
  "status": "healthy",
  "timestamp": "2026-08-19T04:51:31.837Z",
  "backend": "Node.js/Express",
  "auth": "Firebase-only",
  "commit": "b91101ad3",
  "deployedAt": "2026-08-19T04:51:06.459Z",
  "env": "production"
}
```

State separation:

| State | Verdict |
|---|---|
| CODE MERGED | Canonical base `b91101ad` is merged; reconciliation changes are not merged |
| BACKEND DEPLOYED | Production runs base `b91101ad3`; reconciliation adapter is not deployed |
| MOBILE CONSUMING | Implemented and source-tested locally; no released artifact contains it |
| REAL DEVICE VERIFIED | No |

The original dirty mobile checkout and the dirty canonical checkout were not edited. Work was performed in isolated worktrees to preserve existing auth work, PDFs, untracked files, and other concurrent worktrees.

## C. Existing Mobile Architecture Audit

### Mobile client endpoint inventory before this change

| Mobile action | Existing endpoint | Canonical equivalent | Reconciliation action |
|---|---|---|---|
| Start/reuse conversation | `POST /api/m/chat/start` | `POST /api/chat/start` / `startConversation` | Keep URL; delegate to canonical operation |
| List tenant conversations | `GET /api/m/chat/me` | `GET /api/chat/me` / `getMyConversations` | Keep URL; delegate |
| Fetch thread | `GET /api/m/chat/:conversationId/messages` | Canonical `getConversationMessages` | Keep URL; delegate |
| Send tenant message | `POST /api/m/chat/:conversationId/messages` | Canonical `sendTenantMessage` | Keep URL; delegate |
| Confirm resolution | `PATCH /api/m/chat/:conversationId/resolution` | Canonical `confirmTenantResolution` | Keep URL; delegate |
| Reopen conversation | `PATCH /api/m/chat/:conversationId/reopen` | Canonical `reopenTenantConversation` | Keep URL; delegate |
| Close conversation | `PATCH /api/m/chat/:conversationId/close` | Canonical close lifecycle | Keep compatibility route; implement in canonical controller |
| Upload support attachment | Previously generic `POST /api/m/upload/firebase-storage` plus client metadata | `POST /api/chat/:conversationId/attachments` | Mobile now calls canonical multipart chat upload |
| Download support attachment | `GET /api/m/chat/:conversationId/attachments/:attachmentId` | Canonical protected download | Keep URL; delegate |
| Typing signal | Client had no canonical transport | Canonical `broadcastTyping` | Compatibility route/API method exposed; UI emission not enabled |

### Duplicate business logic found

The target contained an independently maintained CommonJS mobile controller at `server/mobile/controllers/chat.controller.js`, its own route table, direct raw-collection operations, lifecycle transitions, ticket handling, attachment rules, branch resolution, and notifications. It was a second domain authority beside `server/controllers/chatController.js`.

The duplicate mobile controller and route are removed. `server/mobile/routes/index.js` no longer mounts them. `server/routes/mobileChatRoutes.js` now performs only:

1. mobile session authentication;
2. binding the authenticated database tenant to `req.authUser`;
3. multipart transport validation for the existing canonical upload operation; and
4. route-to-controller delegation.

It contains no `ChatConversation`, `ChatMessage`, ticket generation, status history, reuse, branch, ownership, notification, or persistence logic.

### Notification router audit

`resolveNotificationRoute` now maps the canonical event types explicitly before generic URL/title handling. No `support_reply` event was introduced. The Home notification sheet also retains `message_id` when projecting a stored notification into the shared resolver.

### Contract data-source audit

At audited mobile HEAD, `useTenantContract` already used `GET /api/m/contracts/current`, and `buildContractSummary` already treated `contract.tenantDocument` as the primary server-resolved document. It falls back to `finalDocument`/`preparedDocument` only when `tenantDocument` is absent. No live text reconstruction path was found. This phase retained that canonical selection and added live invalidation, exact deep-link guarding, and Contract → Contact Support.

## D. `/api/m/chat/*` Reconciliation

| Route | Before | After | Canonical operation / compatibility |
|---|---|---|---|
| `POST /api/m/chat/start` | Vendored raw-Mongo controller | Thin adapter | `startConversation`; accepts mobile `initialMessage`, persists it canonically, returns `reusedExisting` |
| `GET /api/m/chat/me` | Vendored list/query logic | Thin adapter | `getMyConversations`; canonical serialization, ticket IDs, context, status, avatar |
| `GET /api/m/chat/:id/messages` | Vendored message query | Thin adapter | `getConversationMessages`; canonical tenant ownership and protected attachment URLs |
| `POST /api/m/chat/:id/messages` | Vendored send/status/notify logic | Thin adapter | `sendTenantMessage`; attachment IDs validated by canonical controller |
| `POST /api/m/chat/:id/attachments` | No mobile use of canonical upload | Thin multipart adapter | `uploadChatAttachment`; field `file`, one file/request, 5 MB |
| `GET /api/m/chat/:id/attachments/:attachmentId` | Vendored download authority | Thin adapter | `downloadChatAttachment`; tenant ownership checked server-side |
| `PATCH /api/m/chat/:id/resolution` | Vendored lifecycle | Thin adapter | `confirmTenantResolution`; optional rating/feedback retained |
| `PATCH /api/m/chat/:id/reopen` | Vendored lifecycle | Thin adapter | `reopenTenantConversation`; same conversation identity retained |
| `PATCH /api/m/chat/:id/close` | Vendored tenant close | Thin adapter | New canonical `closeTenantConversation` compatibility operation; idempotent for already-closed threads |
| `POST /api/m/chat/:id/typing` | Vendored route | Thin adapter | Canonical `broadcastTyping` |

The adapter is mounted before the remaining vendored `/api/m` router. Mount-order regression coverage proves `/api/m/chat/me` is owned by the canonical adapter while unrelated vendored routes remain reachable.

## E. Contract Context

The Contract screen now provides **Contact Support** using existing `SurfaceCard`, `SectionHeader`, and `ActionButton` patterns. It submits:

```json
{
  "category": "general_inquiry",
  "priority": "normal",
  "context": {
    "entityType": "contract",
    "entityId": "<current contract id>",
    "sourceModule": "contract"
  }
}
```

The client does not send a branch or tenant override and does not choose a conversation locally. It opens the exact `conversation.id` returned by the canonical start operation.

Canonical behavior retained:

- Same contract: reuse the active conversation whose `context.entityType` and `context.entityId` match.
- Different contract: the different `entityId` does not match and a separate conversation can be created.
- Generic support: the contextless query is restricted to contextless conversations and cannot hijack a contract thread.
- Invalid/unowned contract: canonical `Contract.exists({_id, tenantId})` validation drops the invalid context before persistence. The client is not the security authority.

Contract-context threads render a compact **Related to Contract / View Contract** card. It opens `/contract-viewer?contractId=<entityId>` without copying contract content into every message.

## F. Support Lifecycle

| Behavior | Mobile behavior | Canonical authority |
|---|---|---|
| Status display | `Open`, `In Review`, `Waiting for You`, `Resolved`, `Closed` | Raw canonical enum mapped only for display |
| Admin reply | Realtime refresh plus polling fallback; `waiting_tenant` displays a resolution card | Admin send operation sets `waiting_tenant` |
| YES | Optional 1–5 rating and feedback, then one guarded request | `confirmTenantResolution(resolved=true, rating?, feedback?)` |
| NO | One guarded request keeps the same thread active | Current canonical API specifically implements this as `confirmTenantResolution(resolved=false, note)` and returns status `open` |
| Explicit reopen | Confirmation prompt; same conversation ID | `reopenTenantConversation` for `resolved`/`closed` conversations |
| Close | Destructive confirmation; UI changes only after server-confirmed `closed` response | `closeTenantConversation` |

The requested conceptual “NO → reopen” behavior was reconciled to the actual canonical contract: at `b91101ad`, `reopenTenantConversation` accepts only `resolved` or `closed`, while `confirmTenantResolution(false)` is the canonical `waiting_tenant` NO operation and records “Tenant selected NO” in the same conversation. The mobile app therefore does not bypass or duplicate the domain state machine.

Double taps are guarded with in-flight refs/state. Failed close calls no longer fabricate a local `closed` state. No persistent `isReopenedLocal` field was introduced.

Canonical system-event audit: no new contract lifecycle system-message architecture was added. Existing canonical auto-close system messages remain untouched. Mobile’s temporary divider rows are presentation-only and are not persisted or represented as admin-authored messages.

## G. Notification Routing

### `chat_reply`

| Stage | Behavior |
|---|---|
| Server creation | Existing `notify.adminReply(userId, conversationId, messageId)` |
| Canonical identity | `chat_reply:<conversationId>:<messageId>` |
| DB projection | `conversation_id` and now `message_id` (including recovery from `dedupeKey`) |
| Mobile mapper | Explicit `type === "chat_reply"` mapping |
| Route | `/(tabs)/chatbot` with `conversationId` and optional `messageId` |
| Thread behavior | Verifies target exists in authenticated tenant list, loads exact thread, highlights the message when present |

### `contract_document_ready`

| Stage | Behavior |
|---|---|
| Server projection | `contract_id` retained |
| Mobile mapper | Explicit `type === "contract_document_ready"` mapping before direct URL fallback |
| Route | `/contract-viewer` with `contractId` |
| Open-app behavior | Canonical event invalidates/refetches the current contract immediately |
| Exactness guard | A mismatched requested ID is not silently replaced by a different current contract |

### Foreground, background, cold start, and dedupe

- Push receipt and Socket.IO `notification:new` both publish into one in-memory canonical event bus.
- A canonical `event_key`/dedupe key is preferred over transport-specific push IDs; a 30-second presentation window suppresses duplicate banners/refetches.
- Mobile never inserts a new server-style notification record. It refetches the canonical `/notifications` feed.
- Notification taps are queued while auth restores and navigated only after authenticated state is ready.
- Existing root redirect protection prevents the normal authenticated-root redirect from overwriting a cold-start notification route.
- Background taps use the same shared resolver and do not reset navigation unnecessarily.

These paths are covered by automated mapper/auth-queue/source tests. Physical foreground/background/terminated push tests were **not executed**.

## H. Attachments

### Existing canonical backend contract consumed by mobile

| Item | Canonical contract |
|---|---|
| Upload | `POST /api/m/chat/:conversationId/attachments` (adapter to canonical upload) |
| Multipart field | `file` |
| Cardinality | One file per upload request |
| Maximum | 5 MB |
| MIME types | JPEG/JPG, PNG, WebP, HEIC, HEIF, PDF |
| MIME verification | Canonical file filter plus content-signature validation |
| Image handling | Canonical service may compress images to WebP |
| Storage | Existing configured `ATTACHMENT_STORAGE_DRIVER`: Firebase Storage or local driver; no new provider |
| Upload response | Canonical attachment ID, name/fileName, MIME/type, size, and protected chat URL |
| Message send | `attachments` contains uploaded canonical attachment objects/IDs; empty text is accepted when attachments exist |
| Download | `GET /api/m/chat/:conversationId/attachments/:attachmentId` with mobile bearer session |
| Authorization | Canonical conversation ownership and attachment-to-conversation checks |
| Deletion | No chat-attachment deletion endpoint exists in the audited canonical API; none was invented |

### Mobile UX

- Photo/library/camera and PDF/document selection use the existing picker.
- Client preflight mirrors canonical MIME and 5 MB limits; server remains authoritative.
- Each support file is uploaded through the canonical multipart endpoint before send.
- Optional text and attachment-only messages are supported without fake “Attachment” message text.
- Selected local files are restored after upload/send failure for retry.
- Canonical image attachments render a bounded protected thumbnail and open an in-app full-screen protected preview; “Open or Share” uses the authenticated download path.
- Documents render filename, type, size when available, and an Open action.
- Raw storage URLs and credentials are not displayed or embedded.

Known limitation: if one file in a multi-file sequence uploads and a later upload or message send fails, the canonical API has no deletion operation to clean the unattached upload. The UI preserves the local selection for retry, but server-side orphan cleanup remains a backend concern.

## I. Contract PDF

### Audited source and root cause status

The current mobile base no longer contains the historical “text contract as document” implementation. Its active path is:

```text
GET /api/m/contracts/current
  -> contract.tenantDocument (server-selected canonical document)
  -> preferredContractDocument/buildContractSummary
  -> /document-viewer with contract-final or contract-prepared kind
```

Selection priority is:

1. server-resolved `tenantDocument` (including final notarized/tenant-visible decision);
2. legacy `finalDocument`/`preparedDocument` flags only if `tenantDocument` is entirely absent;
3. lifecycle/empty state when no authorized document exists.

No active mapper strips file URLs or reconstructs a PDF from text. The Contract screen may show a metadata summary, but the View Contract action uses the protected canonical viewer endpoint.

Changes in this phase:

- `contract_document_ready` invalidates the hook while the app is open;
- app background → active and screen focus still refetch;
- notification deep links retain `contract_id`;
- the viewer refuses to silently show a different current contract for a mismatched deep link; and
- Contract → Contact Support supplies canonical context.

## J. Files Changed

### Canonical backend worktree

| Path | Reason and behavior |
|---|---|
| `server/routes/mobileChatRoutes.js` | New thin `/api/m/chat/*` transport adapter to canonical controller; multipart limits/errors |
| `server/server.js` | Mount adapter before remaining vendored mobile routes |
| `server/mobile/routes/index.js` | Stop mounting duplicate mobile chat routes |
| `server/mobile/routes/chat.routes.js` | Removed duplicate route table |
| `server/mobile/controllers/chat.controller.js` | Removed duplicate mobile chat domain controller |
| `server/controllers/chatController.js` | Canonical mobile `initialMessage` compatibility, retry dedupe, and tenant close operation |
| `server/routes/chatRoutes.js` | Expose canonical tenant close route on `/api/chat` too |
| `server/middleware/mobileTenantAuth.js` | Extract reusable mobile session resolver shared by HTTP and Socket.IO |
| `server/utils/socket.js` | Authenticate mobile sockets with canonical mobile session token |
| `server/services/mobileNotificationBridge.js` | Project canonical `message_id` from direct fields/data/dedupe key |
| `server/controllers/chatController.context.test.js` | Verify canonical initial-message persistence alongside context behavior |
| `server/mobile/controllers/chatLifecycle.test.js` | Reconciled old duplicate-controller tests into adapter/lifecycle authority tests |
| `server/mobile/controllers/chatBranchResolution.test.js` | Reconciled old duplicate-controller tests into context/branch authority tests |
| `server/mobile/controllers/chatbotBsonRegression.test.js` | Point chat BSON regression at canonical controller after deletion |
| `server/routes/chatRoutes.authorization.test.js` | Mock/test canonical tenant close route authorization |
| `server/routes/mobileFullMountOrder.test.js` | Include canonical mobile chat adapter in full mount-order coverage |
| `server/services/mobileNotificationBridge.test.js` | Verify `chat_reply` conversation/message projection |
| `server/utils/socket.auth.behavior.test.js` | Verify mobile session-token socket authentication |

### Mobile worktree

| Path | Reason and behavior |
|---|---|
| `frontend/app/contract-viewer.jsx` | Exact contract-ID guard and Contract → Contact Support context flow |
| `frontend/package.json` | Add `socket.io-client` runtime dependency |
| `frontend/package-lock.json` | Lock dependency graph |
| `frontend/src/services/realtime.js` | Authenticated singleton Socket.IO client and local subscriptions |
| `frontend/src/services/canonicalEvents.js` | Canonical event normalization and local cross-transport presentation dedupe |
| `frontend/src/services/notifications.js` | Explicit `chat_reply`/`contract_document_ready` routes; retain entity IDs |
| `frontend/src/services/api.js` | Canonical multipart upload, satisfaction fields, typing API |
| `frontend/src/context/AuthContext.js` | Start/stop realtime with auth; unify push/socket foreground presentation and feed refetch |
| `frontend/src/hooks/useTenantContract.js` | Refetch on `contract_document_ready` without logout/refocus |
| `frontend/src/components/AppHeader.js` | Retain stored `message_id` through notification routing |
| `frontend/src/screens/LilyAssistantScreen.jsx` | Realtime refresh, exact deep link/highlight, context card, canonical uploads, actual statuses, lifecycle/satisfaction, confirmations, safer errors |
| `frontend/src/components/assistant/MessageBubble.jsx` | Canonical avatar mapping, attachment-only rendering, protected thumbnails/full-screen image preview, document cards |
| `frontend/src/components/assistant/InquiryCard.jsx` | Display actual canonical status labels/tones |
| `frontend/src/utils/supportConversationPresentation.js` | Central canonical status labels/grouping |
| `frontend/src/utils/chatErrorMessage.js` | Readable 409/413/422 and attachment errors |
| `frontend/src/tests/phase2NotificationNavigation.test.js` | Exact contract/chat entity route coverage including `message_id` |
| `frontend/src/tests/phase4InquiryAttachments.test.js` | Canonical multipart and attachment-only behavior coverage |
| `frontend/src/tests/useTenantContract.test.js` | Foreground canonical contract-event invalidation coverage |
| `frontend/src/tests/chatReconciliation.test.js` | New status/error mapping coverage |
| `frontend/src/tests/canonicalEvents.test.js` | Cross-transport event normalization/dedupe coverage |
| `frontend/src/tests/mobileContractSupportReconciliation.test.js` | Context/lifecycle/notification/source architecture guards |

## K. Tests

| Check | Command | Result |
|---|---|---|
| Canonical server CI regression | `npm run test:ci -- --silent` | **219 suites passed; 2,114 tests passed; 0 failed** |
| Mobile frontend full regression | `npm test -- --runInBand --silent` | **64 suites passed; 397 tests passed; 0 failed** |
| Mobile lint | `npm run lint` | **Passed; 0 errors/warnings** |
| Canonical JS syntax | `node --check` on changed runtime JS | **Passed** |
| Mobile release contract | `npm run verify:release-contract` | **Passed: 1.2.1 (20), canonical API, standalone profiles** |
| Canonical `git diff --check` | `git diff --check` | **Passed** (line-ending conversion notices only) |
| Mobile `git diff --check` | `git diff --check` | **Passed** (line-ending conversion notices only) |
| Expo diagnostics | `npx expo-doctor` | **15/17 passed; 2 existing dependency-hygiene checks failed** |
| TypeScript | No repository typecheck script/configured TS gate | **Not run / not configured** |

Server CI uses the repository's `test:ci` command, which intentionally ignores tests whose path matches `integration`. It also force-exits after completion and reports the repository's existing open-handle advisory. All selected chat, notification, adapter, socket, authority, and security tests are included in the passing result.

Expo Doctor findings:

1. `@types/react-native` is installed directly even though React Native includes types.
2. Five Expo packages are one patch behind the currently recommended SDK 54 patch versions: `expo`, `expo-constants`, `expo-file-system`, `expo-local-authentication`, and `jest-expo`.

These dependency-version findings pre-existed this functional scope and were not auto-upgraded during the reconciliation.

## L. Build Proof

**NOT BUILT.**

No APK/IPA path, build ID, install proof, or launch proof exists for these changes. The source currently declares:

- app version: `1.2.1`
- Android versionCode: `20`
- API base URL: `https://api.lilycrest.space`
- Profile build footer: app version, build number, Git commit, API URL, and build timestamp

Because the reconciliation is uncommitted, a build made now would identify the previous HEAD (`a50be389`) rather than a committed reconciliation SHA. Do not claim any existing APK contains these fixes.

## M. Real Device QA

### Executed

- None.

### Not executed

- Android or iOS build/install/launch
- small-phone, large-phone, and tablet responsive inspection
- keyboard/safe-area behavior in support and satisfaction UI
- image/PDF picker and protected preview on device
- actual admin ↔ tenant realtime message round trip
- actual OS push in foreground, background, and terminated states
- cold-start auth restoration from a push tap
- same-contract/different-contract behavior against deployed reconciliation backend
- unauthorized/oversized/unsupported attachment scenarios against production
- exact final-contract publication while the app remains open

### Passed / failed

- Passed on real device: none claimed.
- Failed on real device: none observed because the matrix was not executed.

## N. Remaining Risks

1. **Deployment sequencing is the primary blocker.** Production is healthy at base `b91101ad3`, not at a commit containing the local adapter/socket/projection changes. Mobile device QA must wait for backend merge and deployment confirmation.
2. **Two-repository atomicity.** The canonical backend and mobile changes must be reviewed, committed, and released in a coordinated order. The backend should deploy first because the new mobile attachment and socket transports depend on it.
3. **No artifact or physical-device evidence.** Automated tests do not prove native Socket.IO, Expo push, file picker, image rendering, keyboard behavior, or cold-start navigation on a release build.
4. **Attachment orphan cleanup.** The audited canonical API has no chat-attachment deletion operation; a partial multi-file upload followed by failure can leave an unattached stored record/file.
5. **Historical contract notifications.** The mobile API exposes the current canonical contract, not an arbitrary contract-by-ID tenant endpoint. A notification pointing to a no-longer-current contract is safely rejected by the exactness guard rather than silently displaying another contract, but it cannot display the historical document.
6. **Expo dependency hygiene.** Expo Doctor remains 15/17 until the direct `@types/react-native` dependency and five SDK patch-level mismatches are handled in a separate dependency maintenance change.
7. **Server test process advisory.** The canonical server suite passes but still requires `--forceExit` and prints the existing Jest open-handle advisory; this is not introduced by the reconciliation, but should be investigated separately.
8. **Typing emission is not wired into the text input.** The canonical typing route and mobile API method exist, but enabling throttled typing UI was left out to avoid adding noisy realtime traffic without real-device measurement.

## Final Definition-of-Done Status

| Item | Status |
|---|---|
| Mobile based on canonical target/descendant | Complete |
| Production base SHA verified | Complete (`b91101ad3`) |
| `/api/m/chat/*` duplicate domain removed in source | Complete |
| Existing mobile route compatibility preserved | Complete in source/tests |
| Contract context + Contact Support | Complete in source/tests |
| Same/different/generic reuse authority | Complete in canonical source/tests |
| Reopen/resolution/satisfaction | Complete in source/tests |
| `chat_reply` only; IDs retained | Complete in source/tests |
| Foreground event reconciliation/dedupe | Complete in source/tests |
| Background/cold-start route architecture | Complete in source/tests; device test pending |
| Canonical contract PDF/invalidation | Complete in source/tests |
| Canonical attachments and protected rendering | Complete in source/tests |
| Ticket IDs/profile/status/branch authority | Complete in source/tests |
| Backend reconciliation deployed | Pending |
| APK/IPA built | Not built |
| Real-device QA | Not executed |
