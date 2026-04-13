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

/**
 * Broadcast a push notification to ALL active tenants.
 * @param {object} db - MongoDB db instance
 * @param {object} options - { title, body, data }
 */
async function sendPushToAllTenants(db, { title, body, data = {} }) {
  try {
    const tenants = await db.collection('users').find({
      push_token: { $exists: true, $ne: null, $ne: '' },
      is_active: { $ne: false },
      role: { $nin: ['admin', 'superadmin'] },
    }).project({ push_token: 1 }).toArray();

    if (!tenants.length) {
      console.log('[Push] No tenants with push tokens found');
      return 0;
    }

    // Batch into chunks of 100 (Expo API limit)
    const chunks = [];
    for (let i = 0; i < tenants.length; i += 100) {
      chunks.push(tenants.slice(i, i + 100));
    }

    let sent = 0;
    for (const chunk of chunks) {
      const messages = chunk.map((t) => ({
        to: t.push_token,
        sound: 'default',
        title,
        body,
        data,
      }));

      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });

      const result = await response.json();
      const successCount = Array.isArray(result.data)
        ? result.data.filter((r) => r.status !== 'error').length
        : 0;
      sent += successCount;
    }

    console.log(`[Push] Broadcast sent to ${sent}/${tenants.length} tenants: "${title}"`);
    return sent;
  } catch (error) {
    console.error('[Push] Broadcast failed:', error?.message);
    return 0;
  }
}

/**
 * Notify a tenant that a new bill has been released.
 */
async function notifyBillCreated(userId, bill) {
  const period = bill.billing_period || bill.description || 'New billing statement';
  const amount = bill.total ?? bill.amount ?? 0;
  return sendPushToUser(userId, {
    title: '🧾 New Billing Statement',
    body: `${period} is now available. Amount due: PHP ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    data: { type: 'billing_new', billing_id: bill.billing_id, screen: 'billing' },
  });
}

/**
 * Notify a tenant that their payment was confirmed.
 */
async function notifyPaymentConfirmed(userId, bill) {
  const period = bill.billing_period || bill.description || 'Your bill';
  const amount = bill.total ?? bill.amount ?? 0;
  return sendPushToUser(userId, {
    title: '✅ Payment Confirmed',
    body: `${period} payment of PHP ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} has been received. Thank you!`,
    data: { type: 'payment_confirmed', billing_id: bill.billing_id, screen: 'billing' },
  });
}

/**
 * Notify a tenant about a new announcement.
 */
async function notifyNewAnnouncement(db, announcement) {
  const isUrgent = announcement.priority === 'high' || announcement.is_urgent;
  const title = isUrgent ? `🚨 Urgent: ${announcement.title}` : `📢 ${announcement.title}`;
  const body = (announcement.content || '').slice(0, 100) + ((announcement.content || '').length > 100 ? '…' : '');
  return sendPushToAllTenants(db, {
    title,
    body,
    data: { type: 'announcement', announcement_id: announcement.announcement_id, screen: 'announcements' },
  });
}

module.exports = {
  sendPushToUser,
  sendPushToAllTenants,
  notifyMaintenanceStatusChange,
  notifyBillCreated,
  notifyPaymentConfirmed,
  notifyNewAnnouncement,
};
