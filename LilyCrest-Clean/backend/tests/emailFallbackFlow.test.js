'use strict';

// Traces the ACTUAL executable branches of backend/services/emailService.js
// rather than trusting its docstring. Findings this test locks in:
//
//   1. There is no separate "Resend template" vs "inline HTML fallback"
//      distinction in this codebase — every email (OTP, password reset,
//      password changed, receipt) is always the SAME locally-rendered inline
//      HTML string (brandedHtml() + a body), regardless of which transport
//      sends it. "Fallback" here means transport selection, not content
//      selection — and the canonical action URL embedded in that HTML (e.g.
//      the reset link) is identical no matter which transport ends up
//      sending it, since it's baked into the HTML before either transport is
//      even chosen.
//   2. Resend and SMTP transporters are now resolved and memoized
//      independently (sendWithFallback in emailService.js) — Resend is tried
//      first when configured; SMTP is tried as a genuine per-send runtime
//      fallback only when Resend is either unconfigured or its send attempt
//      is rejected by axios (a definitive failure per that transport's own
//      promise contract, never an ambiguous successful-but-unusual response).
//   3. Exactly one send attempt per configured transport per call — no
//      recursion, no retry loop beyond the single fallback attempt.
//   4. A missing transport (neither configured) makes sendX() resolve to
//      false without throwing — callers (e.g. auth.controller.js's
//      forgotPassword) already treat these as fire-and-forget
//      (`.catch(() => {})`), so a delivery failure is logged server-side via
//      console.warn but never surfaces in the HTTP response (intentional,
//      to avoid leaking whether an email is registered).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const emailServicePath = require.resolve('../services/emailService');
const authControllerPath = require.resolve('../controllers/auth.controller');

