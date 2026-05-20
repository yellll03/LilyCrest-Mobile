import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

const MIME_TYPE_EXTENSION_MAP = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
};

function inferMimeType(asset = {}, fallback = 'application/octet-stream') {
  if (asset.mimeType) return asset.mimeType;
  if (asset.type === 'image') return 'image/jpeg';
  return asset.type || fallback;
}

function ensureExtension(name = 'file', mimeType = '') {
  if (/\.[a-z0-9]+$/i.test(name)) return name;
  return `${name}${MIME_TYPE_EXTENSION_MAP[mimeType] || ''}`;
}

function normalizeAsset(asset) {
  const mimeType = inferMimeType(asset);
  const fallbackName = asset.uri?.split('/')?.pop() || 'file';
  return {
    name: ensureExtension(asset.fileName || asset.name || fallbackName, mimeType),
    uri: asset.uri,
    type: mimeType,
    size: asset.fileSize || asset.size,
  };
}

export async function pickFromLibrary() {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Please allow photo access to pick an image or video.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.7,
    base64: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  return normalizeAsset(result.assets[0]);
}

export async function pickFromCamera() {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Please allow camera access to take a photo or video.');
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({ quality: 0.6, base64: false });
  if (result.canceled || !result.assets?.length) return null;
  return normalizeAsset(result.assets[0]);
}

export async function pickDocument() {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.length) return null;
  return normalizeAsset(result.assets[0]);
}
