# Smart Tenant Assistant Enhancement

Date: 2026-07-24

## Implemented

- English, Tagalog, and Taglish style detection for grounded billing answers.
- Model instructions to mirror the tenant's language naturally.
- Tenant-scoped retrieval already present for bills, maintenance, announcements, profile, room/bed, and support conversations.
- Contract context now includes only available authenticated-user/reservation metadata: start/end dates, lease type, monthly rent, and deposit.
- Multi-turn context remains isolated by session and an authenticated-user fingerprint.
- Explicit cross-tenant privacy guard.
- Email addresses and internal tenant IDs removed from Gemini prompt context.
- Assistant attachments now travel from the UI to the backend instead of being discarded.
- Image/PDF understanding using Gemini multimodal input.
- Attachment-only questions automatically request a verified summary.
- Server-side attachment controls:
  - maximum three files;
  - JPEG, PNG, WebP, or PDF only;
  - maximum 10 MiB each;
  - Firebase URL/object-path consistency;
  - required `ai-assistant-attachments/{authenticatedTenantId}/` ownership prefix;
  - response MIME match;
  - non-empty body;
  - PDF `%PDF-` signature.
- Safe messages for inaccessible, unauthorized, unsupported, or unreadable files.
- Prompt safeguards against identifying people, medical diagnosis, invented clauses, and unsupported conclusions.

## Retrieval flow

```text
Authenticated message
  -> privacy/session guard
  -> deterministic intent routing
  -> tenant-scoped database retrieval
  -> authorized policy hints
  -> optional tenant-owned attachment validation
  -> grounded multilingual prompt
  -> concise response or explicit missing-data result
```

## Files changed

- `frontend/src/services/api.js`
- `frontend/src/hooks/useAssistantChat.js`
- `frontend/src/screens/LilyAssistantScreen.jsx`
- `backend/controllers/chatbot.controller.js`
- `backend/services/gemini.service.js`
- `backend/services/assistantAttachment.service.js`
- `backend/tests/assistantAttachment.test.js`
- `backend/tests/chatbotLanguagePrivacy.test.js`

## Verification

- Frontend full suite: 54 tests passed.
- Frontend focused assistant/upload suite: 7 tests passed.
- Expo lint: passed.
- Backend full suite: 66 tests passed.
- New tests cover English/Tagalog/Taglish classification, cross-tenant privacy detection, tenant storage-path ownership, metadata/URL substitution, MIME/signature validation, and unsupported input rejection.

## Important limitations

- Live Gemini OCR, receipt extraction, image description, and PDF summarization require the updated backend to be deployed with a valid Gemini key and must be tested with authorized fixtures.
- Existing stored contract/application documents are not automatically fetched into the model. The tenant can attach an authorized local PDF/image; contract metadata questions use tenant-scoped database fields. Automatic stored-document RAG needs a server-managed document index or storage-object authorization registry.
- Scanned PDF quality depends on Gemini vision/OCR. The assistant returns a safe unreadable-file response when preprocessing or model access fails.
- No face/person identification or medical analysis is implemented.
- Admin analytics were not expanded; existing admin permissions remain unchanged.
- Conversation storage remains in-memory, so context does not survive backend restarts and is unsuitable for multi-instance deployment without Redis/database persistence.
