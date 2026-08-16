import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../src/context/ThemeContext';
import { useTenantContract } from '../src/hooks/useTenantContract';
import { buildContractSummary } from '../src/utils/contractPresentation';
import { safeBack } from '../src/utils/navigation';

export default function ContractViewer() {
  const router = useRouter();
  const { colors } = useTheme();
  const [showDocumentInfo, setShowDocumentInfo] = useState(false);
  const { contract, state, loading, refreshing, error, reload, refresh } = useTenantContract();
  const summary = buildContractSummary(contract);
  // STALE: a refresh after a prior successful load failed transiently — the
  // last safe presentation stays on screen with a dismissible warning
  // instead of being replaced by an empty/error screen.
  const showStaleWarning = state === 'STALE' && Boolean(summary);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => safeBack(router)} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={25} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Lease Contract</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      >
        {loading ? (
          <View style={styles.empty}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error && !summary ? (
          <View style={styles.empty}>
            <Ionicons name="cloud-offline-outline" size={58} color={colors.textSecondary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{error}</Text>
            <TouchableOpacity style={[styles.open, { backgroundColor: colors.primary }]} onPress={reload}>
              <Text style={styles.openText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !summary ? (
          <View style={styles.empty}>
            <Ionicons name="document-outline" size={58} color={colors.textSecondary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No current contract is available.</Text>
          </View>
        ) : (
          <>
            {showStaleWarning ? (
              <View style={[styles.staleWarning, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.textSecondary} />
                <Text style={[styles.staleWarningText, { color: colors.textSecondary }]}>{error}</Text>
                <TouchableOpacity onPress={reload}><Text style={[styles.staleWarningRetry, { color: colors.primary }]}>Retry</Text></TouchableOpacity>
              </View>
            ) : null}

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.statusRow}>
                <Ionicons name="shield-checkmark-outline" size={23} color={colors.accent} />
                <Text style={[styles.status, { color: colors.text }]}>{summary.lifecycleLabel}</Text>
              </View>
              <Text style={[styles.lifecycleMessage, { color: colors.textSecondary }]}>{summary.message}</Text>
              {summary.fields.map((field) => (
                <View key={field.key} style={styles.summaryField}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>{field.label}</Text>
                  <Text style={[styles.value, { color: colors.text }]}>{field.value}</Text>
                </View>
              ))}
              {summary.hasMissingDetails ? (
                <Text style={[styles.finalizing, { color: colors.textSecondary }]}>Some contract details are still being finalized.</Text>
              ) : null}
            </View>

            {summary.canOpenPdf ? (
              <TouchableOpacity
                style={[styles.open, { backgroundColor: colors.primary }]}
                onPress={() => router.push({
                  pathname: '/document-viewer',
                  params: {
                    kind: summary.documentKind,
                    id: contract.id,
                    cacheKey: summary.documentCacheKey,
                    title: 'Lease Contract',
                  },
                })}
              >
                <Ionicons name="document-text-outline" size={20} color="#fff" />
                <Text style={styles.openText}>View / Download Contract</Text>
              </TouchableOpacity>
            ) : null}

            {summary.documentInfo.length ? (
              <View style={[styles.documentInfo, { borderColor: colors.border }]}>
                <TouchableOpacity style={styles.documentInfoToggle} onPress={() => setShowDocumentInfo((value) => !value)}>
                  <Text style={[styles.documentInfoTitle, { color: colors.text }]}>Document Information</Text>
                  <Ionicons name={showDocumentInfo ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
                </TouchableOpacity>
                {showDocumentInfo ? summary.documentInfo.map((field) => (
                  <View key={field.label} style={styles.infoRow}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>{field.label}</Text>
                    <Text style={[styles.infoValue, { color: colors.text }]}>{field.value}</Text>
                  </View>
                )) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { height: 62, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { padding: 18, paddingBottom: 42 },
  empty: { alignItems: 'center', paddingTop: 100, gap: 16 },
  emptyTitle: { maxWidth: 310, textAlign: 'center', fontSize: 19, lineHeight: 27, fontWeight: '700' },
  card: { borderRadius: 16, padding: 18, borderWidth: 1, gap: 17 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  status: { fontSize: 21, fontWeight: '800' },
  lifecycleMessage: { fontSize: 13, lineHeight: 19, marginTop: -6 },
  staleWarning: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 },
  staleWarningText: { flex: 1, fontSize: 12, lineHeight: 17 },
  staleWarningRetry: { fontSize: 13, fontWeight: '700' },
  summaryField: { gap: 4 },
  label: { fontSize: 12, fontWeight: '600' },
  value: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  finalizing: { paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, fontSize: 13, lineHeight: 19 },
  open: { marginTop: 18, borderRadius: 12, padding: 15, flexDirection: 'row', justifyContent: 'center', gap: 9 },
  openText: { color: '#fff', fontWeight: '700' },
  documentInfo: { marginTop: 18, borderWidth: 1, borderRadius: 12, padding: 14 },
  documentInfoToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  documentInfoTitle: { fontSize: 14, fontWeight: '700' },
  infoRow: { marginTop: 12, gap: 3 },
  infoValue: { fontSize: 14, fontWeight: '600' },
});
