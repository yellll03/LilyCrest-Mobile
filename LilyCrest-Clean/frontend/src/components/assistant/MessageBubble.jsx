import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import LilyFlowerIcon from './LilyFlowerIcon';
import { tenantMessageDeliveryStatus } from '../../utils/supportConversationPresentation';

export default function MessageBubble({ message, isUser, onOpenAttachment, showDeliveryStatus = false }) {
  const { colors } = useTheme();

  const systemLineColor = colors.border;
  const systemTextColor = colors.textMuted;
  const userBubbleColor = colors.primary;
  const botBubbleColor = colors.surface;
  const botBubbleBorder = colors.border;
  const avatarBg = colors.primary;
  const adminBubbleBg = colors.surface;
  const adminBubbleBorder = colors.border;
  const botTextColor = colors.text;

  // ── System divider (transfer notice, resolved notice) ──
  if (message.sender === 'system') {
    return (
      <View style={styles.systemRow}>
        <View style={[styles.systemLine, { backgroundColor: systemLineColor }]} />
        <Text style={[styles.systemText, { color: systemTextColor }]}>{message.text}</Text>
        <View style={[styles.systemLine, { backgroundColor: systemLineColor }]} />
      </View>
    );
  }

  const isAdmin = message.sender === 'admin';
  const deliveryStatus = showDeliveryStatus ? tenantMessageDeliveryStatus(message) : '';

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowBot]}>
      {/* Left avatar — Lily or Admin */}
      {!isUser && (
        <View style={[styles.avatar, { backgroundColor: avatarBg }, isAdmin && styles.adminAvatar]}>
          {isAdmin
            ? <Text style={styles.adminAvatarText}>A</Text>
            : <LilyFlowerIcon size={22} />
          }
        </View>
      )}

      <View style={[styles.bubble, isUser ? [styles.userBubble, { backgroundColor: userBubbleColor, borderColor: userBubbleColor }] : isAdmin ? [styles.adminBubble, { backgroundColor: adminBubbleBg, borderColor: adminBubbleBorder }] : [styles.botBubble, { backgroundColor: botBubbleColor, borderColor: botBubbleBorder }]]}>
        {isAdmin && <Text style={styles.adminLabel}>LilyCrest Admin</Text>}
        <Text style={[styles.text, { color: isUser ? '#f1f5f9' : botTextColor }]}>{message.text}</Text>
        {message.attachments?.length ? (
          <View style={styles.attachmentsRow}>
            {message.attachments.map((file, idx) => (
              <Pressable
                key={`${message.id}-att-${idx}`}
                style={[styles.attachmentChip, isUser && styles.attachmentChipUser]}
                onPress={() => onOpenAttachment?.(file)}
                disabled={!onOpenAttachment}
                accessibilityRole="button"
                accessibilityLabel={`Open ${file?.name || 'attachment'}`}
              >
                <Text style={[styles.attachmentText, isUser && styles.attachmentTextUser]}>Attachment: {file?.name || file}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Text style={[styles.time, isUser && styles.userTime]}>
          {message.time}{deliveryStatus ? ` · ${deliveryStatus}` : ''}
        </Text>
      </View>

      {/* Right avatar — User */}
      {isUser && (
        <View style={[styles.avatar, styles.userAvatar, { backgroundColor: userBubbleColor }]}>
          <Text style={styles.avatarUserText}>{message.avatar || 'U'}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // ── System message ──
  systemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 14,
    paddingHorizontal: 4,
  },
  systemLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  systemText: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'center',
    flexShrink: 1,
  },

  // ── Bubble layout ──
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 14,
    gap: 10,
  },
  rowUser: {
    alignSelf: 'flex-end',
  },
  rowBot: {
    alignSelf: 'flex-start',
  },

  // ── Avatars ──
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0A1628',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#0A1628', shadowOpacity: 0.25, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6 },
      android: { elevation: 3 },
    }),
  },
  userAvatar: {},
  adminAvatar: {
    backgroundColor: '#FBF7EA',
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
  avatarUserText: {
    color: '#0A1628',
    fontWeight: '700',
    fontSize: 14,
  },
  adminAvatarText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 14,
  },

  // ── Bubbles ──
  bubble: {
    maxWidth: '75%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  botBubble: {
    backgroundColor: '#ffffff',
    borderColor: '#E5E7EB',
    borderBottomLeftRadius: 4,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.04)' },
      ios: { shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 4 },
      android: { elevation: 0 },
    }),
  },
  adminBubble: {
    backgroundColor: '#F1F5F9',
    borderColor: '#2563EB',
    borderBottomLeftRadius: 4,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 4 },
      android: { elevation: 0 },
    }),
  },
  userBubble: {
    borderBottomRightRadius: 4,
    ...Platform.select({
      web: { boxShadow: '0 2px 6px rgba(0,0,0,0.15)' },
      ios: { shadowOpacity: 0.2, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6 },
      android: { elevation: 1 },
    }),
  },

  // ── Text ──
  adminLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B9921F',
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  text: {
    fontSize: 14.5,
    color: '#1e293b',
    lineHeight: 21,
  },
  // note: botTextColor applied inline via colors.text
  userText: {
    color: '#f1f5f9',
  },
  time: {
    marginTop: 5,
    fontSize: 10,
    color: '#6B7280',
    textAlign: 'right',
  },
  userTime: {
    color: 'rgba(203,213,225,0.7)',
  },

  // ── Attachments ──
  attachmentsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  attachmentChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  attachmentChipUser: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  attachmentText: {
    fontSize: 11,
    color: '#4B5563',
    fontWeight: '600',
  },
  attachmentTextUser: {
    color: '#E5E7EB',
  },
});
