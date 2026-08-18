import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../src/context/ThemeContext';
import { useTenantContract } from '../src/hooks/useTenantContract';
import { buildContractSummary } from '../src/utils/contractPresentation';
import { safeBack } from '../src/utils/navigation';
import {
  ActionButton,
  DataRow,
  DocumentActionCard,
  EmptyState,
  ScreenHeader,
  SectionHeader,
  StatusBadge,
  SurfaceCard,
} from '../src/components/ui/LilycrestUI';

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
      <ScreenHeader title="Contract" subtitle="Your canonical Lilycrest tenancy document" onBack={() => safeBack(router)} strong />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      >
        {loading ? (
          <View style={styles.empty}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error && !summary ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Contract unavailable"
            description={error}
            action={<ActionButton label="Retry" onPress={reload} />}
          />
        ) : !summary ? (
          <EmptyState icon="document-outline" title="No current contract" description="Your current contract will appear here once it is available." />
        ) : (
          <>
            {showStaleWarning ? (
              <View style={[styles.staleWarning, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.textSecondary} />
                <Text style={[styles.staleWarningText, { color: colors.textSecondary }]}>{error}</Text>
                <TouchableOpacity onPress={reload}><Text style={[styles.staleWarningRetry, { color: colors.primary }]}>Retry</Text></TouchableOpacity>
              </View>
            ) : null}

            <SurfaceCard style={styles.card}>
              <SectionHeader
                icon="shield-checkmark-outline"
                title="Contract Summary"
                trailing={<StatusBadge status={summary.lifecycleState} label={summary.status} tone={summary.lifecycleState === 'final' ? 'success' : summary.lifecycleState === 'draft' ? 'warning' : 'info'} />}
              />
              <Text style={[styles.lifecycleMessage, { color: colors.textSecondary }]}>{summary.message}</Text>
              {summary.fields.map((field, index) => (
                <DataRow key={field.key} label={field.label} value={field.value} last={index === summary.fields.length - 1} />
              ))}
              {summary.hasMissingDetails ? (
                <Text style={[styles.finalizing, { color: colors.textSecondary }]}>Some contract details are still being finalized.</Text>
              ) : null}
            </SurfaceCard>

            <DocumentActionCard
              title="Current Document"
              subtitle={summary.lifecycleLabel}
              status={summary.lifecycleState === 'final' ? 'Verified' : summary.lifecycleState === 'draft' ? 'Under Review' : 'Processing'}
            >
              {summary.canOpenPdf ? (
                <ActionButton
                  label="View Contract"
                  icon="document-text-outline"
                  onPress={() => router.push({
                    pathname: '/document-viewer',
                    params: {
                      kind: summary.documentKind,
                      id: contract.id,
                      cacheKey: summary.documentCacheKey,
                      title: summary.lifecycleLabel,
                    },
                  })}
                />
              ) : <Text style={[styles.documentPending, { color: colors.textSecondary }]}>The current PDF is not available yet. Pull down to refresh.</Text>}
            </DocumentActionCard>

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
  content: { padding: 18, paddingBottom: 42 },
  empty: { alignItems: 'center', paddingTop: 100, gap: 16 },
  card: { gap: 12, marginBottom: 16 },
  lifecycleMessage: { fontSize: 13, lineHeight: 19, marginTop: -6 },
  staleWarning: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 },
  staleWarningText: { flex: 1, fontSize: 12, lineHeight: 17 },
  staleWarningRetry: { fontSize: 13, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '600' },
  finalizing: { paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, fontSize: 13, lineHeight: 19 },
  documentPending: { fontSize: 13, lineHeight: 19, marginTop: 12 },
  documentInfo: { marginTop: 18, borderWidth: 1, borderRadius: 12, padding: 14 },
  documentInfoToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  documentInfoTitle: { fontSize: 14, fontWeight: '700' },
  infoRow: { marginTop: 12, gap: 3 },
  infoValue: { fontSize: 14, fontWeight: '600' },
});
