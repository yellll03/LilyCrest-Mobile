export const CANONICAL_MAINTENANCE_REQUEST_TYPES = Object.freeze([
  'maintenance',
  'plumbing',
  'electrical',
  'aircon',
  'elevator',
  'furniture',
  'internet',
  'cleaning',
  'pest',
  'other',
]);

export const CANONICAL_MAINTENANCE_URGENCIES = Object.freeze([
  'low',
  'normal',
  'high',
  'urgent',
  'emergency',
]);

export const MAX_MAINTENANCE_ATTACHMENTS = 5;

export function extractMaintenanceList(response) {
  const body = response?.data;
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.requests)) return body.requests;
  if (Array.isArray(body?.data?.requests)) return body.data.requests;
  return [];
}

export function extractMaintenanceRequest(response, fallback = null) {
  const body = response?.data;
  return body?.data?.request || body?.request || body?.data || body || fallback;
}

export function getMaintenanceTenantActions(request = {}) {
  const actions = request?.tenantActions || request?.tenant_actions;
  if (!actions || typeof actions !== 'object') return null;
  return {
    canEdit: actions.canEdit === true,
    canCancel: actions.canCancel === true,
    canReopen: actions.canReopen === true,
    canConfirmResolution: actions.canConfirmResolution === true,
    canRequestReschedule: actions.canRequestReschedule === true,
    canReply: actions.canReply === true,
    canSubmitSimilar: actions.canSubmitSimilar === true,
  };
}

export function reconcileMaintenanceRequest(list = [], updatedRequest) {
  if (!updatedRequest?.request_id) return [...list];
  const next = list.filter((request) => request?.request_id !== updatedRequest.request_id);
  return [updatedRequest, ...next];
}
