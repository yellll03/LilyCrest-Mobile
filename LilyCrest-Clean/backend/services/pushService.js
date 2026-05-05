const axios = require('axios');
const { getDb } = require('../config/database');
const { admin } = require('../config/firebase');

const DEFAULT_CHANNEL_ID = 'default';
const MULTICAST_CHUNK_SIZE = 500;
const EXPO_PUSH_CHUNK_SIZE = 100;
const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clipText(value, max = 120) {
  const text = normalizeString(value);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isExpoPushToken(token) {
  return typeof token === 'string'
    && /^(Expo|Exponent)PushToken\[[A-Za-z0-9-_=]+\]$/.test(token.trim());
}

function normalizePushEntry(entry, fallback = {}) {
  if (typeof entry === 'string') {
    const token = normalizeString(entry);
    return token
      ? {
          token,
          provider: fallback.provider || null,
          platform: fallback.platform || null,
          enabled: true,
          updated_at: fallback.updated_at || null,
        }
      : null;
  }

  if (!entry || typeof entry !== 'object') return null;

  const token = normalizeString(entry.token || entry.push_token || entry.value);
  if (!token) return null;

  return {
    token,
    provider: normalizeString(entry.provider) || fallback.provider || null,
    platform: normalizeString(entry.platform || entry.device_platform) || fallback.platform || null,
    enabled: entry.enabled !== false,
    updated_at: entry.updated_at || fallback.updated_at || null,
  };
}

function extractUserPushTokens(user) {
  if (!user) return [];

  const candidates = [];
  if (Array.isArray(user.push_tokens)) {
    candidates.push(...user.push_tokens.map((entry) => normalizePushEntry(entry)));
  }
  if (user.push_token) {
    candidates.push(normalizePushEntry(
      {
        token: user.push_token,
        provider: user.push_provider,
        platform: user.push_platform,
        updated_at: user.push_token_updated,
      },
      {
        provider: user.push_provider,
        platform: user.push_platform,
        updated_at: user.push_token_updated,
      }
    ));
  }

  const seen = new Set();
  return candidates
    .filter(Boolean)
    .filter((entry) => entry.enabled !== false)
    .filter((entry) => {
      if (seen.has(entry.token)) return false;
      seen.add(entry.token);
      return true;
    });
}

function isFirebaseTokenEntry(entry) {
  if (!entry?.token) return false;
  if (isExpoPushToken(entry.token)) return false;
  return entry.provider !== 'apns';
}

function isUnsupportedPushEntry(entry) {
  return Boolean(entry?.token) && !isExpoPushToken(entry.token) && entry.provider === 'apns';
}

function sanitizeDataPayload(data = {}) {
  const payload = {};

  Object.entries(data || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string') {
      payload[key] = value;
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      payload[key] = String(value);
      return;
    }
    payload[key] = JSON.stringify(value);
  });

  payload.channelId = payload.channelId || DEFAULT_CHANNEL_ID;
  return payload;
}

function buildNotificationTag(data = {}) {
  const type = normalizeString(data.type || data.screen || 'update');
  const id = normalizeString(
    data.billing_id
    || data.bill_id
    || data.request_id
    || data.announcement_id
    || data.ticket_id
    || data.session_id
    || data.reservation_id
  );

  return id ? `${type}:${id}` : type;
}

function isInvalidTokenError(error) {
  const code = error?.code || error?.errorInfo?.code;
  return code === 'messaging/registration-token-not-registered'
    || code === 'messaging/invalid-registration-token';
}

async function removeInvalidTokens(tokens) {
  const uniqueTokens = Array.from(new Set((tokens || []).filter(Boolean)));
  if (!uniqueTokens.length) return;

  const db = getDb();
  const now = new Date();

  try {
    await Promise.all([
      db.collection('users').updateMany(
        { push_token: { $in: uniqueTokens } },
        {
          $set: {
            push_token: null,
            push_provider: null,
            push_platform: null,
            push_token_updated: now,
          },
        }
      ),
      db.collection('users').updateMany(
        { 'push_tokens.token': { $in: uniqueTokens } },
        {
          $pull: { push_tokens: { token: { $in: uniqueTokens } } },
          $set: { push_token_updated: now },
        }
      ),
      db.collection('users').updateMany(
        { push_tokens: { $in: uniqueTokens } },
        {
          $pull: { push_tokens: { $in: uniqueTokens } },
          $set: { push_token_updated: now },
        }
      ),
    ]);
  } catch (error) {
    console.warn('[Push] Invalid token cleanup warning:', error?.message);
  }
}

