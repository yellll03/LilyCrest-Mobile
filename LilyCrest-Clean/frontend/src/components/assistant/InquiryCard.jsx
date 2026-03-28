import { Pressable, StyleSheet, Text, View } from 'react-native';

const STATUS_COLORS = {
  pending: { bg: '#fff7ed', text: '#c2410c' },
  solved: { bg: '#ecfdf3', text: '#15803d' },
};

export default function InquiryCard({ title, status, timestamp, onPress }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.pending;

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        <View style={[styles.chip, { backgroundColor: colors.bg }]}>
          <Text style={[styles.chipText, { color: colors.text }]}>{status === 'solved' ? 'Solved' : 'Pending'}</Text>
        </View>
      </View>
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
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  time: {
    fontSize: 12,
    color: '#475569',
  },
});
