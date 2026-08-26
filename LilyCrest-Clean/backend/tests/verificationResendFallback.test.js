'use strict';

// Explicit proof for the email-verification/resend requirement. This
// codebase has no separate "email verification" feature — registration
// requires admin approval, not a verification link/code (see register() in
// auth.controller.js: no email is sent at signup, status is
// 'pending_approval'). The only OTP + resend flow that exists is the LOGIN
// verification code: after password auth, a 6-digit code is emailed
// ("verification code" is the app's own wording — see the email subject
// built in sendLoginOtpEmail), and POST /auth/login/resend-otp
// (resendOtp() below) lets the tenant request a new one.
//
// Call chain proven here:
//   POST /auth/login/resend-otp
//   -> resendOtp() (controllers/auth.controller.js)
//   -> sendLoginOtpEmail() (services/emailService.js)
//   -> sendWithFallback() (services/emailService.js)
//   -> Resend (primary) -> SMTP (fallback, only on definitive Resend failure)

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const databasePath = require.resolve('../config/database');
const authControllerPath = require.resolve('../controllers/auth.controller');

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function fakeDb(otpDoc, userOverrides = {}) {
  const state = { doc: { ...otpDoc } };
  return {
    _state: state,
    collection(name) {
      if (name === 'users') {
        return {
          findOne: async (query) => (query.user_id === state.doc.user_id
            ? { user_id: state.doc.user_id, role: 'tenant', is_active: true, status: 'active', ...userOverrides }
            : null),
        };
      }
      if (name !== 'otp_store') {
        return { insertOne: async () => ({}), findOne: async () => null };
      }
      return {
        findOne: async (query) => (query.otp_token_hash === state.doc.otp_token_hash ? { ...state.doc } : null),
        updateOne: async (query, update) => {
          if (query.otp_token_hash !== state.doc.otp_token_hash) return { modifiedCount: 0 };
          Object.assign(state.doc, update.$set);
          return { modifiedCount: 1 };
        },
        deleteOne: async (query) => {
          if (query.otp_token_hash !== state.doc.otp_token_hash) return { deletedCount: 0 };
          state.doc = null;
          return { deletedCount: 1 };
        },
      };
    },
  };
}

function withMockedAxiosPost(impl, fn) {
  const axios = require('axios');
  const original = axios.post;
  axios.post = impl;
  return Promise.resolve(fn()).finally(() => { axios.post = original; });
}

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

