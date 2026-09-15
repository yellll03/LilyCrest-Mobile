import { extensionDate as date, extensionPresentation, extensionError, isRecoveredExtension } from '../src/utils/extendStayPresentation';
import { subscribeCanonicalNotifications } from '../src/services/canonicalEvents';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, AppState, RefreshControl, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton, DataRow, ScreenHeader, StatusBadge, SurfaceCard } from '../src/components/ui/LilycrestUI';
import { useAlert } from '../src/context/AlertContext';
import { useTheme } from '../src/context/ThemeContext';
import { apiService } from '../src/services/api';
import { safeBack } from '../src/utils/navigation';


const money = (value) => Number(value).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' });

export default function ExtendStayScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { showAlert } = useAlert();
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [months, setMonths] = useState(6), [reason, setReason] = useState(''), [note, setNote] = useState('');
  const guard = useRef(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    setLoading(true); setError('');
    try { const result = (await apiService.getCurrentStayExtension()).data; if (requestId === sequence.current) setData(result); return result; }
    catch (err) { if (requestId === sequence.current) setError(extensionError(err)); }
    finally { if (requestId === sequence.current) setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') load(); });
    const unsubscribe = subscribeCanonicalNotifications((notification) => {
      if (/stay_extension|extend-stay|renewal_effective|contract_document_ready|contract_finalized|contract_replaced/.test(JSON.stringify(notification))) load();
    });
    return () => { sub.remove(); unsubscribe(); sequence.current += 1; };
  }, [load]);
  const presentation = extensionPresentation(data?.request);
  const selected = data?.options?.find((option) => option.months === months);
  const submit = async () => {
    if (guard.current || !data?.canRequest || !selected) return;
    guard.current = true;
    const intent = { stayId: data.current.stayId, months, requestedEndDate: selected.endDate, expectedMonthlyRent: selected.monthlyRent, reason, note };
    try {
      const decision = await showAlert({ title: 'Request stay extension?', message: `Request an extension through ${date(selected.endDate)} at ${money(selected.monthlyRent)} per month, subject to Admin approval and contract signing?`, type: 'info', buttons: [{ text: 'Cancel', style: 'cancel' }, { text: 'Submit request' }] });
      if (decision !== 'Submit request') return;
      setSaving(true);
      await apiService.createStayExtension(intent);
      setReason(''); setNote('');
      await load();
      showAlert({ title: 'Request submitted', message: 'Your extension is pending Admin review.', type: 'success' });
    } catch (err) {
      const recovered = await load();
      if ((!err.response || err.response.status >= 500) && isRecoveredExtension(recovered?.request, data?.request, intent)) showAlert({ title: 'Request submitted', message: 'Your extension request is being processed.', type: 'success' });
      else showAlert({ title: 'Unable to submit request', message: extensionError(err), type: 'error' });
    } finally { guard.current = false; setSaving(false); }
  };
  const input = [styles.input, { color: colors.text, backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }];
  return <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
    <ScreenHeader strong title="Extend Stay" subtitle="Request and track a lease extension" onBack={() => safeBack(router)} />
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator color={colors.interactive} /> : error ? <SurfaceCard><Text style={{ color: colors.errorText }}>{error}</Text><ActionButton label="Retry" onPress={load} /></SurfaceCard> : <>
          {data?.current ? <SurfaceCard><Text style={[styles.title, { color: colors.heading }]}>Your current stay</Text><DataRow label="Room" value={data.current.room} /><DataRow label="Start date" value={date(data.current.startDate)} /><DataRow label="Current end date" value={date(data.current.endDate)} last /></SurfaceCard> : null}
          {data?.request ? <SurfaceCard><Text style={[styles.title, { color: colors.heading }]}>Latest request</Text><StatusBadge status={data.request.status} label={presentation.label} /><Text style={{ color: colors.text, marginVertical: 12 }}>{presentation.nextAction}</Text>
          {presentation.contractAction ? <ActionButton label="Open Contract" onPress={() => router.push('/contract-viewer')} /> : null}
          <DataRow label="Current lease end" value={date(data.request.currentEndDate)} />
          <DataRow label="Monthly rate" value={data.request.monthlyRent != null ? money(data.request.monthlyRent) : 'Not available'} />
          <DataRow label="Submitted on" value={date(data.request.createdAt)} />
          {data.request.reviewedAt ? <DataRow label="Reviewed on" value={date(data.request.reviewedAt)} /> : null}
          <DataRow label="Extension starts" value={date(presentation.start)} />
          <DataRow label="Requested end date" value={date(data.request.requestedEndDate)} /><DataRow label="Extension" value={`${data.request.months} months`} /><DataRow label="Admin note" value={data.request.adminNote || 'No note'} last /></SurfaceCard> : null}
          {data?.canRequest ? <SurfaceCard>
            <Text style={[styles.title, { color: colors.heading }]}>Request an extension</Text>
            <View style={styles.options}>{data.options.map((option) => <ActionButton key={option.months} label={`${option.months} month${option.months === 1 ? '' : 's'}`} variant={months === option.months ? 'gold' : 'secondary'} disabled={saving} onPress={() => setMonths(option.months)} />)}</View>
            <DataRow label="Requested new end date" value={date(selected?.endDate)} />
            <DataRow label="Monthly rent for extension" value={selected ? money(selected.monthlyRent) : 'Not available'} />
            <Text style={{ color: colors.text }}>Reason (optional)</Text><TextInput accessibilityLabel="Reason" value={reason} onChangeText={setReason} editable={!saving} multiline maxLength={500} style={input} placeholder="Why would you like to extend your stay?" placeholderTextColor={colors.textMuted} />
            <Text style={{ color: colors.text }}>Note (optional)</Text><TextInput accessibilityLabel="Note" value={note} onChangeText={setNote} editable={!saving} multiline maxLength={1000} style={input} placeholder="Anything else Admin should know" placeholderTextColor={colors.textMuted} />
            <Text style={[styles.notice, { color: colors.infoText, backgroundColor: colors.infoBg }]}>Subject to Admin approval and the lease preparation and signing process.</Text>
            <ActionButton label={saving ? 'Submitting...' : 'Submit request'} disabled={saving || !selected} onPress={submit} />
          </SurfaceCard> : data?.reason ? <Text style={{ color: colors.textSecondary }}>{extensionError(data.reason)}</Text> : null}
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ root: { flex: 1 }, content: { padding: 18, gap: 16, paddingBottom: 48 }, title: { fontSize: 19, fontWeight: '700', marginBottom: 12 }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, input: { borderWidth: 1, borderRadius: 10, minHeight: 80, padding: 12, marginVertical: 8, textAlignVertical: 'top' }, notice: { padding: 12, borderRadius: 10, marginVertical: 12, lineHeight: 20 } });
