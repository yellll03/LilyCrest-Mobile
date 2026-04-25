import { Platform, StyleSheet, Text, View } from 'react-native';
import LilyFlowerIcon from './LilyFlowerIcon';

export default function MessageBubble({ message, isUser }) {
  // ── System divider (transfer notice, resolved notice) ──
  if (message.sender === 'system') {
    return (
      <View style={styles.systemRow}>
        <View style={styles.systemLine} />
        <Text style={styles.systemText}>{message.text}</Text>
        <View style={styles.systemLine} />
      </View>
    );
  }

  const isAdmin = message.sender === 'admin';

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowBot]}>
      {/* Left avatar — Lily or Admin */}
      {!isUser && (
        <View style={[styles.avatar, isAdmin && styles.adminAvatar]}>
          {isAdmin
            ? <Text style={styles.adminAvatarText}>A</Text>
            : <LilyFlowerIcon size={22} glow={false} />
          }
        </View>
      )}

      <View style={[styles.bubble, isUser ? styles.userBubble : isAdmin ? styles.adminBubble : styles.botBubble]}>
        {isAdmin && <Text style={styles.adminLabel}>LilyCrest Admin</Text>}
        <Text style={[styles.text, isUser && styles.userText]}>{message.text}</Text>
        {message.attachments?.length ? (
          <View style={styles.attachmentsRow}>
            {message.attachments.map((file, idx) => (
              <View key={`${message.id}-att-${idx}`} style={[styles.attachmentChip, isUser && styles.attachmentChipUser]}>
                <Text style={[styles.attachmentText, isUser && styles.attachmentTextUser]}>Attachment: {file?.name || file}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <Text style={[styles.time, isUser && styles.userTime]}>{message.time}</Text>
      </View>

      {/* Right avatar — User */}
      {isUser && (
        <View style={[styles.avatar, styles.userAvatar]}>
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
    backgroundColor: '#c9cdd4',
  },
  systemText: {
    fontSize: 11,
    color: '#8a8f99',
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
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#D4682A', shadowOpacity: 0.25, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6 },
      android: { elevation: 3 },
    }),
  },
  userAvatar: {
    backgroundColor: '#1e3a5f',
  },
  adminAvatar: {
    backgroundColor: '#D4682A',
  },
  avatarUserText: {
    color: '#ffffff',
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
    borderRadius: 18,
    borderWidth: 1,
  },
  botBubble: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderBottomLeftRadius: 4,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.04)' },
      ios: { shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  adminBubble: {
    backgroundColor: '#f0f4ff',
    borderColor: '#c7d2fe',
    borderBottomLeftRadius: 4,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  userBubble: {
    backgroundColor: '#1e3a5f',
    borderColor: '#1e3a5f',
    borderBottomRightRadius: 4,
    ...Platform.select({
      web: { boxShadow: '0 2px 6px rgba(30,58,95,0.2)' },
      ios: { shadowColor: '#1e3a5f', shadowOpacity: 0.2, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6 },
      android: { elevation: 3 },
    }),
  },

  // ── Text ──
  adminLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#D4682A',
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  text: {
    fontSize: 14.5,
    color: '#1e293b',
    lineHeight: 21,
  },
  userText: {
    color: '#f1f5f9',
  },
  time: {
    marginTop: 5,
    fontSize: 10,
    color: '#94a3b8',
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
    borderColor: '#e2e8f0',
  },
  attachmentChipUser: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  attachmentText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  attachmentTextUser: {
    color: '#e2e8f0',
  },
});
