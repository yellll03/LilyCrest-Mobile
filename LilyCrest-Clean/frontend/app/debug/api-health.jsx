import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_BASE_URL, MOBILE_API_BASE_URL } from '../../src/config/api';
import { useTheme } from '../../src/context/ThemeContext';
import { runFullApiDiagnostics } from '../../src/utils/mobileDiagnostics';
import { safeBack } from '../../src/utils/navigation';

function formatBody(body) {
  if (body == null || body === '') return 'No response body';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body, null, 2);
  } catch (_) {
    return String(body);
  }
}

function statusColor(result) {
  if (result.skipped) return '#4B5563';
  if (result.ok) return '#065F46';
  if (result.status === 401) return '#92400E';
  if (result.status === 404) return '#DC2626';
  if (result.status >= 500) return '#DC2626';
  if (result.status == null) return '#DC2626';
  return '#334155';
}

function resultTitle(result) {
  if (result.skipped) return 'SKIPPED';
  if (result.ok) return `OK ${result.status}`;
  if (result.status) return `HTTP ${result.status}`;
  return 'NETWORK ERROR';
}

export default function ApiHealthDebugScreen() {
  const router = useRouter();
  const { colors, isDarkMode } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDarkMode), [colors, isDarkMode]);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState(null);

  const runDiagnostics = useCallback(async () => {
    if (running) return;
    setRunning(true);
    try {
      const nextResults = await runFullApiDiagnostics();
      setResults(nextResults);
      setLastRunAt(new Date().toLocaleTimeString());
    } catch (error) {
      setResults([{
        testName: 'Diagnostics runner failed',
        ok: false,
        status: null,
        errorName: error?.name,
        errorMessage: error?.message,
        errorCode: error?.code,
        transport: 'diagnostics-runner',
        platform: Platform.OS,
        resolvedBaseURL: API_BASE_URL,
        mobileApiBaseURL: MOBILE_API_BASE_URL,
      }]);
    } finally {
      setRunning(false);
    }
  }, [running]);

  useEffect(() => {
    runDiagnostics();
    // Run once when the debug route opens; the button can re-run after login/reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // This screen dumps live API base URLs, auth-token presence, and raw
    // response bodies. It must never be reachable in a production build,
    // regardless of how the route is entered (deep link, direct URL, stale
    // notification) — the login-screen entry button being __DEV__-gated is
    // not enough on its own since Expo Router still registers the route.
    if (!__DEV__) router.replace('/login');
  }, [router]);

  if (!__DEV__) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => safeBack(router, '/login')}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>API Diagnostics</Text>
          <Text style={styles.subtitle}>Dev-only Android connectivity checks</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Resolved API base URL</Text>
          <Text style={styles.mono}>{API_BASE_URL}</Text>
          <Text style={styles.summaryLabel}>Mobile API base URL</Text>
          <Text style={styles.mono}>{MOBILE_API_BASE_URL}</Text>
          <Text style={styles.summaryLabel}>Platform</Text>
          <Text style={styles.mono}>{Platform.OS}</Text>
          {lastRunAt ? <Text style={styles.lastRun}>Last run: {lastRunAt}</Text> : null}
        </View>

        <TouchableOpacity
          style={[styles.runButton, running && styles.runButtonDisabled]}
          onPress={runDiagnostics}
          disabled={running}
        >
          {running ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="pulse" size={19} color="#FFFFFF" />
              <Text style={styles.runButtonText}>Run API Diagnostics</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          Console markers: API_DIAGNOSTICS_START, API_DIAGNOSTICS_RESULT, API_DIAGNOSTICS_END.
        </Text>

        {results.map((result, index) => (
          <View key={`${result.testName}-${index}`} style={styles.resultCard}>
            <View style={styles.resultHeader}>
              <Text style={styles.resultName}>{result.testName}</Text>
              <Text style={[styles.resultStatus, { color: statusColor(result) }]}>
                {resultTitle(result)}
              </Text>
            </View>

            <Text style={styles.metaLine}>Transport: {result.transport || 'unknown'}</Text>
            <Text style={styles.metaLine}>Method: {result.method || 'GET'}</Text>
            <Text style={styles.metaLine}>URL: {result.fullURL || 'unknown'}</Text>
            <Text style={styles.metaLine}>Timeout: {result.timeout || 'unknown'}ms</Text>
            <Text style={styles.metaLine}>Metro: {result.metroHost || 'unknown'} / port {result.metroPort || 'unknown'}</Text>
            <Text style={styles.metaLine}>Firebase user: {result.hasFirebaseUser ? 'yes' : 'no'}</Text>
            <Text style={styles.metaLine}>ID token available: {result.hasIdToken ? 'yes' : 'no'}</Text>
            <Text style={styles.metaLine}>error.name: {result.errorName || 'none'}</Text>
            <Text style={styles.metaLine}>error.message: {result.errorMessage || 'none'}</Text>
            <Text style={styles.metaLine}>error.code: {result.errorCode || 'none'}</Text>
            <Text style={styles.metaLine}>error.response exists: {result.hasResponse ? 'yes' : 'no'}</Text>
            <Text style={styles.metaLine}>error.request exists: {result.hasRequest ? 'yes' : 'no'}</Text>
            {result.reason ? <Text style={styles.reason}>Reason: {result.reason}</Text> : null}

            <Text style={styles.bodyLabel}>Response body</Text>
            <Text style={styles.bodyText}>{formatBody(result.body)}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors, isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  summaryCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
  },
  summaryLabel: {
    marginTop: 8,
    marginBottom: 4,
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  mono: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  lastRun: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  runButton: {
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  runButtonDisabled: {
    opacity: 0.6,
  },
  runButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
    marginBottom: 14,
  },
  resultCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  resultName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  resultStatus: {
    fontSize: 12,
    fontWeight: '900',
  },
  metaLine: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  reason: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: '#92400E',
    fontWeight: '700',
  },
  bodyLabel: {
    marginTop: 10,
    marginBottom: 4,
    fontSize: 12,
    fontWeight: '900',
    color: colors.text,
  },
  bodyText: {
    padding: 10,
    borderRadius: 8,
    fontSize: 11,
    lineHeight: 16,
    color: colors.text,
    backgroundColor: isDarkMode ? 'rgba(15,23,42,0.6)' : '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
  },
});
