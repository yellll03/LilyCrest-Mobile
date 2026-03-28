import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Linking, Platform } from 'react-native';
import { BASE_BACKEND_URL } from '../services/api';

const buildBillPdfUrl = (billId) => {
  if (!billId) return null;
  const base = BASE_BACKEND_URL || '';
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return encodeURI(`${normalizedBase}/api/billing/${billId}/pdf`);
};

export async function downloadBillPdf(billId, setBusy) {
  const url = buildBillPdfUrl(billId);
  if (!url) {
    Alert.alert('Download unavailable', 'No bill ID found.');
    return false;
  }

  let token;
  try {
    token = await AsyncStorage.getItem('session_token');
  } catch (_) {
    token = null;
  }

  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const target = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}${billId || 'bill'}.pdf`;

  if (setBusy) setBusy(true);

  try {
    const download = FileSystem.createDownloadResumable(url, target, { headers });
    const result = await download.downloadAsync();

    if (result?.status >= 200 && result?.status < 300 && result?.uri) {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, { dialogTitle: 'Share billing PDF' });
      } else {
        await WebBrowser.openBrowserAsync(result.uri);
      }
      return true;
    }

    throw new Error(`Unexpected status ${result?.status}`);
  } catch (error) {
    try {
      let finalUrl = url;
      if (token) {
        const separator = finalUrl.includes('?') ? '&' : '?';
        finalUrl = `${finalUrl}${separator}token=${encodeURIComponent(token)}`;
      }
      await Linking.openURL(finalUrl);
      return true;
    } catch (_) {
      Alert.alert('Download failed', Platform.OS === 'android' ? 'Unable to open the bill PDF on this device.' : 'Unable to open the bill PDF right now.');
      return false;
    }
  } finally {
    if (setBusy) setBusy(false);
  }
}
