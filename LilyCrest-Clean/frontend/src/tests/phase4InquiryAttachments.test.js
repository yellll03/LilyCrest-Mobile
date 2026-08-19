/* global __dirname, test */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Phase 4 inquiry, archive, and attachment reconciliation', () => {
  const screen = read('src/screens/LilyAssistantScreen.jsx');
  const api = read('src/services/api.js');
  const announcements = read('app/(tabs)/announcements.jsx');
  const viewer = read('src/utils/chatAttachmentViewer.js');
  const bubble = read('src/components/assistant/MessageBubble.jsx');

  test('announcement swipe Archive uses the design-system error token', () => {
    expect(announcements).toMatch(/swipeAction:\s*\{[\s\S]*backgroundColor:\s*c\.error/);
    expect(announcements).toContain('accessibilityLabel={`Archive');
  });

  test('waiting_tenant renders an explicit YES / NO confirmation backed by the canonical endpoint', () => {
    expect(screen).toContain("AWAITING_CONFIRMATION: 'awaiting_confirmation'");
    expect(screen).toContain('Was your concern resolved?');
    expect(screen).toContain('confirmInquiryResolution(true');
    expect(screen).toContain('confirmInquiryResolution(false');
    expect(api).toContain('confirmSupportResolution:');
    expect(api).toContain("api.patch(`/chat/${conversationId}/resolution`");
  });

  test('same-thread reopen and resolved timestamp remain visible', () => {
    expect(api).toContain('reopenSupportChat:');
    expect(screen).toContain('Resolved on {resolvedTimestamp}');
    expect(screen).toContain("'Reopen Inquiry'");
    expect(screen).toContain('selectedInquiry.thread.map');
  });

  test('support attachments use the authenticated chat pipeline and survive history mapping', () => {
    expect(screen).not.toContain('Attachments are not supported in admin support yet.');
    // Support attachments go through the single durable-storage pipeline this
    // codebase already has (POST /upload/firebase-storage via
    // ensureFirebaseStorageAttachments), then register the server-issued
    // metadata against the conversation. The old multipart path posted to a
    // route the backend never registered, so every upload 404'd; there is
    // deliberately no second storage system and no multipart parser.
    expect(screen).toContain('ensureFirebaseStorageAttachments(');
    expect(screen).toContain('apiService.registerSupportAttachment(');
    expect(screen).toContain("folder: SUPPORT_ATTACHMENT_FOLDER");
    expect(api).not.toContain("form.append('file'");
    expect(api).toContain('registerSupportAttachment:');
    expect(api).toContain('/attachments`, { attachment }');
    expect(screen).toContain('attachments: Array.isArray(message.attachments)');
    expect(api).toContain('sendSupportMessage: (conversationId, message, attachments = [])');
    expect(bubble).toContain('onOpen?.(file)');
    expect(bubble).toContain('attachmentThumbnail');
    expect(screen).toContain('text,');
    expect(screen).not.toContain("text: text || 'Shared attachments'");
  });

  test('attachment opening uses the current session token and only protected chat paths', () => {
    expect(viewer).toContain("relativeUrl.startsWith('/chat/')");
    expect(viewer).toContain('getSessionToken()');
    expect(viewer).toContain('Authorization: `Bearer ${token}`');
    expect(viewer).toContain('MOBILE_API_BASE_URL');
  });

  test('the unused duplicate Lily chatbot implementation is removed', () => {
    expect(fs.existsSync(path.join(root, 'src/components/LilyChatbot.js'))).toBe(false);
  });
});
