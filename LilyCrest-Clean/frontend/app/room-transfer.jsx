import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '../src/components/ui/LilycrestUI';
import { useAlert } from '../src/context/AlertContext';
import { useTheme } from '../src/context/ThemeContext';
import { apiService, getApiErrorMessage } from '../src/services/api';
import { subscribeCanonicalNotifications } from '../src/services/canonicalEvents';
import { getRoomTransferPresentation, isValidPreferredTransferDate } from '../src/utils/roomTransferPresentation';
import { safeBack } from '../src/utils/navigation';

const ROOM_TYPES = [
  { value: 'private', label: 'Private' },
  { value: 'double-sharing', label: 'Double Sharing' },
  { value: 'quadruple-sharing', label: 'Quadruple Sharing' },
];

export default function RoomTransferScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { showAlert } = useAlert();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [lifecycle, setLifecycle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [preferredRoomType, setPreferredRoomType] = useState('');
  const [preferredTransferDate, setPreferredTransferDate] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [preferredRoomId, setPreferredRoomId] = useState('');
  const [rooms, setRooms] = useState([]);
  const presentation = getRoomTransferPresentation(lifecycle);
  const matchingRooms = useMemo(() => rooms.filter((room) => (
    room.preferenceSelectable !== false &&
    String(room.roomType || '').toLowerCase() === preferredRoomType
  )), [preferredRoomType, rooms]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLoadError('');
      setMessage('');
      const response = await apiService.getCurrentRoomTransfer();
      setLifecycle(response?.data || null);
      const roomsResponse = await apiService.getRoomTransferPreferences().catch(() => ({ data: { rooms: [] } }));
      const roomPayload = roomsResponse?.data?.rooms;
      setRooms(Array.isArray(roomPayload) ? roomPayload : []);
    } catch (error) {
      setLoadError(getApiErrorMessage(error, 'Unable to load your room transfer status.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const resumed = /inactive|background/.test(previous) && nextState === 'active';
      previous = nextState;
      if (resumed) load();
    });
    return () => subscription.remove();
  }, [load]);
  useEffect(() => subscribeCanonicalNotifications((notification) => {
    const title = String(notification?.data?.title || notification?.title || '').toLowerCase();
    if (title.includes('room transfer')) load();
  }), [load]);

  const submit = async () => {
    const trimmedReason = reason.trim();
    if (!preferredRoomType || !trimmedReason) {
      setMessage('Select a preferred room type and enter a reason.');
      return;
    }
    if (!isValidPreferredTransferDate(preferredTransferDate)) {
      setMessage('Use a valid date in YYYY-MM-DD format that is today or later.');
      return;
    }
    setSaving(true); setMessage('');
    try {
      await apiService.createRoomTransferRequest({
        preferredRoomType,
        preferredRoomId: preferredRoomId || null,
        preferredTransferDate: preferredTransferDate || null,
        reason: trimmedReason,
        note: note.trim() || null,
      });
      setPreferredRoomType(''); setPreferredRoomId(''); setPreferredTransferDate(''); setReason(''); setNote('');
      await showAlert({ title: 'Request received', message: 'Your room transfer request is pending Admin review.', type: 'success' });
      await load();
    } catch (error) {
      if (error?.response?.status === 409) await load();
      setMessage(getApiErrorMessage(error, 'Unable to submit your room transfer request.'));
    } finally { setSaving(false); }
  };

  const cancel = async () => {
    const decision = await showAlert({
      title: 'Cancel room transfer request?',
      message: 'This only cancels your pending request.',
      type: 'warning',
      buttons: [{ text: 'Keep request', style: 'cancel' }, { text: 'Cancel request' }],
    });
    if (decision !== 'Cancel request') return;
    setSaving(true); setMessage('');
    try {
      await apiService.cancelRoomTransferRequest(lifecycle?.request?.id);
      await load();
    } catch (error) {
      if (error?.response?.status === 409) await load();
      setMessage(getApiErrorMessage(error, 'Unable to cancel your room transfer request.'));
    } finally { setSaving(false); }
  };

  const hasStatus = Boolean(presentation.status);
  const showForm = !loading && !loadError && presentation.canRequest;
  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader strong title="Room Transfer" subtitle="Request and track a room change" onBack={() => safeBack(router)} />
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View> : loadError ? (
        <View style={styles.center}>
          <Text style={styles.errorBox}>{loadError}</Text>
          <TouchableOpacity onPress={load} style={styles.submit}><Text style={styles.submitText}>Retry</Text></TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {hasStatus ? (
              <View style={styles.statusCard} accessibilityLabel={`Room transfer status: ${presentation.statusLabel}`}>
                <View style={styles.statusIcon}><Ionicons name="swap-horizontal" size={20} color={colors.interactive} /></View>
                <View style={styles.statusBody}>
                  <Text style={styles.eyebrow}>Current status</Text>
                  <Text style={styles.statusTitle}>{presentation.statusLabel}</Text>
                  {presentation.scheduledLabel ? <Text style={styles.statusDetail}>{presentation.scheduledLabel}</Text> : null}
                  {presentation.declineReason ? <Text style={styles.statusDetail}>{presentation.declineReason}</Text> : null}
                  {presentation.guidance ? <Text style={styles.guidance}>{presentation.guidance}</Text> : null}
                  {presentation.settlement?.required ? (
                    <Text style={styles.statusDetail}>
                      Settlement: ₱{Number(presentation.settlement.remaining || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} remaining
                    </Text>
                  ) : null}
                  {presentation.utilitiesNote ? <Text style={styles.guidance}>{presentation.utilitiesNote}</Text> : null}
                </View>
                {presentation.canCancel ? <TouchableOpacity disabled={saving} onPress={cancel} style={styles.cancelButton}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity> : null}
              </View>
            ) : null}

            {showForm ? (
              <View style={styles.formCard}>
                <Text style={styles.title}>{hasStatus ? 'Request another transfer' : 'Request Room Transfer'}</Text>
                <Text style={styles.helper}>Choose the room type you prefer and tell Admin why you would like to move.</Text>
                <Text style={styles.label}>Preferred room type *</Text>
                <View style={styles.chips}>{ROOM_TYPES.map((type) => (
                  <TouchableOpacity key={type.value} onPress={() => { setPreferredRoomType(type.value); setPreferredRoomId(''); }} style={[styles.chip, preferredRoomType === type.value && styles.chipSelected]} accessibilityRole="radio" accessibilityState={{ selected: preferredRoomType === type.value }}>
                    <Text style={[styles.chipText, preferredRoomType === type.value && styles.chipTextSelected]}>{type.label}</Text>
                  </TouchableOpacity>
                ))}</View>
                <Text style={styles.label}>Specific room (optional)</Text>
                <View style={styles.chips}>
                  <TouchableOpacity onPress={() => setPreferredRoomId('')} style={[styles.chip, !preferredRoomId && styles.chipSelected]} accessibilityRole="radio" accessibilityState={{ selected: !preferredRoomId }}>
                    <Text style={[styles.chipText, !preferredRoomId && styles.chipTextSelected]}>No specific room</Text>
                  </TouchableOpacity>
                  {matchingRooms.map((room) => {
                    const roomId = String(room.roomId || '');
                    if (!roomId) return null;
                    const selected = preferredRoomId === roomId;
                    return <TouchableOpacity key={roomId} onPress={() => setPreferredRoomId(roomId)} style={[styles.chip, selected && styles.chipSelected]} accessibilityRole="radio" accessibilityState={{ selected }}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{room.name || room.room_number || room.roomNumber || 'Room'}</Text></TouchableOpacity>;
                  })}
                </View>
                <Text style={styles.label}>Preferred transfer date</Text>
                <TextInput value={preferredTransferDate} onChangeText={setPreferredTransferDate} style={styles.input} placeholder="YYYY-MM-DD (optional)" placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" />
                <Text style={styles.label}>Reason *</Text>
                <TextInput value={reason} onChangeText={setReason} style={[styles.input, styles.textarea]} multiline maxLength={500} textAlignVertical="top" placeholder="Why would you like to transfer?" placeholderTextColor={colors.textMuted} />
                <Text style={styles.label}>Note (optional)</Text>
                <TextInput value={note} onChangeText={setNote} style={[styles.input, styles.textareaSmall]} multiline maxLength={1000} textAlignVertical="top" placeholder="Anything else Admin should know" placeholderTextColor={colors.textMuted} />
                <Text style={styles.notice}>Room preference and transfer date are subject to Admin confirmation.</Text>
                {message ? <Text style={styles.error}>{message}</Text> : null}
                <TouchableOpacity disabled={saving} onPress={submit} style={[styles.submit, saving && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Submit request</Text>}</TouchableOpacity>
              </View>
            ) : null}
            {!showForm && message ? <Text style={styles.errorBox}>{message}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const createStyles = (c) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background }, flex: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, paddingBottom: 48, gap: 16 }, statusCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  statusIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentLight }, statusBody: { flex: 1, gap: 3 }, eyebrow: { color: c.textMuted, textTransform: 'uppercase', letterSpacing: .7, fontSize: 10, fontWeight: '800' },
  statusTitle: { color: c.text, fontSize: 17, fontWeight: '800' }, statusDetail: { color: c.textSecondary, fontSize: 13, lineHeight: 19 }, guidance: { color: c.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
  cancelButton: { paddingVertical: 7, paddingHorizontal: 10, borderWidth: 1, borderColor: c.border, borderRadius: 9 }, cancelText: { color: c.danger || '#DC2626', fontSize: 12, fontWeight: '800' },
  formCard: { padding: 18, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }, title: { color: c.text, fontSize: 20, fontWeight: '800' }, helper: { color: c.textSecondary, lineHeight: 20, marginTop: 5, marginBottom: 6 },
  label: { color: c.text, fontSize: 13, fontWeight: '700', marginTop: 14, marginBottom: 7 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border }, chipSelected: { borderColor: c.interactive, backgroundColor: c.accentLight }, chipText: { color: c.textSecondary, fontWeight: '600' }, chipTextSelected: { color: c.interactive },
  input: { color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: c.inputBg || c.background }, textarea: { minHeight: 94 }, textareaSmall: { minHeight: 70 },
  notice: { marginTop: 15, padding: 12, borderRadius: 10, backgroundColor: c.accentLight, color: c.textSecondary, fontSize: 12, lineHeight: 18 }, error: { color: c.danger || '#DC2626', marginTop: 12, lineHeight: 19 }, errorBox: { color: c.danger || '#DC2626', padding: 14, borderRadius: 10, backgroundColor: c.surface },
  submit: { marginTop: 16, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: c.primary }, submitText: { color: '#fff', fontWeight: '800' }, disabled: { opacity: .6 },
});
