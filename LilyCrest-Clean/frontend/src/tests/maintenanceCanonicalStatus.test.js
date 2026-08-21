/* global __dirname, test */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const screen = fs.readFileSync(path.join(root, 'app/(tabs)/services.jsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'src/services/api.js'), 'utf8');

describe('canonical maintenance presentation', () => {
  test.each([
    'pending_review',
    'provider_assigned',
    'reviewed',
    'waiting_tenant',
    'reopened',
  ])('%s remains visible in Active', (status) => {
    expect(screen).toMatch(new RegExp(`ACTIVE_STATUSES = \\[[^\\]]*['\"]${status}['\"]`, 's'));
  });

  test.each(['resolved', 'completed', 'rejected', 'closed'])('%s remains visible in Resolved', (status) => {
    expect(screen).toMatch(new RegExp(`RESOLVED_STATUSES = \\[[^\\]]*['\"]${status}['\"]`, 's'));
  });

  test('wires the canonical backend read-receipt endpoint instead of inventing local state', () => {
    // Backend already exposes PATCH /maintenance/:requestId/read with
    // server-computed unreadTenantCount/hasUnreadTenantUpdates — the chat
    // redesign wires the tenant UI up to that canonical state rather than
    // introducing a second, client-only read-tracking system.
    expect(api).toContain('markMaintenanceRead');
    expect(screen).toContain('apiService.markMaintenanceRead');
    expect(screen).toContain('hasUnreadTenantUpdates');
  });

  test('no longer renders a separate Follow-up Reply section', () => {
    expect(screen).not.toContain('Reply / Follow-up');
    expect(screen).not.toContain('Add follow-up details');
  });

  test('renders the maintenance thread as a single chat conversation', () => {
    expect(screen).toContain('function buildChatItems');
    expect(screen).toContain('testID="maintenance-conversation"');
    expect(screen).toContain('testID="maintenance-composer"');
    // Tenant bubbles align right, admin/staff bubbles align left.
    expect(screen).toMatch(/alignItems: isTenant \? 'flex-end' : 'flex-start'/);
  });

  test('shows a server-backed Sent/Seen receipt only on the latest outgoing message', () => {
    expect(screen).toContain('latestTenantEntryId');
    expect(screen).toContain('seenByAdmin');
    expect(screen).toMatch(/entry\.seenByAdmin \? 'Seen' : 'Sent'/);
  });

  test('composer disables sending an empty message and blocks duplicate taps while sending', () => {
    expect(screen).toMatch(/disabled=\{sendingReply \|\| \(!replyMessage\.trim\(\) && replyAttachments\.length === 0\)\}/);
  });
});
