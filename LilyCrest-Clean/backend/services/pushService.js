/**
 * Expo Push Notification Service
 * Sends push notifications via the Expo Push API.
 */
const { getDb } = require('../config/database');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Send a push notification to a specific user.
 * @param {string} userId - The user_id to send to
 * @param {object} options - { title, body, data }
 */
async function sendPushToUser(userId, { title, body, data = {} }) {
  try {
    const db = getDb();
    const user = await db.collection('users').findOne({ user_id: userId });
    
    if (!user?.push_token) {
      console.log(`[Push] No push token for user ${userId}`);
      return false;
    }

    const message = {
      to: user.push_token,
      sound: 'default',
      title,
      body,
      data,
    };

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const result = await response.json();
    
    if (result.data?.status === 'error') {
      console.error('[Push] Error:', result.data.message);
      return false;
    }

    console.log(`[Push] Sent to user ${userId}: "${title}"`);
    return true;
  } catch (error) {
    console.error('[Push] Failed to send:', error?.message);
    return false;
  }
}

/**
 * Notify a user about a maintenance request status change.
 * @param {string} userId - The user to notify
 * @param {object} request - The maintenance request object
 * @param {string} newStatus - The new status
 */
async function notifyMaintenanceStatusChange(userId, request, newStatus) {
  const REQUEST_TYPES = {
    maintenance: 'Maintenance',
    plumbing: 'Plumbing',
    electrical: 'Electrical',
    aircon: 'Air Conditioning',
    cleaning: 'Cleaning',
    pest: 'Pest Control',
    furniture: 'Furniture',
    other: 'Other',
  };

  const STATUS_LABELS = {
    pending: 'Pending',
    viewed: 'Viewed',
    seen: 'Viewed',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    completed: 'Completed',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  };

  const typeName = REQUEST_TYPES[request.request_type] || 'Service';
  const statusLabel = STATUS_LABELS[newStatus] || newStatus;

  return sendPushToUser(userId, {
    title: `${typeName} Request Update`,
    body: `Your ${typeName.toLowerCase()} request is now ${statusLabel}.`,
    data: {
      type: 'maintenance_status',
      request_id: request.request_id,
      new_status: newStatus,
    },
  });
}

module.exports = {
  sendPushToUser,
  notifyMaintenanceStatusChange,
};
