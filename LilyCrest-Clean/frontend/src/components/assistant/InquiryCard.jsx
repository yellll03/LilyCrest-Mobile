import { Pressable, StyleSheet, Text, View } from 'react-native';

const STATUS_COLORS = {
  pending: { bg: '#fff7ed', text: '#c2410c' },
  solved:  { bg: '#ecfdf3', text: '#15803d' },
};

export default function InquiryCard({ title, preview, status, timestamp, onPress }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.pending;

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <View style={[styles.chip, { backgroundColor: colors.bg }]}>
          <Text style={[styles.chipText, { color: colors.text }]}>
            {status === 'solved' ? 'Solved' : 'Pending'}
          </Text>
        </View>
      </View>
      {preview ? (
        <Text style={styles.preview} numberOfLines={2}>{preview}</Text>
      ) : null}
      <Text style={styles.time}>{timestamp}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    color: '#0f172a',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    flexShrink: 0,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  preview: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
  },
  time: {
    fontSize: 11,
    color: '#94a3b8',
  },
});
