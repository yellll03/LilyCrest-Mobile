import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../src/context/ThemeContext';
import { useTenantContract } from '../src/hooks/useTenantContract';
import { useContractAcknowledgement } from '../src/hooks/useContractAcknowledgement';
import { buildContractSummary } from '../src/utils/contractPresentation';
import { safeBack } from '../src/utils/navigation';
import { apiService } from '../src/services/api';
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

// Contract Number/Branch/Room/Lease Period identify the contract at a
// glance; the rest (lease type, rate, deposits, fees) already appear in the
// PDF itself one tap away via "View Contract" — showing them here too reads
// as duplicated content, so they're tucked behind a collapsible section
// instead of always-visible rows.
const ESSENTIAL_FIELD_KEYS = ['number', 'branch', 'room', 'period'];

// The document card's small status chip. It describes the DOCUMENT's
// readiness, not the Contract lifecycle status headline (that is
// summary.status, straight from the backend's displayStatus). "Processing" is
// only ever shown for a genuine backend-derived preparing state — no final and
// no draft PDF yet — never as a cosmetic cover for stale data.
function documentCardStatus(summary) {
  if (summary.lifecycleState === 'final') return 'Verified';
  if (summary.lifecycleState === 'draft') return 'Ready for Signing';
  return 'Processing';
}

