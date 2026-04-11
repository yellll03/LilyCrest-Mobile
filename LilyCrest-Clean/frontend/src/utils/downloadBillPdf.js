import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert, Platform } from 'react-native';
import { BASE_BACKEND_URL } from '../services/api';

const buildBillPdfUrl = (billId) => {
  if (!billId) return null;
  const base = (BASE_BACKEND_URL || '').replace(/\/$/, '');
  return `${base}/api/billing/${encodeURIComponent(billId)}/pdf`;
};

export async function downloadBillPdf(billId, setBusy) {
  const url = buildBillPdfUrl(billId);
  if (!url) {
    Alert.alert('Error', 'No bill ID found.');
    return false;
  }

  let token;
  try {
    token = await AsyncStorage.getItem('session_token');
  } catch (_) {
    token = null;
  }

  if (!token) {
    Alert.alert('Login required', 'Please log in to download billing PDFs.');
    return false;
  }

  if (setBusy) setBusy(true);

  try {
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) throw new Error('No cache directory available');

    const dest = `${cacheDir}${billId}.pdf`;

    // Remove any stale cached file first
    const info = await FileSystem.getInfoAsync(dest);
    if (info.exists) await FileSystem.deleteAsync(dest, { idempotent: true });

    const result = await FileSystem.downloadAsync(url, dest, {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log('[PDF] download result status:', result?.status);

    if (!result?.uri) throw new Error('Download returned no URI');

    // If the server returned an error body (JSON) instead of a PDF, status will be non-2xx
    if (result.status < 200 || result.status >= 300) {
      // Try reading the error message from the downloaded file
      let detail = `Server error ${result.status}`;
      try {
        const body = await FileSystem.readAsStringAsync(result.uri);
        const parsed = JSON.parse(body);
        if (parsed?.detail) detail = parsed.detail;
      } catch (_) {}
      // Clean up the error file
      await FileSystem.deleteAsync(result.uri, { idempotent: true });
      Alert.alert('Download failed', detail);
      return false;
    }

    // Share / open the PDF
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(result.uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Bill ${billId}`,
        UTI: 'com.adobe.pdf',
      });
    } else {
      Alert.alert('Saved', `PDF saved to: ${result.uri}`);
    }

    return true;
  } catch (error) {
    console.error('[PDF] download error:', error?.message);

    // On Android, sometimes we need to fall back to opening in browser
    if (Platform.OS === 'android') {
      try {
        const { Linking } = await import('react-native');
        const urlWithToken = `${url}?token=${encodeURIComponent(token)}`;
        await Linking.openURL(urlWithToken);
        return true;
      } catch (_) {}
    }

    Alert.alert(
      'Download failed',
      'Unable to download the billing PDF. Make sure you are connected and logged in.'
    );
    return false;
  } finally {
    if (setBusy) setBusy(false);
  }
}
