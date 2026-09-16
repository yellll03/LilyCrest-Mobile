export const OPEN_ROOM_TRANSFER_STATUSES = Object.freeze([
  'pending',
  'scheduled',
  'awaiting_settlement',
  'ready_for_transfer',
  'action_required',
]);

const LABELS = Object.freeze({ pending: 'Pending Admin Review', scheduled: 'Transfer Scheduled', awaiting_settlement: 'Payment Required', ready_for_transfer: 'Ready for Transfer', action_required: 'Administration Review Required', declined: 'Declined', cancelled: 'Cancelled', completed: 'Transfer Completed' });
export function isValidRoomTransferLifecycle(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'status') &&
    (value.status === null || Object.prototype.hasOwnProperty.call(LABELS, value.status)) &&
    (!value.request || (typeof value.request === 'object' && !Array.isArray(value.request))) &&
    (!value.scheduledRoomTransfer || (typeof value.scheduledRoomTransfer === 'object' && !Array.isArray(value.scheduledRoomTransfer)));
}
const text = value => typeof value === 'string' ? value : '';
export function getRoomTransferPresentation(lifecycle) {
  const valid = isValidRoomTransferLifecycle(lifecycle);
  const status = valid ? lifecycle.status : null;
  const scheduled = valid ? lifecycle.scheduledRoomTransfer : null;
  return {
    status,
    statusLabel: LABELS[status] || '',
    isOpen: OPEN_ROOM_TRANSFER_STATUSES.includes(status),
    canCancel: valid && status === 'pending' && lifecycle?.request?.canCancel === true,
    canRequest: valid && !OPEN_ROOM_TRANSFER_STATUSES.includes(status) && lifecycle.canRequest !== false,
    scheduledLabel: formatRoomTransferSchedule(scheduled),
    declineReason: status === 'declined' ? text(lifecycle?.request?.declineReason) || 'Contact administration for the reason, or submit a new request with updated preferences.' : '',
    guidance: text(scheduled?.tenantGuidance) || text(lifecycle?.eligibilityReason),
    utilitiesNote: text(scheduled?.utilitiesNote),
    settlement: scheduled?.settlement || null,
    actionRequiredReason: scheduled?.actionRequiredReason || null,
  };
}

export function formatRoomTransferSchedule(transfer) {
  if (!transfer?.effectiveTransferDate) return '';
  const date = new Date(transfer.effectiveTransferDate);
  if (Number.isNaN(date.getTime())) return '';
  const suppliedMinutes = Number(transfer.effectiveTransferTimeMinutes ?? 540);
  const minutes = Number.isInteger(suppliedMinutes) && suppliedMinutes >= 0 && suppliedMinutes < 1440 ? suppliedMinutes : 540;
  const dateLabel = new Intl.DateTimeFormat('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
  }).format(date);
  const clock = new Date(Date.UTC(2020, 0, 1, Math.floor(minutes / 60), minutes % 60));
  const timeLabel = new Intl.DateTimeFormat('en-PH', {
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }).format(clock);
  return `${dateLabel} · ${timeLabel}`;
}

export function isValidPreferredTransferDate(value, today = new Date()) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(today);
  const part = type => parts.find(p => p.type === type).value;
  return value >= `${part('year')}-${part('month')}-${part('day')}`;
}
