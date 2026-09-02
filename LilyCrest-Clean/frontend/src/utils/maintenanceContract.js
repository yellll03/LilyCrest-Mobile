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

export const MAINTENANCE_EMPTY_DISPLAY_VALUE = '—';

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toDisplayScalar = (value) => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const firstDisplayScalar = (...values) => {
  for (const value of values) {
    const scalar = toDisplayScalar(value);
    if (scalar) return scalar;
  }
  return '';
};

/**
 * Room identifiers are transport values, never presentation values. Populated
 * room documents and legacy scalar room values are both accepted while the
 * mobile/backend contract rolls forward.
 */
export function getMaintenanceRoomIdentifier(room) {
  const scalar = toDisplayScalar(room);
  if (scalar) return scalar;
  if (!isRecord(room)) return null;

  const identifier = firstDisplayScalar(
    room._id,
    room.id,
    room.roomId,
    room.room_id,
    room.value,
  );
  return identifier || null;
}

export function getMaintenanceRoomDisplayName(
  room,
  fallback = MAINTENANCE_EMPTY_DISPLAY_VALUE,
) {
  const scalar = toDisplayScalar(room);
  if (scalar) return scalar;
  if (!isRecord(room)) return fallback;

  return firstDisplayScalar(
    room.roomNumber,
    room.room_number,
    room.unitNumber,
    room.unit_number,
    room.name,
    room.label,
    room.id,
    room._id,
  ) || fallback;
}

export function getMaintenanceBranchDisplayName(
  branch,
  fallback = MAINTENANCE_EMPTY_DISPLAY_VALUE,
) {
  const scalar = toDisplayScalar(branch);
  if (scalar) return scalar;
  if (!isRecord(branch)) return fallback;

  return firstDisplayScalar(
    branch.branchName,
    branch.branch_name,
    branch.name,
    branch.label,
    branch.code,
    branch.slug,
    branch.id,
    branch._id,
  ) || fallback;
}

export function getMaintenanceFloorDisplayName(
  floor,
  fallback = MAINTENANCE_EMPTY_DISPLAY_VALUE,
) {
  const scalar = toDisplayScalar(floor);
  if (scalar) return scalar;
  if (!isRecord(floor)) return fallback;

  return firstDisplayScalar(
    floor.floorNumber,
    floor.floor_number,
    floor.number,
    floor.name,
    floor.label,
    floor.id,
    floor._id,
  ) || fallback;
}

/**
 * Canonical mapping for room selectors: UI components render label while
 * mutations submit id/value. The source room object is intentionally not used
 * as either React children or the selector value.
 */
export function toMaintenanceRoomOption(room) {
  const id = getMaintenanceRoomIdentifier(room);
  const label = getMaintenanceRoomDisplayName(room, '');
  if (!id && !label) return null;

  const roomNumber = isRecord(room)
    ? firstDisplayScalar(room.roomNumber, room.room_number, room.unitNumber, room.unit_number)
    : '';
  const branch = isRecord(room) ? getMaintenanceBranchDisplayName(room.branch, '') : '';
  const floor = isRecord(room) ? getMaintenanceFloorDisplayName(room.floor, '') : '';

  return {
    id: id || label,
    value: id || label,
    label: label || id,
    roomNumber: roomNumber || label || id,
    branch: branch || null,
    floor: floor || null,
  };
}

const getRoomCandidates = (request = {}) => [
  request.room,
  request.room_id,
  request.roomId,
  request.roomNumber,
  request.room_number,
  request.occupancyContext?.unitNumber,
].filter((value) => value !== undefined && value !== null && value !== '');

