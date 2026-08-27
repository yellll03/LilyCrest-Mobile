'use strict';

const axios = require('axios');
const database = require('../config/database');
const { isTenantResetEligible } = require('../utils/tenantEligibility');

// Enumeration-safe: for any syntactically valid email — registered eligible
// tenant, unknown, ineligible, or non-tenant — the externally visible response
// is exactly this 200 body. The ONLY non-200 outcome is a locally-malformed /
// blank request (400), which depends on the submitted string alone and reveals
// nothing about any account. An upstream (canonical backend) failure is never
// surfaced to the caller — doing so would let an attacker who can induce or
// wait out an outage distinguish an eligible tenant (forward attempted -> 503)
// from an unknown email (no forward -> 200). Upstream failures are observable
// only through server-side logs/metrics.
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
 * Contract (externally visible):
 *   - malformed / missing email                     -> 400 (no DB, no upstream)
 *   - any syntactically valid email                 -> 200 generic, identical
 * Internally:
 *   - eligible tenant (role + active)               -> forward to canonical upstream
 *   - unknown / ineligible / non-tenant             -> NO upstream call
 *   - upstream failure for an eligible tenant       -> logged only, response unchanged
 *   - the forward is fire-and-forget: the 200 is sent immediately either way,
 *     so response timing does not distinguish eligible from unknown.
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

  const canonicalApiUrl = eligible ? resolveCanonicalApiUrl() : null;
  if (eligible && canonicalApiUrl) {
    // Fire-and-forget: forward the reset for an eligible tenant, but never let
    // the outcome (success, timeout, 5xx, DNS failure) change the response the
    // caller sees or how long it takes. An upstream problem is a server-side
    // observability concern, not a client signal — surfacing it here would make
    // "eligible tenant" distinguishable from "unknown email" during an outage.
    axios
      .post(`${canonicalApiUrl}/api/m/auth/forgot-password`, { email }, { timeout: 15000 })
      .catch((error) => {
        console.error('[canonical-password-reset-proxy] Upstream forward failed:', error?.code || error?.message);
      });
  }

  // Identical 200 for eligible / unknown / ineligible / non-tenant, sent now.
  return res.json({ message: GENERIC_RESPONSE });
}

module.exports = {
  GENERIC_RESPONSE,
  RESET_NOT_AVAILABLE,
  resolveCanonicalApiUrl,
  requestPasswordReset,
};
