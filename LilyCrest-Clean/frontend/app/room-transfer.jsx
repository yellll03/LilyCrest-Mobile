import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useAuth } from '../src/context/AuthContext';
import { getRoomTransferError } from '../src/utils/roomTransferErrors';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '../src/components/ui/LilycrestUI';
import { useAlert } from '../src/context/AlertContext';
import { useTheme } from '../src/context/ThemeContext';
import { apiService } from '../src/services/api';
import { subscribeCanonicalNotifications } from '../src/services/canonicalEvents';
import { getRoomTransferPresentation, isValidPreferredTransferDate, isValidRoomTransferLifecycle } from '../src/utils/roomTransferPresentation';
import { safeBack } from '../src/utils/navigation';

const ROOM_TYPES = [
  { value: 'private', label: 'Private' },
  { value: 'double-sharing', label: 'Double Sharing' },
  { value: 'quadruple-sharing', label: 'Quadruple Sharing' },
];

export default function RoomTransferScreen() {
  const { user, authReady, authStatus } = useAuth();
  const accountId = user?.user_id;
  if (!authReady || authStatus !== 'authenticated' || !accountId) return null;
  return <RoomTransferContent key={String(accountId)} accountId={String(accountId)} />;
}

function RoomTransferContent({ accountId }) {
  const router = useRouter();
  const submissionStorageKey = `room-transfer-submission:${accountId}`;
  const active = useRef(true);
  const [retryPending, setRetryPending] = useState(false);
  const attempt = useRef(null);
  const { colors } = useTheme();
  const { showAlert } = useAlert();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [lifecycle, setLifecycle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const submitting = useRef(false);
  const requestSequence = useRef(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessageState] = useState('');
  const setMessage = useCallback((nextMessage) => {
    setMessageState(nextMessage);
    if (nextMessage) showAlert({ title: 'Room Transfer', message: nextMessage, type: 'error' });
  }, [showAlert]);
  const [preferredRoomType, setPreferredRoomType] = useState('');
  const [preferredTransferDate, setPreferredTransferDate] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [preferredRoomId, setPreferredRoomId] = useState('');
  const [rooms, setRooms] = useState([]);
  const [preferencesError, setPreferencesError] = useState('');
  const presentation = getRoomTransferPresentation(lifecycle);
  const matchingRooms = useMemo(() => rooms.filter((room) => (
    room.preferenceSelectable !== false &&
    String(room.roomType || '').toLowerCase() === preferredRoomType
  )), [preferredRoomType, rooms]);

  const load = useCallback(async () => {
    if (!active.current) return;
    const requestId = ++requestSequence.current;
    setLoading(true);
    try {
      setLoadError('');
      setMessage('');
      const response = await apiService.getCurrentRoomTransfer();
      if (requestId !== requestSequence.current) return;
      if (!isValidRoomTransferLifecycle(response?.data)) throw new Error('We could not confirm your room transfer status. Refresh and try again.');
      setLifecycle(response.data);
      const storedAttempt = await AsyncStorage.getItem(submissionStorageKey);
      if (requestId !== requestSequence.current) return;
      if (storedAttempt) {
        let pendingAttempt;
        try { pendingAttempt = JSON.parse(storedAttempt); } catch (_) { pendingAttempt = null; }
        if (!pendingAttempt || !/^[a-zA-Z0-9_-]{16,80}$/.test(pendingAttempt.clientRequestId || '') || !ROOM_TYPES.some(type => type.value === pendingAttempt.preferredRoomType) || typeof pendingAttempt.reason !== 'string' || !['preferredRoomId', 'preferredTransferDate', 'note'].every(field => pendingAttempt[field] == null || typeof pendingAttempt[field] === 'string')) {
          await AsyncStorage.removeItem(submissionStorageKey);
          if (requestId !== requestSequence.current) return;
          attempt.current = null;
          setRetryPending(false);
        } else if (response.data.request?.clientRequestId === pendingAttempt.clientRequestId) {
          await AsyncStorage.removeItem(submissionStorageKey);
          if (requestId !== requestSequence.current) return;
          attempt.current = null;
          setRetryPending(false);
        } else if (!response.data.status || ['cancelled', 'declined', 'completed'].includes(response.data.status)) {
          attempt.current = pendingAttempt;
          setRetryPending(true);
          setPreferredRoomType(pendingAttempt.preferredRoomType || '');
          setPreferredRoomId(pendingAttempt.preferredRoomId || '');
          setPreferredTransferDate(pendingAttempt.preferredTransferDate || '');
          setReason(pendingAttempt.reason || ''); setNote(pendingAttempt.note || '');
        }
      }
      setPreferencesError('');
      if (response.data.canRequest !== false && getRoomTransferPresentation(response.data).canRequest) {
        try {
          const roomsResponse = await apiService.getRoomTransferPreferences();
          if (requestId !== requestSequence.current) return;
          if (!Array.isArray(roomsResponse?.data?.rooms)) throw new Error('The room list could not be loaded. Refresh and try again.');
          setRooms(roomsResponse.data.rooms);
        } catch (error) {
          if (requestId !== requestSequence.current) return;
          setPreferencesError(getRoomTransferError(error, 'The room list could not be loaded. Refresh and try again.'));
        }
      } else setRooms([]);
      return response?.data;
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setLoadError(getRoomTransferError(error, 'Unable to load your room transfer status.'));
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [setMessage, submissionStorageKey]);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; requestSequence.current += 1; };
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
    if (!active.current || submitting.current || loading || loadError || preferencesError || !presentation.canRequest) return;
    const trimmedReason = reason.trim();
    if (!preferredRoomType || !trimmedReason) {
      setMessage('Select a preferred room type and enter a reason.');
      return;
    }
    if (!retryPending && !isValidPreferredTransferDate(preferredTransferDate)) {
      setMessage('Choose today or a future date in Manila, using YYYY-MM-DD.');
      return;
    }
    submitting.current = true;
    setSaving(true); setMessage('');
    let submittedAttempt;
    try {
      // Persist the exact attempt before transport. A retry after timeout or
      // app restart uses the same key and payload, even after Admin acts.
      {
        const stored = await AsyncStorage.getItem(submissionStorageKey);
        attempt.current = stored ? JSON.parse(stored) : {
          clientRequestId: Crypto.randomUUID(), preferredRoomType,
          preferredRoomId: preferredRoomId || null, preferredTransferDate: preferredTransferDate || null,
          reason: trimmedReason, note: note.trim() || null,
        };
      }
      submittedAttempt = attempt.current;
      await AsyncStorage.setItem(submissionStorageKey, JSON.stringify(submittedAttempt));
      if (!active.current) return;
      setRetryPending(true);
      await apiService.createRoomTransferRequest(submittedAttempt);
      if (!active.current) return;
      await AsyncStorage.removeItem(submissionStorageKey);
      if (!active.current) return;
      attempt.current = null;
      setRetryPending(false);
      setPreferredRoomType(''); setPreferredRoomId(''); setPreferredTransferDate(''); setReason(''); setNote('');
      await showAlert({ title: 'Request received', message: 'Your request was received. Refreshing the latest status.', type: 'success' });
      await load();
    } catch (error) {
      if (!active.current) return;
      const attemptedId = submittedAttempt?.clientRequestId;
      const latest = await load();
      if (!active.current) return;
      if (attemptedId && latest?.request?.clientRequestId === attemptedId) {
        await AsyncStorage.removeItem(submissionStorageKey);
        if (!active.current) return;
        attempt.current = null;
        setRetryPending(false);
        await showAlert({ title: 'Request received', message: 'Your request was received. The latest status is shown below.', type: 'success' });
      } else {
        const status = error?.response?.status;
        if (status && status < 500 && ![401, 403, 408, 429].includes(status)) {
          await AsyncStorage.removeItem(submissionStorageKey);
          if (!active.current) return;
          attempt.current = null;
          setRetryPending(false);
        }
        setMessage(getRoomTransferError(error, 'Unable to submit your room transfer request. Refresh its status before trying again.'));
      }
    } finally { submitting.current = false; if (active.current) setSaving(false); }
  };

  const cancel = async () => {
    if (!active.current || submitting.current || !presentation.canCancel) return;
    submitting.current = true;
    const requestId = lifecycle.request.id;
    try {
      const decision = await showAlert({
        title: 'Cancel room transfer request?', message: 'This only cancels your pending request.', type: 'warning',
        buttons: [{ text: 'Keep request', style: 'cancel' }, { text: 'Cancel request' }],
      });
      if (decision !== 'Cancel request' || !active.current) return;
      setSaving(true); setMessage('');
      await apiService.cancelRoomTransferRequest(requestId);
      if (!active.current) return;
      await load();
      if (active.current) await showAlert({ title: 'Request cancelled', message: 'Your room transfer request has been cancelled.', type: 'success' });
    } catch (error) {
      if (!active.current) return;
      const latest = await load();
      if (!active.current) return;
      if (latest?.request?.id === requestId && latest?.status === 'cancelled') await showAlert({ title: 'Request cancelled', message: 'Your room transfer request has been cancelled.', type: 'success' });
      else setMessage(getRoomTransferError(error, 'Unable to cancel your room transfer request. Refresh its status and contact administration for help.'));
    } finally { submitting.current = false; if (active.current) setSaving(false); }
  };

  const hasStatus = Boolean(presentation.status);
  const showForm = !loading && !loadError && !preferencesError && presentation.canRequest;
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
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
            {lifecycle?.currentRoom?.name ? <Text style={styles.helper}>Current room: {lifecycle.currentRoom.name}{lifecycle?.currentBed?.label ? ` / ${lifecycle.currentBed.label}` : ''}</Text> : null}
            {!presentation.canRequest && lifecycle?.eligibilityReason ? <Text style={styles.guidance}>{lifecycle.eligibilityReason}</Text> : null}
            {lifecycle?.scheduledRoomTransfer?.destinationRoom?.name ? <Text style={styles.helper}>Confirmed destination: {lifecycle.scheduledRoomTransfer.destinationRoom.name}{lifecycle.scheduledRoomTransfer.destinationBed?.label ? ` / ${lifecycle.scheduledRoomTransfer.destinationBed.label}` : ''}</Text> : null}
            {hasStatus ? (
              <View style={styles.statusCard} accessibilityLabel={`Room transfer status: ${presentation.statusLabel}`}>
                <View style={styles.statusIcon}><Ionicons name="swap-horizontal" size={20} color={colors.selectionText} /></View>
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
                  {presentation.settlement?.required && presentation.settlement.remaining > 0 ? <TouchableOpacity onPress={() => router.push('/(tabs)/billing')}><Text style={styles.guidance}>Open Billing to review and pay</Text></TouchableOpacity> : null}
                  {presentation.utilitiesNote ? <Text style={styles.guidance}>{presentation.utilitiesNote}</Text> : null}
                </View>
                {presentation.canCancel ? <TouchableOpacity disabled={saving} onPress={cancel} style={styles.cancelButton}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity> : null}
              </View>
            ) : null}

            {preferencesError ? <View><Text style={styles.errorBox}>{preferencesError}</Text><TouchableOpacity onPress={load}><Text style={styles.guidance}>Refresh available rooms</Text></TouchableOpacity></View> : null}
            {showForm ? (
              <View style={styles.formCard}>
                <Text style={styles.title}>{hasStatus ? 'Request another transfer' : 'Request Room Transfer'}</Text>
                {retryPending ? <Text style={styles.guidance}>A previous response was not confirmed. Retrying sends the same request safely.</Text> : null}
                <Text style={styles.helper}>Choose the room type you prefer and tell Admin why you would like to move.</Text>
                <Text style={styles.label}>Preferred room type *</Text>
                <View style={styles.chips}>{ROOM_TYPES.map((type) => (
                  <TouchableOpacity key={type.value} disabled={saving || retryPending} onPress={() => { setPreferredRoomType(type.value); setPreferredRoomId(''); }} style={[styles.chip, preferredRoomType === type.value && styles.chipSelected]} accessibilityRole="radio" accessibilityState={{ selected: preferredRoomType === type.value }}>
                    <Text style={[styles.chipText, preferredRoomType === type.value && styles.chipTextSelected]}>{type.label}</Text>
                  </TouchableOpacity>
                ))}</View>
                <Text style={styles.label}>Specific room (optional)</Text>
                <View style={styles.chips}>
                  <TouchableOpacity disabled={saving || retryPending} onPress={() => setPreferredRoomId('')} style={[styles.chip, !preferredRoomId && styles.chipSelected]} accessibilityRole="radio" accessibilityState={{ selected: !preferredRoomId }}>
                    <Text style={[styles.chipText, !preferredRoomId && styles.chipTextSelected]}>No specific room</Text>
                  </TouchableOpacity>
                  {matchingRooms.map((room) => {
                    const roomId = String(room.roomId || '');
                    if (!roomId) return null;
                    const selected = preferredRoomId === roomId;
                    return <TouchableOpacity key={roomId} disabled={saving || retryPending} onPress={() => setPreferredRoomId(roomId)} style={[styles.chip, selected && styles.chipSelected]} accessibilityRole="radio" accessibilityState={{ selected }}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{room.name || room.room_number || room.roomNumber || 'Room'}</Text></TouchableOpacity>;
                  })}
                </View>
                <Text style={styles.label}>Preferred transfer date</Text>
                <TextInput editable={!saving && !retryPending} value={preferredTransferDate} onChangeText={setPreferredTransferDate} style={styles.input} placeholder="YYYY-MM-DD (optional)" placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" />
                <Text style={styles.label}>Reason *</Text>
                <TextInput editable={!saving && !retryPending} value={reason} onChangeText={setReason} style={[styles.input, styles.textarea]} multiline maxLength={500} textAlignVertical="top" placeholder="Why would you like to transfer?" placeholderTextColor={colors.textMuted} />
                <Text style={styles.label}>Note (optional)</Text>
                <TextInput editable={!saving && !retryPending} value={note} onChangeText={setNote} style={[styles.input, styles.textareaSmall]} multiline maxLength={1000} textAlignVertical="top" placeholder="Anything else Admin should know" placeholderTextColor={colors.textMuted} />
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
  statusIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: c.selectionBg }, statusBody: { flex: 1, gap: 3 }, eyebrow: { color: c.textMuted, textTransform: 'uppercase', letterSpacing: .7, fontSize: 10, fontWeight: '800' },
  statusTitle: { color: c.text, fontSize: 17, fontWeight: '800' }, statusDetail: { color: c.textSecondary, fontSize: 13, lineHeight: 19 }, guidance: { color: c.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
  cancelButton: { paddingVertical: 7, paddingHorizontal: 10, borderWidth: 1, borderColor: c.border, borderRadius: 9 }, cancelText: { color: c.errorText, fontSize: 12, fontWeight: '800' },
  formCard: { padding: 18, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }, title: { color: c.text, fontSize: 20, fontWeight: '800' }, helper: { color: c.textSecondary, lineHeight: 20, marginTop: 5, marginBottom: 6 },
  label: { color: c.text, fontSize: 13, fontWeight: '700', marginTop: 14, marginBottom: 7 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border }, chipSelected: { borderColor: c.interactive, backgroundColor: c.selectionBg }, chipText: { color: c.textSecondary, fontWeight: '600' }, chipTextSelected: { color: c.selectionText },
  input: { color: c.text, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: c.inputBg || c.background }, textarea: { minHeight: 94 }, textareaSmall: { minHeight: 70 },
  notice: { marginTop: 15, padding: 12, borderRadius: 10, backgroundColor: c.infoBg, color: c.infoText, fontSize: 12, lineHeight: 18 }, error: { color: c.errorText, marginTop: 12, lineHeight: 19 }, errorBox: { color: c.errorText, padding: 14, borderRadius: 10, backgroundColor: c.surface },
  submit: { marginTop: 16, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: c.primary }, submitText: { color: '#fff', fontWeight: '800' }, disabled: { opacity: .6 },
});
