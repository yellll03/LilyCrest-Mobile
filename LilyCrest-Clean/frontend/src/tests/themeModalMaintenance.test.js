/* global test, __dirname */
import fs from 'fs';
import path from 'path';
import { DARK_COLORS, LIGHT_COLORS, semanticStatusPalette } from '../theme/tokens';

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

describe('theme-aware dialogs and maintenance conversation', () => {
  test('both themes expose complete semantic foreground, input, modal, icon, and overlay tokens', () => {
    for (const colors of [LIGHT_COLORS, DARK_COLORS]) {
      expect(colors).toEqual(expect.objectContaining({
        textPrimary: expect.any(String),
        textSecondary: expect.any(String),
        textMuted: expect.any(String),
        onPrimary: expect.any(String),
        interactive: expect.any(String),
        inputBackground: expect.any(String),
        modalBackground: expect.any(String),
        overlay: expect.any(String),
        iconPrimary: expect.any(String),
        iconSecondary: expect.any(String),
      }));
    }
    expect(DARK_COLORS.onPrimary).not.toBe(DARK_COLORS.surface);
    expect(DARK_COLORS.interactive).not.toBe(DARK_COLORS.primary);
    expect(DARK_COLORS.textMuted).not.toBe('#4B5563');
  });

  test('status badges use theme-specific surfaces and readable foregrounds', () => {
    expect(semanticStatusPalette(DARK_COLORS, 'danger')).toEqual(expect.objectContaining({
      background: DARK_COLORS.errorBg,
      text: DARK_COLORS.errorText,
    }));
    expect(semanticStatusPalette(DARK_COLORS, 'warning').background).not.toBe(
      semanticStatusPalette(LIGHT_COLORS, 'warning').background,
    );
  });

  test('the shared dialog owns theme surfaces, status colors, custom content, disabled actions, and loading actions', () => {
    const modal = read('../components/StyledModal.js');
    expect(modal).toContain('backgroundColor: colors.modalBackground');
    expect(modal).toContain('backgroundColor: colors.overlay');
    expect(modal).toContain('cfg?.background || colors.primaryLight');
    expect(modal).toContain("children ? <View style={styles.childContent}");
    expect(modal).toContain('disabled={btn.disabled || btn.loading}');
    expect(modal).toContain('btn.loading ? (');
    expect(modal).toContain('accessibilityRole="alert"');
    expect(modal).toContain('accessibilityLabel={btn.text}');
  });

  test('profile and maintenance confirmations use the shared themed dialog', () => {
    const profile = read('../../app/(tabs)/profile.jsx');
    const maintenance = read('../../app/(tabs)/services.jsx');
    expect(profile).not.toMatch(/<Modal visible=\{logoutModalVisible\}|<Modal visible=\{discardModalVisible\}/);
    expect(profile.match(/<StyledModal/g)).toHaveLength(2);
    expect(maintenance).not.toMatch(/<Modal visible=\{showDiscardConfirm\}|<Modal visible=\{showCancelConfirm\}|<Modal visible=\{showReopenModal\}/);
    expect(maintenance.match(/<StyledModal/g)).toHaveLength(3);
  });

  test('other active LilyCrest-owned confirmations use the shared alert provider', () => {
    const notifications = read('../components/AppHeader.js');
    const assistant = read('../screens/LilyAssistantScreen.jsx');
    const survey = read('../../app/survey-form.jsx');
    for (const source of [notifications, assistant, survey]) {
      expect(source).toContain('useAlert');
      expect(source).toContain('showAlert');
      expect(source).not.toContain('Alert.alert');
    }
  });

  test('maintenance composer is nested inside the conversation border with vertically centered placeholder text', () => {
    const maintenance = read('../../app/(tabs)/services.jsx');
    const threadStart = maintenance.indexOf('<View style={styles.conversationThread}>');
    const composer = maintenance.indexOf('testID="maintenance-composer"', threadStart);
    const actionButtons = maintenance.indexOf('{/* Action Buttons */}', composer);
    const threadClose = maintenance.lastIndexOf('</View>', actionButtons);
    expect(threadStart).toBeGreaterThan(-1);
    expect(composer).toBeGreaterThan(threadStart);
    expect(threadClose).toBeGreaterThan(composer);
    expect(maintenance.slice(composer, actionButtons)).toContain('textAlignVertical="center"');
    expect(maintenance).toContain('minHeight: 50');
    expect(maintenance).toContain('lineHeight: 20');
  });

  test('primary maintenance controls use on-primary foregrounds rather than dark surfaces', () => {
    const maintenance = read('../../app/(tabs)/services.jsx');
    expect(maintenance).not.toMatch(/color=\{colors\.surface\}/);
    expect(maintenance).not.toMatch(/color: c\.surface/);
    expect(maintenance).toContain('color={colors.onPrimary}');
    expect(maintenance).toContain('color: c.onPrimary');
  });
});
