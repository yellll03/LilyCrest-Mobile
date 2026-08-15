import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/context/AuthContext';
import { useTheme } from '../src/context/ThemeContext';
import { apiService, isNetworkOrColdStartError } from '../src/services/api';
import { answersObjectToArray, clearSurveyDraft, loadCachedSurvey, loadSurveyDraft, saveCachedSurvey, saveSurveyDraftLocal } from '../src/services/surveyDrafts';
import { firstInvalidQuestionId, safeSurveyErrorMessage, toAnswerObject, validateSurveyAnswers, visibleSurveyQuestions } from '../src/utils/surveyForm';
import { SURVEY_FEEDBACK_ENABLED } from '../src/config/features';

const CHOICE_LABELS = {
  YES: 'Yes', NO: 'No', MAYBE: 'Maybe', CONTRACT_COMPLETED: 'Contract completed',
  TRANSFERRED_LOCATION: 'Transferred location', WORK_OR_SCHOOL_CHANGE: 'Work or school change',
  FINANCIAL_REASON: 'Financial reason', ROOM_OR_FACILITY_CONCERN: 'Room or facility concern',
  SERVICE_CONCERN: 'Service concern', PERSONAL_REASON: 'Personal reason', OTHER: 'Other',
};
const RATING_LABELS = ['Very Dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very Satisfied'];

