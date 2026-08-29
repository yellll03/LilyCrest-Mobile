/* global __dirname, test */
import fs from 'node:fs';
import path from 'node:path';
import { resolveNotificationRoute } from '../services/notifications';

jest.mock('../config/firebase', () => ({ getFreshIdToken: jest.fn() }));

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Lily Assistant global access and return routing', () => {
  test.each([
    ['app/(tabs)/home.jsx', '/(tabs)/home'],
    ['app/(tabs)/services.jsx', '/(tabs)/services'],
    ['app/(tabs)/announcements.jsx', '/(tabs)/announcements'],
    ['app/billing-history.jsx', '/(tabs)/billing'],
  ])('%s renders the shared assistant FAB with its own return route', (file, returnTo) => {
    const source = read(file);
    expect(source).toContain('LilyAssistantFab');
    expect(source).toContain(`<LilyAssistantFab returnTo="${returnTo}" />`);
  });

  test('the shared FAB passes returnTo and Billing no longer owns a duplicate implementation', () => {
    const fab = read('src/components/assistant/LilyAssistantFab.jsx');
    const billing = read('app/billing-history.jsx');
    expect(fab).toContain("pathname: '/(tabs)/chatbot'");
    expect(fab).toContain('params: { returnTo }');
    expect(billing).not.toContain('chatbotFab:');
    expect(billing).not.toContain("LilyFlowerIcon from '../src/components/assistant/LilyFlowerIcon'");
  });

  test('the assistant exposes a safe cross-platform Back action', () => {
    const assistant = read('src/screens/LilyAssistantScreen.jsx');
    expect(assistant).toContain('normalizeAssistantReturnRoute(returnToParam)');
    expect(assistant).toContain('router.replace(assistantReturnRoute)');
    expect(assistant).toContain('Returns to the screen that opened Lily Assistant');
  });
});

describe('notification route safety matrix', () => {
  test('current tenant billing, maintenance, contract, chat, and announcement types route canonically', () => {
    expect(resolveNotificationRoute({ type: 'payment_confirmed', screen: 'billing', billing_id: 'b-1' }))
      .toEqual({ pathname: '/bill-details', params: { billId: 'b-1' } });
    expect(resolveNotificationRoute({ type: 'maintenance_update', request_id: 'm-1' }))
      .toEqual({ pathname: '/(tabs)/services', params: { requestId: 'm-1' } });
    expect(resolveNotificationRoute({ type: 'contract_document_ready', contract_id: 'c-1' }))
      .toEqual({ pathname: '/contract-viewer', params: { contractId: 'c-1' } });
    expect(resolveNotificationRoute({ type: 'chat_reply', conversation_id: 'chat-1' }))
      .toEqual({ pathname: '/(tabs)/chatbot', params: { conversationId: 'chat-1' } });
    expect(resolveNotificationRoute({ type: 'announcement', announcement_id: 'a-1' }))
      .toEqual({ pathname: '/(tabs)/announcements', params: { announcementId: 'a-1' } });
  });

  test('missing resources route to valid parent screens and legacy types use the inbox', () => {
    expect(resolveNotificationRoute({ type: 'payment_confirmed', screen: 'billing' })).toBe('/(tabs)/billing');
    expect(resolveNotificationRoute({ type: 'maintenance_update' })).toBe('/(tabs)/services');
    expect(resolveNotificationRoute({ type: 'announcement' })).toBe('/(tabs)/announcements');
    expect(resolveNotificationRoute({ type: 'legacy_applicant_payment' })).toBe('/notifications');
    expect(resolveNotificationRoute({ url: '/removed/route' })).toBe('/notifications');
  });

  test('actual unsupported taps opt into diagnostic reporting without exposing a dead end', () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveNotificationRoute(
      { type: 'legacy_unknown' },
      { reportUnsupported: true },
    )).toBe('/notifications');
    expect(warning).toHaveBeenCalledWith(
      '[Notifications] Falling back to the notification inbox',
      expect.objectContaining({ type: 'legacy_unknown' }),
    );
    warning.mockRestore();
  });
});
