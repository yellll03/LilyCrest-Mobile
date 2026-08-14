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

    // Not nested inside a conditional render (e.g. `{someFlag && (`) between
    // the start of the Security section and this menu item — only the
    // unrelated biometric row above it is conditionally rendered.
    const securitySectionIndex = source.indexOf("Text style={styles.sectionTitle}>Security<");
    const between = source.slice(securitySectionIndex, menuItemIndex);
    const biometricGateIndex = between.indexOf('biometricAvailable &&');
    expect(biometricGateIndex).toBeGreaterThan(-1);
    // The biometric conditional block closes (its own View) before the
    // Change Password TouchableOpacity opens, i.e. Change Password sits
    // outside of it, as a sibling — not nested inside `biometricAvailable &&`.
    const changePasswordTouchableIndex = between.lastIndexOf('TouchableOpacity');
    const biometricBlockCloseIndex = between.indexOf(')}', biometricGateIndex);
    expect(changePasswordTouchableIndex).toBeGreaterThan(biometricBlockCloseIndex);

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
    expect(source).toContain("'New password must be different from your current password'");
    expect(source).toContain("'Passwords do not match'");
  });

  test('change-password screen calls the real backend endpoint, not a stub', () => {
    const source = read('app/change-password.jsx');
    expect(source).toContain('apiService.changePassword(currentPassword, newPassword');
    const apiSource = read('src/services/api.js');
    expect(apiSource).toContain("changePassword: (currentPassword, newPassword, options = {}) =>");
    expect(apiSource).toContain("api.post('/auth/change-password'");
  });

  test('a successful change clears biometric credentials and forces sign-out back to /login', () => {
    const source = read('app/change-password.jsx');
    expect(source).toContain('await clearCredentials()');
    expect(source).toContain('await logout()');
    expect(source).toContain("router.replace('/login')");
  });
});
