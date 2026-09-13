export const OPEN_ROOM_TRANSFER_STATUSES = Object.freeze([
  'pending',
  'scheduled',
  'awaiting_settlement',
  'ready_for_transfer',
  'action_required',
]);

export function getRoomTransferPresentation(lifecycle) {
  const status = lifecycle?.status || null;
  const scheduled = lifecycle?.scheduledRoomTransfer || null;
  return {
    status,
    statusLabel: status === 'pending' && lifecycle?.request?.acknowledgedAt ? 'Reviewed' : lifecycle?.statusLabel || '',
    isOpen: OPEN_ROOM_TRANSFER_STATUSES.includes(status),
    canCancel: status === 'pending' && lifecycle?.request?.canCancel === true,
    canRequest: !OPEN_ROOM_TRANSFER_STATUSES.includes(status),
    scheduledLabel: formatRoomTransferSchedule(scheduled),
    declineReason: status === 'declined' ? lifecycle?.request?.declineReason || '' : '',
    guidance: scheduled?.tenantGuidance || '',
    utilitiesNote: scheduled?.utilitiesNote || '',
    settlement: scheduled?.settlement || null,
    actionRequiredReason: scheduled?.actionRequiredReason || null,
  };
}

export function formatRoomTransferSchedule(transfer) {
  if (!transfer?.effectiveTransferDate) return '';
  const date = new Date(transfer.effectiveTransferDate);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Number(transfer.effectiveTransferTimeMinutes ?? 540);
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
