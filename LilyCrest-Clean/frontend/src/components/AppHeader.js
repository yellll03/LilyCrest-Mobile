import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme, useThemedStyles } from '../context/ThemeContext';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_MAX_HEIGHT = Math.round(SCREEN_HEIGHT * 0.70);
const ANNOUNCEMENTS_LAST_SEEN_KEY = 'lilycrest_announcements_last_seen';

function getTimestamp(notification = {}) {
  return notification?.created_at
    || notification?.createdAt
    || notification?.publishedAt
    || notification?.sentAt
    || notification?.updated_at
    || notification?.updatedAt
    || null;
}

function formatRelativeTimestamp(value) {
  if (!value) return '';
  try {
    const diff = Date.now() - new Date(value).getTime();
    if (diff < 0 || Number.isNaN(diff)) return '';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (_error) {
    return '';
  }
}

function isNotificationUnread(notification = {}, lastSeenAt) {
  if (typeof notification?.read === 'boolean') return !notification.read;
  if (typeof notification?.is_read === 'boolean') return !notification.is_read;
  if (typeof notification?.unread === 'boolean') return notification.unread;
  const timestamp = getTimestamp(notification);
  if (!timestamp || !lastSeenAt) return false;
  const createdAt = new Date(timestamp);
  return !Number.isNaN(createdAt.getTime()) && createdAt > lastSeenAt;
}

function getCategoryMeta(notification = {}) {
  const cat = (notification?.category || '').toLowerCase();
  const title = (notification?.title || '').toLowerCase();
  const body = (notification?.body || notification?.content || '').toLowerCase();
  const text = `${cat} ${title} ${body}`;

  if (cat === 'billing' || text.includes('billing') || text.includes('payment') || text.includes('invoice')) {
    return { bg: '#DBEAFE', color: '#2563EB', icon: 'card-outline' };
  }
  if (cat === 'maintenance' || text.includes('maintenance') || text.includes('repair')) {
    return { bg: '#FEF3C7', color: '#D97706', icon: 'construct-outline' };
  }
  if (cat === 'reservation' || text.includes('reservation') || text.includes('amenity')) {
    return { bg: '#DCFCE7', color: '#16A34A', icon: 'calendar-outline' };
  }
  if (cat === 'assistant' || text.includes('lily assistant') || text.includes('chatbot')) {
    return { bg: '#F3E8FF', color: '#9333EA', icon: 'chatbubble-ellipses-outline' };
  }
  if (cat === 'security' || text.includes('password') || text.includes('security')) {
    return { bg: '#FEE2E2', color: '#DC2626', icon: 'shield-checkmark-outline' };
  }
  if (cat === 'announcement' || text.includes('announcement') || text.includes('notice')) {
    return { bg: '#EEF2FF', color: '#4F46E5', icon: 'megaphone-outline' };
  }
  if (text.includes('reminder') || text.includes('due') || text.includes('overdue')) {
    return { bg: '#FEE2E2', color: '#DC2626', icon: 'alarm-outline' };
  }
  return { bg: '#EEF2FF', color: '#4F46E5', icon: 'megaphone-outline' };
}

export default function AppHeader({ recentNotifications = [] }) {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const { notificationUnreadCount, hasUnreadNotifications, clearNotificationUnread } = useAuth();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [lastSeenAt, setLastSeenAt] = useState(null);

  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const badgeLabel = notificationUnreadCount > 9 ? '9+' : String(notificationUnreadCount);

  const previewNotifications = useMemo(() => {
    if (!Array.isArray(recentNotifications)) return [];
    return [...recentNotifications]
      .sort((a, b) => {
        const aTime = getTimestamp(a) ? new Date(getTimestamp(a)).getTime() : 0;
        const bTime = getTimestamp(b) ? new Date(getTimestamp(b)).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 8);
  }, [recentNotifications]);

  const unreadCount = useMemo(
    () => previewNotifications.filter(n => isNotificationUnread(n, lastSeenAt)).length,
    [previewNotifications, lastSeenAt]
  );

  const loadLastSeen = useCallback(async () => {
    try {
      const value = await AsyncStorage.getItem(ANNOUNCEMENTS_LAST_SEEN_KEY);
      setLastSeenAt(value ? new Date(value) : null);
    } catch (_error) {
      setLastSeenAt(null);
    }
  }, []);

  useEffect(() => {
    loadLastSeen();
  }, [loadLastSeen]);

  const openSheet = useCallback(async () => {
    await loadLastSeen();
    setIsModalVisible(true);
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        damping: 26,
        stiffness: 200,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [loadLastSeen, translateY, backdropOpacity]);

  const closeSheet = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 260,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setIsModalVisible(false));
  }, [translateY, backdropOpacity]);

  const handleMarkAllRead = useCallback(() => {
    if (clearNotificationUnread) clearNotificationUnread();
    closeSheet();
  }, [clearNotificationUnread, closeSheet]);

  const viewAllNotifications = useCallback(() => {
    closeSheet();
    setTimeout(() => router.push('/(tabs)/announcements'), 270);
  }, [closeSheet, router]);

  const styles = useThemedStyles((c, dark) =>
    StyleSheet.create({
      // ── App header bar (unchanged) ──────────────────────────────────────
      header: {
        backgroundColor: c.headerBg,
        paddingHorizontal: 16,
        paddingBottom: 14,
        paddingTop: Platform.OS === 'ios' ? 56 : (RNStatusBar.currentHeight || 24) + 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderBottomWidth: 3,
        borderBottomColor: '#ff9000',
      },
      spacer: { width: 40 },
      titleContainer: { flex: 1, alignItems: 'center' },
      title: {
        fontSize: 24,
        fontWeight: '800',
        color: '#ffffff',
        textAlign: 'center',
        letterSpacing: 1,
      },
      subtitle: {
        fontSize: 13,
        fontWeight: '500',
        color: 'rgba(255,255,255,0.7)',
        textAlign: 'center',
        marginTop: 2,
        letterSpacing: 0.5,
      },
      iconBtn: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
      },
      badgeDot: {
        position: 'absolute',
        top: 4,
        right: 4,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: '#EF4444',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 3,
        borderWidth: 1.5,
        borderColor: c.headerBg,
      },
      badgeText: {
        fontSize: 9,
        fontWeight: '800',
        color: '#FFFFFF',
      },

      // ── Bottom sheet layout ─────────────────────────────────────────────
      modalContainer: {
        flex: 1,
        justifyContent: 'flex-end',
      },
      backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(10, 18, 36, 0.52)',
      },
      sheet: {
        maxHeight: SHEET_MAX_HEIGHT,
        backgroundColor: c.surface,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        overflow: 'hidden',
        ...Platform.select({
          default: {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -6 },
            shadowOpacity: 0.14,
            shadowRadius: 20,
            elevation: 18,
          },
        }),
      },

      // ── Drag handle ─────────────────────────────────────────────────────
      dragHandle: {
        alignItems: 'center',
        paddingTop: 10,
        paddingBottom: 2,
      },
      dragHandlePill: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)',
      },

      // ── Sheet header ────────────────────────────────────────────────────
      sheetHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 6,
        paddingBottom: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
        gap: 8,
      },
      sheetTitleRow: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
      },
      sheetTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: c.text,
        letterSpacing: 0.1,
      },
      unreadBadge: {
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#EF4444',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
      },
      unreadBadgeText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#FFFFFF',
      },
      headerSeparator: {
        width: 1,
        height: 12,
        backgroundColor: c.border,
      },
      headerAction: {
        fontSize: 12,
        fontWeight: '500',
        color: c.primary || '#204b7e',
      },
      headerActionBold: {
        fontSize: 12,
        fontWeight: '600',
        color: c.primary || '#204b7e',
      },
      closeBtn: {
        width: 24,
        height: 24,
        borderRadius: 6,
        backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        justifyContent: 'center',
        alignItems: 'center',
      },
      closeBtnIcon: {
        color: dark ? '#94A3B8' : '#64748B',
      },

      // ── Notification items ──────────────────────────────────────────────
      scrollContent: {
        paddingVertical: 2,
      },
      notificationItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 10,
        paddingHorizontal: 16,
        gap: 10,
      },
      notificationItemUnread: {
        backgroundColor: dark ? 'rgba(59,130,246,0.07)' : 'rgba(59,130,246,0.04)',
        borderLeftWidth: 2.5,
        borderLeftColor: '#3B82F6',
        paddingLeft: 13,
      },
      categoryIconWrap: {
        width: 34,
        height: 34,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
        marginTop: 1,
      },
      iconUnreadDot: {
        position: 'absolute',
        top: -2,
        right: -2,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#3B82F6',
        borderWidth: 1.5,
        borderColor: c.surface,
      },
      itemBody: {
        flex: 1,
        minWidth: 0,
      },
      itemTopRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 6,
        marginBottom: 3,
      },
      itemTitle: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: c.text,
        lineHeight: 17,
      },
      itemTitleUnread: {
        fontWeight: '700',
      },
      itemTime: {
        fontSize: 11,
        color: c.textMuted,
        fontWeight: '400',
        flexShrink: 0,
        lineHeight: 17,
      },
      itemPreview: {
        fontSize: 12,
        color: c.textSecondary || c.textMuted,
        lineHeight: 17,
        fontWeight: '400',
      },
      itemDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: c.border,
        marginLeft: 61,
      },

      // ── Empty state ─────────────────────────────────────────────────────
      emptyState: {
        paddingVertical: 36,
        alignItems: 'center',
        gap: 6,
      },
      emptyIconWrap: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: dark ? 'rgba(255,255,255,0.06)' : '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 4,
      },
      emptyTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: c.text,
      },
      emptySubtext: {
        fontSize: 12,
        color: c.textMuted,
        textAlign: 'center',
        paddingHorizontal: 28,
      },

      safeAreaPad: {
        height: Platform.OS === 'ios' ? 20 : 6,
      },
    })
  );

  return (
    <>
      <View style={styles.header}>
        <View style={styles.spacer} />
        <View style={styles.titleContainer}>
          <Text style={styles.title}>LilyCrest</Text>
          <Text style={styles.subtitle}>Tenant Portal</Text>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={openSheet}
          accessibilityRole="button"
          accessibilityLabel="Open notifications"
          activeOpacity={0.8}
        >
          <Ionicons name="notifications-outline" size={20} color="#ffffff" />
          {hasUnreadNotifications ? (
            <View style={styles.badgeDot}>
              {notificationUnreadCount > 0 ? <Text style={styles.badgeText}>{badgeLabel}</Text> : null}
            </View>
          ) : null}
        </TouchableOpacity>
      </View>

      <Modal
        visible={isModalVisible}
        transparent
        animationType="none"
        onRequestClose={closeSheet}
        statusBarTranslucent
      >
        <View style={styles.modalContainer}>
          {/* Dimmed backdrop */}
          <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
            <Pressable style={StyleSheet.absoluteFillObject} onPress={closeSheet} />
          </Animated.View>

          {/* Bottom sheet panel */}
          <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
            {/* Drag handle */}
            <View style={styles.dragHandle}>
              <View style={styles.dragHandlePill} />
            </View>

            {/* Sticky header */}
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleRow}>
                <Text style={styles.sheetTitle}>Notifications</Text>
                {unreadCount > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                  </View>
                )}
              </View>
              {unreadCount > 0 && (
                <>
                  <TouchableOpacity
                    onPress={handleMarkAllRead}
                    hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                  >
                    <Text style={styles.headerAction}>Mark read</Text>
                  </TouchableOpacity>
                  <View style={styles.headerSeparator} />
                </>
              )}
              <TouchableOpacity
                onPress={viewAllNotifications}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              >
                <Text style={styles.headerActionBold}>View all</Text>
              </TouchableOpacity>
              <View style={styles.headerSeparator} />
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={closeSheet}
                accessibilityRole="button"
                accessibilityLabel="Close notifications"
              >
                <Ionicons name="close" size={15} color={styles.closeBtnIcon.color} />
              </TouchableOpacity>
            </View>

            {/* Scrollable notification list */}
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
              overScrollMode="never"
            >
              {previewNotifications.length > 0 ? (
                previewNotifications.map((notification, index) => {
                  const unread = isNotificationUnread(notification, lastSeenAt);
                  const timestamp = getTimestamp(notification);
                  const { bg, color, icon } = getCategoryMeta(notification);
                  const isLast = index === previewNotifications.length - 1;

                  return (
                    <View
                      key={`${notification?.announcement_id || notification?.id || notification?.title || 'n'}-${index}`}
                    >
                      <TouchableOpacity
                        style={[styles.notificationItem, unread && styles.notificationItemUnread]}
                        onPress={viewAllNotifications}
                        activeOpacity={0.7}
                      >
                        {/* Category icon with optional unread dot overlay */}
                        <View style={[styles.categoryIconWrap, { backgroundColor: bg }]}>
                          <Ionicons name={icon} size={17} color={color} />
                          {unread && <View style={styles.iconUnreadDot} />}
                        </View>

                        {/* Content */}
                        <View style={styles.itemBody}>
                          <View style={styles.itemTopRow}>
                            <Text
                              style={[styles.itemTitle, unread && styles.itemTitleUnread]}
                              numberOfLines={1}
                            >
                              {notification?.title || 'Notification'}
                            </Text>
                            {timestamp ? (
                              <Text style={styles.itemTime}>
                                {formatRelativeTimestamp(timestamp)}
                              </Text>
                            ) : null}
                          </View>
                          <Text style={styles.itemPreview} numberOfLines={2}>
                            {notification?.body || notification?.content || notification?.description || 'Tap to view details.'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                      {!isLast && <View style={styles.itemDivider} />}
                    </View>
                  );
                })
              ) : (
                <View style={styles.emptyState}>
                  <View style={styles.emptyIconWrap}>
                    <Ionicons
                      name="notifications-off-outline"
                      size={22}
                      color={isDarkMode ? '#94A3B8' : '#94A3B8'}
                    />
                  </View>
                  <Text style={styles.emptyTitle}>All caught up</Text>
                  <Text style={styles.emptySubtext}>No new notifications at this time.</Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.safeAreaPad} />
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}
