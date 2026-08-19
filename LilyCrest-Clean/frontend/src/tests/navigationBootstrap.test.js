/* global __dirname, test */
import fs from 'node:fs';
import path from 'node:path';
import { resolveNotificationRoute } from '../services/notifications';

jest.mock('../config/firebase', () => ({ getFreshIdToken: jest.fn() }));

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('authenticated navigation bootstrap', () => {
  const login = read('app/login.jsx');
  const index = read('app/index.jsx');
  const tabLayout = read('app/(tabs)/_layout.jsx');
  const rootLayout = read('app/_layout.jsx');
  const authContext = read('src/context/AuthContext.js');

  test('authentication, cold start, and restored sessions enter Home', () => {
    expect(login).toContain("router.replace('/(tabs)/home')");
    expect(authContext).toContain('getSessionToken()');
    expect(index).toContain("router.replace('/(tabs)/home')");
    expect(tabLayout).toContain('initialRouteName="home"');
    expect(tabLayout).toContain('backBehavior="history"');
  });

  test('logout returns protected navigation to Login', () => {
    expect(authContext).toContain("setAuthStatus('unauthenticated')");
    expect(rootLayout).toContain("router.replace('/login')");
  });

  test('explicit notification destinations remain exceptions to Home bootstrap', () => {
    expect(resolveNotificationRoute({ type: 'bill_generated', billing_id: 'bill-1' }))
      .toEqual(expect.objectContaining({ pathname: '/bill-details' }));
    expect(resolveNotificationRoute({ type: 'contract_document_ready', contractId: 'contract-1' }))
      .toEqual(expect.objectContaining({ pathname: '/contract-viewer' }));
    expect(resolveNotificationRoute({ type: 'maintenance_update', request_id: 'request-1' }))
      .toEqual(expect.objectContaining({ pathname: '/(tabs)/services' }));
    expect(resolveNotificationRoute({ type: 'chat_reply', conversationId: 'conversation-1' }))
      .toEqual(expect.objectContaining({ pathname: '/(tabs)/chatbot' }));
    expect(resolveNotificationRoute({ type: 'announcement', announcement_id: 'announcement-1' })).toEqual({
      pathname: '/(tabs)/announcements',
      params: { announcementId: 'announcement-1' },
    });
  });
});