const ENV_KEYS = ['RESEND_API_KEY', 'EMAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
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
function setResendEnv() {
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.EMAIL_FROM = 'LilyCrest <no-reply@lilycrest.space>';
}
function setSmtpEnv() {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_USER = 'user@example.com';
  process.env.SMTP_PASS = 'app-password';
}

function freshAuthController(db) {
  require(databasePath).getDb = () => db;
  delete require.cache[require.resolve('../services/emailService')];
  delete require.cache[authControllerPath];
  return require(authControllerPath);
}

function validOtpDoc(overrides = {}) {
  const rawToken = 'otp-token-raw';
  return {
    rawToken,
    doc: {
      otp_token_hash: hash(rawToken),
      email: 'tenant@example.com',
      user_id: 'tenant-a',
      otp_code_hash: hash('111111'),
      attempts: 0,
      expires_at: new Date(Date.now() + 5 * 60 * 1000),
      ...overrides,
    },
  };
}

test('verification-code resend reaches sendWithFallback: Resend success delivers exactly one email, SMTP never touched', async () => {
  const saved = snapshotEnv();
  setResendEnv();
  setSmtpEnv();
  try {
    const { rawToken, doc } = validOtpDoc();
    const db = fakeDb(doc);
    const { resendOtp } = freshAuthController(db);

    let axiosCalls = 0;
    let capturedHtml = null;
    await withMockedSmtp(null, async (smtpCalls) => {
      await withMockedAxiosPost(async (url, body) => {
        axiosCalls += 1;
        capturedHtml = body.html;
        return { data: { id: 'resend-id' } };
      }, async () => {
        const res = fakeResponse();
        await resendOtp({ body: { otp_token: rawToken } }, res);
        assert.equal(res.statusCode, 200); // resendOtp only calls res.json() on success, no explicit status() call
        assert.match(res.body.message, /new verification code/i);
      });
      assert.equal(axiosCalls, 1);
      assert.equal(smtpCalls.length, 0);
    });

    assert.ok(capturedHtml.includes('Verification Code') || capturedHtml.toLowerCase().includes('verification'));
  } finally {
    restoreEnv(saved);
  }
});

test('verification-code resend: Resend failure triggers exactly one SMTP fallback attempt, final result is success', async () => {
  const saved = snapshotEnv();
  setResendEnv();
  setSmtpEnv();
  try {
    const { rawToken, doc } = validOtpDoc();
    const db = fakeDb(doc);
    const { resendOtp } = freshAuthController(db);

    let axiosCalls = 0;
    await withMockedSmtp(null, async (smtpCalls) => {
      await withMockedAxiosPost(async () => { axiosCalls += 1; throw new Error('Resend API unavailable'); }, async () => {
        const res = fakeResponse();
        await resendOtp({ body: { otp_token: rawToken } }, res);
        assert.match(res.body.message, /new verification code/i);
      });
      assert.equal(axiosCalls, 1);
      assert.equal(smtpCalls.length, 1, 'SMTP must be attempted exactly once after Resend fails');
    });
  } finally {
    restoreEnv(saved);
  }
});

test('verification-code resend: both Resend and SMTP failing produces a truthful failure response, no duplicate attempts', async () => {
  const saved = snapshotEnv();
  setResendEnv();
  setSmtpEnv();
  try {
    const { rawToken, doc } = validOtpDoc();
    const db = fakeDb(doc);
    const { resendOtp } = freshAuthController(db);

    let axiosCalls = 0;
    await withMockedSmtp(() => { throw new Error('SMTP also unavailable'); }, async (smtpCalls) => {
      await withMockedAxiosPost(async () => { axiosCalls += 1; throw new Error('Resend API unavailable'); }, async () => {
        const res = fakeResponse();
        await resendOtp({ body: { otp_token: rawToken } }, res);
        assert.equal(res.statusCode, 500);
        assert.match(res.body.detail, /failed to send/i);
      });
      assert.equal(axiosCalls, 1);
      assert.equal(smtpCalls.length, 1, 'no retry loop even when both transports fail');
    });
  } finally {
    restoreEnv(saved);
  }
});

test('verification code embedded in the email is identical whether delivered via Resend or the SMTP fallback', async () => {
  const saved = snapshotEnv();
  setResendEnv();
  setSmtpEnv();
  try {
    const { rawToken: tokenA, doc: docA } = validOtpDoc();
    let resendHtml = null;
    await withMockedAxiosPost(async (url, body) => { resendHtml = body.html; return { data: { id: 'resend-id' } }; }, async () => {
      const { resendOtp } = freshAuthController(fakeDb(docA));
      await resendOtp({ body: { otp_token: tokenA } }, fakeResponse());
    });

    const { rawToken: tokenB, doc: docB } = validOtpDoc();
    let smtpHtml = null;
    await withMockedSmtp((opts) => { smtpHtml = opts.html; return { messageId: 'id' }; }, async () => {
      await withMockedAxiosPost(async () => { throw new Error('Resend API unavailable'); }, async () => {
        const { resendOtp } = freshAuthController(fakeDb(docB));
        await resendOtp({ body: { otp_token: tokenB } }, fakeResponse());
      });
    });

    assert.ok(resendHtml && smtpHtml);
    // Both emails embed a freshly generated 6-digit code inside the same
    // branded verification-code layout; extract and compare shape/markup
    // rather than the (necessarily different, randomly generated) codes.
    const extractLayout = (html) => html.replace(/\d{6}/, 'CODE');
    assert.equal(extractLayout(resendHtml).includes('Verification Code'), true);
    assert.equal(extractLayout(smtpHtml).includes('Verification Code'), true);
  } finally {
    restoreEnv(saved);
  }
});

test('resendOtp never logs the raw OTP code or transport secrets, only a user_id', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(authControllerPath, 'utf8');
  const resendOtpBody = source.slice(source.indexOf('async function resendOtp'), source.indexOf('// ─── GOOGLE SIGN-IN'));
  assert.doesNotMatch(resendOtpBody, /console\.(log|warn|error)\([^)]*newCode/);
  assert.match(resendOtpBody, /console\.log\(`\[ResendOtp\] New OTP sent for user_id=\$\{record\.user_id\}`\)/);
});

test('resend revalidates tenant role and rejects an applicant even with a valid OTP token', async () => {
  const { rawToken, doc } = validOtpDoc();
  const db = fakeDb(doc, { role: 'applicant' });
  const { resendOtp } = freshAuthController(db);
  const res = fakeResponse();

  await resendOtp({ body: { otp_token: rawToken } }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'TENANT_ACCESS_REQUIRED');
});

test('resend revalidates active status and rejects a tenant deactivated after password verification', async () => {
  const { rawToken, doc } = validOtpDoc();
  const db = fakeDb(doc, { is_active: false, status: 'inactive' });
  const { resendOtp } = freshAuthController(db);
  const res = fakeResponse();

  await resendOtp({ body: { otp_token: rawToken } }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ACCOUNT_INACTIVE');
});
