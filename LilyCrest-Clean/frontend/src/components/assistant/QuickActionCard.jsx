import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function QuickActionCard({ label, note, onPress }) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.iconDot} />
      <View style={styles.textCol}>
        <Text style={styles.label}>{label}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '48%',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#D4682A',
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  note: {
    fontSize: 12,
    color: '#475569',
  },
});