export default function ContractViewer() {
  const router = useRouter();
  const { contractId: requestedContractIdParam } = useLocalSearchParams();
  const requestedContractId = Array.isArray(requestedContractIdParam)
    ? requestedContractIdParam[0]
    : requestedContractIdParam;
  const { colors } = useTheme();
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [startingSupport, setStartingSupport] = useState(false);
  const [supportError, setSupportError] = useState('');
  const { contract, upcoming, state, loading, refreshing, error, reload, refresh } = useTenantContract();
  const requestedContractMismatch = Boolean(
    requestedContractId
    && contract?.id
    && String(requestedContractId) !== String(contract.id),
  );
  const summary = buildContractSummary(requestedContractMismatch ? null : contract);
  const upcomingSummary = upcoming ? buildContractSummary(upcoming) : null;
  const activeContractId = requestedContractMismatch ? null : contract?.id || null;
  const acknowledgement = useContractAcknowledgement(activeContractId);
  const essentialFields = summary?.fields.filter((field) => ESSENTIAL_FIELD_KEYS.includes(field.key)) || [];
  const moreFields = summary?.fields.filter((field) => !ESSENTIAL_FIELD_KEYS.includes(field.key)) || [];
  // STALE: a refresh after a prior successful load failed transiently — the
  // last safe presentation stays on screen with a dismissible warning
  // instead of being replaced by an empty/error screen.
  const showStaleWarning = state === 'STALE' && Boolean(summary);

  const contactSupport = async () => {
    if (startingSupport) return;
    if (state !== 'MULTIPLE_CONTRACTS' && (!contract?.id || requestedContractMismatch)) return;
    setStartingSupport(true);
    setSupportError('');
    try {
      const response = await apiService.startSupportChat({
        category: 'general_inquiry',
        priority: 'normal',
        context: {
          entityType: 'contract',
          ...(contract?.id ? { entityId: contract.id } : {}),
          sourceModule: 'contract',
        },
      });
      const conversationId = response.data?.conversation?.id;
      if (!conversationId) throw new Error('Support did not return a conversation.');
      router.push({ pathname: '/chatbot', params: { conversationId } });
    } catch (_supportError) {
      setSupportError('Unable to open contract support right now. Please try again.');
    } finally {
      setStartingSupport(false);
    }
  };

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
        ) : state === 'MULTIPLE_CONTRACTS' ? (
          <EmptyState
            icon="alert-circle-outline"
            title="Contract records need review"
            description={supportError || error}
            action={<ActionButton label={startingSupport ? 'Opening Support...' : 'Contact Support'} onPress={contactSupport} disabled={startingSupport} />}
          />
        ) : (error || requestedContractMismatch) && !summary ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Contract unavailable"
            description={requestedContractMismatch
              ? 'The contract linked by this notification is not your current visible contract.'
              : error}
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
                <TouchableOpacity onPress={reload}><Text style={[styles.staleWarningRetry, { color: colors.interactive }]}>Retry</Text></TouchableOpacity>
              </View>
            ) : null}

            <SurfaceCard style={styles.card}>
              <SectionHeader
                icon="shield-checkmark-outline"
                title="Contract Status"
                trailing={<StatusBadge status={summary.lifecycleState} label={summary.lifecycleBadgeLabel} tone={summary.lifecycleState === 'final' ? 'success' : summary.lifecycleState === 'draft' ? 'warning' : 'info'} />}
              />
              <Text style={[styles.lifecycleStatus, { color: colors.heading }]}>{summary.status}</Text>
              {essentialFields.map((field, index) => (
                <DataRow key={field.key} label={field.label} value={field.value} last={index === essentialFields.length - 1 && !moreFields.length} />
              ))}
              {summary.hasMissingDetails ? (
                <Text style={[styles.finalizing, { color: colors.textSecondary }]}>Some contract details are still being finalized.</Text>
              ) : null}
              {moreFields.length ? (
                <View style={[styles.moreDetails, { borderTopColor: colors.border }]}>
                  <TouchableOpacity style={styles.documentInfoToggle} onPress={() => setShowMoreDetails((value) => !value)}>
                    <Text style={[styles.documentInfoTitle, { color: colors.text }]}>Lease &amp; Payment Details</Text>
                    <Ionicons name={showMoreDetails ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                  {showMoreDetails ? moreFields.map((field, index) => (
                    <DataRow key={field.key} label={field.label} value={field.value} last={index === moreFields.length - 1} />
                  )) : null}
                </View>
              ) : null}
            </SurfaceCard>

            <DocumentActionCard
              title="Current Document"
              subtitle={summary.lifecycleLabel}
              status={documentCardStatus(summary)}
            >
              {summary.canOpenPdf ? (
                <ActionButton
                  label={summary.documentActionLabel}
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

            {summary.canOpenPdf && acknowledgement.status ? (
              <SurfaceCard style={styles.acknowledgementCard}>
                <SectionHeader
                  icon="checkmark-circle-outline"
                  title="Document Acknowledgement"
                  trailing={acknowledgement.isAcknowledged
                    ? <StatusBadge status="final" label="Acknowledged" tone="success" />
                    : <StatusBadge status="draft" label="Action needed" tone="warning" />}
                />
                {acknowledgement.isAcknowledged ? (
                  <Text style={[styles.ackNote, { color: colors.textSecondary }]}>
                    You have acknowledged this version of your contract document. This is an
                    acknowledgement of receipt and review — it is not a signature.
                  </Text>
                ) : (
                  <>
                    <Text style={[styles.ackNote, { color: colors.textSecondary }]}>
                      Please review the document above and acknowledge that you have received and
                      read it. This is an acknowledgement only — it is not a signature.
                    </Text>
                    {acknowledgement.error ? (
                      <Text style={[styles.supportError, { color: colors.errorText }]}>{acknowledgement.error}</Text>
                    ) : null}
                    <ActionButton
                      label={acknowledgement.submitting ? 'Recording…' : 'Review and acknowledge'}
                      icon="checkmark-done-outline"
                      onPress={acknowledgement.acknowledge}
                      disabled={acknowledgement.submitting}
                    />
                  </>
                )}
              </SurfaceCard>
            ) : null}

            {upcomingSummary ? (
              <SurfaceCard style={styles.card}>
                <SectionHeader
                  icon="calendar-outline"
                  title="Upcoming Renewal"
                  trailing={<StatusBadge status="preparing" label="Upcoming" tone="info" />}
                />
                <Text style={[styles.upcomingNote, { color: colors.textSecondary }]}>
                  This is not your current contract yet. Your current contract above stays in effect
                  until Lilycrest activates the renewal.
                </Text>
                {upcomingSummary.fields
                  .filter((field) => ['number', 'room', 'period'].includes(field.key))
                  .map((field, index, arr) => (
                    <DataRow key={field.key} label={field.label} value={field.value} last={index === arr.length - 1} />
                  ))}
              </SurfaceCard>
            ) : null}

            <SurfaceCard style={styles.supportCard}>
              {supportError ? <Text style={[styles.supportError, { color: colors.errorText }]}>{supportError}</Text> : null}
              <ActionButton
                label={startingSupport ? 'Opening Support...' : 'Questions? Contact Support'}
                icon="chatbubble-ellipses-outline"
                onPress={contactSupport}
                disabled={startingSupport}
                variant="secondary"
              />
            </SurfaceCard>
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
  card: { gap: 10, marginBottom: 16 },
  // The acknowledgement card gets its own vertical rhythm so it reads as a
  // distinct call-to-action, set apart from the Current Document card above
  // and the Renewal / support content below.
  acknowledgementCard: { gap: 10, marginTop: 12, marginBottom: 28 },
  lifecycleStatus: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  staleWarning: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 },
  staleWarningText: { flex: 1, fontSize: 12, lineHeight: 17 },
  staleWarningRetry: { fontSize: 13, fontWeight: '700' },
  finalizing: { paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, fontSize: 13, lineHeight: 19 },
  moreDetails: { marginTop: 4, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  upcomingNote: { fontSize: 12, lineHeight: 17, marginBottom: 4 },
  ackNote: { fontSize: 12, lineHeight: 17, marginBottom: 6 },
  documentPending: { fontSize: 13, lineHeight: 19, marginTop: 12 },
  supportCard: { gap: 12, marginTop: 16 },
  supportError: { fontSize: 12, lineHeight: 17 },
  // Still used by the "Lease & Payment Details" collapsible inside the
  // Contract Status card.
  documentInfoToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  documentInfoTitle: { fontSize: 14, fontWeight: '700' },
});
