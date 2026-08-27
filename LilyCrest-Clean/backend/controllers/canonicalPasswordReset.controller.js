'use strict';

const axios = require('axios');
const database = require('../config/database');
const { isAccountActive, isTenantMobileRole } = require('../utils/tenantEligibility');

const GENERIC_RESPONSE = 'If an account exists for this email, a password reset link has been sent.';
const RESET_NOT_AVAILABLE = "We couldn't start a tenant password reset for this email. Check the address or contact the admin office.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Compatibility proxy for anyone still running the retired standalone mobile
 * backend. It creates no credential and stores no reset token; the canonical
 * Capstone backend owns Firebase action-code generation and branded delivery.
 */
async function requestPasswordReset(req, res) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ detail: 'Please provide a valid email address' });
  }

  const canonicalApiUrl = String(process.env.CANONICAL_API_URL || 'https://api.lilycrest.space').replace(/\/+$/, '');
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
      role: { $in: ['tenant', 'resident'] },
    });
    if (!user || !isTenantMobileRole(user.role) || !isAccountActive(user)) {
      return res.status(422).json({
        code: 'TENANT_RESET_NOT_AVAILABLE',
        detail: RESET_NOT_AVAILABLE,
      });
    }
    // The canonical server performs its own authoritative tenant check too;
    // the standalone database result is defense in depth, never the final
    // authority for mobile reset eligibility.
    await axios.post(`${canonicalApiUrl}/api/m/auth/forgot-password`, { email }, { timeout: 15000 });
  } catch (error) {
    console.error('[canonical-password-reset-proxy] Request failed:', error?.code || error?.message);
    return res.status(503).json({
      code: 'PASSWORD_RESET_UNAVAILABLE',
      detail: 'Password reset is temporarily unavailable. Please try again later.',
    });
  }
  return res.json({ message: GENERIC_RESPONSE });
}

module.exports = { GENERIC_RESPONSE, RESET_NOT_AVAILABLE, requestPasswordReset };
