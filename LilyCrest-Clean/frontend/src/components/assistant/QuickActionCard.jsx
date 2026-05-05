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
    backgroundColor: '#F4F6FA',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#D8E2F0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ff9000',
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a2744',
  },
  note: {
    fontSize: 12,
    color: '#4a5568',
  },
});
