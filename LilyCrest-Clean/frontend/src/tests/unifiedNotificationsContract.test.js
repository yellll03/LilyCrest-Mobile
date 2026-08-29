/* global test, __dirname */
import fs from 'fs';
import path from 'path';
import {
  buildNotificationRouteData,
  formatRelativeNotificationTimestamp,
  getNotificationCategoryPresentation,
} from '../utils/notificationPresentation';
import { resolveNotificationRoute } from '../services/notifications';

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('unified tenant notifications contract', () => {
  test('View all opens a dedicated Notifications route registered in the root stack', () => {
    const header = read('src/components/AppHeader.js');
    const layout = read('app/_layout.jsx');
    expect(header).toContain("router.push('/notifications')");
    expect(header).not.toMatch(/viewAllNotifications[\s\S]{0,180}\(tabs\)\/announcements/);
    expect(layout).toContain('<Stack.Screen name="notifications" />');
  });

  test('the unified screen uses AuthContext notifications and keeps News isolated', () => {
    const screen = read('app/notifications.jsx');
    expect(screen).toContain('notifications,');
    expect(screen).toContain('refreshNotifications,');
    expect(screen).toContain('markNotificationRead,');
    expect(screen).toContain('dismissNotification,');
    expect(screen).toContain('clearNotifications,');
    expect(screen).toMatch(/resolveNotificationRoute\(\s*buildNotificationRouteData\(notification\),\s*\{ reportUnsupported: true \},\s*\)/);
    expect(screen).not.toContain('useCanonicalAnnouncements');
    expect(screen).not.toContain("api.get('/announcements')");
  });

  test('Home search resolves each notification instead of sending every type to News', () => {
    const home = read('app/(tabs)/home.jsx');
    expect(home).toContain('resolveNotificationRoute(buildNotificationRouteData(n))');
    expect(home).toContain("|| '/notifications'");
    expect(home).not.toMatch(/category: 'Notifications'[^\n]*route: '\/\(tabs\)\/announcements'/);
  });

  test('route payload preserves canonical IDs from top-level and nested data', () => {
    expect(buildNotificationRouteData({
      type: 'bill_released',
      billing_id: 'bill-1',
      data: { request_id: 'request-ignored' },
    })).toEqual(expect.objectContaining({ type: 'bill_released', billing_id: 'bill-1', request_id: 'request-ignored' }));
    expect(buildNotificationRouteData({
      data: { type: 'contract_document_ready', contract_id: 'contract-2' },
    })).toEqual(expect.objectContaining({ type: 'contract_document_ready', contract_id: 'contract-2' }));
    expect(resolveNotificationRoute({ type: 'notification', category: 'billing', billing_id: 'bill-3' })).toEqual({
      pathname: '/bill-details',
      params: { billId: 'bill-3' },
    });
    expect(resolveNotificationRoute({ type: 'notification' })).toBe('/notifications');
  });

  test('presentation supports all major notification families', () => {
    const colors = { infoBg: '#1', info: '#2', warningBg: '#3', warning: '#4', accentSubtle: '#5', accentHover: '#6', surfaceSecondary: '#7', iconSecondary: '#8' };
    expect(getNotificationCategoryPresentation({ type: 'payment_approved' }, colors).label).toBe('Billing');
    expect(getNotificationCategoryPresentation({ type: 'contract_document_ready' }, colors).label).toBe('Contract');
    expect(getNotificationCategoryPresentation({ type: 'maintenance_update' }, colors).label).toBe('Maintenance');
    expect(getNotificationCategoryPresentation({ type: 'announcement' }, colors).label).toBe('Announcement');
    expect(getNotificationCategoryPresentation({ type: 'unknown-event' }, colors).label).toBe('System');
    expect(formatRelativeNotificationTimestamp('2026-08-24T00:00:00.000Z', new Date('2026-08-24T00:05:00.000Z').getTime())).toBe('5m ago');
  });
});
