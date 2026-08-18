/* global test, __dirname */
import fs from 'fs';
import path from 'path';
import {
  getLatestOutgoingMessageId,
  inquiryTicketLabel,
  tenantMessageDeliveryStatus,
} from '../utils/supportConversationPresentation';

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('support inquiry presentation', () => {
  test('shows a stable ticket ID in list and detail surfaces', () => {
    expect(inquiryTicketLabel('inq-2026-000123')).toBe('INQ-2026-000123');
    expect(inquiryTicketLabel('')).toBe('Inquiry ID pending');
    const screen = read('src/screens/LilyAssistantScreen.jsx');
    expect(screen).toContain('ticketId={item.ticketId}');
    expect(screen).toContain('{selectedInquiry.ticketId}');
  });

  test('only the newest outgoing tenant message receives canonical Sent or Seen status', () => {
    const messages = [
      { id: 'tenant-1', sender: 'user', readAt: '2026-08-18T01:00:00.000Z' },
      { id: 'admin-1', sender: 'admin', readAt: null },
      { id: 'tenant-2', sender: 'user', readAt: null },
    ];
    expect(getLatestOutgoingMessageId(messages)).toBe('tenant-2');
    expect(tenantMessageDeliveryStatus(messages[0])).toBe('Seen');
    expect(tenantMessageDeliveryStatus(messages[2])).toBe('Sent');
    expect(tenantMessageDeliveryStatus(messages[1])).toBe('');
  });

  test('message mapping preserves backend readAt and canonical polling replaces optimistic support rows', () => {
    const screen = read('src/screens/LilyAssistantScreen.jsx');
    expect(screen).toContain('readAt: message.readAt || null');
    expect(screen).toContain("!String(item.id || '').startsWith('support-')");
    expect(screen).toContain('showDeliveryStatus={item.id === latestOutgoingMessageId}');
  });

  test('detail footer reserves measured tab-bar space on Android and keyboard resize remains enabled', () => {
    const screen = read('src/screens/LilyAssistantScreen.jsx');
    expect(screen).toContain('useBottomTabBarHeight()');
    expect(screen).toContain('styles.detailScreen, { paddingBottom: tabBarHeight }');
    expect(screen).toContain("behavior={Platform.OS === 'ios' ? 'padding' : 'height'}");
  });
});
