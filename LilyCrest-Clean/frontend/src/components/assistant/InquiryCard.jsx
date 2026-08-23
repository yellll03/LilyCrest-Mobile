import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { semanticStatusPalette, statusTone } from '../../theme/tokens';
import { supportStatusLabel } from '../../utils/supportConversationPresentation';

export default function InquiryCard({ title, ticketId, preview, status, canonicalStatus, timestamp, onPress }) {
  const { colors } = useTheme();
  const actualStatus = canonicalStatus || (status === 'solved' ? 'resolved' : 'open');
  const tone = semanticStatusPalette(colors, statusTone(actualStatus));

  return (
    <Pressable style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={onPress}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.heading }]} numberOfLines={1}>{title}</Text>
        <View style={[styles.chip, { backgroundColor: tone.background, borderColor: tone.solid }]}>
          <Text style={[styles.chipText, { color: tone.text }]}>
            {supportStatusLabel(actualStatus)}
          </Text>
        </View>
      </View>
      {ticketId ? <Text style={[styles.ticketId, { color: colors.textSecondary }]}>{ticketId}</Text> : null}
      {preview ? (
        <Text style={[styles.preview, { color: colors.textSecondary }]} numberOfLines={2}>{preview}</Text>
      ) : null}
      <Text style={[styles.time, { color: colors.textMuted }]}>{timestamp}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
    gap: 5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    flexShrink: 0,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  preview: {
    fontSize: 13,
    lineHeight: 18,
  },
  ticketId: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  time: {
    fontSize: 11,
  },
});
