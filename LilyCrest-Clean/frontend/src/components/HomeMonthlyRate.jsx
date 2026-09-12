import { StyleSheet, Text, View } from 'react-native';
import { formatHomeCurrency, hasHomeCurrencyAmount } from '../utils/homePresentation';

export default function HomeMonthlyRate({ amount, colors }) {
  const available = hasHomeCurrencyAmount(amount);
  return (
    <View style={[styles.row, { borderTopColor: colors.border }, !available && styles.unavailableRow]}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>Monthly Rate</Text>
      <Text style={available
        ? [styles.price, { color: colors.interactive }]
        : [styles.unavailable, { color: colors.textSecondary }]}>
        {available ? formatHomeCurrency(amount) : 'Not available'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 8, rowGap: 4, marginTop: 10, paddingTop: 10, borderTopWidth: 1 },
  unavailableRow: { flexDirection: 'column', alignItems: 'flex-start' },
  label: { fontSize: 12 },
  price: { fontSize: 18, fontWeight: '700', flexShrink: 1, maxWidth: '100%' },
  unavailable: { fontSize: 13, lineHeight: 18, fontWeight: '400', flexShrink: 1, maxWidth: '100%' },
});
