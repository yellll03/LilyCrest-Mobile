/* global __dirname */
const fs = require('fs');
const path = require('path');
const { getChatErrorMessage } = require('../utils/chatErrorMessage');

describe('chat tenant/auth reconciliation', () => {
  const apiSource = fs.readFileSync(path.resolve(__dirname, '../services/api.js'), 'utf8');
  const screenSource = fs.readFileSync(path.resolve(__dirname, '../screens/LilyAssistantScreen.jsx'), 'utf8');

  it('uses the canonical support route through the authenticated API client', () => {
    expect(apiSource).toContain("getMySupportChats: () => api.get('/chat/me')");
    expect(apiSource).toContain('config.headers.Authorization = `Bearer ${token}`');
  });

  it('waits for auth hydration and never sends a mobile tenant or branch override', () => {
    expect(screenSource).toContain('if (!authReady) return');
    expect(screenSource).toContain('if (!user)');
    expect(screenSource).not.toMatch(/startSupportChat\(\{[\s\S]{0,300}\b(?:tenantId|tenant_id|branch|branchId)\s*:/);
  });

  it('maps auth, inactive-account, tenant-context, and network failures safely', () => {
    expect(getChatErrorMessage({ response: { status: 401 } })).toMatch(/session expired/i);
    expect(getChatErrorMessage({ response: { status: 403, data: { code: 'ACCOUNT_INACTIVE' } } })).toMatch(/inactive/i);
    expect(getChatErrorMessage({ response: { status: 400, data: { code: 'BRANCH_REQUIRED' } } })).toMatch(/tenant and branch/i);
    expect(getChatErrorMessage({ request: {}, message: 'Network Error' })).toMatch(/check your connection/i);
    expect(getChatErrorMessage({ status: 401, backendCode: 'TOKEN_EXPIRED' })).toMatch(/session expired/i);
    expect(getChatErrorMessage({ code: 'network_error', network: true })).toMatch(/check your connection/i);
  });

  it('does not expose an arbitrary backend detail or stack string to the tenant', () => {
    const error = { response: { status: 500, data: { detail: 'MongoServerError: secret internals' } } };
    expect(getChatErrorMessage(error)).toBe('Chat is temporarily unavailable. Please try again later.');
  });
});