const ENV_KEYS = ['RESEND_API_KEY', 'EMAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
const RESET_LINK = 'https://api.lilycrest.space/api/auth/reset-password?token=abc123';

function snapshotEnv() {
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function freshEmailService() {
  delete require.cache[emailServicePath];
  return require(emailServicePath);
}

function withMockedAxiosPost(impl, fn) {
  const axios = require('axios');
  const original = axios.post;
  axios.post = impl;
  return Promise.resolve(fn()).finally(() => { axios.post = original; });
}

// Stubs nodemailer.createTransport and DNS resolution so SMTP can be
// exercised without any real network/DNS access, and captures every
// sendMail call made through it.
function withMockedSmtp(sendMailImpl, fn) {
  const nodemailer = require('nodemailer');
  const dns = require('node:dns');
  const originalCreateTransport = nodemailer.createTransport;
  const originalResolve4 = dns.promises.resolve4;

  const calls = [];
  dns.promises.resolve4 = async () => ['127.0.0.1'];
  nodemailer.createTransport = () => ({
    sendMail: async (opts) => {
      calls.push(opts);
      return sendMailImpl ? sendMailImpl(opts) : { messageId: 'smtp-message-id' };
    },
  });

  return Promise.resolve(fn(calls)).finally(() => {
    nodemailer.createTransport = originalCreateTransport;
    dns.promises.resolve4 = originalResolve4;
  });
}

function setResendEnv() {
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.EMAIL_FROM = 'LilyCrest <no-reply@lilycrest.space>';
}

function setSmtpEnv() {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_USER = 'user@example.com';
  process.env.SMTP_PASS = 'app-password';
}

test('Resend success: exactly one email sent, SMTP never touched', async () => {
  const saved = snapshotEnv();
  setResendEnv();
  setSmtpEnv(); // configured too, to prove a successful primary short-circuits it
  try {
    await withMockedSmtp(null, async (smtpCalls) => {
      const axiosCalls = [];
      await withMockedAxiosPost(async (url, body) => { axiosCalls.push({ url, body }); return { data: { id: 'resend-id' } }; }, async () => {
        const { sendPasswordResetEmail } = freshEmailService();
        const result = await sendPasswordResetEmail('tenant@example.com', 'Ana', RESET_LINK);
        assert.equal(result, true);
      });
      assert.equal(axiosCalls.length, 1);
      assert.equal(axiosCalls[0].url, 'https://api.resend.com/emails');
      assert.match(axiosCalls[0].body.html, /https:\/\/api\.lilycrest\.space\/api\/auth\/reset-password\?token=abc123/);
      assert.equal(smtpCalls.length, 0, 'SMTP transporter must never be invoked while Resend succeeds');
    });
  } finally {
    restoreEnv(saved);
  }
});

test('Resend failure: SMTP is called exactly once as a genuine per-send fallback', async () => {
  const saved = snapshotEnv();
  setResendEnv();
  setSmtpEnv();
  try {
    let axiosCalls = 0;
    await withMockedSmtp(null, async (smtpCalls) => {
      await withMockedAxiosPost(async () => { axiosCalls += 1; throw new Error('Resend API unavailable'); }, async () => {
        const { sendPasswordResetEmail } = freshEmailService();
        await sendPasswordResetEmail('tenant@example.com', 'Ana', RESET_LINK);
      });
      assert.equal(axiosCalls, 1);
      assert.equal(smtpCalls.length, 1, 'SMTP must be attempted exactly once after Resend fails');
    });
  } finally {
    restoreEnv(saved);
  }
});

test('Resend failure + SMTP success: final result is success, exactly one delivered email', async () => {
  const saved = snapshotEnv();
  setResendEnv();
  setSmtpEnv();
  try {
    await withMockedSmtp(null, async (smtpCalls) => {
      await withMockedAxiosPost(async () => { throw new Error('Resend API unavailable'); }, async () => {
        const { sendPasswordResetEmail } = freshEmailService();
        const result = await sendPasswordResetEmail('tenant@example.com', 'Ana', RESET_LINK);
        assert.equal(result, true);
      });
      assert.equal(smtpCalls.length, 1);
    });
  } finally {
    restoreEnv(saved);
  }
});

test('both Resend and SMTP fail: final result is a truthful failure, not a false success', async () => {
  const saved = snapshotEnv();
  setResendEnv();
  setSmtpEnv();
  try {
    await withMockedSmtp(() => { throw new Error('SMTP also unavailable'); }, async (smtpCalls) => {
      await withMockedAxiosPost(async () => { throw new Error('Resend API unavailable'); }, async () => {
        const { sendPasswordResetEmail } = freshEmailService();
        const result = await sendPasswordResetEmail('tenant@example.com', 'Ana', RESET_LINK);
        assert.equal(result, false);
      });
      assert.equal(smtpCalls.length, 1, 'no retry loop — SMTP is still only attempted once even though it also fails');
    });
  } finally {
    restoreEnv(saved);
  }
});

test('Resend failure does not cause a duplicate SMTP attempt (no retry loop)', async () => {
  const saved = snapshotEnv();
  setResendEnv();
  setSmtpEnv();
  try {
    let axiosCalls = 0;
    await withMockedSmtp(null, async (smtpCalls) => {
      await withMockedAxiosPost(async () => { axiosCalls += 1; throw new Error('Resend API unavailable'); }, async () => {
        const { sendPasswordResetEmail } = freshEmailService();
        await sendPasswordResetEmail('tenant@example.com', 'Ana', RESET_LINK);
      });
      assert.equal(axiosCalls, 1);
      assert.equal(smtpCalls.length, 1);
    });
  } finally {
    restoreEnv(saved);
  }
});

test('only SMTP configured (no Resend): SMTP works as the sole transport', async () => {
  const saved = snapshotEnv();
  delete process.env.RESEND_API_KEY;
  setSmtpEnv();
  try {
    let axiosCalled = false;
    await withMockedSmtp(null, async (smtpCalls) => {
      await withMockedAxiosPost(async () => { axiosCalled = true; return { data: {} }; }, async () => {
        const { sendPasswordResetEmail } = freshEmailService();
        const result = await sendPasswordResetEmail('tenant@example.com', 'Ana', RESET_LINK);
        assert.equal(result, true);
      });
      assert.equal(axiosCalled, false, 'Resend must never be called when it is not configured');
      assert.equal(smtpCalls.length, 1);
    });
  } finally {
    restoreEnv(saved);
  }
});

test('neither Resend nor SMTP configured: truthful failure, no network call attempted', async () => {
  const saved = snapshotEnv();
  for (const key of ENV_KEYS) delete process.env[key];
  try {
    let axiosCalled = false;
    await withMockedAxiosPost(async () => { axiosCalled = true; return { data: {} }; }, async () => {
      const { sendPasswordResetEmail } = freshEmailService();
      const result = await sendPasswordResetEmail('tenant@example.com', 'Ana', RESET_LINK);
      assert.equal(result, false);
    });
    assert.equal(axiosCalled, false);
  } finally {
    restoreEnv(saved);
  }
});

test('the reset URL embedded in the email is identical whether Resend or the SMTP fallback ends up sending it', async () => {
  const saved = snapshotEnv();
  setResendEnv();
  setSmtpEnv();
  try {
    // Primary (Resend) succeeds — capture its HTML.
    let resendHtml = null;
    await withMockedAxiosPost(async (url, body) => { resendHtml = body.html; return { data: { id: 'resend-id' } }; }, async () => {
      const { sendPasswordResetEmail } = freshEmailService();
      await sendPasswordResetEmail('tenant@example.com', 'Ana', RESET_LINK);
    });

    // Now force Resend to fail so the SMTP fallback sends it instead — capture its HTML.
    let smtpHtml = null;
    await withMockedSmtp((opts) => { smtpHtml = opts.html; return { messageId: 'id' }; }, async () => {
      await withMockedAxiosPost(async () => { throw new Error('Resend API unavailable'); }, async () => {
        const { sendPasswordResetEmail } = freshEmailService();
        await sendPasswordResetEmail('tenant@example.com', 'Ana', RESET_LINK);
      });
    });

    assert.ok(resendHtml && smtpHtml);
    const extractLink = (html) => html.match(/href="([^"]+)"/)[1];
    assert.equal(extractLink(resendHtml), extractLink(smtpHtml));
    assert.equal(extractLink(resendHtml), RESET_LINK);
  } finally {
    restoreEnv(saved);
  }
});

test('the OTP verification code embedded in the email is identical whether Resend or the SMTP fallback ends up sending it', async () => {
  const saved = snapshotEnv();
  setResendEnv();
  setSmtpEnv();
  try {
    let resendHtml = null;
    await withMockedAxiosPost(async (url, body) => { resendHtml = body.html; return { data: { id: 'resend-id' } }; }, async () => {
      const { sendLoginOtpEmail } = freshEmailService();
      await sendLoginOtpEmail('tenant@example.com', 'Ana', '654321');
    });

    let smtpHtml = null;
    await withMockedSmtp((opts) => { smtpHtml = opts.html; return { messageId: 'id' }; }, async () => {
      await withMockedAxiosPost(async () => { throw new Error('Resend API unavailable'); }, async () => {
        const { sendLoginOtpEmail } = freshEmailService();
        await sendLoginOtpEmail('tenant@example.com', 'Ana', '654321');
      });
    });

    assert.ok(resendHtml.includes('654321'));
    assert.ok(smtpHtml.includes('654321'));
  } finally {
    restoreEnv(saved);
  }
});

test('every email type renders one unconditional inline HTML body — no separate "template" vs "fallback" content branch', () => {
  const source = fs.readFileSync(emailServicePath, 'utf8');
  const functionBodies = source.match(/async function send\w*Email\w*\([^)]*\)\s*{[\s\S]*?\n}/g) || [];
  assert.ok(functionBodies.length >= 4, 'expected at least the four send*Email* functions');
  for (const body of functionBodies) {
    const templateCallCount = (body.match(/brandedHtml\(/g) || []).length;
    assert.equal(templateCallCount, 1, `expected exactly one inline HTML render per send function, got ${templateCallCount} in: ${body.slice(0, 60)}...`);
  }
});

test('forgotPassword sends the reset email exactly once per request and never awaits/blocks on it', () => {
  const source = fs.readFileSync(authControllerPath, 'utf8');
  const forgotPasswordBody = source.slice(source.indexOf('async function forgotPassword'), source.indexOf('// ─── RESET PASSWORD (GET'));
  const sendCalls = (forgotPasswordBody.match(/sendPasswordResetEmail\(/g) || []).length;
  assert.equal(sendCalls, 1);
  assert.match(forgotPasswordBody, /sendPasswordResetEmail\([^)]*\)\.catch\(\(\)\s*=>\s*\{\}\)/);
});
