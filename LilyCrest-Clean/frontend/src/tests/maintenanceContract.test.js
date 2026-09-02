/* global test */
import {
  CANONICAL_MAINTENANCE_REQUEST_TYPES,
  CANONICAL_MAINTENANCE_URGENCIES,
  MAX_MAINTENANCE_ATTACHMENTS,
  extractMaintenanceList,
  extractMaintenanceRequest,
  getMaintenanceTenantActions,
  reconcileMaintenanceRequest,
} from '../utils/maintenanceContract';

describe('canonical mobile maintenance contract', () => {
  test('exposes the canonical categories, urgency semantics, and attachment limit', () => {
    expect(CANONICAL_MAINTENANCE_REQUEST_TYPES).toEqual([
      'maintenance', 'plumbing', 'electrical', 'aircon', 'elevator',
      'furniture', 'internet', 'cleaning', 'pest', 'other',
    ]);
    expect(CANONICAL_MAINTENANCE_URGENCIES).toEqual([
      'low', 'normal', 'high', 'urgent', 'emergency',
    ]);
    expect(MAX_MAINTENANCE_ATTACHMENTS).toBe(5);
  });

  test('consumes canonical envelopes and legacy responses during rollout', () => {
    const request = { request_id: 'm1' };
    expect(extractMaintenanceList({ data: { data: { requests: [request] } } })).toEqual([request]);
    expect(extractMaintenanceList({ data: [request] })).toEqual([request]);
    expect(extractMaintenanceRequest({ data: { data: { request } } })).toBe(request);
    expect(extractMaintenanceRequest({ data: request })).toBe(request);
  });

  test('uses server-returned action capabilities and reconciles returned DTOs', () => {
    const request = {
      request_id: 'm1',
      tenantActions: { canCancel: true, canRequestReschedule: false },
    };
    expect(getMaintenanceTenantActions(request)).toEqual({
      canEdit: false,
      canCancel: true,
      canReopen: false,
      canConfirmResolution: false,
      canRequestReschedule: false,
      canReply: false,
      canSubmitSimilar: false,
    });
    expect(reconcileMaintenanceRequest([{ request_id: 'm1', status: 'pending' }, { request_id: 'm2' }], { request_id: 'm1', status: 'cancelled' }))
      .toEqual([{ request_id: 'm1', status: 'cancelled' }, { request_id: 'm2' }]);
  });
});