export default function SurveyFormScreen() {
  const { surveyId, responseStatus } = useLocalSearchParams();
  const readOnlyRequested = responseStatus === 'SUBMITTED';
  const router = useRouter();
  const { user } = useAuth();
  const tenantKey = user?.tenantId || user?.tenant_id || user?.user_id;
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [survey, setSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [readOnly, setReadOnly] = useState(readOnlyRequested);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [submittedAt, setSubmittedAt] = useState(null);
  const hydrated = useRef(false);
  const scrollRef = useRef(null);
  const questionPositions = useRef({});
  const confirmationOpen = useRef(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [local, cached] = await Promise.all([
        !readOnlyRequested && tenantKey ? loadSurveyDraft(tenantKey, surveyId) : null,
        tenantKey ? loadCachedSurvey(tenantKey, surveyId) : null,
      ]);
      if (active && cached) {
        setSurvey(cached);
        setAnswers(local?.answers || {});
        setLoading(false);
      }
      try {
        let response;
        let responseMode = readOnlyRequested;
        try {
          response = readOnlyRequested
            ? await apiService.getMySurveyResponse(surveyId)
            : await apiService.getMySurvey(surveyId);
        } catch (initialError) {
          if (readOnlyRequested || isNetworkOrColdStartError(initialError)) throw initialError;
          response = await apiService.getMySurveyResponse(surveyId);
          responseMode = true;
        }
        if (!active) return;
        const payloadSurvey = responseMode ? response.data.survey : response.data;
        // A 200 response with a missing/malformed survey body (no crash, but
        // nothing usable to render) must still surface a message — otherwise
        // the `!survey` branch below renders with an empty `message` and the
        // screen looks blank/broken instead of failing safely.
        if (!payloadSurvey || typeof payloadSurvey !== 'object' || !payloadSurvey.surveyId || !payloadSurvey.title) {
          throw new Error('Malformed survey response');
        }
        const remoteResponse = responseMode ? response.data.response : response.data.response;
        setSurvey(payloadSurvey);
        setAnswers(local?.answers || toAnswerObject(remoteResponse?.answers));
        setReadOnly(remoteResponse?.status === 'SUBMITTED' || responseMode);
        setSubmittedAt(remoteResponse?.submittedAt || null);
        if (tenantKey) await saveCachedSurvey(tenantKey, surveyId, payloadSurvey);
      } catch (error) {
        setMessage(cached && isNetworkOrColdStartError(error)
          ? 'You are offline. Your saved draft is available and will remain on this device.'
          : safeSurveyErrorMessage(error, 'This survey is not available right now.'));
      } finally { hydrated.current = true; setLoading(false); }
    })();
    return () => { active = false; };
  }, [readOnlyRequested, surveyId, tenantKey]);

  useEffect(() => {
    if (!hydrated.current || readOnly || !tenantKey || !surveyId) return undefined;
    const timer = setTimeout(() => saveSurveyDraftLocal(tenantKey, surveyId, answers).catch(() => {}), 400);
    return () => clearTimeout(timer);
  }, [answers, readOnly, surveyId, tenantKey]);

  useEffect(() => {
    // Defense in depth: notification payloads/deep links captured before the
    // feature was hidden could still point here.
    if (!SURVEY_FEEDBACK_ENABLED) router.replace('/(tabs)/profile');
  }, [router]);

  if (!SURVEY_FEEDBACK_ENABLED) return null;

  const setAnswer = (questionId, value) => {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    setErrors((current) => ({ ...current, [questionId]: '' }));
  };

  const saveDraft = async () => {
    setSaving(true); setMessage('');
    try {
      await apiService.saveSurveyDraft(surveyId, answersObjectToArray(answers));
      setMessage('Draft saved.');
    } catch (error) { setMessage(safeSurveyErrorMessage(error, 'Unable to save your draft.')); }
    finally { setSaving(false); }
  };

  const submit = async () => {
    if (saving || confirmationOpen.current) return;
    const validation = validateSurveyAnswers(survey, answers);
    setErrors(validation);
    if (Object.keys(validation).length) {
      const firstId = firstInvalidQuestionId(survey, answers);
      const y = questionPositions.current[firstId];
      if (Number.isFinite(y)) requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(y - 16, 0), animated: true }));
      return;
    }
    confirmationOpen.current = true;
    Alert.alert('Submit Survey?', 'You will not be able to edit your answers after submission.', [
      { text: 'Cancel', style: 'cancel', onPress: () => { confirmationOpen.current = false; } },
      {
        text: 'Submit', onPress: async () => {
          confirmationOpen.current = false;
          if (saving) return;
          setSaving(true); setMessage('');
          try {
            await apiService.submitSurvey(surveyId, answersObjectToArray(answers));
            await clearSurveyDraft(tenantKey, surveyId);
            setReadOnly(true);
            setSubmittedAt(new Date().toISOString());
            Alert.alert('Thank you', 'Thank you for sharing your feedback.', [{ text: 'Done', onPress: () => router.replace('/surveys') }]);
          } catch (error) {
            setErrors(error?.response?.data?.fields || {});
            setMessage(isNetworkOrColdStartError(error)
              ? 'Unable to submit your survey. Please check your connection and try again.'
              : safeSurveyErrorMessage(error, 'Something went wrong while submitting your survey. Please try again later.'));
          } finally { setSaving(false); }
        },
      },
    ], { onDismiss: () => { confirmationOpen.current = false; } });
  };

  const renderQuestion = (question) => {
    const value = answers[question.questionId];
    const disabled = readOnly;
    if (question.questionId === 'MOVE_OUT_REASON_OTHER' && answers.MOVE_OUT_REASON !== 'OTHER') return null;
    return (
      <View
        key={question.questionId}
        style={[styles.question, errors[question.questionId] && styles.questionInvalid]}
        onLayout={(event) => { questionPositions.current[question.questionId] = event.nativeEvent.layout.y; }}
      >
        <Text style={styles.prompt}>{question.questionId === 'FEEDBACK' ? 'Additional Feedback' : question.prompt}{question.required ? ' *' : ''}</Text>
        {question.questionId === 'OVERALL_SATISFACTION' ? <Text style={styles.questionHelper}>How satisfied are you with your stay at LilyCrest?</Text> : null}
        {question.questionId === 'FEEDBACK' ? <Text style={styles.questionHelper}>May gusto ka pa bang i-share para mas mapaganda namin ang service?</Text> : null}
        {question.type === 'RATING' ? (
          <>
            <View style={styles.ratingRow}>{[1, 2, 3, 4, 5].map((rating) => (
              <TouchableOpacity key={rating} disabled={disabled} onPress={() => setAnswer(question.questionId, rating)} style={[styles.rating, value === rating && styles.selected]} accessibilityRole="radio" accessibilityState={{ selected: value === rating, disabled }} accessibilityLabel={`${question.prompt}: ${rating}, ${RATING_LABELS[rating - 1]}`}>
                <Text style={[styles.ratingText, value === rating && styles.selectedText]}>{rating}</Text>
              </TouchableOpacity>
            ))}</View>
            {value ? <Text style={styles.ratingMeaning}>{RATING_LABELS[value - 1]}</Text> : null}
          </>
        ) : question.type === 'SINGLE_CHOICE' ? (
          <View style={styles.choices}>{(question.options || []).map((option) => (
            <TouchableOpacity key={option} disabled={disabled} onPress={() => setAnswer(question.questionId, option)} style={[styles.choice, value === option && styles.selected]} accessibilityRole="radio" accessibilityState={{ selected: value === option, disabled }}>
              <Text style={[styles.choiceText, value === option && styles.selectedText]}>{CHOICE_LABELS[option] || option}</Text>
            </TouchableOpacity>
          ))}</View>
        ) : (
          <TextInput
            editable={!disabled} multiline value={String(value || '')}
            maxLength={question.maxLength || undefined}
            onChangeText={(text) => setAnswer(question.questionId, text)}
            style={[styles.input, disabled && styles.disabled]}
            placeholder="Type your answer here" placeholderTextColor={colors.textMuted}
            accessibilityLabel={question.prompt}
          />
        )}
        {question.maxLength ? <Text style={styles.count}>{String(value || '').length}/{question.maxLength}</Text> : null}
        {errors[question.questionId] ? <Text style={styles.error}>{errors[question.questionId]}</Text> : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><TouchableOpacity onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={colors.text} /></TouchableOpacity><Text style={styles.headerTitle}>{readOnly ? 'Survey Response' : 'Complete Survey'}</Text><View style={{ width: 24 }} /></View>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View> : !survey ? <View style={styles.center}><Text style={styles.error}>{message}</Text></View> : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={styles.title}>{survey.title}</Text><Text style={styles.description}>{survey.description}</Text>
          <Text style={styles.surveyType}>{survey.surveyType === 'MOVE_OUT' ? 'Move-Out Feedback' : 'Quarterly Satisfaction'}</Text>
          {readOnly && submittedAt ? <Text style={styles.submittedDate}>Submitted {new Date(submittedAt).toLocaleDateString()}</Text> : null}
          {readOnly && <View style={styles.readOnly}><Ionicons name="lock-closed" color={colors.accent} size={18} /><Text style={styles.readOnlyText}>Submitted responses are read-only.</Text></View>}
          {message ? <Text style={message === 'Draft saved.' ? styles.success : styles.errorBox}>{message}</Text> : null}
          {[...visibleSurveyQuestions(survey, answers)].sort((a, b) => a.order - b.order).map(renderQuestion)}
          {!readOnly && <View style={styles.actions}><TouchableOpacity disabled={saving} accessibilityRole="button" style={[styles.secondaryButton, saving && styles.buttonDisabled]} onPress={saveDraft}><Text style={styles.secondaryText}>Save Draft</Text></TouchableOpacity><TouchableOpacity disabled={saving} accessibilityRole="button" style={[styles.primaryButton, saving && styles.buttonDisabled]} onPress={submit}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Submit Survey</Text>}</TouchableOpacity></View>}
        </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const createStyles = (c) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background }, flex: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, borderBottomWidth: 1, borderBottomColor: c.border },
  headerTitle: { color: c.text, fontSize: 19, fontWeight: '800' }, content: { padding: 18, paddingBottom: 50 },
  title: { color: c.text, fontSize: 23, fontWeight: '800' }, description: { color: c.textSecondary, marginTop: 7, lineHeight: 21 },
  surveyType: { color: c.accent, fontWeight: '800', marginTop: 10 }, submittedDate: { color: c.textSecondary, marginTop: 6 },
  question: { marginTop: 18, padding: 16, borderRadius: 15, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  questionInvalid: { borderColor: '#DC2626', borderWidth: 1.5 },
  prompt: { color: c.text, fontSize: 16, fontWeight: '700', lineHeight: 22 }, questionHelper: { color: c.textSecondary, lineHeight: 20, marginTop: 5 },
  ratingRow: { flexDirection: 'row', gap: 6, marginTop: 14, justifyContent: 'space-between' },
  rating: { flex: 1, minWidth: 44, minHeight: 48, maxWidth: 58, borderRadius: 12, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  ratingText: { color: c.text, fontWeight: '800' }, selected: { backgroundColor: c.accent, borderColor: c.accent }, selectedText: { color: '#fff' },
  ratingMeaning: { color: c.textSecondary, marginTop: 8 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  choice: { paddingVertical: 10, paddingHorizontal: 13, borderRadius: 10, borderWidth: 1, borderColor: c.border },
  choiceText: { color: c.text, fontWeight: '600' }, input: { color: c.text, minHeight: 100, marginTop: 12, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 12, textAlignVertical: 'top' },
  disabled: { opacity: 0.75 }, count: { color: c.textMuted, textAlign: 'right', marginTop: 5, fontSize: 12 },
  error: { color: '#B91C1C', marginTop: 7 }, errorBox: { color: '#B91C1C', backgroundColor: '#FEE2E2', padding: 12, borderRadius: 10, marginTop: 14 },
  success: { color: '#166534', backgroundColor: '#DCFCE7', padding: 12, borderRadius: 10, marginTop: 14 },
  readOnly: { flexDirection: 'row', gap: 8, backgroundColor: c.surface, padding: 12, borderRadius: 10, marginTop: 14 }, readOnlyText: { color: c.textSecondary, flex: 1 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 22 }, secondaryButton: { flex: 1, padding: 14, borderRadius: 11, borderWidth: 1, borderColor: c.accent, alignItems: 'center' },
  primaryButton: { flex: 1, padding: 14, borderRadius: 11, backgroundColor: c.accent, alignItems: 'center' }, secondaryText: { color: c.accent, fontWeight: '800' }, primaryText: { color: '#fff', fontWeight: '800' },
  buttonDisabled: { opacity: 0.6 },
});
