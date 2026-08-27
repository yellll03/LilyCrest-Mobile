'use strict';

const axios = require('axios');
const database = require('../config/database');
const { isTenantResetEligible } = require('../utils/tenantEligibility');

// Enumeration-safe: a registered/eligible email and an unknown/ineligible one
// get exactly this response and status. The only non-200 outcomes are a
// locally-malformed request (400) and a genuine upstream outage (503) — neither
// of which reveals whether the account exists or what role it has.
const GENERIC_RESPONSE = 'If an account exists for this email, a password reset link has been sent.';
// Retained for older mobile clients that still branch on this code. The
// deployed backend no longer emits it (doing so would leak tenant eligibility),
// but the constant and the client-side handling stay as defense in depth.
const RESET_NOT_AVAILABLE = "We couldn't start a tenant password reset for this email. Check the address or contact the admin office.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimTrailingSlashes(value) {
  return String(value || '').replace(/\/+$/, '');
}

/**
 * The canonical upstream this proxy forwards eligible resets to, or null when
 * forwarding must be skipped:
 *   * CANONICAL_API_URL is unset / blank, or
 *   * it resolves to this backend's own public URL (BACKEND_URL) — forwarding
 *     there would just POST back into this same handler forever.
 * Skipping the forward is not an error: the caller still gets the generic 200.
 */
function resolveCanonicalApiUrl() {
  const configured = trimTrailingSlashes(process.env.CANONICAL_API_URL);
  if (!configured) return null;
  const selfUrl = trimTrailingSlashes(process.env.BACKEND_URL);
  if (selfUrl && configured.toLowerCase() === selfUrl.toLowerCase()) return null;
  return configured;
}

/**
 * Compatibility proxy for anyone still running the retired standalone mobile
 * backend. It creates no credential and stores no reset token; the canonical
 * Capstone backend owns Firebase action-code generation and branded delivery.
 *
 * Contract:
 *   - malformed / missing email            -> 400 (no DB, no upstream)
 *   - eligible tenant (role + active)      -> forward to canonical upstream, 200 generic
 *   - unknown / ineligible / non-tenant    -> NO upstream call, 200 generic (identical)
 *   - upstream unreachable for an eligible -> 503 (outage, not enumeration)
 */
async function requestPasswordReset(req, res) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ detail: 'Please provide a valid email address' });
  }

  let eligible = false;
  try {
    const db = database.getDb();
    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactEmail = new RegExp(`^${escapedEmail}$`, 'i');
    const user = await db.collection('users').findOne({
      $or: [
        { email: exactEmail },
        { email_normalized: email },
        { google_email: exactEmail },
      ],
    });
    eligible = isTenantResetEligible(user);
  } catch (error) {
    // A lookup failure must not leak (and must not 500 the caller). Treat it as
    // "not eligible from here" and fall through to the generic response; the
    // canonical backend remains the authority and the tenant can retry.
    console.error('[canonical-password-reset-proxy] Eligibility lookup failed:', error?.code || error?.message);
    return res.json({ message: GENERIC_RESPONSE });
  }

  if (!eligible) {
    // Unknown email, wrong role, or inactive account: identical generic 200,
    // and crucially no upstream reset is triggered for a non-tenant.
    return res.json({ message: GENERIC_RESPONSE });
  }

  const canonicalApiUrl = resolveCanonicalApiUrl();
  if (!canonicalApiUrl) {
    // Nothing to forward to (unset, or would recurse into ourselves). The
    // eligible tenant still gets the generic response.
    return res.json({ message: GENERIC_RESPONSE });
  }

  try {
    // The canonical server performs its own authoritative tenant check too;
    // the standalone database result is defense in depth, never the final
    // authority for mobile reset eligibility.
    await axios.post(`${canonicalApiUrl}/api/m/auth/forgot-password`, { email }, { timeout: 15000 });
  } catch (error) {
    console.error('[canonical-password-reset-proxy] Upstream request failed:', error?.code || error?.message);
    return res.status(503).json({
      code: 'PASSWORD_RESET_UNAVAILABLE',
      detail: 'Password reset is temporarily unavailable. Please try again later.',
    });
  }

  return res.json({ message: GENERIC_RESPONSE });
}

module.exports = {
  GENERIC_RESPONSE,
  RESET_NOT_AVAILABLE,
  resolveCanonicalApiUrl,
  requestPasswordReset,
};
