import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Print from 'expo-print';
import Pdf from 'react-native-pdf';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/context/AuthContext';
import { useTheme } from '../src/context/ThemeContext';
import { documentErrorMessage, downloadPdf, fetchPdf, getCachedPdf, getPdfMetadata, sharePdf } from '../src/services/documentManager';
import { safeBack } from '../src/utils/navigation';

function formatFileSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function DocumentViewer() {
  const router = useRouter();
  const pdfRef = useRef(null);
  const { kind = 'policy', id, cacheKey = id, title = 'Document' } = useLocalSearchParams();
  const { user } = useAuth();
  const { colors } = useTheme();
  const [uri, setUri] = useState(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [fileSize, setFileSize] = useState(0);
  const userId = user?.id || user?._id || user?.user_id || user?.email;

  const load = useCallback(async (force = false) => {
    setLoading(true); setError(''); setProgress(0);
    try {
      const cached = !force && await getCachedPdf(userId, kind, id, cacheKey);
      if (cached) {
        setUri(cached);
        setFileSize((await getPdfMetadata(cached)).size);
      }
      else {
        const result = await fetchPdf({ userId, kind, id, cacheKey, onProgress: setProgress });
        setUri(result.uri);
        setFileSize(result.size || 0);
      }
    } catch (e) {
      setUri(null);
      setError(documentErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [cacheKey, id, kind, userId]);

  useEffect(() => { load(); }, [load]);
  const go = (next) => { const value = Math.max(1, Math.min(pages, next)); pdfRef.current?.setPage(value); };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => safeBack(router)} accessibilityLabel="Back"><Ionicons name="arrow-back" size={25} color={colors.text} /></TouchableOpacity>
        <View style={styles.heading}><Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>{title}</Text>
          {!!uri && <Text style={[styles.meta, { color: colors.textSecondary }]}>PDF · {fileSize ? `${formatFileSize(fileSize)} · ` : ''}{pages ? `${pages} page${pages === 1 ? '' : 's'}` : 'Checking pages'}</Text>}
        </View>
        <TouchableOpacity disabled={!uri} accessibilityLabel="Download PDF" onPress={async () => { try { const saved = await downloadPdf(uri, title); Alert.alert('Download complete', `${saved.filename} was saved.`); } catch (e) { Alert.alert('Download unavailable', documentErrorMessage(e)); } }}>
          <Ionicons name="download-outline" size={24} color={uri ? colors.primary : colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity disabled={!uri} accessibilityLabel="Print PDF" onPress={async () => { try { await Print.printAsync({ uri }); } catch (e) { Alert.alert('Print unavailable', documentErrorMessage(e)); } }}>
          <Ionicons name="print-outline" size={24} color={uri ? colors.primary : colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity disabled={!uri} accessibilityLabel="Share PDF" onPress={async () => { try { await sharePdf(uri, title); } catch (e) { Alert.alert('Share unavailable', documentErrorMessage(e)); } }}>
          <Ionicons name="share-outline" size={24} color={uri ? colors.primary : colors.textSecondary} />
        </TouchableOpacity>
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /><Text style={{ color: colors.textSecondary }}>Loading PDF… {progress ? `${Math.round(progress * 100)}%` : ''}</Text></View>
      : error ? <View style={styles.center}><Ionicons name="document-outline" size={54} color={colors.textSecondary} /><Text style={[styles.error, { color: colors.text }]}>{error}</Text><TouchableOpacity style={[styles.retry, { backgroundColor: colors.primary }]} onPress={() => load(true)}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></View>
      : Platform.OS === 'web' ? <View style={styles.center}><Text style={{ color: colors.text }}>Download this PDF to view it in your browser.</Text></View>
      : <Pdf ref={pdfRef} source={{ uri, cache: false }} style={styles.pdf} minScale={1} maxScale={5} spacing={8}
          onLoadComplete={(count) => setPages(count)} onPageChanged={setPage}
          onError={(e) => { setError(documentErrorMessage(e)); setUri(null); }} />}
      {!!uri && pages > 0 && <View style={[styles.controls, { backgroundColor: colors.card }]}>
        <TouchableOpacity disabled={page <= 1} onPress={() => go(page - 1)}><Ionicons name="chevron-back" size={26} color={page <= 1 ? colors.border : colors.text} /></TouchableOpacity>
        <Text style={{ color: colors.text }}>Page {page} of {pages}</Text>
        <TouchableOpacity disabled={page >= pages} onPress={() => go(page + 1)}><Ionicons name="chevron-forward" size={26} color={page >= pages ? colors.border : colors.text} /></TouchableOpacity>
      </View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 }, header: { minHeight: 62, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 14 },
  heading: { flex: 1 }, title: { fontSize: 17, fontWeight: '700' }, meta: { fontSize: 12, marginTop: 2 },
  pdf: { flex: 1, width: '100%', backgroundColor: '#e9edf2' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28 },
  error: { textAlign: 'center', fontSize: 16, lineHeight: 23 }, retry: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 }, retryText: { color: '#fff', fontWeight: '700' },
  controls: { position: 'absolute', bottom: 22, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 22, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24, elevation: 5 },
});
