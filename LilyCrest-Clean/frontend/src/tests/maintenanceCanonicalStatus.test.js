/* global __dirname, test */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const screen = fs.readFileSync(path.join(root, 'app/(tabs)/services.jsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'src/services/api.js'), 'utf8');

describe('canonical maintenance presentation', () => {
  test.each([
    'pending_review',
    'assigned',
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

  // The 5-stage Guided Stage Action Hub (commit 45bbf64f) is a client-side
  // presentational grouping over the backend's richer status vocabulary. Every
  // status the backend can actually write must land in exactly one stage —
  // an unmapped status makes STATUS_STAGES.findIndex return -1 and the entire
  // hub silently renders nothing for that request.
  test('every backend maintenance status maps into exactly one of the 5 stages', () => {
    const backendSource = fs.readFileSync(
      path.join(root, '..', 'backend', 'controllers', 'maintenance.controller.js'),
      'utf8',
    );
    const validStatuses = backendSource
      .match(/const VALID_STATUSES = \[([^\]]*)\]/)[1]
      .match(/'([^']+)'/g)
      .map((quoted) => quoted.replace(/'/g, ''));

    const stageBlock = screen.slice(
      screen.indexOf('const STATUS_STAGES = ['),
      screen.indexOf('const MIN_DESCRIPTION_LENGTH'),
    );
    const stageStatusLists = stageBlock.match(/statuses: \[[^\]]*\]/g);
    expect(stageStatusLists).toHaveLength(5);

    const stageMemberships = stageStatusLists.map((list) => (
      (list.match(/'([^']+)'/g) || []).map((quoted) => quoted.replace(/'/g, ''))
    ));

    // Terminal statuses have no stage in the progress hub by design — they are
    // surfaced through RESOLVED_STATUSES/CLOSED_REPLY_STATUSES instead.
    const terminal = new Set(['rejected', 'cancelled']);

    for (const status of validStatuses) {
      if (terminal.has(status)) continue;
      const owningStages = stageMemberships.filter((members) => members.includes(status));
      expect(owningStages).toHaveLength(1);
    }
  });

  test('does not call a nonexistent maintenance read endpoint or invent unread counts', () => {
    expect(api).not.toContain('markMaintenanceRead');
    expect(screen).not.toContain('unreadTenantCount');
  });
});
