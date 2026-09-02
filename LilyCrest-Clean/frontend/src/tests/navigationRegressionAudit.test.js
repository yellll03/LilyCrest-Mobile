/* global __dirname, test */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('navigation regression contracts', () => {
  test('Home remains the authenticated root and tab Back target', () => {
    const rootLayout = read('app/_layout.jsx');
    const tabLayout = read('app/(tabs)/_layout.jsx');
    expect(rootLayout).toContain("initialRouteName: '(tabs)'");
    expect(tabLayout).toContain('initialRouteName="home"');
    expect(tabLayout).toContain('backBehavior="initialRoute"');
  });

  test('foreground lifecycle handlers refresh state without navigating', () => {
    const authContext = read('src/context/AuthContext.js');
    const foregroundHandlers = [...authContext.matchAll(/AppState\.addEventListener\('change',[\s\S]*?\n\s*\}\);/g)]
      .map((match) => match[0]);
    expect(foregroundHandlers.length).toBeGreaterThan(0);
    foregroundHandlers.forEach((handler) => {
      expect(handler).not.toMatch(/router|navigate|replace|announcements/);
    });
  });

  test('authenticated custom Back controls use history with Home as their safe fallback', () => {
    const protectedScreens = [
      'about.jsx', 'bill-details.jsx', 'billing-history.jsx', 'contract-viewer.jsx',
      'document-viewer.jsx', 'documents.jsx', 'house-rules.jsx', 'image-viewer.jsx',
      'my-documents.jsx', 'payment.jsx', 'privacy-policy.jsx', 'settings.jsx',
      'survey-form.jsx', 'surveys.jsx', 'terms-of-service.jsx',
    ];
    protectedScreens.forEach((screen) => {
      const source = read(`app/${screen}`);
      expect(source).not.toContain('router.back()');
      expect(source).not.toMatch(/safeBack\(router,\s*['"]/);
    });
  });

  test('Android Back closes Maintenance and News detail modals in place', () => {
    const services = read('app/(tabs)/services.jsx');
    const announcements = read('app/(tabs)/announcements.jsx');
    expect(services).toMatch(/visible=\{showDetailModal\}[\s\S]*?onRequestClose=\{closeMaintenanceDetail\}/);
    expect(services).toMatch(/const closeMaintenanceDetail = \(\) => \{[\s\S]*?setShowDetailModal\(false\);/);
    expect(announcements).toMatch(/visible=\{!!selectedAnn\}[\s\S]*?onRequestClose=\{\(\) => setSelectedAnn\(null\)\}/);
  });
});
