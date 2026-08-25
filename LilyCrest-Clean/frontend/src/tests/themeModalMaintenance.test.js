/* global test, __dirname */
import fs from 'fs';
import path from 'path';
import { DARK_COLORS, LIGHT_COLORS, resolveThemeForeground, semanticStatusPalette } from '../theme/tokens';

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

const relativeLuminance = (hex) => {
  const channels = hex.match(/[\da-f]{2}/gi).map((value) => parseInt(value, 16) / 255);
  const linear = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
};

const contrastRatio = (foreground, background) => {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
};

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

  test('legacy registry colors resolve to complementary dark-surface foregrounds', () => {
    const foregrounds = [
      resolveThemeForeground('#0A1628', DARK_COLORS, true),
      resolveThemeForeground('#B9921F', DARK_COLORS, true),
      resolveThemeForeground('#991B1B', DARK_COLORS, true),
      resolveThemeForeground('#DC2626', DARK_COLORS, true),
    ];

    expect(foregrounds).toEqual([
      DARK_COLORS.iconPrimary,
      DARK_COLORS.accent,
      DARK_COLORS.errorText,
      DARK_COLORS.errorText,
    ]);
    for (const foreground of foregrounds) {
      expect(contrastRatio(foreground, DARK_COLORS.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(foreground, DARK_COLORS.background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(resolveThemeForeground('#0A1628', LIGHT_COLORS, false)).toBe('#0A1628');
  });

  test('dark-mode registries and the About wordmark use active theme foregrounds', () => {
    const sources = [
      read('../../app/(tabs)/services.jsx'),
      read('../../app/documents.jsx'),
      read('../../app/house-rules.jsx'),
      read('../../app/my-documents.jsx'),
    ];
    for (const source of sources) {
      expect(source).toContain('resolveThemeForeground');
    }
    expect(read('../../app/about.jsx')).toContain("theme={isDarkMode ? 'dark' : 'light'}");
  });

  test('maintenance service-type icons use the system gold in dark mode', () => {
    const maintenance = read('../../app/(tabs)/services.jsx');
    expect(maintenance).toMatch(/function getServiceTypeIconColor[\s\S]*?isDarkMode\s*\? colors\.accent/);
    expect(maintenance.match(/getServiceTypeIconColor\(/g).length).toBeGreaterThanOrEqual(6);
    expect(maintenance).toContain('isSelected && !isDarkMode ? colors.onPrimary : foregroundColor');
    expect(maintenance).not.toContain('color={typeInfo.color}');
    expect(maintenance).not.toContain('color={ti.color}');
  });

  test('the offline session banner is inset below system chrome without adding a second safe-area gap', () => {
    const auth = read('../context/AuthContext.js');
    expect(auth).toContain('useSafeAreaInsets');
    expect(auth).toContain('style={[styles.sessionOfflineBanner, { top: safeAreaInsets.top }]}');
    expect(auth).toContain("sessionState === 'retryable' && styles.contentWithOfflineBanner");
    expect(auth).toContain("position: 'absolute'");
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
