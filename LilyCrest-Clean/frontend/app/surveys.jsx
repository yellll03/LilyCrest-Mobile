import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../src/context/ThemeContext';
import { useAuth } from '../src/context/AuthContext';
import { apiService } from '../src/services/api';
import { saveCachedSurveyDashboard } from '../src/services/surveyDrafts';
import { SURVEY_FEEDBACK_ENABLED } from '../src/config/features';
import { ScreenHeader, StatusBadge } from '../src/components/ui/LilycrestUI';

const LABELS = { QUARTERLY: 'Quarterly Survey', MOVE_OUT: 'Move-Out Survey' };
const RESPONSE_STATUS_LABELS = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  SUBMITTED: 'Submitted',
  EXPIRED: 'Expired',
};
const formatDate = (value) => value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Not available';

export default function SurveysScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuth();
  const tenantKey = user?.tenantId || user?.tenant_id || user?.user_id;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      setUnavailable(false);
      const response = await apiService.getMySurveys();
      const items = Array.isArray(response.data?.surveys) ? response.data.surveys : [];
      setSurveys(items);
      if (tenantKey) await saveCachedSurveyDashboard(tenantKey, items);
    } catch (err) {
      setSurveys([]);
      // A 404 here means the survey feature itself isn't offered by the
      // backend right now (not a transient network/server failure) - retrying
      // can never succeed, so show a calm "not available" state instead of
      // the alarming error card with a Retry button that would only ever fail.
      if (err?.response?.status === 404) setUnavailable(true);
      else setError('Unable to load surveys right now.');
    } finally { setLoading(false); }
  }, [tenantKey]);
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  useEffect(() => {
    // Defense in depth: the menu entry point is hidden, but a stale deep
    // link/notification or direct URL could still land here while the
    // feature is disabled for deployment testing.
    if (!SURVEY_FEEDBACK_ENABLED) router.replace('/(tabs)/profile');
  }, [router]);

  if (!SURVEY_FEEDBACK_ENABLED) return null;

  const available = surveys.filter((item) => item.tenantResponseStatus === 'NOT_STARTED' && item.status === 'ACTIVE');
  const inProgress = surveys.filter((item) => item.tenantResponseStatus === 'IN_PROGRESS' && item.status === 'ACTIVE');
  const submitted = surveys.filter((item) => item.tenantResponseStatus === 'SUBMITTED');
  const history = surveys.filter((item) => ['EXPIRED'].includes(item.tenantResponseStatus));

  const renderGroup = (title, items, emptyText) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {!items.length ? <Text style={styles.sectionEmpty}>{emptyText}</Text> : null}
      {items.map((survey) => (
        <View key={survey.surveyId} style={styles.card}>
          <View style={styles.cardTop}>
            <Ionicons name={survey.surveyType === 'MOVE_OUT' ? 'exit-outline' : 'star-outline'} size={22} color={colors.accent} />
            <View style={styles.flex}>
              <Text style={styles.title}>{survey.title}</Text>
              <Text style={styles.type}>{LABELS[survey.surveyType] || survey.surveyType}</Text>
            </View>
          </View>
          <Text style={styles.meta}>Available: {formatDate(survey.availableFrom)} – {formatDate(survey.availableUntil)}</Text>
          <Text style={styles.meta}>Due: {formatDate(survey.availableUntil)}</Text>
          <Text style={styles.meta}>Estimated Time: 2–3 minutes</Text>
          <View style={styles.status}><StatusBadge status={survey.tenantResponseStatus} label={RESPONSE_STATUS_LABELS[survey.tenantResponseStatus] || 'Unavailable'} /></View>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push({ pathname: '/survey-form', params: { surveyId: survey.surveyId, responseStatus: survey.tenantResponseStatus } })}
          >
            <Text style={styles.buttonText}>{survey.tenantResponseStatus === 'SUBMITTED' ? 'View Response' : survey.tenantResponseStatus === 'IN_PROGRESS' ? 'Continue Survey' : 'Start Survey'}</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader strong title="Survey and Feedback" subtitle="Tenant experience records" onBack={() => router.back()} />
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.helper}>Loading surveys…</Text></View> : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
          {unavailable ? (
            <View style={styles.empty}>
              <Ionicons name="chatbox-ellipses-outline" size={40} color={colors.textMuted} />
              <Text style={styles.title}>Surveys are not available at this time.</Text>
              <Text style={styles.helper}>Check back later, or contact the admin office if you have feedback to share now.</Text>
            </View>
          ) : error ? (
            <View style={styles.errorState}>
              <Ionicons name="cloud-offline-outline" size={40} color="#991B1B" />
              <Text style={styles.error}>{error}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => { setLoading(true); load(); }}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : !surveys.length ? (
            <View style={styles.empty}>
              <Ionicons name="chatbox-ellipses-outline" size={40} color={colors.textMuted} />
              <Text style={styles.title}>No survey is available right now.</Text>
              <Text style={styles.helper}>Your move-out survey will become available once your move-out is officially approved or your stay is completed.</Text>
            </View>
          ) : (
            <>
              {renderGroup('Available', available, 'No survey is available right now.')}
              {renderGroup('In Progress', inProgress, 'You have no surveys in progress.')}
              {renderGroup('Submitted', submitted, 'You have no submitted surveys yet.')}
              {renderGroup('History', history, 'You have no survey history yet.')}
              <Text style={styles.moveOutHelper}>Your move-out survey will become available once your move-out is officially approved or your stay is completed.</Text>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const createStyles = (c) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  content: { padding: 18, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  section: { marginBottom: 18 }, sectionTitle: { color: c.text, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  sectionEmpty: { color: c.textSecondary, backgroundColor: c.surface, borderRadius: 12, padding: 14, lineHeight: 20 },
  card: { backgroundColor: c.surface, padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: c.border },
  cardTop: { flexDirection: 'row', gap: 12 }, flex: { flex: 1 },
  title: { color: c.text, fontSize: 16, fontWeight: '700' }, type: { color: c.textSecondary, marginTop: 3 },
  meta: { color: c.textSecondary, marginTop: 9, fontSize: 13 }, status: { marginTop: 10 },
  button: { backgroundColor: c.primary, padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 12 },
  buttonText: { color: '#fff', fontWeight: '800' }, helper: { color: c.textSecondary, textAlign: 'center', marginTop: 10, lineHeight: 20 },
  empty: { alignItems: 'center', padding: 30, backgroundColor: c.surface, borderRadius: 12, gap: 10, borderWidth: 1, borderColor: c.border },
  errorState: { alignItems: 'center', padding: 30, backgroundColor: '#FEF2F2', borderRadius: 12, gap: 12, borderWidth: 1, borderColor: '#DC2626' },
  error: { color: '#991B1B', textAlign: 'center', fontWeight: '700' },
  retryButton: { backgroundColor: '#991B1B', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 24 },
  retryText: { color: '#fff', fontWeight: '800' },
  moveOutHelper: { color: c.textSecondary, lineHeight: 20, marginBottom: 18 },
});
