/* global __dirname, test */
import fs from 'node:fs';
import path from 'node:path';
import {
  getMaintenanceAllowedActions,
  getMaintenanceStatusDefinition,
  MAINTENANCE_ACTIONS,
  MAINTENANCE_GROUPS,
  MAINTENANCE_STATUS_DEFINITIONS,
  MAINTENANCE_STATUS_STAGES,
  MAINTENANCE_STAGE_KEYS,
} from '../utils/maintenanceStatus';

const root = path.resolve(__dirname, '../..');
const screen = fs.readFileSync(path.join(root, 'app/(tabs)/services.jsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'src/services/api.js'), 'utf8');
const backendController = fs.readFileSync(
  path.join(root, '..', 'backend/controllers/maintenance.controller.js'),
  'utf8',
);
const backendRoutes = fs.readFileSync(
  path.join(root, '..', 'backend/routes/maintenance.routes.js'),
  'utf8',
);

const backendStatuses = backendController
  .match(/const VALID_STATUSES = \[([^\]]*)\]/)[1]
  .match(/'([^']+)'/g)
  .map((quoted) => quoted.replace(/'/g, ''));

const EXPECTED_BACKEND_POLICY = {
  pending: {
    group: MAINTENANCE_GROUPS.ACTIVE,
    stage: MAINTENANCE_STAGE_KEYS.PENDING_REVIEW,
    actions: ['edit', 'cancel', 'reply', 'submit_similar'],
  },
  viewed: {
    group: MAINTENANCE_GROUPS.ACTIVE,
    stage: MAINTENANCE_STAGE_KEYS.UNDER_REVIEW,
    actions: ['reply', 'submit_similar'],
  },
  in_progress: {
    group: MAINTENANCE_GROUPS.ACTIVE,
    stage: MAINTENANCE_STAGE_KEYS.IN_PROGRESS,
    actions: ['reply', 'submit_similar'],
  },
  assigned: {
    group: MAINTENANCE_GROUPS.ACTIVE,
    stage: MAINTENANCE_STAGE_KEYS.IN_PROGRESS,
    actions: ['reply', 'submit_similar'],
  },
  scheduled: {
    group: MAINTENANCE_GROUPS.ACTIVE,
    stage: MAINTENANCE_STAGE_KEYS.IN_PROGRESS,
    actions: ['reply', 'submit_similar'],
  },
  resolved: {
    group: MAINTENANCE_GROUPS.RESOLVED,
    stage: MAINTENANCE_STAGE_KEYS.RESOLVED,
    actions: ['confirm_resolved', 'reopen', 'submit_similar'],
  },
  completed: {
    group: MAINTENANCE_GROUPS.RESOLVED,
    stage: MAINTENANCE_STAGE_KEYS.COMPLETED,
    actions: ['submit_similar'],
  },
  rejected: {
    group: MAINTENANCE_GROUPS.RESOLVED,
    stage: null,
    actions: ['submit_similar'],
  },
  cancelled: {
    group: MAINTENANCE_GROUPS.CANCELLED,
    stage: null,
    actions: ['submit_similar'],
  },
};

describe('canonical maintenance presentation', () => {
  test('accounts for every backend status with exactly one group, stage policy, and allowed-action policy', () => {
    expect([...backendStatuses].sort()).toEqual(Object.keys(EXPECTED_BACKEND_POLICY).sort());

    for (const status of backendStatuses) {
      const expected = EXPECTED_BACKEND_POLICY[status];
      const actual = getMaintenanceStatusDefinition(status);
      const groupMemberships = Object.values(MAINTENANCE_GROUPS)
        .filter((group) => actual.group === group);
      const stageMemberships = MAINTENANCE_STATUS_STAGES
        .filter((stage) => stage.statuses.includes(status));

      expect(groupMemberships).toHaveLength(1);
      expect(actual.group).toBe(expected.group);
      expect(actual.stage).toBe(expected.stage);
      expect(stageMemberships).toHaveLength(expected.stage ? 1 : 0);
      if (expected.stage) expect(stageMemberships[0].key).toBe(expected.stage);
      expect(getMaintenanceAllowedActions(status)).toEqual(expected.actions);
    }
  });

  test('assigned remains visible in Active and renders in the In Progress stage', () => {
    expect(getMaintenanceStatusDefinition('assigned')).toMatchObject({
      group: MAINTENANCE_GROUPS.ACTIVE,
      stage: MAINTENANCE_STAGE_KEYS.IN_PROGRESS,
    });
    expect(MAINTENANCE_STATUS_STAGES
      .find((stage) => stage.key === MAINTENANCE_STAGE_KEYS.IN_PROGRESS)
      .statuses)
      .toContain('assigned');
    expect(screen).toContain('getMaintenanceStatusGroup(request.status)');
  });

  test('an unknown future status stays visible but exposes no unsupported server mutation', () => {
    expect(getMaintenanceStatusDefinition('future_backend_status')).toMatchObject({
      group: MAINTENANCE_GROUPS.ACTIVE,
      stage: null,
      actions: [MAINTENANCE_ACTIONS.SUBMIT_SIMILAR],
    });
  });

  test.each([
    ['pending_review', MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.PENDING_REVIEW],
    ['reviewed', MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.UNDER_REVIEW],
    ['provider_assigned', MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.IN_PROGRESS],
    ['waiting_tenant', MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.IN_PROGRESS],
    ['reopened', MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.IN_PROGRESS],
    ['closed', MAINTENANCE_GROUPS.RESOLVED, null],
  ])('keeps legacy/web status %s deliberately classified', (status, group, stage) => {
    expect(MAINTENANCE_STATUS_DEFINITIONS[status]).toMatchObject({ group, stage });
  });

  test('completed does not expose confirm or reopen controls rejected by the backend', () => {
    const actions = getMaintenanceAllowedActions('completed');
    expect(actions).not.toContain(MAINTENANCE_ACTIONS.CONFIRM_RESOLVED);
    expect(actions).not.toContain(MAINTENANCE_ACTIONS.REOPEN);
    expect(screen).not.toContain("['resolved', 'completed'].includes");
  });

  test('every server-backed visible action has a registered API method and Express route', () => {
    expect(api).toContain('sendMaintenanceReply:');
    expect(backendRoutes).toContain("router.post('/:requestId/replies'");
    expect(api).toContain('confirmMaintenanceResolved:');
    expect(api).toContain("api.post(`/maintenance/${requestId}/confirm`, data)");
    expect(api).toContain('updateMaintenance:');
    expect(backendRoutes).toContain("router.put('/:requestId'");
    expect(api).toContain('cancelMaintenance:');
    expect(backendRoutes).toContain("router.patch('/:requestId/cancel'");
    expect(api).toContain('reopenMaintenance:');
    expect(backendRoutes).toContain("router.patch('/:requestId/reopen'");
  });

  test('keeps PR #21 read receipts wired to the registered endpoint', () => {
    expect(api).toContain('markMaintenanceRead');
    expect(backendRoutes).toContain("router.patch('/:requestId/read'");
    expect(screen).toContain('apiService.markMaintenanceRead');
    expect(screen).toContain('hasUnreadTenantUpdates');
    expect(screen).toContain('latestTenantEntryId');
    expect(screen).toContain('seenByAdmin');
    expect(screen).toMatch(/entry\.seenByAdmin \? 'Seen' : 'Sent'/);
  });

  test('keeps the PR #21 single conversation and duplicate-send guard', () => {
    expect(screen).toContain('function buildChatItems');
    expect(screen).toContain('testID="maintenance-conversation"');
    expect(screen).toContain('testID="maintenance-composer"');
    expect(screen).toMatch(/alignItems: isTenant \? 'flex-end' : 'flex-start'/);
    expect(screen).toMatch(/disabled=\{sendingReply \|\| \(!replyMessage\.trim\(\) && replyAttachments\.length === 0\)\}/);
  });
});
