import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { apiService } from '../../services/api';
import { getChatErrorMessage } from '../../utils/chatErrorMessage';
import { newerSupportConcern } from '../../utils/supportConversationPresentation';

const UNKNOWN = 'We could not confirm whether your rating was saved. Check its status before submitting again.';
const uncertainRatings = new Set();
export function ratingErrorMessage(error) {
  const messages = {
    REQUEST_REQUIRED: 'This concern needs to be refreshed before rating.',
    REQUEST_MISMATCH: 'This concern needs to be refreshed before rating.',
    CONVERSATION_CHANGED: 'This concern needs to be refreshed before rating.',
    NOT_RESOLVED: 'You can rate this concern after an admin resolves it.',
    RESOLUTION_NOT_READY: 'You can rate this concern after an admin resolves it.',
    ALREADY_RATED: 'This support request has already been rated.',
    INVALID_RATING: 'Choose a whole-number rating from 1 to 5.',
    INVALID_FEEDBACK: 'Keep your feedback within 1,000 characters.',
  };
  if ([401, 403].includes(error?.response?.status)) return getChatErrorMessage(error);
  return messages[error?.response?.data?.code] || (error?.response?.status === 400
    ? 'Check your rating and feedback before submitting.' : 'We could not submit your rating. Please try again.');
}
function canonical(c) {
  return c?.request ? { ...c, ...c.request, id: c.id, requestId: c.request.id } : c;
}
const hasRating = (c) => Boolean(c?.satisfaction) || c?.satisfactionRating != null;
const same = (a, b) => a?.id === b?.id && a?.requestId === b?.requestId && a?.tenantUserId === b?.tenantUserId;
export default function SupportConcernRating(props) {
  const c = canonical(props.conversation);
  return <RatingForm key={JSON.stringify([props.userId, c?.id, c?.requestId])} {...props} conversation={c} />;
}
function RatingForm({ conversation, userId, onChange }) {
  const { colors } = useTheme();
  const [current, setCurrent] = useState(conversation);
  const [rating, setRating] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState(false);
  const [knownRated, setKnownRated] = useState(false);
  const identity = JSON.stringify([userId, conversation?.id, conversation?.requestId]);
  const [needsCheck, setNeedsCheck] = useState(() => uncertainRatings.has(identity));
  const [error, setError] = useState(() => uncertainRatings.has(identity) ? UNKNOWN : '');
  const guard = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setCurrent((old) => hasRating(old) ? old : newerSupportConcern(old, conversation));
  }, [conversation]);
  useEffect(() => { setConfirmed(false); setRating(0); setFeedback(''); }, [current?.resolvedAt]);
  const owned = Boolean(userId) && current?.tenantUserId === userId;
  const eligible = owned && typeof current?.requestId === 'string' && current.requestId.trim()
    && current.status === 'resolved' && Number.isFinite(Date.parse(current.resolvedAt))
    && current.resolvedBy && !hasRating(current) && !knownRated;
  const apply = (value) => {
    const saved = canonical(value);
    if (!saved || !same(current, saved) || Number(saved.revision || 0) < Number(current.revision || 0)) return null;
    if (saved.satisfaction?.requestId && saved.satisfaction.requestId !== current.requestId) return null;
    if (mounted.current) {
      setCurrent((old) => hasRating(old) ? old : newerSupportConcern(old, saved));
      // A parent presentation error must not turn persistence into a submit failure.
      try { onChange?.(saved); } catch (_) { /* Keep the local saved state. */ }
    }
    return saved;
  };
  const lock = () => { uncertainRatings.add(identity); if (mounted.current) setNeedsCheck(true); };
  const unlock = () => { uncertainRatings.delete(identity); if (mounted.current) setNeedsCheck(false); };
  const reconcile = async () => {
    try {
      const { data } = await apiService.getSupportChatMessages(current.id);
      const saved = apply(data?.conversation);
      if (!saved || (!hasRating(saved) && !Object.prototype.hasOwnProperty.call(saved, 'satisfactionRating'))) throw new Error('Unconfirmed state');
      unlock();
      if (mounted.current) setError(hasRating(saved) || saved.status !== 'resolved' ? '' : 'Your rating has not been saved. You can try again when this concern is eligible.');
      return saved;
    } catch (_) { lock(); if (mounted.current) setError(UNKNOWN); return null; }
  };
  const check = async () => {
    if (guard.current) return;
    guard.current = true; setPending(true);
    try { await reconcile(); } finally { guard.current = false; if (mounted.current) setPending(false); }
  };
  const submit = async () => {
    if (guard.current || needsCheck || !eligible || !confirmed || !Number.isInteger(rating) || rating < 1 || rating > 5) return;
    guard.current = true; setPending(true); setError(''); lock();
    try {
      const { data } = await apiService.rateSupportInquiry(current.id, { requestId: current.requestId, revision: current.revision, rating, feedback });
      const saved = apply(data?.conversation);
      if (saved && hasRating(saved)) unlock();
      else await reconcile();
    } catch (failure) {
      const status = failure?.response?.status;
      if (failure?.response?.data?.code === 'ALREADY_RATED' && mounted.current) setKnownRated(true);
      const ambiguous = !status || status >= 500 || status === 408;
      if (ambiguous || status === 409) {
        const saved = await reconcile();
        if (saved && !hasRating(saved) && !ambiguous && mounted.current) setError(ratingErrorMessage(failure));
      } else { unlock(); if (mounted.current) setError(ratingErrorMessage(failure)); }
    } finally { guard.current = false; if (mounted.current) setPending(false); }
  };
  const reopen = async () => {
    if (guard.current || needsCheck || !eligible) return;
    guard.current = true; setPending(true); setError(''); lock();
    try {
      const { data } = await apiService.reopenSupportChat(current.id, '', { requestId: current.requestId, revision: current.revision });
      const saved = apply(data?.conversation);
      if (saved && saved.status === 'open') { unlock(); if (mounted.current) setConfirmed(false); }
      else await reconcile();
    } catch (failure) {
      const status = failure?.response?.status;
      if (!status || status >= 500 || status === 408 || status === 409) {
        await reconcile();
      } else { unlock(); if (mounted.current) setError(getChatErrorMessage(failure, 'We could not reopen your inquiry. Please try again.')); }
    } finally { guard.current = false; if (mounted.current) setPending(false); }
  };
  if (!owned) return null;
  if (hasRating(current)) return (
    <View testID="support-rating-completed" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={{ color: colors.textPrimary }}>{(current.satisfaction?.rating ?? current.satisfactionRating) != null ? 'Your rating: ' + (current.satisfaction?.rating ?? current.satisfactionRating) + '/5' : 'Your rating has been submitted.'}</Text>
      {(current.satisfaction?.feedback || current.satisfactionFeedback) ? <Text style={{ color: colors.textSecondary }}>{current.satisfaction?.feedback || current.satisfactionFeedback}</Text> : null}
    </View>
  );
  if (!eligible && !needsCheck && !error) return null;
  return (
    <View testID={confirmed ? "support-rating-card" : "support-confirmation-card"} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {eligible && !confirmed ? <>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>Your concern has been marked as resolved.</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>{new Date(current.resolvedAt).toLocaleString()}</Text>
        {(current.resolutionNote || current.closingNote) ? <View style={[styles.note, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>Admin resolution note</Text>
          <Text style={[styles.description, { color: colors.textPrimary }]}>{current.resolutionNote || current.closingNote}</Text>
        </View> : null}
        <Text style={[styles.label, { color: colors.textPrimary }]}>Is your concern resolved?</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Yes, it's resolved" disabled={pending || needsCheck}
          style={[styles.button, { backgroundColor: colors.primary }, (pending || needsCheck) && styles.disabled]}
          accessibilityState={{ disabled: pending || needsCheck }} onPress={() => setConfirmed(true)}>
          <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Yes, It&apos;s Resolved</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="No, I still need help" disabled={pending || needsCheck}
          style={[styles.button, styles.secondary, { borderColor: colors.interactive }, (pending || needsCheck) && styles.disabled]}
          accessibilityState={{ disabled: pending || needsCheck }} onPress={reopen}>
          <Text style={[styles.buttonText, { color: colors.interactive }]}>{pending ? 'Reopening...' : 'No, I Still Need Help'}</Text>
        </Pressable>
      </> : null}
      {eligible && confirmed ? <>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>Rate your support experience</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>How satisfied are you with the support you received?</Text>
        <View style={styles.row}>
          {[1, 2, 3, 4, 5].map((value) => (
            <Pressable key={value} style={styles.star} disabled={pending || needsCheck} onPress={() => setRating(value)} accessibilityRole="button"
              accessibilityLabel={value + ' stars'} accessibilityState={{ selected: value === rating, disabled: pending || needsCheck }}>
              <Text style={{ color: colors.interactive, fontSize: 32 }}>{value <= rating ? '★' : '☆'}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.label, { color: colors.textPrimary }]}>Feedback (optional)</Text>
        <TextInput accessibilityLabel="Rating feedback" placeholder="Tell us about your experience" value={feedback}
          placeholderTextColor={colors.textSecondary} textAlignVertical="top"
          onChangeText={setFeedback} editable={!pending && !needsCheck} maxLength={1000} multiline
          style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]} />
        <Pressable accessibilityRole="button" accessibilityLabel="Submit rating" onPress={submit}
          style={[styles.button, { backgroundColor: colors.primary }, (pending || needsCheck || !rating) && styles.disabled]}
          disabled={pending || needsCheck || !rating} accessibilityState={{ disabled: pending || needsCheck || !rating }}>
          <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{pending ? 'Saving...' : 'Submit Rating'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to confirmation" disabled={pending || needsCheck}
          accessibilityState={{ disabled: pending || needsCheck }}
          style={[styles.button, styles.secondary, { borderColor: colors.interactive }, (pending || needsCheck) && styles.disabled]} onPress={() => setConfirmed(false)}>
          <Text style={[styles.buttonText, { color: colors.interactive }]}>Back</Text>
        </Pressable>
      </> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: colors.textPrimary }}>{error}</Text> : null}
      {needsCheck && !pending ? <Pressable accessibilityRole="button" accessibilityLabel="Check rating status" style={[styles.button, styles.secondary, { borderColor: colors.interactive }]} onPress={check}>
        <Text style={{ color: colors.interactive }}>Check rating status</Text>
      </Pressable> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  card: { gap: 12, padding: 16, borderWidth: 1, borderRadius: 12, width: '100%' },
  heading: { fontSize: 17, fontWeight: '700', flexShrink: 1 },
  description: { fontSize: 14, lineHeight: 21 },
  label: { fontSize: 14, fontWeight: '600' },
  note: { padding: 12, borderRadius: 8, gap: 6 },
  button: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  secondary: { borderWidth: 1 },
  disabled: { opacity: 0.5 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4 },
  star: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 96, maxHeight: 180, borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 15, lineHeight: 22 },
});
