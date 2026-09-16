import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/context/ThemeContext';
import { useToast } from '../src/context/ToastContext';
import { useAuth } from '../src/context/AuthContext';
import {
  getStoredPushToken,
  registerForPushNotifications,
  savePushTokenToServer,
  setPushNotificationsEnabled,
} from '../src/services/notifications';
import { safeBack } from '../src/utils/navigation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScreenHeader } from '../src/components/ui/LilycrestUI';

export default function SettingsScreen() {
  const router = useRouter();
  const { user, authReady, authStatus } = useAuth();
  const { isDarkMode, toggleDarkMode, colors } = useTheme();
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState(true);
  const [notificationSaving, setNotificationSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const notifSetting = await AsyncStorage.getItem('notifications');
      if (notifSetting !== null) setNotifications(notifSetting === 'true');
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const handleNotificationToggle = async (value) => {
    if (notificationSaving) return;
    if (!authReady || authStatus !== 'authenticated' || !user?.user_id) {
      showToast({
        type: 'warning',
        title: 'Sign In Required',
        message: 'Please sign in before changing push notification settings.',
      });
      return;
    }

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

  const handleChangePassword = () => {
    router.push('/change-password');
  };

  const styles = createStyles(colors, isDarkMode);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader strong title="Settings" subtitle="Preferences, security, and legal" onBack={() => safeBack(router)} />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Appearance */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Appearance</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <View style={[styles.iconContainer, { backgroundColor: colors.infoBg }]}>
                <Ionicons name="moon" size={20} color="#2563EB" />
              </View>
              <View>
                <Text style={styles.settingLabel}>Dark Mode</Text>
                <Text style={styles.settingDescription}>{isDarkMode ? 'Currently enabled' : 'Switch to dark theme'}</Text>
              </View>
            </View>
            <Switch 
              value={isDarkMode} 
              onValueChange={toggleDarkMode} 
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={isDarkMode ? '#0A1628' : '#FFFFFF'}
            />
          </View>
        </View>

        {/* Notifications */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <View style={[styles.iconContainer, { backgroundColor: colors.infoBg }]}>
                <Ionicons name="notifications" size={20} color="#2563EB" />
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
              trackColor={{ false: colors.border, true: '#2563EB' }}
              thumbColor="#FFFFFF" 
            />
          </View>
        </View>

        {/* Security */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security</Text>
          
          <TouchableOpacity style={styles.menuItem} onPress={handleChangePassword}>
            <View style={styles.settingLeft}>
              <View
                style={[
                  styles.iconContainer,
                  {
                    backgroundColor: colors.accentSubtle,
                    borderWidth: 1,
                    borderColor: colors.accentLight,
                  },
                ]}
              >
                <Ionicons name="lock-closed" size={20} color={colors.accent} />
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

        <Text style={styles.versionText}>
          LilyCrest Tenant Portal v{Constants.expoConfig?.version || 'Unknown'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16 },
  section: { backgroundColor: colors.surface, borderRadius: 12, marginBottom: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.textMuted, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  iconContainer: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  settingLabel: { fontSize: 15, color: colors.text, fontWeight: '500' },
  settingDescription: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  versionText: { textAlign: 'center', fontSize: 12, color: colors.textMuted, marginTop: 16, marginBottom: 32 },
});
