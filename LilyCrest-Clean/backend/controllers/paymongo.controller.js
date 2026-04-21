const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require('mongodb');
const { getDb } = require('../config/database');
const { PRESENTATION_BILLS, mapRealBill } = require('./billing.controller');
const { notifyPaymentConfirmed } = require('../services/pushService');

const PAYMONGO_BASE = 'https://api.paymongo.com/v1';

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isLocalhostUrl(value) {
  try {
    const parsed = new URL(value);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function resolveRedirectBaseUrl(req) {
  const configured = normalizeBaseUrl(process.env.BACKEND_URL);
  if (configured && !isLocalhostUrl(configured)) {
    return configured;
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = typeof forwardedProto === 'string' && forwardedProto
    ? forwardedProto.split(',')[0].trim()
    : (req.protocol || 'http');
  const host = req.get('host');

  if (host) {
    return `${protocol}://${host}`;
  }

  return configured || 'http://localhost:8001';
}

function getSecretKey() {
  return process.env.PAYMONGO_SECRET_KEY || '';
}

function paymongoHeaders() {
  const key = getSecretKey();
  if (!key) throw new Error('PAYMONGO_SECRET_KEY is not configured');
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Basic ${Buffer.from(key + ':').toString('base64')}`,
  };
}

// ── Resolve a bill from any of the three sources ─────────────────────────────
// Returns { bill, source } so callers know which collection to update.
// source: 'legacy' | 'real' | 'presentation'
async function resolveBillWithSource(db, billingId, user) {
  const userId = user.user_id;
  const mongoId = user._id;

  // 1. Legacy 'billing' collection (string billing_id)
  const legacyBill = await db.collection('billing').findOne({ billing_id: billingId, user_id: userId });
  if (legacyBill) return { bill: legacyBill, source: 'legacy' };

  // 2. Real 'bills' collection (ObjectId _id)
  if (mongoId) {
    try {
      const realBill = await db.collection('bills').findOne({ _id: new ObjectId(billingId), userId: mongoId });
      if (realBill) return { bill: mapRealBill(realBill, userId), source: 'real', rawBill: realBill };
    } catch (_) { /* not a valid ObjectId */ }
  }

  // 3. Presentation-mode mock bill
  if (PRESENTATION_BILLS[billingId]) return { bill: { ...PRESENTATION_BILLS[billingId] }, source: 'presentation' };

  return { bill: null, source: null };
}

// Backward-compatible wrapper
async function resolveBill(db, billingId, user) {
  const { bill } = await resolveBillWithSource(db, billingId, user);
  return bill;
}

// ── Save checkout reference to the correct collection ────────────────────────
async function saveCheckoutRef(db, billingId, userId, mongoId, checkoutId, referenceNumber) {
  // Try legacy collection first
  const legacyResult = await db.collection('billing').updateOne(
    { billing_id: billingId, user_id: userId },
    {
      $set: {
        paymongo_checkout_id: checkoutId,
        paymongo_reference: referenceNumber,
        payment_method: 'paymongo',
        updated_at: new Date(),
      },
    }
  );
  if (legacyResult.matchedCount > 0) return;

  // Try real 'bills' collection
  if (mongoId) {
    try {
      await db.collection('bills').updateOne(
        { _id: new ObjectId(billingId), userId: mongoId },
        {
          $set: {
            paymongoSessionId: checkoutId,
            paymongoReference: referenceNumber,
            paymentMethod: 'paymongo',
            updatedAt: new Date(),
          },
        }
      );
    } catch (_) { /* billingId not a valid ObjectId */ }
  }
}

// ── Mark a bill as paid in the correct collection ────────────────────────────
// Returns the bill document (pre-update) for push notification context
async function markBillPaid(db, billingId, userId, { paymentId, eventType } = {}) {
  // 1. Try legacy 'billing' collection
  const legacyBill = await db.collection('billing').findOne({ billing_id: billingId, user_id: userId });
  if (legacyBill) {
    const alreadyPaid = legacyBill.status === 'paid';
    await db.collection('billing').updateOne(
      { billing_id: billingId, user_id: userId },
      {
        $set: {
          status: 'paid',
          payment_method: 'paymongo',
          payment_date: new Date(),
          paymongo_payment_id: paymentId || null,
          ...(eventType ? { paymongo_event: eventType } : {}),
          updated_at: new Date(),
        },
      }
    );
    return { existing: legacyBill, alreadyPaid };
  }

  // 2. Try real 'bills' collection (billingId is the ObjectId string)
  try {
    const user = await db.collection('users').findOne({ user_id: userId });
    const mongoId = user?._id;
    if (!mongoId) return { existing: null, alreadyPaid: false };

    const realBill = await db.collection('bills').findOne({ _id: new ObjectId(billingId), userId: mongoId });
    if (realBill) {
      const alreadyPaid = realBill.status === 'paid';
      await db.collection('bills').updateOne(
        { _id: new ObjectId(billingId) },
        {
          $set: {
            status: 'paid',
            paymentMethod: 'paymongo',
            paidAt: new Date(),
            paymentDate: new Date(),
            paymongoPaymentId: paymentId || null,
            ...(eventType ? { paymongoEvent: eventType } : {}),
            updatedAt: new Date(),
          },
        }
      );
      return { existing: mapRealBill(realBill, userId), alreadyPaid };
    }
  } catch (_) { /* billingId not a valid ObjectId */ }

  // 3. Presentation mode (no DB update needed)
  return { existing: null, alreadyPaid: false };
}

// Create a PayMongo Checkout Session for a specific bill
async function createCheckoutSession(req, res) {
  try {
    const { billingId } = req.body;
    if (!billingId) {
      return res.status(400).json({ detail: 'billingId is required' });
    }

    const db = getDb();
    const { bill } = await resolveBillWithSource(db, billingId, req.user);

    if (!bill) {
      return res.status(404).json({ detail: 'Bill not found' });
    }

    const status = (bill.status || '').toLowerCase();
    if (status === 'paid') {
      return res.status(400).json({ detail: 'This bill has already been paid' });
    }

    const amount = Math.round((bill.remaining_amount ?? bill.total ?? bill.amount ?? 0) * 100); // centavos
    if (amount <= 0) {
      return res.status(400).json({ detail: 'Invalid bill amount' });
    }

    const description = bill.description || `Bill ${billingId}`;
    const referenceNumber = `LC-${billingId}-${Date.now()}`;

    // Build redirect URLs from a device-reachable origin in development.
    // If BACKEND_URL points to localhost, use the incoming request host instead.
    const backendUrl = resolveRedirectBaseUrl(req);

    // Build the PayMongo Checkout Session payload
    const payload = {
      data: {
        attributes: {
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          description: `LilyCrest Dormitory - ${description}`,
          line_items: [
            {
              currency: 'PHP',
              amount,
              name: description,
              quantity: 1,
            },
          ],
          payment_method_types: [
            'gcash',
            'grab_pay',
            'paymaya',
            'card',
          ],
          reference_number: referenceNumber,
          // Redirect to backend endpoints that bounce the user back to the app via deep link
          success_url: `${backendUrl}/api/paymongo/redirect/success?billing_id=${billingId}`,
          cancel_url: `${backendUrl}/api/paymongo/redirect/cancel?billing_id=${billingId}`,
          metadata: {
            billing_id: billingId,
            user_id: req.user.user_id,
            user_email: req.user.email || '',
          },
        },
      },
    };

    const response = await axios.post(`${PAYMONGO_BASE}/checkout_sessions`, payload, {
      headers: paymongoHeaders(),
    });

    const session = response.data?.data;
    const checkoutUrl = session?.attributes?.checkout_url;
    const checkoutId = session?.id;

    if (!checkoutUrl) {
      return res.status(500).json({ detail: 'Failed to create checkout session' });
    }

    // Save checkout reference to the correct collection (legacy or real)
    await saveCheckoutRef(db, billingId, req.user.user_id, req.user._id, checkoutId, referenceNumber);

    res.json({
      checkout_url: checkoutUrl,
      checkout_id: checkoutId,
      reference: referenceNumber,
    });
  } catch (error) {
    console.error('PayMongo checkout error:', error?.response?.data || error.message);
    const paymongoError = error?.response?.data?.errors?.[0]?.detail;
    res.status(500).json({
      detail: paymongoError || 'Failed to create payment session. Please try again.',
    });
  }
}

// Retrieve checkout session status (for polling from frontend)
async function getCheckoutStatus(req, res) {
  try {
    const { checkoutId } = req.params;
    if (!checkoutId) {
      return res.status(400).json({ detail: 'checkoutId is required' });
    }

    const response = await axios.get(`${PAYMONGO_BASE}/checkout_sessions/${checkoutId}`, {
      headers: paymongoHeaders(),
    });

    const session = response.data?.data;
    const paymentStatus = session?.attributes?.payment_intent?.attributes?.status || session?.attributes?.status || 'pending';
    const payments = session?.attributes?.payments || [];

    // Mark paid only when the payment intent is confirmed or every payment object is paid.
    // Avoid using payments.length > 0 alone — payments can appear in non-final states.
    const paymentConfirmed =
      paymentStatus === 'succeeded' ||
      paymentStatus === 'paid' ||
      (payments.length > 0 && payments.every((p) => {
        const s = p?.attributes?.status || p?.status || '';
        return s === 'paid' || s === 'succeeded';
      }));

    if (paymentConfirmed) {
      const billingId = session?.attributes?.metadata?.billing_id;
      const userId = session?.attributes?.metadata?.user_id;
      if (billingId && userId) {
        const db = getDb();
        const { existing, alreadyPaid } = await markBillPaid(db, billingId, userId, {
          paymentId: payments[0]?.id,
        });
        // Push only once
        if (!alreadyPaid && existing) {
          notifyPaymentConfirmed(userId, { ...existing, status: 'paid' }).catch(() => {});
        }
      }
    }

    res.json({
      status: paymentStatus,
      paid: paymentConfirmed,
      payments_count: payments.length,
      checkout_url: session?.attributes?.checkout_url,
    });
  } catch (error) {
    console.error('PayMongo status check error:', error?.response?.data || error.message);
    res.status(500).json({ detail: 'Failed to check payment status' });
  }
}

// PayMongo webhook handler — receives events from PayMongo
async function handleWebhook(req, res) {
  try {
    const event = req.body?.data;
    const eventType = event?.attributes?.type;

    if (eventType === 'checkout_session.payment.paid') {
      const checkoutData = event?.attributes?.data;
      const billingId = checkoutData?.attributes?.metadata?.billing_id;
      const userId = checkoutData?.attributes?.metadata?.user_id;
      const payments = checkoutData?.attributes?.payments || [];

      if (billingId && userId) {
        const db = getDb();
        const { existing, alreadyPaid } = await markBillPaid(db, billingId, userId, {
          paymentId: payments[0]?.id,
          eventType,
        });
        console.log(`[PayMongo Webhook] Bill ${billingId} marked as paid`);
        if (!alreadyPaid && existing) {
          notifyPaymentConfirmed(userId, { ...existing, status: 'paid' }).catch(() => {});
        }
      }
    }

    // Always respond 200 to acknowledge the webhook
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('PayMongo webhook error:', error);
    res.status(200).json({ received: true }); // Still 200 to prevent retries
  }
}

// Auto-register PayMongo webhook on server startup
async function registerWebhook() {
  const key = getSecretKey();
  if (!key) {
    console.log('[PayMongo] No secret key configured — skipping webhook registration');
    return;
  }

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    console.log('[PayMongo] BACKEND_URL not set — webhook registration skipped.');
    console.log('[PayMongo] Set BACKEND_URL to your public URL (e.g. https://your-domain.com or ngrok URL) to auto-register.');
    return;
  }

  const webhookUrl = `${backendUrl}/api/paymongo/webhook`;

  try {
    // Check for existing webhooks to avoid duplicates
    const existingResp = await axios.get(`${PAYMONGO_BASE}/webhooks`, {
      headers: paymongoHeaders(),
    });
    const existingWebhooks = existingResp.data?.data || [];
    const alreadyRegistered = existingWebhooks.find(
      (wh) => wh.attributes?.url === webhookUrl && wh.attributes?.status === 'enabled'
    );

    if (alreadyRegistered) {
      console.log(`[PayMongo] Webhook already registered: ${webhookUrl} (ID: ${alreadyRegistered.id})`);
      return;
    }

    // Disable any stale webhooks for the same URL
    for (const wh of existingWebhooks) {
      if (wh.attributes?.url === webhookUrl && wh.attributes?.status === 'enabled') {
        try {
          await axios.post(`${PAYMONGO_BASE}/webhooks/${wh.id}/disable`, {}, { headers: paymongoHeaders() });
          console.log(`[PayMongo] Disabled stale webhook: ${wh.id}`);
        } catch (_) {}
      }
    }

    // Register a new webhook
    const resp = await axios.post(
      `${PAYMONGO_BASE}/webhooks`,
      {
        data: {
          attributes: {
            url: webhookUrl,
            events: [
              'checkout_session.payment.paid',
              'payment.paid',
              'payment.failed',
            ],
          },
        },
      },
      { headers: paymongoHeaders() }
    );

    const webhookId = resp.data?.data?.id;
    console.log(`[PayMongo] ✓ Webhook registered successfully!`);
    console.log(`[PayMongo]   URL: ${webhookUrl}`);
    console.log(`[PayMongo]   ID: ${webhookId}`);
  } catch (error) {
    console.error('[PayMongo] Webhook registration failed:', error?.response?.data?.errors?.[0]?.detail || error.message);
    console.log('[PayMongo] You can manually register at: https://dashboard.paymongo.com/developers/webhooks');
  }
}

// ── Redirect handlers ──
// PayMongo redirects the browser here after payment. We serve an HTML page
// that auto-redirects to the app's deep link (frontend:// scheme).

function redirectSuccess(req, res) {
  const billingId = req.query.billing_id || '';
  const prodLink = `frontend://payment-success?billing_id=${encodeURIComponent(billingId)}&status=success`;
  const devLink = `exp+frontend://payment-success?billing_id=${encodeURIComponent(billingId)}&status=success`;
  console.log(`[PayMongo] Payment success redirect for bill ${billingId}`);

  // Immediately redirect to the app scheme. Chrome Custom Tabs (openAuthSessionAsync)
  // intercepts this and closes the browser, returning control to the app.
  // The fallback HTML is shown only if the browser doesn't support the scheme.
  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Successful</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; flex-direction: column;
         align-items: center; justify-content: center; min-height: 100vh; margin: 0;
         background: #f0fdf4; color: #15803d; text-align: center; padding: 20px; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  p { color: #4B5563; margin-bottom: 24px; }
  a { display: inline-block; padding: 14px 32px; background: #D4682A; color: #fff;
      text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 16px; }
  .retry { margin-top: 12px; font-size: 14px; color: #6B7280; }
</style>
</head><body>
<h1>✅ Payment Successful!</h1>
<p>Redirecting you back to LilyCrest...</p>
<a href="${prodLink}">Return to App</a>
<p class="retry">If the app doesn't open, <a href="${devLink}" style="background:none;padding:0;color:#D4682A;font-size:14px;">tap here (dev build)</a></p>
<script>
  // Immediate redirect — no timer so the browser can intercept it as a navigation event
  window.location.replace("${prodLink}");
</script>
</body></html>`);
}

function redirectCancel(req, res) {
  const billingId = req.query.billing_id || '';
  const prodLink = `frontend://payment-cancel?billing_id=${encodeURIComponent(billingId)}&status=cancelled`;
  const devLink = `exp+frontend://payment-cancel?billing_id=${encodeURIComponent(billingId)}&status=cancelled`;
  console.log(`[PayMongo] Payment cancelled redirect for bill ${billingId}`);

  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Cancelled</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; flex-direction: column;
         align-items: center; justify-content: center; min-height: 100vh; margin: 0;
         background: #fef2f2; color: #b91c1c; text-align: center; padding: 20px; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  p { color: #4B5563; margin-bottom: 24px; }
  a { display: inline-block; padding: 14px 32px; background: #1E3A5F; color: #fff;
      text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 16px; }
  .retry { margin-top: 12px; font-size: 14px; color: #6B7280; }
</style>
</head><body>
<h1>Payment Cancelled</h1>
<p>No charges were made. Redirecting back...</p>
<a href="${prodLink}">Return to App</a>
<p class="retry">If the app doesn't open, <a href="${devLink}" style="background:none;padding:0;color:#1E3A5F;font-size:14px;">tap here (dev build)</a></p>
<script>
  window.location.replace("${prodLink}");
</script>
</body></html>`);
}

module.exports = {
  createCheckoutSession,
  getCheckoutStatus,
  handleWebhook,
  registerWebhook,
  redirectSuccess,
  redirectCancel,
};
