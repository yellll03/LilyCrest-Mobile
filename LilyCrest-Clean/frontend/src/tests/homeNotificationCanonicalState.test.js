/* global test, __dirname */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

// Regression guard for the Home screen's notification-search-index data
// source. Home used to fetch its own independent copy of notifications
// (apiService.getNotifications()/getAnnouncements(), bundled into
// dashboardData.notifications) purely to build "Notifications" rows in its
// quick-search results — a second, disconnected copy of the same data
// AuthContext already owns. Because that copy was disconnected from
// AuthContext.dismissNotification()/clearNotifications(), a tenant could
// dismiss or clear a notification and still see it surface in Home's search
// until the next unrelated dashboard refetch. Home must now derive its
// search-index notifications directly from AuthContext's canonical list, so
// dismiss/clear reflects there immediately with no second fetch.
//
// Same source-text-assertion style as homeRoomPhotoInteractionIsolation.test.js
// — Home's own dependency surface (Animated lightbox, dashboard API, billing
// state subscription, etc.) makes a full component render disproportionately
// heavy for what's a data-plumbing regression, matching this repo's existing
// convention for this specific screen.
describe('Home notification search index uses AuthContext, not a separate fetch', () => {
  const source = read('app/(tabs)/home.jsx');

  test('useAuth() destructures the canonical notifications list', () => {
    expect(source).toContain('notifications: authNotifications');
  });

  test('the search-index notifications memo derives from AuthContext, not dashboardData', () => {
    const memoIndex = source.indexOf('const notifications = useMemo(');
    expect(memoIndex).toBeGreaterThan(-1);
    const memoEnd = source.indexOf(';', memoIndex);
    const memoBlock = source.slice(memoIndex, memoEnd);
    expect(memoBlock).toContain('authNotifications');
    expect(memoBlock).not.toContain('dashboardData');
  });

  test('fetchDashboard no longer performs an independent notifications/announcements fetch', () => {
    expect(source).not.toContain('notificationsRes');
    expect(source).not.toContain('notificationsOrAnnouncements');
    expect(source).not.toContain('notifItems');
    // getBillingHistory (a genuinely separate, still-needed call) must remain
    // untouched — this proves the fix removed only the notifications leg of
    // the Promise.all, not the whole fetch.
    expect(source).toContain('apiService.getBillingHistory');
  });

  test('setDashboardData no longer carries a notifications field (nothing else should read dashboardData.notifications)', () => {
    const setCallIndex = source.indexOf('setDashboardData({');
    const setCallEnd = source.indexOf(');', setCallIndex);
    const setCallBlock = source.slice(setCallIndex, setCallEnd);
    expect(setCallBlock).not.toContain('notifications:');
    expect(source).not.toContain('dashboardData?.notifications');
    expect(source).not.toContain('dashboardData.notifications');
  });
});