async function sendMulticast(tokens, { title, body, data = {} }) {
  const normalizedTokens = (tokens || [])
    .map((entry) => {
      if (typeof entry === 'string') {
        const token = entry.trim();
        return token ? { token, provider: null, platform: null } : null;
      }
      return normalizePushEntry(entry);
    })
    .filter(Boolean);

  if (!normalizedTokens.length) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  const expoEntries = normalizedTokens.filter((entry) => isExpoPushToken(entry.token));
  const firebaseEntries = normalizedTokens.filter(isFirebaseTokenEntry);
  const unsupportedEntries = normalizedTokens.filter(isUnsupportedPushEntry);
  const invalidTokens = [];
  let successCount = 0;
  let failureCount = 0;
  const payloadData = sanitizeDataPayload(data);
  const tag = buildNotificationTag(data);

  if (unsupportedEntries.length) {
    console.warn(`[Push] Skipping ${unsupportedEntries.length} unsupported APNs device token(s); app should refresh to Expo push tokens.`);
  }

  await Promise.all(chunk(expoEntries, EXPO_PUSH_CHUNK_SIZE).map(async (expoChunk) => {
    try {
      const messages = expoChunk.map((entry) => ({
        to: entry.token,
        title,
        body,
        data: payloadData,
        sound: 'default',
        channelId: DEFAULT_CHANNEL_ID,
        priority: 'high',
      }));

      const response = await axios.post(EXPO_PUSH_ENDPOINT, messages, {
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      const tickets = Array.isArray(response?.data?.data) ? response.data.data : [];
      tickets.forEach((ticket, index) => {
        if (ticket?.status === 'ok') {
          successCount += 1;
          return;
        }
        failureCount += 1;
        const errorCode = ticket?.details?.error;
        if (errorCode === 'DeviceNotRegistered') {
          invalidTokens.push(expoChunk[index].token);
        } else if (ticket?.message) {
          console.warn('[Push] Expo send warning:', ticket.message);
        }
      });
    } catch (error) {
      failureCount += expoChunk.length;
      console.error('[Push] Expo send failed:', error?.response?.data || error?.message);
    }
  }));

  await Promise.all(chunk(firebaseEntries.map((entry) => entry.token), MULTICAST_CHUNK_SIZE).map(async (tokenChunk) => {
    try {
      const response = await admin.messaging().sendEachForMulticast({
        tokens: tokenChunk,
        notification: { title, body },
        data: payloadData,
        android: {
          priority: 'high',
          collapseKey: tag,
          notification: {
            channelId: DEFAULT_CHANNEL_ID,
            sound: 'default',
            tag,
          },
        },
      });

      successCount += response.successCount;
      failureCount += response.failureCount;

      response.responses.forEach((result, index) => {
        if (!result.success && isInvalidTokenError(result.error)) {
          invalidTokens.push(tokenChunk[index]);
        }
      });
    } catch (error) {
      failureCount += tokenChunk.length;
      console.error('[Push] FCM send failed:', error?.message);
    }
  }));

  if (invalidTokens.length) {
    await removeInvalidTokens(invalidTokens);
  }

  return { successCount, failureCount, invalidTokens };
}

async function sendPushToUser(userId, { title, body, data = {} }) {
  try {
    const db = getDb();
    const user = await db.collection('users').findOne(
      { user_id: userId },
      {
        projection: {
          push_token: 1,
          push_provider: 1,
          push_platform: 1,
          push_token_updated: 1,
          push_tokens: 1,
        },
      }
    );

    const pushEntries = extractUserPushTokens(user);
    if (!pushEntries.length) {
      console.log(`[Push] No active device token for user ${userId}`);
      return false;
    }

    const result = await sendMulticast(pushEntries, { title, body, data });
    console.log(`[Push] Sent to user ${userId}: "${title}" (${result.successCount}/${pushEntries.length})`);
    return result.successCount > 0;
  } catch (error) {
    console.error('[Push] Failed to send:', error?.message);
    return false;
  }
}

async function sendPushToAllTenants(db, { title, body, data = {} }) {
  try {
    const tenants = await db.collection('users').find(
      {
        is_active: { $ne: false },
        role: { $nin: ['admin', 'superadmin'] },
        $or: [
          { push_token: { $exists: true, $nin: [null, ''] } },
          { 'push_tokens.0': { $exists: true } },
          { 'push_tokens.token': { $exists: true } },
        ],
      },
      {
        projection: {
          push_token: 1,
          push_provider: 1,
          push_platform: 1,
          push_token_updated: 1,
          push_tokens: 1,
        },
      }
    ).toArray();

    const pushEntries = tenants.flatMap((tenant) => extractUserPushTokens(tenant));
    if (!pushEntries.length) {
      console.log('[Push] No tenant device tokens found');
      return 0;
    }

    const result = await sendMulticast(pushEntries, { title, body, data });
    console.log(`[Push] Broadcast sent to ${result.successCount}/${pushEntries.length} devices: "${title}"`);
    return result.successCount;
  } catch (error) {
    console.error('[Push] Broadcast failed:', error?.message);
    return 0;
  }
}

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
      screen: 'services',
      url: '/(tabs)/services',
    },
  });
}

