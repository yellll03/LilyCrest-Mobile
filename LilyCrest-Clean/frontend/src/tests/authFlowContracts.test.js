/* global test, __dirname */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('auth flow implementation contracts', () => {
  test('forgot password has repeated-submission protection', () => {
    const source = read('app/forgot-password.jsx');
    expect(source).toContain('if (requestInFlight.current) return;');
    expect(source).toContain('requestInFlight.current = true;');
    expect(source).toContain('disabled={isLoading || !isEmailValid}');
  });

  // Forgot-password must go through this backend's own reset-token flow
  // (Resend email + production reset page, always built from BACKEND_URL —
  // see auth.controller.js's buildPasswordResetLink) rather than Firebase's
  // client SDK, whose action link domain is controlled by Firebase Console
  // settings and is not guaranteed to point at our production domain.
  test('forgot password is routed through the backend, not the Firebase client SDK', () => {
    const source = read('app/forgot-password.jsx');
    expect(source).toContain('apiService.forgotPassword(');
    expect(source).not.toContain('sendPasswordResetEmail(auth');
    expect(source).not.toMatch(/from ['"]firebase\/auth['"]/);
  });

  test('Google authentication uses the singleton Firebase module', () => {
    expect(read('src/config/googleSignIn.js')).toContain("from './firebase'");
    expect(read('src/config/firebase.js')).toContain('globalForFirebase.auth');
  });

  test('auth restoration renders a loading state before protected content', () => {
    const context = read('src/context/AuthContext.js');
    const layout = read('app/_layout.jsx');
    expect(context).toContain("authStatus === 'initializing'");
    expect(layout).toContain('if (isLoading || !authReady');
  });

  test('expired session clears storage and returns unauthenticated', () => {
    const source = read('src/context/AuthContext.js');
    expect(source).toContain('if (status === 401)');
    expect(source).toContain('await clearPersistedSession()');
    expect(source).toContain("setAuthStatus('unauthenticated')");
  });

  test('logout clears account, session, notification, and Firebase state', () => {
    const source = read('src/context/AuthContext.js');
    expect(source).toContain('await clearCredentials()');
    expect(source).toContain('await clearPersistedSession()');
    expect(source).toContain('setNotificationUnreadCount(0)');
    expect(source).toContain('auth.signOut()');
  });

  test('preview configuration cannot resolve to localhost', () => {
    const eas = JSON.parse(read('eas.json'));
    expect(eas.build.preview.android.buildType).toBe('apk');
    expect(eas.build.preview.env.EXPO_PUBLIC_BACKEND_URL)
      .toBe('https://api.lilycrest.space');
  });

  test('email login allows time for backend authentication and OTP delivery', () => {
    const source = read('src/context/AuthContext.js');
    expect(source).toContain("api.post('/auth/login'");
    expect(source).toContain('timeout: 60000');
  });

  test('a background session expiry (axios refresh failure) forces logout and tells the tenant why', () => {
    const apiSource = read('src/services/api.js');
    const contextSource = read('src/context/AuthContext.js');
    expect(apiSource).toContain("import { emitSessionExpired } from './sessionEvents';");
    expect(apiSource).toContain('emitSessionExpired(');
    expect(contextSource).toContain('subscribeSessionExpired');
    expect(contextSource).toContain("setAuthStatus('unauthenticated')");
    expect(contextSource).toContain('Session expired');
  });

  test('auth code does not log passwords or tokens', () => {
    const sources = [
      read('app/login.jsx'),
      read('app/forgot-password.jsx'),
      read('src/context/AuthContext.js'),
      read('src/services/api.js'),
    ].join('\n');
    expect(sources).not.toMatch(/console\.(?:log|warn|error)\([^)]*\bpassword\b/i);
    expect(sources).not.toMatch(/console\.(?:log|warn|error)\([^)]*\b(?:access|refresh|session|id)Token\b/i);
  });
});
