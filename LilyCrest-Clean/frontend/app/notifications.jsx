import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '../src/components/ui/LilycrestUI';
import { useAlert } from '../src/context/AlertContext';
import { useAuth } from '../src/context/AuthContext';
import { useTheme, useThemedStyles } from '../src/context/ThemeContext';
import { resolveNotificationRoute } from '../src/services/notifications';
import { sortNotifications } from '../src/utils/notificationFilters';
import {
  buildNotificationRouteData,
  formatRelativeNotificationTimestamp,
  getNotificationCategoryPresentation,
  getNotificationTimestamp,
  isNotificationUnread,
} from '../src/utils/notificationPresentation';
import { safeBack } from '../src/utils/navigation';

export default function NotificationsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { showAlert } = useAlert();
  const {
    notifications,
    notificationUnreadCount,
    refreshNotifications,
    markNotificationRead,
    clearNotificationUnread,
    dismissNotification,
    clearNotifications,
  } = useAuth();
  const [filter, setFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const notificationItems = useMemo(
    () => (Array.isArray(notifications) ? notifications : []),
    [notifications],
  );

  const loadNotifications = useCallback(async () => {
    setRefreshing(true);
    const loaded = await refreshNotifications();
    setLoadError(!loaded);
    setHasLoadedOnce(true);
    setRefreshing(false);
  }, [refreshNotifications]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const feedItems = useMemo(() => {
    const allItems = sortNotifications(notificationItems, 'newest');
    return filter === 'unread' ? allItems.filter(isNotificationUnread) : allItems;
  }, [filter, notificationItems]);

  const handleNotificationPress = useCallback(async (notification) => {
    if (notification?.notification_id) {
      await markNotificationRead(notification.notification_id);
    }
    const destination = resolveNotificationRoute(
      buildNotificationRouteData(notification),
      { reportUnsupported: true },
    );
    if (destination === '/notifications') {
      await showAlert({
        title: notification?.title || 'Notification',
        message: notification?.body || notification?.content || 'This update has no additional destination.',
        type: 'info',
        buttons: [{ text: 'OK' }],
      });
      return;
    }
    if (destination) router.push(destination);
  }, [markNotificationRead, router, showAlert]);

  const handleClear = useCallback(async () => {
    const decision = await showAlert({
      title: 'Clear notifications?',
      message: 'This removes the notifications currently in your list. New notifications will still appear.',
      type: 'warning',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive' },
      ],
    });
    if (decision === 'Clear') await clearNotifications();
  }, [clearNotifications, showAlert]);

  const renderNotification = useCallback(({ item }) => {
    const unread = isNotificationUnread(item);
    const timestamp = getNotificationTimestamp(item);
    const category = getNotificationCategoryPresentation(item, colors);
    const destination = resolveNotificationRoute(buildNotificationRouteData(item));
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Notification: ${item?.title || 'Notification'}`}
        accessibilityHint={destination ? 'Opens the related LilyCrest screen' : 'Marks this notification as read'}
        activeOpacity={0.75}
        onPress={() => handleNotificationPress(item)}
        style={[styles.card, unread && styles.cardUnread]}
      >
        <View style={[styles.iconWrap, { backgroundColor: category.background }]}>
          <Ionicons name={category.icon} size={21} color={category.foreground} />
          {unread ? <View style={styles.unreadDot} /> : null}
        </View>
        <View style={styles.cardBody}>
          <View style={styles.cardTopRow}>
            <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={2}>
              {item?.title || 'Notification'}
            </Text>
            {timestamp ? (
              <Text style={styles.timestamp}>{formatRelativeNotificationTimestamp(timestamp)}</Text>
            ) : null}
          </View>
          <Text style={styles.category}>{category.label}</Text>
          <Text style={styles.body} numberOfLines={3}>
            {item?.body || item?.content || item?.description || 'Tap to view this update.'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          hitSlop={8}
          onPress={(event) => {
            event?.stopPropagation?.();
            if (item?.notification_id) dismissNotification(item.notification_id);
          }}
          style={styles.dismissButton}
        >
          <Ionicons name="close-circle-outline" size={21} color={colors.textMuted} />
        </Pressable>
      </TouchableOpacity>
    );
  }, [colors, dismissNotification, handleNotificationPress, styles]);

  const isInitialLoading = !hasLoadedOnce && refreshing && notificationItems.length === 0;
  const emptyUnread = filter === 'unread' && notificationItems.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        strong
        title="Notifications"
        subtitle="Billing, contracts, maintenance, News, and account updates"
        onBack={() => safeBack(router, '/(tabs)/home')}
      />

      <View style={styles.toolbar}>
        <View style={styles.filters}>
          {['all', 'unread'].map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={value === 'all' ? 'Show all notifications' : 'Show unread notifications'}
              onPress={() => setFilter(value)}
              style={[styles.filterChip, filter === value && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>
                {value === 'all' ? `All (${notificationItems.length})` : `Unread (${notificationUnreadCount})`}
              </Text>
            </Pressable>
          ))}
        </View>
        {notificationUnreadCount > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Mark all notifications read" onPress={clearNotificationUnread}>
            <Text style={styles.toolbarAction}>Mark all read</Text>
          </Pressable>
        ) : null}
        {notificationItems.length > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear notifications" onPress={handleClear}>
            <Text style={styles.clearAction}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {loadError ? (
        <View style={styles.errorBanner}>
          <Ionicons name="cloud-offline-outline" size={18} color={colors.error} />
          <Text style={styles.errorText}>Unable to refresh notifications. Your last loaded list is still shown.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Retry loading notifications" onPress={loadNotifications}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {isInitialLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Loading notifications…</Text>
        </View>
      ) : (
        <FlatList
          data={feedItems}
          keyExtractor={(item, index) => String(item?.notification_id || item?.id || `notification-${index}`)}
          renderItem={renderNotification}
          contentContainerStyle={[styles.listContent, feedItems.length === 0 && styles.emptyListContent]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadNotifications} tintColor={colors.accent} colors={[colors.accent]} />}
          ListEmptyComponent={(
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name={emptyUnread ? 'checkmark-done-outline' : 'notifications-off-outline'} size={30} color={colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>{emptyUnread ? 'No unread notifications' : 'All caught up'}</Text>
              <Text style={styles.emptyText}>
                {emptyUnread ? 'Everything in your notification list has been read.' : 'Your LilyCrest updates will appear here.'}
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  toolbar: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    backgroundColor: c.surface,
  },
  filters: { flex: 1, flexDirection: 'row', gap: 8 },
  filterChip: { minHeight: 38, justifyContent: 'center', borderRadius: 19, paddingHorizontal: 13, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border },
  filterChipActive: { backgroundColor: c.accentSubtle, borderColor: c.accent },
  filterText: { color: c.textSecondary, fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: c.heading },
  toolbarAction: { color: c.interactive, fontSize: 12, fontWeight: '700' },
  clearAction: { color: c.errorText, fontSize: 12, fontWeight: '700' },
  errorBanner: { marginHorizontal: 16, marginTop: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, borderColor: c.error, backgroundColor: c.errorBg },
  errorText: { flex: 1, color: c.errorText, fontSize: 12, lineHeight: 17 },
  retryText: { color: c.errorText, fontSize: 12, fontWeight: '800' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: c.textSecondary, fontSize: 14 },
  listContent: { padding: 16, gap: 10, paddingBottom: 32 },
  emptyListContent: { flexGrow: 1, justifyContent: 'center' },
  card: { minHeight: 104, flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  cardUnread: { borderColor: c.accent, backgroundColor: c.accentSubtle },
  iconWrap: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  unreadDot: { position: 'absolute', right: -2, top: -2, width: 9, height: 9, borderRadius: 5, backgroundColor: c.error, borderWidth: 2, borderColor: c.surface },
  cardBody: { flex: 1 },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { flex: 1, color: c.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  titleUnread: { color: c.heading, fontWeight: '800' },
  timestamp: { color: c.textMuted, fontSize: 11, marginTop: 2 },
  category: { color: c.interactive, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 3 },
  body: { color: c.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 5 },
  dismissButton: { minWidth: 36, minHeight: 36, alignItems: 'flex-end', justifyContent: 'flex-start' },
  emptyState: { alignItems: 'center', paddingHorizontal: 36, paddingVertical: 56 },
  emptyIcon: { width: 68, height: 68, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceSecondary, marginBottom: 14 },
  emptyTitle: { color: c.heading, fontSize: 17, fontWeight: '800', marginBottom: 6 },
  emptyText: { color: c.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
