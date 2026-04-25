import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/context/ThemeContext';
import { useAlert } from '../src/context/AlertContext';
import { useToast } from '../src/context/ToastContext';
import {
  getStoredPushToken,
  registerForPushNotifications,
  savePushTokenToServer,
  setPushNotificationsEnabled,
} from '../src/services/notifications';
import { clearCredentials } from '../src/services/secureCredentials';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

export default function SettingsScreen() {
  const router = useRouter();
  const { isDarkMode, toggleDarkMode, colors } = useTheme();
  const { showAlert } = useAlert();
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState(true);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [biometrics, setBiometrics] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState('Biometric');

  useEffect(() => {
    loadSettings();
    checkBiometricSupport();
  }, []);

  const loadSettings = async () => {
    try {
      const notifSetting = await AsyncStorage.getItem('notifications');
      const bioSetting = await AsyncStorage.getItem('biometricLogin');
      if (notifSetting !== null) setNotifications(notifSetting === 'true');
      if (bioSetting !== null) setBiometrics(bioSetting === 'true');
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const checkBiometricSupport = async () => {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      setBiometricAvailable(compatible);
      
      if (compatible) {
        setBiometricType('Biometrics');
      }
    } catch (error) {
      console.error('Biometric check error:', error);
    }
  };

  const handleNotificationToggle = async (value) => {
    if (notificationSaving) return;

    const previousValue = notifications;
    setNotifications(value);
    setNotificationSaving(true);

    try {
      await setPushNotificationsEnabled(value);

      if (value) {
        const token = await registerForPushNotifications({ requestPermission: true });
        if (!token) {
          await setPushNotificationsEnabled(false);
          setNotifications(false);
          showToast({
            type: 'warning',
            title: 'Notifications Blocked',
            message: 'Allow notifications in your device settings to receive LilyCrest updates.',
          });
          return;
        }

        await savePushTokenToServer(token, { notificationsEnabled: true });
        showToast({
          type: 'success',
          title: 'Notifications Enabled',
          message: 'This device will now receive billing, announcement, maintenance, and chat updates.',
        });
        return;
      }

      const storedToken = await getStoredPushToken();
      await savePushTokenToServer(storedToken, { notificationsEnabled: false });
      showToast({
        type: 'info',
        title: 'Notifications Paused',
        message: 'This device will stop receiving LilyCrest push notifications.',
      });
    } catch (_error) {
      await setPushNotificationsEnabled(previousValue);
      setNotifications(previousValue);
      showToast({
        type: 'error',
        title: 'Update Failed',
        message: 'Could not update notification settings. Please try again.',
      });
    } finally {
      setNotificationSaving(false);
    }
  };

  const handleBiometricToggle = async (value) => {
    if (value) {
      // Verify biometric first
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Verify your identity to enable biometric login',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      
      if (result.success) {
        setBiometrics(true);
        await AsyncStorage.setItem('biometricLogin', 'true');
        showAlert({
          title: `${biometricType} Login Enabled`,
          message: `${biometricType} login is now activated. Sign in with your email and password once more — after that, you can use ${biometricType} to log in instantly.`,
          type: 'success',
        });
      } else {
        showAlert({
          title: 'Verification Failed',
          message: 'Biometric verification was not successful. Please try again.',
          type: 'error',
        });
      }
    } else {
      setBiometrics(false);
      await AsyncStorage.setItem('biometricLogin', 'false');
      await clearCredentials();
      showAlert({
        title: `${biometricType} Disabled`,
        message: `${biometricType} login has been disabled and stored credentials have been removed.`,
        type: 'warning',
      });
    }
  };

  const handleChangePassword = () => {
    router.push('/change-password');
  };

  const styles = createStyles(colors, isDarkMode);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Appearance */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Appearance</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <View style={[styles.iconContainer, { backgroundColor: isDarkMode ? 'rgba(147,51,234,0.2)' : '#F3E8FF' }]}>
                <Ionicons name="moon" size={20} color="#9333EA" />
              </View>
              <View>
                <Text style={styles.settingLabel}>Dark Mode</Text>
                <Text style={styles.settingDescription}>{isDarkMode ? 'Currently enabled' : 'Switch to dark theme'}</Text>
              </View>
            </View>
            <Switch 
              value={isDarkMode} 
              onValueChange={toggleDarkMode} 
              trackColor={{ false: colors.border, true: '#9333EA' }} 
              thumbColor="#FFFFFF" 
            />
          </View>
        </View>

        {/* Notifications */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <View style={[styles.iconContainer, { backgroundColor: isDarkMode ? 'rgba(59,130,246,0.2)' : '#DBEAFE' }]}>
                <Ionicons name="notifications" size={20} color="#3B82F6" />
              </View>
              <View>
                <Text style={styles.settingLabel}>Push Notifications</Text>
                <Text style={styles.settingDescription}>
                  {notificationSaving ? 'Saving your preference...' : 'Receive important updates'}
                </Text>
              </View>
            </View>
            <Switch 
              value={notifications} 
              onValueChange={handleNotificationToggle} 
              disabled={notificationSaving}
              trackColor={{ false: colors.border, true: '#3B82F6' }} 
              thumbColor="#FFFFFF" 
            />
          </View>
        </View>

        {/* Security */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security</Text>
          
          {biometricAvailable && (
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                <View style={[styles.iconContainer, { backgroundColor: isDarkMode ? 'rgba(34,197,94,0.2)' : '#DCFCE7' }]}>
                  <Ionicons name="finger-print" size={20} color="#22C55E" />
                </View>
                <View>
                  <Text style={styles.settingLabel}>{biometricType} Login</Text>
                  <Text style={styles.settingDescription}>{biometrics ? 'Enabled' : 'Use biometric to login'}</Text>
                </View>
              </View>
              <Switch 
                value={biometrics} 
                onValueChange={handleBiometricToggle} 
                trackColor={{ false: colors.border, true: '#22C55E' }} 
                thumbColor="#FFFFFF" 
              />
            </View>
          )}
          
          <TouchableOpacity style={styles.menuItem} onPress={handleChangePassword}>
            <View style={styles.settingLeft}>
              <View style={[styles.iconContainer, { backgroundColor: isDarkMode ? 'rgba(239,68,68,0.2)' : '#FEE2E2' }]}>
                <Ionicons name="lock-closed" size={20} color="#EF4444" />
              </View>
              <View>
                <Text style={styles.settingLabel}>Change Password</Text>
                <Text style={styles.settingDescription}>Update your password</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Legal */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Legal</Text>
          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/privacy-policy')}>
            <View style={styles.settingLeft}>
              <View style={[styles.iconContainer, { backgroundColor: colors.inputBg }]}>
                <Ionicons name="shield-checkmark" size={20} color={colors.textSecondary} />
              </View>
              <Text style={styles.settingLabel}>Privacy Policy</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/terms-of-service')}>
            <View style={styles.settingLeft}>
              <View style={[styles.iconContainer, { backgroundColor: colors.inputBg }]}>
                <Ionicons name="document-text" size={20} color={colors.textSecondary} />
              </View>
              <Text style={styles.settingLabel}>Terms of Service</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/house-rules')}>
            <View style={styles.settingLeft}>
              <View style={[styles.iconContainer, { backgroundColor: colors.inputBg }]}>
                <Ionicons name="home" size={20} color={colors.textSecondary} />
              </View>
              <Text style={styles.settingLabel}>House Rules</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.versionText}>LilyCrest Tenant Portal v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  backButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16 },
  section: { backgroundColor: colors.surface, borderRadius: 16, marginBottom: 16, overflow: 'hidden', borderWidth: isDarkMode ? 1 : 0, borderColor: colors.border },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.textMuted, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  iconContainer: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  settingLabel: { fontSize: 15, color: colors.text, fontWeight: '500' },
  settingDescription: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  versionText: { textAlign: 'center', fontSize: 12, color: colors.textMuted, marginTop: 16, marginBottom: 32 },
});
