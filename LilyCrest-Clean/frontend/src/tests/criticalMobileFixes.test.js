/* global test, __dirname */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('critical mobile fixes', () => {
  test('billing quick action sends an account billing question', () => {
    const source = read('src/screens/LilyAssistantScreen.jsx');
    expect(source).toContain("prompt: 'How much do I need to pay this month?'");
    expect(source).toContain('onPress={() => handleQuickAction(action)}');
  });

  test('profile uses server-provided username cooldown metadata', () => {
    const source = read('app/(tabs)/profile.jsx');
    expect(source).toContain('user?.usernameNextAllowedAt');
    expect(source).toContain('user?.serverTime');
    expect(source).toContain('editable={!usernameCooldownActive}');
    expect(source).not.toContain("new Date(user.lastUsernameChangedAt).getTime() + 7");
  });

  test('approved address is read-only and branch map failures are distinct', () => {
    const source = read('app/(tabs)/profile.jsx');
    expect(source).toContain('Address comes from your approved tenant application.');
    expect(source).toContain('Unable to open the branch location. Please try again.');
    expect(source).toContain("!/^https:\\/\\//i.test(destination || '')");
  });

  test('bill details recognizes every canonical status the backend can return, including rejected', () => {
    const source = read('app/bill-details.jsx');
    expect(source).toContain("rejected: { bg: '#fef2f2', text: '#b91c1c', icon: 'close-circle', label: 'Payment Rejected' }");
    // All 7 canonical statuses must have a STATUS_CONFIG entry so the badge
    // never silently falls back to "Unpaid" for a bill that's actually
    // overdue, under review, partially paid, rejected, or cancelled.
    for (const status of ['unpaid', 'overdue', 'pending_verification', 'partially_paid', 'paid', 'rejected', 'cancelled']) {
      expect(source).toContain(`${status}: {`);
    }
  });

  test('bill details never presents the PayMongo gateway name as the tenant\'s payment method', () => {
    const source = read('app/bill-details.jsx');
    expect(source).toContain('paymentMethodLabel(bill.payment_method, bill.payment_channel)');
    expect(source).not.toContain("bill.payment_method === 'paymongo' ? 'PayMongo'");
  });
});
