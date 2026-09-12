import { Text, View } from 'react-native';

export function formatMeterValue(value) {
  if (value === null || value === undefined || value === '') return 'Not available';
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('en-PH', { maximumFractionDigits: 2 })
    : 'Not available';
}

// Uses the Electricity table styles. All allocations and amounts come from
// the API; formatting never changes the stored readings or billing arithmetic.
export default function WaterBreakdown({ breakdown, total, dueDate, styles, currency, date }) {
  const allocations = breakdown.allocations?.length ? breakdown.allocations : [breakdown];
  return <>
    {allocations.map((allocation, index) => {
      const record = allocation.record;
      const measured = record ? allocation.calculationVersion === 'water-meter-v1' : true;
      const start = record?.cycleStart ?? allocation.period_start;
      const end = record?.cycleEnd ?? allocation.period_end;
      const occupants = record?.tenantsSharing ?? allocation.tenants_sharing;
      const opening = measured ? (record?.readingFrom ?? allocation.reading_from) : null;
      const closing = measured ? (record?.readingTo ?? allocation.reading_to) : null;
      const consumption = measured ? (record?.usage ?? allocation.consumption) : null;
      const rate = measured ? (record?.ratePerUnit ?? allocation.rate) : null;
      const share = allocation.tenantAmount ?? record?.myShare ?? allocation.my_share;
      return <View key={index}>
        <View style={styles.breakdownMetaRow}>
          <View style={styles.breakdownMetaItem}><Text style={styles.breakdownMetaLabel}>Meter cycle</Text><Text style={styles.breakdownMetaValue}>{date(start)} – {date(end)}</Text></View>
        </View>
        <View style={styles.elecTable}>
          {occupants != null ? <View style={styles.elecTableHeaderRow}><Text style={styles.elecHeaderLabel}>No. of occupants in the room:</Text><Text style={styles.elecHeaderValue}>{occupants}</Text></View> : null}
          <View style={styles.elecColHeaderRow}><View style={styles.elecColFirst} /><View style={styles.elecColDate}><Text style={styles.elecColHeaderText}>Date</Text></View><View style={styles.elecColKwh}><Text style={styles.elecColHeaderText}>cu.m</Text></View></View>
          {[
            ['Opening reading', start, opening],
            ['Closing reading', allocation.reading_date || end, closing],
            ['Total consumption', null, consumption],
          ].map(([label, readingDate, value]) => <View key={label} style={styles.elecDataRow}>
            <View style={styles.elecColFirst}><Text style={styles.elecRowLabel}>{label}</Text></View>
            <View style={styles.elecColDate}><Text style={styles.elecRowValue}>{readingDate ? date(readingDate) : ''}</Text></View>
            <View style={styles.elecColKwh}><Text style={styles.elecRowValue}>{formatMeterValue(value)}</Text></View>
          </View>)}
          <View style={styles.elecSummaryRow}><Text style={styles.elecSummaryLabel}>Rate per cu.m</Text><Text style={styles.elecSummaryAmount}>{currency(rate)}</Text></View>
          <View style={styles.elecSummaryRow}><Text style={styles.elecSummaryLabel}>Room total</Text><Text style={styles.elecSummaryAmount}>{currency(record?.roomTotal ?? allocation.total)}</Text></View>
          <View style={styles.elecAmountRow}><Text style={styles.elecAmountLabel}>Your allocated share</Text><Text style={styles.elecAmountValue}>{currency(share)}</Text></View>
        </View>
        <Text style={styles.sharingPolicy}>{allocation.billingBasis || allocation.sharing_policy || breakdown.sharing_policy}</Text>
      </View>;
    })}
    <View style={styles.elecSummaryTable}>
      <View style={styles.elecTotalDueRow}><Text style={styles.elecTotalDueLabel}>Total Amount Due</Text><Text style={styles.elecTotalDueValue}>{currency(total)}</Text></View>
      <View style={styles.elecDueDateRow}><Text style={styles.elecDueDateLabel}>Due Date:</Text><Text style={styles.elecDueDateValue}>{date(dueDate)}</Text></View>
    </View>
  </>;
}
