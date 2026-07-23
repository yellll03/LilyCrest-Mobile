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
});
