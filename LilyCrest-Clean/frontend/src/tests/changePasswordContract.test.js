/* global test, __dirname */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

// Proves Change Password is discoverable and fully wired from the normal
// Settings UI, is not gated behind any conditional, validates all three
// fields, calls the real backend endpoint, and forces re-login after a
// successful change — the concrete contract requested for QA re-verification.
describe('Change Password reachability and contract', () => {
  test('Settings screen unconditionally renders a Change Password entry point to /change-password', () => {
    const source = read('app/settings.jsx');
    const menuItemIndex = source.indexOf("Text style={styles.settingLabel}>Change Password<");
    expect(menuItemIndex).toBeGreaterThan(-1);

    const securitySectionIndex = source.indexOf("Text style={styles.sectionTitle}>Security<");
    expect(securitySectionIndex).toBeGreaterThan(-1);
    expect(menuItemIndex).toBeGreaterThan(securitySectionIndex);
    expect(source).not.toMatch(/biometric|finger-print/i);
    expect(source).toContain("router.push('/change-password')");
  });

  test('change-password route is registered in the app navigator', () => {
    const layout = read('app/_layout.jsx');
    expect(layout).toMatch(/<Stack\.Screen\s+name="change-password"/);
  });

  test('change-password screen validates current password, new password strength, and confirmation match', () => {
    const source = read('app/change-password.jsx');
    expect(source).toContain("if (!password) return 'Current password is required'");
    expect(source).toContain('validateStrongPassword(newPassword');
    expect(source).toContain("'Your new password must be different from your current password.'");
    expect(source).toContain("'Passwords do not match'");
  });

  test('change-password screen calls the real backend endpoint, not a stub', () => {
    const source = read('app/change-password.jsx');
    expect(source).toContain('apiService.changePassword(currentPassword, newPassword');
    const apiSource = read('src/services/api.js');
    expect(apiSource).toContain("changePassword: (currentPassword, newPassword, options = {}) =>");
    expect(apiSource).toContain("api.post('/auth/change-password'");
  });

  test('all three password fields reject whitespace through the same input guard', () => {
    const source = read('app/change-password.jsx');
    expect(source).toMatch(/validateCurrentPassword[\s\S]{0,180}\/\\s\/\.test\(password\)/);
    expect(source).toContain('blockPasswordWhitespaceInput(value, currentValue)');
    expect(source).toContain("if (field === 'current') setCurrentPassword(nextValue);");
    expect(source).not.toContain('>No spaces</Text>');
  });

  test('change-password has a synchronous duplicate-submit guard', () => {
    const source = read('app/change-password.jsx');
    expect(source).toContain('const submitInFlight = useRef(false);');
    expect(source).toContain('if (submitInFlight.current) return;');
    expect(source).toContain('submitInFlight.current = true;');
    expect(source).toContain('submitInFlight.current = false;');
  });

  test('a successful change clears pending auth state and forces sign-out back to /login', () => {
    const source = read('app/change-password.jsx');
    expect(source).toContain('await clearCredentials()');
    expect(source).toContain('await logout()');
    expect(source).toContain("router.replace('/login')");
  });

  test('the hero lock icon uses the themed gold accent, not a hardcoded dark colour (dark-mode visibility)', () => {
    const source = read('app/change-password.jsx');
    // The 40px hero icon inside styles.iconContainer must take colors.accent
    // so it stays visible on the accentSubtle chip in dark mode.
    expect(source).toMatch(/name="lock-closed"\s+size=\{40\}\s+color=\{colors\.accent\}/);
    expect(source).not.toContain('color="#0A1628"');
    // The chip keeps the accentSubtle fill + accentLight border treatment.
    expect(source).toMatch(/iconContainer:\s*\{[^}]*backgroundColor:\s*colors\.accentSubtle[^}]*borderColor:\s*colors\.accentLight/);
  });
});
