import fs from 'fs';
import path from 'path';
import { resolveNotificationRoute } from '../services/notifications';

jest.mock('../config/firebase', () => ({ getFreshIdToken: jest.fn() }));

describe('Phase 2 canonical notification destinations', () => {
  it('routes contract document events to the contract workflow', () => {
    expect(resolveNotificationRoute({
      type: 'contract_document_ready',
      contract_id: 'contract-1',
      url: '/contract-viewer',
    })).toBe('/contract-viewer');

    expect(resolveNotificationRoute({
      type: 'contract_document_ready',
      contract_id: 'contract-2',
    })).toEqual({
      pathname: '/contract-viewer',
      params: { contractId: 'contract-2' },
    });
  });

  it('routes an admin reply to its persisted conversation', () => {
    expect(resolveNotificationRoute({
      type: 'chat_reply',
      screen: 'chat',
      conversation_id: 'conversation-1',
      url: '/(tabs)/chatbot',
    })).toEqual({
      pathname: '/(tabs)/chatbot',
      params: { conversationId: 'conversation-1' },
    });
  });

  it('routes billing events to the canonical bill', () => {
    expect(resolveNotificationRoute({
      type: 'payment_approved',
      screen: 'billing',
      billing_id: 'bill-1',
    })).toEqual({
      pathname: '/bill-details',
      params: { billId: 'bill-1' },
    });
  });

  it('routes maintenance events to the canonical request', () => {
    expect(resolveNotificationRoute({
      type: 'maintenance_update',
      screen: 'maintenance',
      request_id: 'maint-1',
      url: '/(tabs)/services',
    })).toEqual({
      pathname: '/(tabs)/services',
      params: { requestId: 'maint-1' },
    });
  });
});

describe('Phase 2 destination ownership guards', () => {
  const assistantSource = fs.readFileSync(
    path.join(process.cwd(), 'src/screens/LilyAssistantScreen.jsx'),
    'utf8',
  );
  const servicesSource = fs.readFileSync(
    path.join(process.cwd(), 'app/(tabs)/services.jsx'),
    'utf8',
  );
  const appHeaderSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/AppHeader.js'),
    'utf8',
  );

  it('the Home notification sheet resolves and pushes each canonical event destination', () => {
    expect(appHeaderSource).toMatch(/resolveNotificationRoute\(\{/);
    expect(appHeaderSource).toMatch(/router\.push\(destination\)/);
    expect(appHeaderSource).toMatch(/markNotificationRead\(notification\.notification_id\)/);
  });

  it('opens a chat deep link only after the target appears in the authenticated tenant conversation list', () => {
    expect(assistantSource).toMatch(/conversations\.find\(/);
    expect(assistantSource).toMatch(/String\(conversation\.id\) === targetConversationId/);
    expect(assistantSource).toMatch(/targetConversation\s*&&/);
  });

  it('opens a maintenance deep link only after the target appears in the authenticated tenant request list', () => {
    expect(servicesSource).toMatch(/requests\.find\(/);
    expect(servicesSource).toMatch(/String\(request\.request_id\) === targetRequestId/);
    expect(servicesSource).toMatch(/if \(!ownedRequest\) return/);
  });
});
