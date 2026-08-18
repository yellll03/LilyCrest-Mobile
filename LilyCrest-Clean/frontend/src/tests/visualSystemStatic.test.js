/* global __dirname, test */
import fs from 'fs';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../..');

function sourceFiles(relativeDirectory) {
  const directory = path.join(projectRoot, relativeDirectory);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (relativePath.replace(/\\/g, '/') === 'src/tests') return [];
      return sourceFiles(relativePath);
    }
    return /\.(js|jsx)$/.test(entry.name) ? [relativePath] : [];
  });
}

const presentationFiles = [...sourceFiles('app'), ...sourceFiles('src')];
const presentationSource = presentationFiles
  .map((relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'))
  .join('\n');

describe('canonical Lilycrest visual-system guardrails', () => {
  test('tenant presentation contains no gradient or glow implementation', () => {
    expect(presentationSource).not.toMatch(/LinearGradient|linear-gradient|radial-gradient|GOLD_GLOW/i);
  });

  test('legacy brand, arbitrary purple, and old orange values stay out of production UI', () => {
    expect(presentationSource).not.toMatch(/#204B7E|#F97316|#F08040|#C05018|#3B82F6|#9333EA|#7C3AED|#8B5CF6|#EC4899|#06B6D4/i);
    expect(presentationSource).not.toMatch(/rgba\((255,\s*144,\s*0|255,\s*101,\s*0|212,\s*104,\s*42|212,\s*148,\s*42|249,\s*115,\s*22)/i);
  });

  test('shared components preserve canonical action and status semantics', () => {
    const source = fs.readFileSync(path.join(projectRoot, 'src/components/ui/LilycrestUI.jsx'), 'utf8');
    expect(source).toContain('export function ScreenHeader');
    expect(source).toContain('export function SurfaceCard');
    expect(source).toContain('export function StatusBadge');
    expect(source).toContain('export function EmptyState');
    expect(source).toContain("destructive: { background: colors.errorBg, border: colors.error, text: colors.errorText }");
    expect(source).toContain("gold: { background: colors.accent, border: colors.accent, text: '#0A1628' }");
  });

  test('bottom navigation uses one icon treatment and keeps content above the bar', () => {
    const tabs = fs.readFileSync(path.join(projectRoot, 'app/(tabs)/_layout.jsx'), 'utf8');
    const support = fs.readFileSync(path.join(projectRoot, 'src/screens/LilyAssistantScreen.jsx'), 'utf8');
    const billDetails = fs.readFileSync(path.join(projectRoot, 'app/bill-details.jsx'), 'utf8');
    expect(tabs).not.toContain('HomeTabIcon');
    expect(tabs).toContain('TabBarItem');
    expect(tabs).not.toContain('AnimatedTabIcon');
    expect(support).toContain('paddingBottom: tabBarHeight');
    expect(billDetails).toContain("<SafeAreaView style={styles.container} edges={['top']}>");
  });
});
