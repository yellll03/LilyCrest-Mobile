import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/context/AuthContext';
import { useTheme } from '../src/context/ThemeContext';
import {
  downloadImage,
  fetchTenantImage,
  imageDocumentErrorMessage,
  printImage,
  shareImage,
} from '../src/services/imageDocumentManager';
import { safeBack } from '../src/utils/navigation';

export default function ImageViewer() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();
  const { id, title = 'Document' } = useLocalSearchParams();
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [mimeType, setMimeType] = useState('image/jpeg');
  const userId = user?.user_id || user?.id || user?._id || user?.email;

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setProgress(0);
    setError('');
    try {
      const result = await fetchTenantImage({ userId, id, force, onProgress: setProgress });
      setSource({ uri: result.uri });
      if (result.mimeType) setMimeType(result.mimeType);
    } catch (loadError) {
      setSource(null);
      setError(imageDocumentErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [id, userId]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: '#1E293B' }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack(router)} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={25} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <TouchableOpacity disabled={!source} accessibilityLabel="Download image" onPress={async () => { try { const saved = await downloadImage(source.uri, title, mimeType); Alert.alert('Download complete', `${saved.filename} was saved.`); } catch (actionError) { Alert.alert('Download unavailable', imageDocumentErrorMessage(actionError)); } }}><Ionicons name="download-outline" size={23} color={source ? '#fff' : '#6B7280'} /></TouchableOpacity>
        <TouchableOpacity disabled={!source} accessibilityLabel="Print image" onPress={async () => { try { await printImage(source.uri); } catch (actionError) { Alert.alert('Print unavailable', imageDocumentErrorMessage(actionError)); } }}><Ionicons name="print-outline" size={23} color={source ? '#fff' : '#6B7280'} /></TouchableOpacity>
        <TouchableOpacity disabled={!source} accessibilityLabel="Share image" onPress={async () => { try { await shareImage(source.uri, mimeType, title); } catch (actionError) { Alert.alert('Share unavailable', imageDocumentErrorMessage(actionError)); } }}><Ionicons name="share-outline" size={23} color={source ? '#fff' : '#6B7280'} /></TouchableOpacity>
      </View>
      {source && !error ? (
        <ScrollView
          style={styles.viewport}
          contentContainerStyle={styles.imageWrap}
          minimumZoomScale={1}
          maximumZoomScale={5}
          centerContent
        >
          <Image
            source={source}
            style={styles.image}
            resizeMode="contain"
            onError={() => setError('The requested document could not be found or is not a valid image.')}
          />
        </ScrollView>
      ) : null}
      {loading && !error && <View style={styles.overlay}><ActivityIndicator size="large" color={colors.interactive} /><Text style={styles.message}>Loading image… {progress ? `${Math.round(progress * 100)}%` : ''}</Text></View>}
      {!!error && <View style={styles.overlay}><Ionicons name="image-outline" size={54} color="#6B7280" /><Text style={styles.message}>{error}</Text><TouchableOpacity style={[styles.retry, { backgroundColor: colors.primary }]} onPress={() => load(true)}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 14, backgroundColor: '#1E293B' },
  title: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center' },
  viewport: { flex: 1 },
  imageWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  overlay: { ...StyleSheet.absoluteFillObject, top: 58, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28, backgroundColor: '#1E293B' },
  message: { color: '#E5E7EB', textAlign: 'center', fontSize: 15, lineHeight: 22 },
  retry: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  retryText: { color: '#fff', fontWeight: '700' },
});
