import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

const KIND_LABELS = { pdf: 'PDF', jpg: 'JPEG', png: 'PNG' };

export default function DocumentViewer() {
  const router = useRouter();
  const pdfRef = useRef(null);
  const { kind = 'policy', id, title = 'Document', cacheKey, version } = useLocalSearchParams();
  const { user } = useAuth();
  const { colors } = useTheme();
  const [uri, setUri] = useState(null);
  const [extension, setExtension] = useState('pdf');
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [fileSize, setFileSize] = useState(0);
  const userId = user?.id || user?._id || user?.user_id || user?.email;
  // A signed contract scan may be uploaded as a PDF or as a JPG/JPEG/PNG image
  // (see CONTRACT_MOBILE_DISPLAY_WORKFLOW.md — the standard wet-signed path
  // accepts any of those) — the viewer must render whichever the backend
  // actually served instead of assuming every "current document" is a PDF.
  const isImage = extension === 'jpg' || extension === 'png';

  const load = useCallback(async (force = false) => {
    setLoading(true); setError(''); setProgress(0); setPage(1); setPages(0);
    try {
      const cached = !force && await getCachedPdf(userId, kind, id, cacheKey);
      if (cached) {
        setUri(cached.uri);
        setExtension(cached.extension || 'pdf');
        setFileSize((await getPdfMetadata(cached.uri)).size);
      }
      else {
        const result = await fetchPdf({ userId, kind, id, cacheKey, extra: version, onProgress: setProgress });
        setUri(result.uri);
        setExtension(result.extension || 'pdf');
        setFileSize(result.size || 0);
      }
    } catch (e) {
      setUri(null);
      setError(documentErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id, kind, userId, cacheKey, version]);

  useEffect(() => { load(); }, [load]);
  const go = (next) => { const value = Math.max(1, Math.min(pages, next)); pdfRef.current?.setPage(value); };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.headerAction} onPress={() => safeBack(router)} accessibilityLabel="Back"><Ionicons name="arrow-back" size={25} color={colors.heading} /></TouchableOpacity>
        <View style={styles.heading}><Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>{title}</Text>
          {!!uri && <Text style={[styles.meta, { color: colors.textSecondary }]}>{KIND_LABELS[extension] || 'Document'} · {fileSize ? `${formatFileSize(fileSize)}` : ''}{!isImage && pages ? ` · ${pages} page${pages === 1 ? '' : 's'}` : ''}</Text>}
        </View>
        <TouchableOpacity style={styles.headerAction} disabled={!uri} accessibilityLabel="Download document" onPress={async () => { try { const saved = await downloadPdf(uri, title); Alert.alert('Download complete', `${saved.filename} was saved.`); } catch (e) { Alert.alert('Download unavailable', documentErrorMessage(e)); } }}>
          <Ionicons name="download-outline" size={24} color={uri ? colors.heading : colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerAction} disabled={!uri || isImage} accessibilityLabel="Print document" onPress={async () => { try { await Print.printAsync({ uri }); } catch (e) { Alert.alert('Print unavailable', documentErrorMessage(e)); } }}>
          <Ionicons name="print-outline" size={24} color={uri && !isImage ? colors.heading : colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerAction} disabled={!uri} accessibilityLabel="Share document" onPress={async () => { try { await sharePdf(uri, title); } catch (e) { Alert.alert('Share unavailable', documentErrorMessage(e)); } }}>
          <Ionicons name="share-outline" size={24} color={uri ? colors.heading : colors.textSecondary} />
        </TouchableOpacity>
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.interactive} /><Text style={{ color: colors.textSecondary }}>Loading document… {progress ? `${Math.round(progress * 100)}%` : ''}</Text></View>
      : error ? <View style={styles.center}><Ionicons name="document-outline" size={54} color={colors.textSecondary} /><Text style={[styles.error, { color: colors.text }]}>{error}</Text><TouchableOpacity style={[styles.retry, { backgroundColor: colors.primary }]} onPress={() => load(true)}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></View>
      : Platform.OS === 'web' ? <View style={styles.center}><Text style={{ color: colors.text }}>Download this document to view it in your browser.</Text></View>
      : isImage ? (
        <ScrollView style={styles.pdf} contentContainerStyle={styles.imageScrollContent} minimumZoomScale={1} maximumZoomScale={4} centerContent>
          <Image
            source={{ uri }}
            style={styles.image}
            resizeMode="contain"
            onError={() => setError(documentErrorMessage(new Error('INVALID_PDF')))}
          />
        </ScrollView>
      ) : (
        <Pdf ref={pdfRef} source={{ uri, cache: false }} style={styles.pdf} minScale={1} maxScale={5} spacing={8}
          onLoadComplete={(count) => setPages(count)} onPageChanged={setPage}
          onError={(e) => { setError(documentErrorMessage(e)); setUri(null); }} />
      )}
      {!isImage && !!uri && pages > 0 && <View style={[styles.controls, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity disabled={page <= 1} onPress={() => go(page - 1)}><Ionicons name="chevron-back" size={26} color={page <= 1 ? colors.border : colors.text} /></TouchableOpacity>
        <Text style={{ color: colors.text }}>Page {page} of {pages}</Text>
        <TouchableOpacity disabled={page >= pages} onPress={() => go(page + 1)}><Ionicons name="chevron-forward" size={26} color={page >= pages ? colors.border : colors.text} /></TouchableOpacity>
      </View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 }, header: { minHeight: 64, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1 }, title: { fontSize: 17, fontWeight: '700' }, meta: { fontSize: 12, marginTop: 2 },
  pdf: { flex: 1, width: '100%', backgroundColor: '#F1F5F9' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28 },
  imageScrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%', minHeight: 400 },
  error: { textAlign: 'center', fontSize: 16, lineHeight: 23 }, retry: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }, retryText: { color: '#fff', fontWeight: '700' },
  controls: { position: 'absolute', bottom: 22, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 22, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, elevation: 3 },
});
