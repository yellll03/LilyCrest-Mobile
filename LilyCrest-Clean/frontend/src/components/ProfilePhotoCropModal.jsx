import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import {
  clampProfileCropOffset,
  getProfileCropLayout,
  PROFILE_CROP_MAX_ZOOM,
  PROFILE_CROP_MIN_ZOOM,
} from '../utils/profilePhotoCrop';

const ZOOM_STEP = 0.25;

export default function ProfilePhotoCropModal({ asset, error = '', onCancel, onSave, saving = false, visible }) {
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const cropSize = Math.min(Math.max(240, windowWidth - 48), 360);
  const [zoom, setZoom] = useState(PROFILE_CROP_MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [croppedAsset, setCroppedAsset] = useState(null);
  const [applyingCrop, setApplyingCrop] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!visible) return;
    setZoom(PROFILE_CROP_MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
    setCroppedAsset(null);
    setApplyingCrop(false);
  }, [asset?.uri, visible]);

  const layout = useMemo(
    () => getProfileCropLayout(asset, cropSize, zoom, offset),
    [asset, cropSize, offset, zoom],
  );

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
    onPanResponderGrant: () => {
      dragStart.current = offset;
    },
    onPanResponderMove: (_event, gesture) => {
      setOffset(clampProfileCropOffset(asset, cropSize, zoom, {
        x: dragStart.current.x + gesture.dx,
        y: dragStart.current.y + gesture.dy,
      }));
    },
  }), [asset, cropSize, offset, zoom]);

  const changeZoom = (nextZoom) => {
    const bounded = Math.min(PROFILE_CROP_MAX_ZOOM, Math.max(PROFILE_CROP_MIN_ZOOM, nextZoom));
    setZoom(bounded);
    setOffset((current) => clampProfileCropOffset(asset, cropSize, bounded, current));
  };

  const applyCrop = async () => {
    if (!asset?.uri || applyingCrop) return;
    setApplyingCrop(true);
    try {
      const result = await ImageManipulator.manipulateAsync(
        asset.uri,
        [
          { crop: layout.crop },
          { resize: { width: 1024, height: 1024 } },
        ],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      setCroppedAsset({
        ...result,
        fileName: 'profile-photo-cropped.jpg',
        mimeType: 'image/jpeg',
      });
    } finally {
      setApplyingCrop(false);
    }
  };

  if (!visible || !asset) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={saving ? undefined : onCancel}>
      <View style={[styles.screen, { backgroundColor: colors.background }]}> 
        <View style={[styles.header, { borderBottomColor: colors.border }]}> 
          <TouchableOpacity
            accessibilityLabel="Cancel profile photo crop"
            accessibilityRole="button"
            disabled={saving || applyingCrop}
            onPress={onCancel}
            style={styles.headerButton}
          >
            <Ionicons name="close" size={26} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]}>{croppedAsset ? 'Cropped Preview' : 'Adjust Profile Photo'}</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              {croppedAsset ? 'Review the square image before saving.' : 'Drag the image and use zoom to choose the crop.'}
            </Text>
          </View>
          <View style={styles.headerButton} />
        </View>

        <View style={styles.content}>
          {croppedAsset ? (
            <Image
              accessibilityLabel="Cropped profile photo preview"
              source={{ uri: croppedAsset.uri }}
              style={[styles.preview, { width: cropSize, height: cropSize, backgroundColor: colors.surfaceSecondary }]}
            />
          ) : (
            <View
              accessibilityLabel="Profile photo crop area"
              style={[styles.cropWindow, { width: cropSize, height: cropSize, backgroundColor: colors.surfaceSecondary }]}
              {...panResponder.panHandlers}
            >
              <Image
                source={{ uri: asset.uri }}
                style={{
                  height: layout.displayHeight,
                  width: layout.displayWidth,
                  transform: [
                    { translateX: layout.offset.x },
                    { translateY: layout.offset.y },
                  ],
                }}
              />
              <View pointerEvents="none" style={[styles.cropBorder, { borderColor: colors.accent }]} />
            </View>
          )}

          {!croppedAsset ? (
            <View style={styles.zoomControls}>
              <TouchableOpacity
                accessibilityLabel="Zoom out"
                accessibilityRole="button"
                disabled={zoom <= PROFILE_CROP_MIN_ZOOM}
                onPress={() => changeZoom(zoom - ZOOM_STEP)}
                style={[styles.roundButton, { borderColor: colors.border }]}
              >
                <Ionicons name="remove" size={22} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.zoomLabel, { color: colors.textSecondary }]}>{Math.round(zoom * 100)}%</Text>
              <TouchableOpacity
                accessibilityLabel="Zoom in"
                accessibilityRole="button"
                disabled={zoom >= PROFILE_CROP_MAX_ZOOM}
                onPress={() => changeZoom(zoom + ZOOM_STEP)}
                style={[styles.roundButton, { borderColor: colors.border }]}
              >
                <Ionicons name="add" size={22} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityLabel="Reset crop"
                accessibilityRole="button"
                onPress={() => { setZoom(PROFILE_CROP_MIN_ZOOM); setOffset({ x: 0, y: 0 }); }}
                style={styles.resetButton}
              >
                <Text style={[styles.resetText, { color: colors.accent }]}>Reset</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {error ? <Text style={[styles.error, { color: colors.errorText }]}>{error}</Text> : null}
        </View>

        <View style={[styles.footer, { borderTopColor: colors.border }]}> 
          {croppedAsset ? (
            <>
              <TouchableOpacity
                accessibilityLabel="Adjust crop"
                accessibilityRole="button"
                disabled={saving}
                onPress={() => setCroppedAsset(null)}
                style={[styles.secondaryButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.secondaryText, { color: colors.text }]}>Adjust Crop</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityLabel="Save profile photo"
                accessibilityRole="button"
                disabled={saving}
                onPress={() => onSave(croppedAsset)}
                style={[styles.primaryButton, { backgroundColor: colors.accent }]}
              >
                {saving ? <ActivityIndicator color="#0A1628" /> : <Text style={styles.primaryText}>Save Photo</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                accessibilityLabel="Cancel crop"
                accessibilityRole="button"
                disabled={applyingCrop}
                onPress={onCancel}
                style={[styles.secondaryButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.secondaryText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityLabel="Crop profile photo"
                accessibilityRole="button"
                disabled={applyingCrop}
                onPress={applyCrop}
                style={[styles.primaryButton, { backgroundColor: colors.accent }]}
              >
                {applyingCrop ? <ActivityIndicator color="#0A1628" /> : <Text style={styles.primaryText}>Crop</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, paddingTop: 48 },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  title: { fontSize: 19, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: 12, lineHeight: 17, marginTop: 3, textAlign: 'center' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 24 },
  cropWindow: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 18 },
  cropBorder: { ...StyleSheet.absoluteFillObject, borderWidth: 3, borderRadius: 18 },
  preview: { borderRadius: 18 },
  zoomControls: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14 },
  roundButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  zoomLabel: { width: 52, textAlign: 'center', fontSize: 14, fontWeight: '700' },
  resetButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  resetText: { fontSize: 14, fontWeight: '800' },
  error: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  footer: { borderTopWidth: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingBottom: 28, paddingTop: 16 },
  secondaryButton: { flex: 1, minHeight: 52, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '800' },
  primaryButton: { flex: 1, minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#0A1628', fontSize: 15, fontWeight: '800' },
});
