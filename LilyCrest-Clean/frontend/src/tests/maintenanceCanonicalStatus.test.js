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

  test('does not call a nonexistent maintenance read endpoint or invent unread counts', () => {
    expect(api).not.toContain('markMaintenanceRead');
    expect(screen).not.toContain('unreadTenantCount');
  });
});
