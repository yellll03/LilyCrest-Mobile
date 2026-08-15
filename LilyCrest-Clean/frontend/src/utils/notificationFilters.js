export function normalizeNotificationCategory(category) {
  const normalized = String(category || '').trim().toLowerCase();
  return normalized || 'general';
}

export function getNotificationDateValue(notification = {}) {
  return notification.publishedAt
    || notification.sentAt
    || notification.created_at
    || notification.createdAt
    || notification.updated_at
    || notification.updatedAt
    || null;
}

function getNotificationTimestamp(notification = {}) {
  const value = getNotificationDateValue(notification);
  if (!value) return null;

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

export function isUrgentNotification(notification = {}) {
  const priority = String(notification.priority || '').trim().toLowerCase();
  return notification.is_urgent === true
    || notification.isUrgent === true
    || ['high', 'urgent', 'critical'].includes(priority);
}

export function matchesNotificationFilters(notification, { category = null, priority = 'all' } = {}) {
  const categoryMatches = !category
    || normalizeNotificationCategory(notification?.category) === normalizeNotificationCategory(category);

  if (!categoryMatches) return false;
  if (priority === 'urgent') return isUrgentNotification(notification);
  if (priority === 'normal') return !isUrgentNotification(notification);
  return true;
}

export function filterNotifications(notifications = [], filters = {}) {
  return notifications.filter((notification) => matchesNotificationFilters(notification, filters));
}

export function sortNotifications(notifications = [], order = 'newest') {
  const direction = order === 'oldest' ? 1 : -1;
  return [...notifications].sort((left, right) => {
    const leftTimestamp = getNotificationTimestamp(left);
    const rightTimestamp = getNotificationTimestamp(right);
    if (leftTimestamp === null && rightTimestamp === null) return 0;
    if (leftTimestamp === null) return 1;
    if (rightTimestamp === null) return -1;
    return (leftTimestamp - rightTimestamp) * direction;
  });
}

// Counts intentionally preserve the screen's previous cross-filter behavior:
// category counts honor the selected priority, while priority counts honor the
// selected category. Urgency remains a separate dimension and is never added
// to category totals.
export function buildNotificationFilterCounts(notifications = [], { category = null, priority = 'all' } = {}) {
  const categoryCounts = new Map();
  let allCategories = 0;
  let allPriorities = 0;
  let urgent = 0;
  let normal = 0;

  notifications.forEach((notification) => {
    const notificationCategory = normalizeNotificationCategory(notification?.category);
    const urgentNotification = isUrgentNotification(notification);
    const priorityMatches = priority === 'urgent'
      ? urgentNotification
      : priority === 'normal'
        ? !urgentNotification
        : true;
    const categoryMatches = !category
      || notificationCategory === normalizeNotificationCategory(category);

    if (priorityMatches) {
      allCategories += 1;
      categoryCounts.set(notificationCategory, (categoryCounts.get(notificationCategory) || 0) + 1);
    }

    if (categoryMatches) {
      allPriorities += 1;
      if (urgentNotification) urgent += 1;
      else normal += 1;
    }
  });

  return {
    categories: categoryCounts,
    allCategories,
    priorities: { all: allPriorities, urgent, normal },
  };
}
