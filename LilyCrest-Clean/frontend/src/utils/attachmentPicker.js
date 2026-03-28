import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

function normalizeAsset(asset) {
  return {
    name: asset.fileName || asset.name || asset.uri?.split('/')?.pop() || 'file',
    uri: asset.uri,
    type: asset.mimeType || asset.type || 'application/octet-stream',
    size: asset.size,
  };
}

export async function pickFromLibrary() {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Please allow photo access to pick an image or video.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
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