async function notifyBillCreated(userId, bill) {
  const period = bill.billing_period || bill.description || 'New billing statement';
  const amount = bill.total ?? bill.amount ?? 0;
  const billingId = bill.billing_id || bill.bill_id || '';

  return sendPushToUser(userId, {
    title: 'New Billing Statement',
    body: `${period} is now available. Amount due: PHP ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    data: {
      type: 'billing_new',
      billing_id: billingId,
      screen: 'billing',
      url: billingId ? `/bill-details?billId=${billingId}` : '/billing-history',
    },
  });
}

async function notifyPaymentConfirmed(userId, bill) {
  const period = bill.billing_period || bill.description || 'Your bill';
  const amount = bill.total ?? bill.amount ?? 0;
  const billingId = bill.billing_id || bill.bill_id || '';

  return sendPushToUser(userId, {
    title: 'Payment Confirmed',
    body: `${period} payment of PHP ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} has been received.`,
    data: {
      type: 'payment_confirmed',
      billing_id: billingId,
      screen: 'billing',
      url: billingId ? `/bill-details?billId=${billingId}` : '/billing-history',
    },
  });
}

async function notifyNewAnnouncement(db, announcement) {
  const isUrgent = announcement.priority === 'high' || announcement.is_urgent;
  const title = isUrgent ? `Urgent: ${announcement.title}` : announcement.title;
  const body = clipText(announcement.content, 110);

  return sendPushToAllTenants(db, {
    title,
    body,
    data: {
      type: 'announcement',
      announcement_id: announcement.announcement_id,
      screen: 'announcements',
      url: '/(tabs)/announcements',
    },
  });
}

async function notifyAdminChatAccepted(userId, adminName, sessionId) {
  return sendPushToUser(userId, {
    title: 'Admin Joined Your Chat',
    body: `${adminName || 'An admin'} is now ready to assist you.`,
    data: {
      type: 'chat_assigned',
      session_id: sessionId,
      screen: 'chat',
      url: '/(tabs)/chatbot',
    },
  });
}

async function notifyChatbotReply(userId, { adminName, message, sessionId }) {
  return sendPushToUser(userId, {
    title: `${adminName || 'Admin'} replied`,
    body: clipText(message, 110) || 'You have a new message from LilyCrest support.',
    data: {
      type: 'chat_reply',
      session_id: sessionId,
      screen: 'chat',
      url: '/(tabs)/chatbot',
    },
  });
}

async function notifyReservationUpdate(userId, reservation = {}) {
  const reservationId = reservation.reservation_id || reservation._id?.toString() || '';
  const status = normalizeString(reservation.status) || 'updated';
  const statusLabel = status.replace(/_/g, ' ');

  return sendPushToUser(userId, {
    title: 'Reservation Update',
    body: `Your reservation is now ${statusLabel}.`,
    data: {
      type: 'reservation_update',
      reservation_id: reservationId,
      reservation_status: status,
      screen: 'reservation',
      url: '/(tabs)/home',
    },
  });
}

module.exports = {
  sendPushToUser,
  sendPushToAllTenants,
  notifyMaintenanceStatusChange,
  notifyBillCreated,
  notifyPaymentConfirmed,
  notifyNewAnnouncement,
  notifyAdminChatAccepted,
  notifyChatbotReply,
  notifyReservationUpdate,
};
