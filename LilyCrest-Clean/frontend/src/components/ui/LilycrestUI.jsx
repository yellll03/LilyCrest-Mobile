import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { RADII, SPACING, STATUS, statusTone } from '../../theme/tokens';

export function ScreenHeader({ title, subtitle, onBack, action, strong = false }) {
  const { colors } = useTheme();
  const backgroundColor = strong ? colors.headerBg : colors.surface;
  const foreground = strong ? '#FFFFFF' : colors.heading;
  return (
    <View style={[styles.header, { backgroundColor, borderBottomColor: strong ? colors.accent : colors.border }]}>
      {onBack ? (
        <Pressable style={styles.headerAction} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={foreground} />
        </Pressable>
      ) : <View style={styles.headerAction} />}
      <View style={styles.headerCopy}>
        <Text style={[styles.headerTitle, { color: foreground }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[styles.headerSubtitle, { color: strong ? '#D0D7E2' : colors.textSecondary }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      <View style={styles.headerAction}>{action || null}</View>
    </View>
  );
}

export function SurfaceCard({ children, style, accessibilityLabel }) {
  const { colors } = useTheme();
  return <View accessibilityLabel={accessibilityLabel} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>{children}</View>;
}

export function SectionHeader({ icon, title, trailing }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      {icon ? <Ionicons name={icon} size={19} color={colors.accentHover} /> : null}
      <Text style={[styles.sectionTitle, { color: colors.heading }]}>{title}</Text>
      {trailing ? <View style={styles.sectionTrailing}>{trailing}</View> : null}
    </View>
  );
}

export function StatusBadge({ status, label = status, tone }) {
  const resolvedTone = tone || statusTone(status);
  const palette = STATUS[resolvedTone] || STATUS.neutral;
  return (
    <View style={[styles.statusBadge, { backgroundColor: palette.background, borderColor: palette.solid }]}>
      <Text style={[styles.statusText, { color: palette.text }]}>{label}</Text>
    </View>
  );
}

export function DataRow({ label, value, emphasized = false, last = false }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.dataRow, !last && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <Text style={[styles.dataLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.dataValue, { color: emphasized ? colors.heading : colors.text }, emphasized && styles.dataValueEmphasized]}>{value || 'Not available'}</Text>
    </View>
  );
}

export function EmptyState({ icon = 'document-outline', title, description, action }) {
  const { colors } = useTheme();
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceSecondary }]}>
        <Ionicons name={icon} size={28} color={colors.textMuted} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.heading }]}>{title}</Text>
      {description ? <Text style={[styles.emptyDescription, { color: colors.textSecondary }]}>{description}</Text> : null}
      {action || null}
    </View>
  );
}

export function ActionButton({ label, onPress, icon, variant = 'primary', disabled = false, style }) {
  const { colors } = useTheme();
  const variants = {
    primary: { background: colors.primary, border: colors.primary, text: '#FFFFFF' },
    gold: { background: colors.accent, border: colors.accent, text: '#0A1628' },
    positive: { background: colors.success, border: colors.success, text: '#FFFFFF' },
    secondary: { background: colors.surface, border: colors.border, text: colors.heading },
    destructive: { background: colors.errorBg, border: colors.error, text: colors.errorText },
  };
  const palette = variants[variant] || variants.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { backgroundColor: palette.background, borderColor: palette.border }, disabled && styles.disabled, style]}
    >
      {icon ? <Ionicons name={icon} size={18} color={palette.text} /> : null}
      <Text style={[styles.buttonText, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

export function DocumentActionCard({ title, subtitle, status, children }) {
  const { colors } = useTheme();
  return (
    <SurfaceCard accessibilityLabel={title}>
      <SectionHeader icon="document-text-outline" title={title} trailing={status ? <StatusBadge status={status} label={status} /> : null} />
      {subtitle ? <Text style={[styles.documentSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
      {children}
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1 },
  headerAction: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, paddingHorizontal: SPACING.xs },
  headerTitle: { fontSize: 19, lineHeight: 25, fontWeight: '700' },
  headerSubtitle: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  card: { borderWidth: 1, borderRadius: RADII.lg, padding: SPACING.lg },
  sectionHeader: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  sectionTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700', flexShrink: 1 },
  sectionTrailing: { marginLeft: 'auto' },
  statusBadge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: RADII.pill, paddingHorizontal: 9, paddingVertical: 4 },
  statusText: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  dataRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.lg, paddingVertical: SPACING.sm },
  dataLabel: { flex: 1, fontSize: 13, lineHeight: 18 },
  dataValue: { flex: 1, textAlign: 'right', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  dataValueEmphasized: { fontSize: 15, fontWeight: '800' },
  emptyState: { alignItems: 'center', paddingVertical: SPACING.xxxl, paddingHorizontal: SPACING.xl },
  emptyIcon: { width: 52, height: 52, borderRadius: RADII.lg, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md },
  emptyTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700', textAlign: 'center' },
  emptyDescription: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: SPACING.sm, maxWidth: 310 },
  button: { minHeight: 44, borderWidth: 1, borderRadius: RADII.md, paddingHorizontal: SPACING.lg, paddingVertical: 11, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: SPACING.sm },
  buttonText: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  disabled: { opacity: 0.55 },
  documentSubtitle: { marginTop: SPACING.sm, marginBottom: SPACING.lg, fontSize: 13, lineHeight: 19 },
});
