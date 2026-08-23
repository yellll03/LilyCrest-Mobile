/* global __dirname, test */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('single-splash and Login UX contracts', () => {
  const layout = read('app/_layout.jsx');
  const authContext = read('src/context/AuthContext.js');
  const index = read('app/index.jsx');
  const login = read('app/login.jsx');
  const otp = read('app/otp-verify.jsx');

  test('native startup hands off to one visually continuous animated loading overlay', () => {
    expect(layout).toContain('SplashScreen.preventAutoHideAsync()');
    expect(layout).toContain('startupReady');
    expect(layout).toContain('SplashScreen.hideAsync()');
    expect(layout).toContain('testID="startup-loading-overlay"');
    expect(layout).toContain("require('../assets/images/splash-image.png')");
    expect(layout).toContain('accessibilityLabel="Loading LilyCrest"');
    expect(layout).toContain("outputRange: ['0deg', '360deg']");
    expect(layout).toContain('zIndex: 3000');
    expect(authContext).not.toContain('Preparing LilyCrest');
    expect(index).not.toMatch(/ActivityIndicator|loadingScreen|loadingLogo|PRE_LOGIN_LOADING_MIN_MS/);
  });

  test('logged-out startup restores all three onboarding screens', () => {
    expect(index).toContain("title: 'Smart Living'");
    expect(index).toContain("title: 'Secure Stay'");
    expect(index).toContain("title: 'Easy Management'");
    expect(index).toContain("'Get Started'");
    expect(index).toContain("router.replace('/login')");
    expect(layout).not.toContain('unauthenticatedEntryPath');
  });

  test('Login has email-only Remember me beside Forgot password and no back arrow', () => {
    expect(login).toContain('accessibilityRole="checkbox"');
    expect(login).toContain('accessibilityLabel="Remember me"');
    expect(login).toContain('>Remember me</Text>');
    expect(login).toContain('Forgot password?');
    expect(login).toContain('saveRememberedEmail({ rememberEmail, email: normalizedEmail })');
    expect(login).not.toContain('style={styles.backButton}');
    expect(login).not.toContain('name="arrow-back"');
    expect(login).not.toContain("getItem('last_email')");
    expect(login).toContain('passwordInputContainer: { marginBottom: 4 }');
  });

  test('OTP completion applies the same preference only after successful verification', () => {
    expect(otp).toContain('const result = await verifyLoginOtp(otpToken, code);');
    expect(otp).toMatch(/if \(!result\.success\)[\s\S]*?return;[\s\S]*?await saveRememberedEmail\(/);
    expect(otp).toContain('rememberEmail: pendingLogin?.rememberEmail === true');
  });

  test('approved splash and wordmark assets remain wired to startup and authentication', () => {
    const config = read('app.config.js');
    const styles = read('android/app/src/main/res/values/styles.xml');
    expect(config).toContain("image: './assets/images/splash-image.png'");
    expect(config).toContain("backgroundColor: '#000000'");
    expect(styles).toContain('@drawable/splashscreen_logo');
    expect(index).toContain("require('../assets/images/lilycrest-wordmark.png')");
    expect(login).toContain("require('../assets/images/lilycrest-wordmark.png')");

    const digest = (relativePath) => crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(root, relativePath)))
      .digest('hex');
    expect(digest('assets/images/splash-image.png')).toBe(
      'a9a5721eae7c01806e0eb0e4cd01eca0ec098d6f01b8c002660ea1714446fd86'
    );
    expect(digest('assets/images/lilycrest-wordmark.png')).toBe(
      '5298f31933a2a778f3b2fa5f2b1585676f7cf076b83195a7bc88745e0e73dc45'
    );
  });

  test('Android adaptive launcher icons keep the logo inside the safe area', () => {
    const launcher = read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml');
    const roundLauncher = read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml');
    expect(launcher).toContain('android:inset="10%"');
    expect(roundLauncher).toContain('android:inset="10%"');
  });
});
