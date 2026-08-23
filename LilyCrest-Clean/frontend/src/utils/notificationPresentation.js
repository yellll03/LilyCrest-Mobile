export function getNotificationTimestamp(notification = {}) {
  return notification?.created_at
    || notification?.createdAt
    || notification?.publishedAt
    || notification?.sentAt
    || notification?.updated_at
    || notification?.updatedAt
    || null;
}

export function formatRelativeNotificationTimestamp(value, now = Date.now()) {
  if (!value) return '';
  try {
    const parsed = new Date(value).getTime();
    const diff = now - parsed;
    if (diff < 0 || Number.isNaN(diff)) return '';
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(parsed).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (_error) {
    return '';
  }
}

export function isNotificationUnread(notification = {}) {
  return notification?.read !== true;
}

export function buildNotificationRouteData(notification = {}) {
  return {
    ...(notification?.data || {}),
    type: notification?.type || notification?.data?.type,
    category: notification?.category || notification?.data?.category,
    url: notification?.url || notification?.data?.url,
    billing_id: notification?.billing_id || notification?.bill_id || notification?.data?.billing_id || notification?.data?.bill_id,
    announcement_id: notification?.announcement_id || notification?.data?.announcement_id,
    contract_id: notification?.contract_id || notification?.data?.contract_id,
    conversation_id: notification?.conversation_id || notification?.data?.conversation_id,
    message_id: notification?.message_id || notification?.data?.message_id,
    request_id: notification?.request_id || notification?.data?.request_id,
  };
}

function classifyNotification(notification = {}) {
  const category = String(notification?.category || notification?.data?.category || '').trim().toLowerCase();
  const type = String(notification?.type || notification?.data?.type || '').trim().toLowerCase();
  const copy = `${category} ${type} ${notification?.title || ''} ${notification?.body || notification?.content || ''}`.toLowerCase();

  if (category === 'billing' || /(bill|billing|payment|invoice|rent|utility|penalty)/.test(copy)) return 'billing';
  if (category === 'maintenance' || /(maintenance|repair|service request)/.test(copy)) return 'maintenance';
  if (category === 'contract' || /(contract|lease|document ready)/.test(copy)) return 'contract';
  if (category === 'announcement' || /(announcement|news|notice)/.test(copy)) return 'announcement';
  if (category === 'assistant' || /(chat|assistant|message|reply)/.test(copy)) return 'assistant';
  if (category === 'reservation' || /(reservation|move-in|move in|room assignment)/.test(copy)) return 'account';
  if (category === 'security' || /(security|password|account)/.test(copy)) return 'security';
  return 'system';
}

export function getNotificationCategoryPresentation(notification = {}, colors = {}) {
  const category = classifyNotification(notification);
  const presentations = {
    billing: { label: 'Billing', icon: 'card-outline', background: colors.infoBg || '#EFF6FF', foreground: colors.info || '#2563EB' },
    maintenance: { label: 'Maintenance', icon: 'construct-outline', background: colors.warningBg || '#FFFBEB', foreground: colors.warning || '#D97706' },
    contract: { label: 'Contract', icon: 'document-text-outline', background: colors.accentSubtle || '#FBF7EA', foreground: colors.accentHover || '#B9921F' },
    announcement: { label: 'Announcement', icon: 'megaphone-outline', background: colors.infoBg || '#EFF6FF', foreground: colors.info || '#2563EB' },
    assistant: { label: 'Assistant', icon: 'chatbubble-ellipses-outline', background: colors.accentSubtle || '#FBF7EA', foreground: colors.accentHover || '#B9921F' },
    account: { label: 'Account', icon: 'home-outline', background: colors.successBg || '#ECFDF5', foreground: colors.success || '#059669' },
    security: { label: 'Security', icon: 'shield-checkmark-outline', background: colors.errorBg || '#FEF2F2', foreground: colors.error || '#DC2626' },
    system: { label: 'System', icon: 'notifications-outline', background: colors.surfaceSecondary || '#F1F5F9', foreground: colors.iconSecondary || '#4B5563' },
  };
  return presentations[category];
}
