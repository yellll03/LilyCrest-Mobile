import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Platform, StatusBar as RNStatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useThemedStyles } from '../context/ThemeContext';

export default function AppHeader() {
  const router = useRouter();

  const styles = useThemedStyles((c, isDarkMode) =>
    StyleSheet.create({
      header: {
        backgroundColor: isDarkMode ? '#0F1A2E' : '#14365A',
        paddingHorizontal: 16,
        paddingBottom: 14,
        paddingTop: Platform.OS === 'ios' ? 56 : (RNStatusBar.currentHeight || 24) + 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
      },
      spacer: {
        width: 40,
      },
      titleContainer: {
        flex: 1,
        alignItems: 'center',
      },
      title: {
        fontSize: 24,
        fontWeight: '800',
        color: '#ffffff',
        textAlign: 'center',
        letterSpacing: 1,
      },
      subtitle: {
        fontSize: 13,
        fontWeight: '500',
        color: 'rgba(255,255,255,0.7)',
        textAlign: 'center',
        marginTop: 2,
        letterSpacing: 0.5,
      },
      iconBtn: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.1)',
        justifyContent: 'center',
        alignItems: 'center',
      },
    })
  );

  return (
    <View style={styles.header}>
      <View style={styles.spacer} />
      <View style={styles.titleContainer}>
        <Text style={styles.title}>LilyCrest</Text>
        <Text style={styles.subtitle}>Tenant Portal</Text>
      </View>
      <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/(tabs)/announcements')}>
        <Ionicons name="notifications-outline" size={20} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
}
