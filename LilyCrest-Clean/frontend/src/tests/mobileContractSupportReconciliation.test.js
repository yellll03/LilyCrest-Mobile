/* global __dirname, test */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('mobile contract/support canonical consumption', () => {
  const contractViewer = read('app/contract-viewer.jsx');
  const assistant = read('src/screens/LilyAssistantScreen.jsx');
  const api = read('src/services/api.js');
  const notifications = read('src/services/notifications.js');

  test('Contract Contact Support submits canonical context and opens the returned exact thread', () => {
    expect(contractViewer).toContain("entityType: 'contract'");
    expect(contractViewer).toContain('entityId: contract.id');
    expect(contractViewer).toContain("sourceModule: 'contract'");
    expect(contractViewer).toContain("params: { conversationId }");
    expect(contractViewer).not.toMatch(/branch\s*:/);
  });

  test('support lifecycle exposes actual statuses, optional satisfaction, and same-thread NO', () => {
    expect(assistant).toContain('supportStatusLabel(selectedInquiry.canonicalStatus)');
    expect(assistant).toContain('satisfactionRating');
    expect(assistant).toContain('satisfactionFeedback');
    expect(assistant).toContain('confirmInquiryResolution(false, conversationId)');
    expect(api).toContain('...(satisfaction.rating ? { rating: satisfaction.rating } : {})');
  });

  test('canonical chat_reply routing retains both conversation and message IDs', () => {
    expect(notifications).toContain("case 'chat_reply'");
    expect(notifications).toContain('conversationId: String(conversationId)');
    expect(notifications).toContain('messageId: String(messageId)');
    expect(notifications).not.toContain("case 'support_reply'");
  });

  test('contract conversations render one compact context link instead of copying contract text into messages', () => {
    expect(assistant).toContain('Related to Contract');
    expect(assistant).toContain('View Contract');
    expect(assistant).toContain("params: { contractId: context.entityId }");
  });

  test('support retries use stable client operation ids and no legacy work-item APIs remain', () => {
    expect(assistant).toContain("createClientOperationId('support-start')");
    expect(assistant).toContain("createClientOperationId('support-message')");
    expect(assistant).toContain("createClientOperationId('support-reply')");
    expect(assistant).toContain('clientAttachmentId');
    expect(api).toContain('clientMessageId');
    expect(api).not.toContain('requestAdminChat:');
    expect(api).not.toContain('getMyTickets:');
  });

  test('long support threads expose cursor pagination and an explicit load-earlier control', () => {
    expect(api).toContain('getSupportChatMessages: (conversationId, params = {})');
    expect(assistant).toContain('pageInfo.nextCursor');
    expect(assistant).toContain('Load Earlier Messages');
    expect(assistant).toContain('mergeSupportThread(older');
  });
});
