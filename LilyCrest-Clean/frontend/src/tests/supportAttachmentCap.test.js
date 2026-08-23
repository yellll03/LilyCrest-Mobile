/* global __dirname, test */

// The support-chat attachment cap has to say 5 in every layer that can refuse
// a file: the compose UI's selection limit, the count it shows the tenant, the
// message it fails with, and the mobile backend that must not trust any of
// them. This suite pins the client half and its agreement with the server
// constant; backend/tests/chatSupportLifecycle.test.js exercises the server
// half against the real handlers.
//
// Following this repo's existing convention for screen-level guarantees
// (see phase4InquiryAttachments.test.js), the composer is asserted by reading
// its source — LilyAssistantScreen.jsx is not independently mountable here.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('support-chat attachment cap parity', () => {
  const screen = read('src/screens/LilyAssistantScreen.jsx');
  // The mobile backend's single named source for the same numbers.
  const backendConstants = require(path.join(root, '..', 'backend', 'constants', 'supportAttachments.js'));

  test('the canonical per-message cap is 5, matching the admin web repository', () => {
    expect(backendConstants.MAX_SUPPORT_ATTACHMENTS).toBe(5);
    expect(screen).toContain('const MAX_SUPPORT_ATTACHMENT_COUNT = 5;');
  });

  test('the AI assistant keeps its own, deliberately different cap of 3', () => {
    // Assistant attachments are inlined into a model request by
    // backend/services/assistantAttachment.service.js (MAX_ATTACHMENTS = 3).
    // Raising the support cap must not silently raise this one.
    expect(screen).toContain('const MAX_ASSISTANT_ATTACHMENT_COUNT = 3;');
  });

  test('the composer picks its cap from the mode it is in, not one shared literal', () => {
    // A selected inquiry thread (opened from "My Inquiries") is always an
    // admin-support conversation but does not drive the shared `chatMode`
    // state machine, so the mode check is widened to also recognize that
    // context rather than keying on `chatMode` alone.
    expect(screen).toContain('const isSupportAttachmentContext = isSupportMode(chatMode) || Boolean(selectedInquiry);');
    expect(screen).toContain('const maxAttachmentCount = isSupportAttachmentContext');
    expect(screen).toContain('? MAX_SUPPORT_ATTACHMENT_COUNT');
    expect(screen).toContain(': MAX_ASSISTANT_ATTACHMENT_COUNT;');
    // No stale single-cap constant may survive.
    expect(screen).not.toContain('MAX_ATTACHMENT_COUNT = 3;');
    expect(screen).not.toMatch(/prev\.length >= 3/);
  });

  test('selection limit and failure message both come from the mode-aware cap', () => {
    expect(screen).toContain('if (prev.length >= maxAttachmentCount)');
    expect(screen).toContain('You can attach up to ${maxAttachmentCount} files per message.');
  });

  test('the tenant is shown how much of the allowance is used', () => {
    expect(screen).toContain('attachmentCountLimit');
    expect(screen).toContain('${attachments.length} of ${attachmentCountLimit} attached');
    expect(screen).toContain('const attachmentCountLimit = isSupportAttachmentContext');
  });

  test('a selected inquiry thread can attach and send files, not just text', () => {
    // This is the composer reached from "My Inquiries" — a distinct render
    // branch from the main chat composer above. It must reuse the same
    // upload-then-register pipeline and cap/MIME rules, not a second one.
    expect(screen).toContain("placeholder=\"Reply to admin support...\"");
    expect(screen).toMatch(/onPress=\{\(\) => setShowAttachMenu\(\(value\) => !value\)\}\s*\n\s*disabled=\{isSendingReply\}/);
    expect(screen).toMatch(/await apiService\.sendSupportMessage\(\s*conversationId,\s*text,\s*uploadedAttachments,\s*replyMessageRequestRef\.current\.id,\s*\);/);
    expect(screen).toMatch(/if \(\(!text && !attachments\.length\) \|\| !selectedInquiry \|\| replyGuardRef\.current\) return;/);
  });

  test('the cap counts every supported type against one allowance', () => {
    // There is exactly one counter and one limit check — no per-type quota
    // that would let 3 images + 2 PDFs behave differently from 5 images.
    const limitChecks = screen.match(/prev\.length >= maxAttachmentCount/g) || [];
    expect(limitChecks).toHaveLength(1);
  });

  test('the file-size and MIME limits agree with the canonical backend', () => {
    expect(screen).toContain('const MAX_SUPPORT_ATTACHMENT_BYTES = 5 * 1024 * 1024;');
    expect(backendConstants.SUPPORT_ATTACHMENT_MAX_BYTES).toBe(5 * 1024 * 1024);

    const declared = screen
      .slice(screen.indexOf('const SUPPORT_UPLOAD_MIME_TYPES = ['))
      .split(']')[0];
    for (const mimeType of backendConstants.SUPPORT_ATTACHMENT_MIME_TYPES) {
      expect(declared).toContain(`'${mimeType}'`);
    }
  });
});

describe('failed multi-file sends leave nothing behind', () => {
  const screen = read('src/screens/LilyAssistantScreen.jsx');
  const api = read('src/services/api.js');

  test('every attachment is registered before any message is created', () => {
    // Atomic send: the upload loop finishes before sendSupportMessage runs, so
    // no ChatMessage can ever claim an attachment that failed to upload.
    const uploadIndex = screen.indexOf('apiService.registerSupportAttachment(');
    const sendIndex = screen.indexOf('await sendSupportMessage(');
    expect(uploadIndex).toBeGreaterThan(-1);
    expect(sendIndex).toBeGreaterThan(uploadIndex);
  });

  test('a part-way failure discards the attachments that did register', () => {
    expect(screen).toContain('await discardRegisteredAttachments(supportConversationId, uploadedAttachments);');
    expect(screen).toContain('throw uploadError;');
    expect(api).toContain('discardSupportAttachment:');
    expect(api).toContain('/chat/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}');
  });

  test('rollback failure never masks the real upload error', () => {
    const helper = screen.slice(
      screen.indexOf('const discardRegisteredAttachments'),
      screen.indexOf('const handleSend'),
    );
    expect(helper).toContain('console.warn(');
    expect(helper).not.toContain('throw');
  });
});
