/* global __dirname */
const fs = require('fs');
const path = require('path');

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

describe('News announcements remain isolated from Home notifications', () => {
  const service = read('../services/api.js');
  const announcementsScreen = read('../../app/(tabs)/announcements.jsx');
  const tabLayout = read('../../app/(tabs)/_layout.jsx');
  const authContext = read('../context/AuthContext.js');

  it('maps dedicated announcement reads and dismissals to the canonical routes', () => {
    expect(service).toContain("getAnnouncements: () => api.get('/announcements')");
    expect(service).toContain("api.post(`/announcements/${encodeURIComponent(announcementId)}/dismiss`)");
    expect(service).toContain("api.delete(`/announcements/${encodeURIComponent(announcementId)}/dismiss`)");
    expect(service).toContain("api.post('/announcements/dismiss-bulk', { ids: announcementIds })");
  });

  it('uses swipe-to-archive with an Undo snackbar instead of a permanent card trash action', () => {
    expect(announcementsScreen).toContain("react-native-gesture-handler/Swipeable");
    expect(announcementsScreen).toContain('Announcement removed');
    expect(announcementsScreen).toContain('Undo');
    expect(announcementsScreen).not.toContain('trash-outline');
  });

  it('keeps the tenant toolbar separated from the header with readable touch targets', () => {
    const toolbarStart = announcementsScreen.indexOf('toolbarRow: {');
    const toolbarEnd = announcementsScreen.indexOf('toolbarButtonActive:', toolbarStart);
    const toolbarStyles = announcementsScreen.slice(toolbarStart, toolbarEnd);

    expect(toolbarStyles).toContain('paddingTop: 12');
    expect(toolbarStyles).toContain('paddingBottom: 12');
    expect(toolbarStyles).toContain('minHeight: 42');
    expect(toolbarStyles).toContain('paddingHorizontal: 12');
  });

  it('does not read or mutate Home notification state from the News screen', () => {
    expect(announcementsScreen).toContain('useCanonicalAnnouncements()');
    expect(announcementsScreen).not.toContain('useAuth()');
    expect(announcementsScreen).not.toContain('refreshNotifications');
    expect(announcementsScreen).not.toContain('clearNotificationUnread');
    expect(announcementsScreen).not.toContain('dismissNotification');
  });

  it('does not present the Home unread count as a News-tab badge', () => {
    expect(tabLayout).not.toContain('notificationUnreadCount');
  });

  it('keeps Home clear/dismiss actions on notification-only routes', () => {
    expect(authContext).toContain("api.delete(`/notifications/${encodeURIComponent(notificationId)}`)");
    expect(authContext).toContain("api.delete('/notifications')");
    expect(authContext).not.toContain('dismissAnnouncement');
  });
});
