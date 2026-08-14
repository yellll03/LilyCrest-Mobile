import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;

// Accepts either a remote URL string or a local `require(...)` asset
// (a number, or module object on some bundlers) — Image needs `{uri}` only
// for the former.
function toImageSource(item) {
  if (typeof item === 'string') return { uri: item };
  return item;
}

function sourceKey(item, index) {
  if (typeof item === 'string') return item;
  return `asset-${index}`;
}

/**
 * Shared full-screen image viewer for room, property, and branch photos.
 * `images` accepts a mix of remote URL strings and local require(...) assets.
 */
export default function ImageLightbox({ visible, images, initialIndex = 0, onClose }) {
  const [index, setIndex] = useState(initialIndex);
  const [loadState, setLoadState] = useState('loading');

  useEffect(() => {
    if (visible) {
      setIndex(initialIndex);
      setLoadState('loading');
    }
  }, [visible, initialIndex]);

  // Reset per-image load state whenever the active image changes, whichever
  // path caused it (nav buttons, or initialIndex changing while open).
  useEffect(() => {
    setLoadState('loading');
  }, [index]);

  const safeImages = Array.isArray(images) ? images.filter((item) => item !== null && item !== undefined && item !== '') : [];
  const currentItem = safeImages[index];
  const currentSource = currentItem !== undefined ? toImageSource(currentItem) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Close image preview" style={styles.closeButton}>
            <Ionicons name="close" size={26} color="#ffffff" />
          </TouchableOpacity>
          {safeImages.length > 1 ? (
            <Text style={styles.counter}>{index + 1} / {safeImages.length}</Text>
          ) : null}
        </View>

        <View style={styles.imageArea}>
          {currentSource ? (
            <Image
              key={sourceKey(currentItem, index)}
              source={currentSource}
              style={styles.image}
              contentFit="contain"
              cachePolicy="memory-disk"
              onLoadStart={() => setLoadState('loading')}
              onLoad={() => setLoadState('loaded')}
              onError={() => setLoadState('error')}
            />
          ) : null}
          {loadState === 'loading' ? (
            <View style={styles.overlay}>
              <ActivityIndicator size="large" color="#ffffff" />
            </View>
          ) : null}
          {loadState === 'error' ? (
            <View style={styles.overlay}>
              <Ionicons name="image-outline" size={48} color="#9CA3AF" />
              <Text style={styles.errorText}>Unable to load this image.</Text>
            </View>
          ) : null}
        </View>

        {safeImages.length > 1 ? (
          <View style={styles.navRow}>
            <TouchableOpacity
              disabled={index === 0}
              onPress={() => setIndex((i) => Math.max(0, i - 1))}
              style={[styles.navButton, index === 0 && styles.navButtonDisabled]}
              accessibilityLabel="Previous image"
            >
              <Ionicons name="chevron-back" size={22} color="#ffffff" />
            </TouchableOpacity>
            <TouchableOpacity
              disabled={index === safeImages.length - 1}
              onPress={() => setIndex((i) => Math.min(safeImages.length - 1, i + 1))}
              style={[styles.navButton, index === safeImages.length - 1 && styles.navButtonDisabled]}
              accessibilityLabel="Next image"
            >
              <Ionicons name="chevron-forward" size={22} color="#ffffff" />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

export { toImageSource };

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 50, paddingBottom: 12 },
  closeButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  counter: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  imageArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: SCREEN_WIDTH, height: '100%' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 10 },
  errorText: { color: '#E5E7EB', fontSize: 14 },
  navRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 36 },
  navButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  navButtonDisabled: { opacity: 0.35 },
});
