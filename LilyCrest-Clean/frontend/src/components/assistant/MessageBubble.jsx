import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import LilyFlowerIcon from './LilyFlowerIcon';
import { tenantMessageDeliveryStatus } from '../../utils/supportConversationPresentation';
import { MOBILE_API_BASE_URL } from '../../config/api';
import { getSessionToken } from '../../services/secureCredentials';

const formatFileSize = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function AttachmentCard({ file, isUser, onOpen }) {
  const { colors } = useTheme();
  const [sessionToken, setSessionToken] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const mimeType = String(file?.mimeType || file?.type || '').toLowerCase();
  const isImage = mimeType.startsWith('image/');
  const fileName = file?.name || file?.fileName || 'Attachment';
  const fileUrl = String(file?.url || file?.fileUrl || '');
  const protectedImageSource = isImage && sessionToken && fileUrl.startsWith('/chat/')
    ? {
        uri: `${MOBILE_API_BASE_URL}${fileUrl}`,
        headers: { Authorization: `Bearer ${sessionToken}` },
      }
    : null;

  useEffect(() => {
    if (!isImage) return undefined;
    let mounted = true;
    getSessionToken().then((token) => {
      if (mounted) setSessionToken(token || '');
    }).catch(() => {});
    return () => { mounted = false; };
  }, [isImage]);

  return (
    <Pressable
      style={[
        styles.attachmentCard,
        { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
        isUser && styles.attachmentCardUser,
      ]}
      onPress={() => {
        if (protectedImageSource) setPreviewOpen(true);
        else onOpen?.(file);
      }}
      disabled={!onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Open ${fileName}`}
    >
      {protectedImageSource ? (
        <Image
          style={[styles.attachmentThumbnail, { backgroundColor: colors.border }]}
          source={protectedImageSource}
          contentFit="cover"
          transition={120}
        />
      ) : (
        <View style={[styles.documentIcon, { backgroundColor: colors.border }, isUser && styles.documentIconUser]}>
          <Ionicons name={isImage ? 'image-outline' : 'document-text-outline'} size={22} color={isUser ? colors.onPrimary : colors.iconPrimary} />
        </View>
      )}
      <View style={styles.attachmentCopy}>
        <Text style={[styles.attachmentName, { color: colors.text }, isUser && styles.attachmentTextUser]} numberOfLines={2}>{fileName}</Text>
        <Text style={[styles.attachmentMeta, { color: colors.textSecondary }, isUser && styles.attachmentMetaUser]}>
          {isImage ? 'Image' : mimeType === 'application/pdf' ? 'PDF' : 'Document'}
          {formatFileSize(file?.size) ? ` · ${formatFileSize(file.size)}` : ''}
          {' · Open'}
        </Text>
      </View>
      {protectedImageSource ? (
        <Modal visible={previewOpen} transparent statusBarTranslucent animationType="fade" onRequestClose={() => setPreviewOpen(false)}>
          <View style={styles.previewBackdrop}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle} numberOfLines={1}>{fileName}</Text>
              <Pressable onPress={() => setPreviewOpen(false)} accessibilityRole="button" accessibilityLabel="Close image preview">
                <Ionicons name="close" size={28} color="#FFFFFF" />
              </Pressable>
            </View>
            <Image style={styles.previewImage} source={protectedImageSource} contentFit="contain" />
            <Pressable style={styles.previewOpenButton} onPress={() => onOpen?.(file)} accessibilityRole="button">
              <Ionicons name="open-outline" size={17} color={colors.onAccent} />
              <Text style={[styles.previewOpenText, { color: colors.onAccent }]}>Open or Share</Text>
            </Pressable>
          </View>
        </Modal>
      ) : null}
    </Pressable>
  );
}

export default function MessageBubble({ message, isUser, onOpenAttachment, showDeliveryStatus = false, highlighted = false }) {
  const { colors } = useTheme();

  const systemLineColor = colors.border;
  const systemTextColor = colors.textMuted;
  const userBubbleColor = colors.primary;
  const botBubbleColor = colors.surface;
  const botBubbleBorder = colors.border;
  const avatarBg = colors.primary;
  const adminBubbleBg = colors.surfaceSecondary;
  const adminBubbleBorder = colors.info;
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
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowBot, highlighted && styles.highlighted]}>
      {/* Left avatar — Lily or Admin */}
      {!isUser && (
        <View style={[styles.avatar, { backgroundColor: avatarBg }, isAdmin && { backgroundColor: colors.accentSubtle, borderColor: colors.accent }]}>
          {isAdmin
            ? message.avatarUri
              ? <Image source={{ uri: message.avatarUri }} style={styles.avatarImage} contentFit="cover" />
              : <Text style={[styles.adminAvatarText, { color: colors.onAccent }]}>A</Text>
            : <LilyFlowerIcon size={22} />
          }
        </View>
      )}

      <View style={[styles.bubble, isUser ? [styles.userBubble, { backgroundColor: userBubbleColor, borderColor: userBubbleColor }] : isAdmin ? [styles.adminBubble, { backgroundColor: adminBubbleBg, borderColor: adminBubbleBorder }] : [styles.botBubble, { backgroundColor: botBubbleColor, borderColor: botBubbleBorder }]]}>
        {isAdmin && <Text style={[styles.adminLabel, { color: colors.interactive }]}>LilyCrest Admin</Text>}
        {message.text ? <Text style={[styles.text, { color: isUser ? colors.onPrimary : botTextColor }]}>{message.text}</Text> : null}
        {message.attachments?.length ? (
          <View style={styles.attachmentsRow}>
            {message.attachments.map((file, idx) => (
              <AttachmentCard
                key={`${message.id}-att-${idx}`}
                file={file}
                isUser={isUser}
                onOpen={onOpenAttachment}
              />
            ))}
          </View>
        ) : null}
        <Text style={[styles.time, { color: colors.textMuted }, isUser && styles.userTime]}>
          {message.time}{deliveryStatus ? ` · ${deliveryStatus}` : ''}
        </Text>
      </View>

      {/* Right avatar — User */}
      {isUser && (
        <View style={[styles.avatar, styles.userAvatar, { backgroundColor: userBubbleColor }]}>
          {message.avatarUri
            ? <Image source={{ uri: message.avatarUri }} style={styles.avatarImage} contentFit="cover" />
            : <Text style={[styles.avatarUserText, { color: colors.onPrimary }]}>{message.avatar || 'U'}</Text>}
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
  highlighted: {
    borderWidth: 2,
    borderColor: '#D4AF37',
    borderRadius: 14,
    padding: 5,
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
    borderWidth: 1,
  },
  avatarUserText: {
    fontWeight: '700',
    fontSize: 14,
  },
  adminAvatarText: {
    fontWeight: '800',
    fontSize: 14,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
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
    borderBottomLeftRadius: 4,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.04)' },
      ios: { shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 4 },
      android: { elevation: 0 },
    }),
  },
  adminBubble: {
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
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  text: {
    fontSize: 14.5,
    lineHeight: 21,
  },
  // note: botTextColor applied inline via colors.text
  userText: {
    color: '#f1f5f9',
  },
  time: {
    marginTop: 5,
    fontSize: 10,
    textAlign: 'right',
  },
  userTime: {
    color: 'rgba(203,213,225,0.7)',
  },

  // ── Attachments ──
  attachmentsRow: {
    gap: 6,
    marginTop: 8,
  },
  attachmentCard: {
    minWidth: 190,
    maxWidth: 250,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  attachmentCardUser: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  attachmentThumbnail: {
    width: 64,
    height: 48,
    borderRadius: 6,
  },
  documentIcon: {
    width: 42,
    height: 42,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentIconUser: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  attachmentCopy: {
    flex: 1,
    minWidth: 0,
  },
  attachmentName: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  attachmentMeta: {
    marginTop: 3,
    fontSize: 10,
  },
  attachmentTextUser: {
    color: '#E5E7EB',
  },
  attachmentMetaUser: {
    color: 'rgba(248,250,252,0.72)',
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.96)',
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  previewTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  previewImage: {
    flex: 1,
    width: '100%',
  },
  previewOpenButton: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 16,
    borderRadius: 8,
    backgroundColor: '#D4AF37',
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  previewOpenText: {
    fontSize: 13,
    fontWeight: '800',
  },
});
