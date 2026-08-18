/* global test, __dirname */
import fs from 'fs';
import path from 'path';

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

describe('production mutation guards', () => {
  test('both payment entry points guard checkout creation before awaiting a bill refresh', () => {
    for (const file of ['../../app/bill-details.jsx', '../../app/payment.jsx']) {
      const source = read(file);
      const handler = source.slice(source.indexOf('const handlePayOnline'), source.indexOf('const handlePayOnline') + 800);
      expect(handler).toContain('if (checkoutGuardRef.current) return');
      expect(handler.indexOf('checkoutGuardRef.current = true')).toBeLessThan(handler.indexOf("await loadBill({ showLoader: false })"));
    }
  });

  test('payment-proof, profile, OTP, and support mutations use synchronous guards', () => {
    const bill = read('../../app/bill-details.jsx');
    const profile = read('../../app/(tabs)/profile.jsx');
    const otp = read('../../app/otp-verify.jsx');
    const support = read('../screens/LilyAssistantScreen.jsx');
    expect(bill).toContain('proofUploadGuardRef.current = true');
    expect(profile).toContain('profileMutationGuardRef.current = true');
    expect(otp).toContain('verifyGuardRef.current = true');
    expect(otp).toContain('resendGuardRef.current = true');
    expect(support).toContain('replyGuardRef.current');
    expect(support).toContain('reopenGuardRef.current');
    expect(support).toContain('resolutionGuardRef.current');
  });

  test('sign-out is confirmed, destructive, and double-tap guarded', () => {
    const profile = read('../../app/(tabs)/profile.jsx');
    expect(profile).toContain('Are you sure you want to sign out of your Lilycrest account?');
    expect(profile).toContain('if (logoutGuardRef.current) return');
    expect(profile).toContain("backgroundColor: '#DC2626'");
  });
});
