import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MOBILE_API_BASE_URL } from '../src/config/api';
import { useTheme } from '../src/context/ThemeContext';
import { getSessionToken } from '../src/services/secureCredentials';
import { safeBack } from '../src/utils/navigation';

export default function ImageViewer() {
  const router = useRouter();
  const { colors } = useTheme();
  const { id, title = 'Document' } = useLocalSearchParams();
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(String(id))) throw new Error('INVALID_ID');
      const token = await getSessionToken();
      if (!token) throw new Error('UNAUTHENTICATED');
      setSource({
        uri: `${MOBILE_API_BASE_URL}/users/documents/${encodeURIComponent(String(id))}/content`,
        headers: { Authorization: `Bearer ${token}`, Accept: 'image/*' },
      });
    } catch (_) {
      setError('This document could not be opened. Please sign in and try again.');
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: '#111827' }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack(router)} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={25} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <View style={styles.headerSpacer} />
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
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={() => { setLoading(false); setError('The requested document could not be found or is not a valid image.'); }}
          />
        </ScrollView>
      ) : null}
      {loading && !error && <View style={styles.overlay}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.message}>Loading image…</Text></View>}
      {!!error && <View style={styles.overlay}><Ionicons name="image-outline" size={54} color="#9CA3AF" /><Text style={styles.message}>{error}</Text><TouchableOpacity style={[styles.retry, { backgroundColor: colors.primary }]} onPress={load}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 14, backgroundColor: '#111827' },
  title: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center' },
  headerSpacer: { width: 25 },
  viewport: { flex: 1 },
  imageWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  overlay: { ...StyleSheet.absoluteFillObject, top: 58, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28, backgroundColor: '#111827' },
  message: { color: '#E5E7EB', textAlign: 'center', fontSize: 15, lineHeight: 22 },
  retry: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  retryText: { color: '#fff', fontWeight: '700' },
});