export function normalizeMaintenanceRequest(request) {
  if (!isRecord(request)) return request;

  const roomCandidates = getRoomCandidates(request);
  const hasLocationContract = [
    'room',
    'roomId',
    'room_id',
    'roomNumber',
    'room_number',
    'branch',
    'branchName',
    'branch_name',
    'floor',
    'occupancyContext',
  ].some((key) => Object.prototype.hasOwnProperty.call(request, key));
  if (!hasLocationContract) return { ...request };

  const roomSource = roomCandidates[0] ?? null;
  const roomIdentifier = [request.roomId, request.room_id, request.room, request.roomNumber]
    .map(getMaintenanceRoomIdentifier)
    .find(Boolean) || null;
  const roomLabel = [
    request.roomLabel,
    request.roomNumber,
    request.room_number,
    request.room,
    request.room_id,
    request.roomId,
    request.occupancyContext?.unitNumber,
  ]
    .map((room) => getMaintenanceRoomDisplayName(room, ''))
    .find(Boolean) || null;
  const roomOption = toMaintenanceRoomOption(roomSource);
  const roomObject = isRecord(roomSource)
    ? {
        ...roomSource,
        ...(roomIdentifier ? { _id: roomIdentifier, id: roomIdentifier } : {}),
        branch: getMaintenanceBranchDisplayName(roomSource.branch, '') || null,
        floor: getMaintenanceFloorDisplayName(roomSource.floor, '') || null,
      }
    : roomSource;
  const branch = getMaintenanceBranchDisplayName(
    request.branch
      ?? request.branchName
      ?? request.branch_name
      ?? (isRecord(roomSource) ? roomSource.branch : null)
      ?? request.occupancyContext?.branch,
    '',
  ) || null;
  const floor = getMaintenanceFloorDisplayName(
    request.floor
      ?? (isRecord(roomSource) ? roomSource.floor : null)
      ?? request.occupancyContext?.floor,
    '',
  ) || null;

  return {
    ...request,
    room: roomObject,
    roomId: roomIdentifier,
    room_id: roomIdentifier,
    roomLabel,
    roomNumber: firstDisplayScalar(request.roomNumber, request.room_number) || roomLabel,
    roomDetails: roomOption,
    branch,
    floor,
  };
}

export function getMaintenanceRequestRoomDisplayName(
  request,
  fallback = MAINTENANCE_EMPTY_DISPLAY_VALUE,
) {
  if (!isRecord(request)) return getMaintenanceRoomDisplayName(request, fallback);
  return firstDisplayScalar(request.roomLabel, request.roomNumber, request.room_number)
    || getRoomCandidates(request)
      .map((room) => getMaintenanceRoomDisplayName(room, ''))
      .find(Boolean)
    || fallback;
}

export function getMaintenanceRequestBranchDisplayName(
  request,
  fallback = MAINTENANCE_EMPTY_DISPLAY_VALUE,
) {
  if (!isRecord(request)) return getMaintenanceBranchDisplayName(request, fallback);
  return getMaintenanceBranchDisplayName(
    request.branch
      ?? request.branchName
      ?? request.branch_name
      ?? (isRecord(request.room) ? request.room.branch : null),
    fallback,
  );
}

export function getMaintenanceRequestFloorDisplayName(request, fallback = '') {
  if (!isRecord(request)) return getMaintenanceFloorDisplayName(request, fallback);
  return getMaintenanceFloorDisplayName(
    request.floor ?? (isRecord(request.room) ? request.room.floor : null),
    fallback,
  );
}

export function getMaintenanceLocationParts(request = {}) {
  const branch = getMaintenanceRequestBranchDisplayName(request, '');
  const room = getMaintenanceRequestRoomDisplayName(request, '');
  return [branch, room].filter(Boolean);
}

export function extractMaintenanceList(response) {
  const body = response?.data;
  const requests = Array.isArray(body)
    ? body
    : Array.isArray(body?.requests)
      ? body.requests
      : Array.isArray(body?.data?.requests)
        ? body.data.requests
        : [];
  return requests.map(normalizeMaintenanceRequest);
}

export function extractMaintenanceRequest(response, fallback = null) {
  const body = response?.data;
  return normalizeMaintenanceRequest(
    body?.data?.request || body?.request || body?.data || body || fallback,
  );
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
  const normalizedRequest = normalizeMaintenanceRequest(updatedRequest);
  if (!normalizedRequest?.request_id) return list.map(normalizeMaintenanceRequest);
  const next = list
    .map(normalizeMaintenanceRequest)
    .filter((request) => request?.request_id !== normalizedRequest.request_id);
  return [normalizedRequest, ...next];
}
