import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useTheme, useThemedStyles } from '../src/context/ThemeContext';
import { safeBack } from '../src/utils/navigation';
import { useAuth } from '../src/context/AuthContext';
import BrandHeader from '../src/components/BrandHeader';
import { ScreenHeader } from '../src/components/ui/LilycrestUI';

export default function AboutScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useThemedStyles(createStyles);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader strong title="About Lilycrest" subtitle="Dormitory Management System" onBack={() => safeBack(router)} />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.logoSection}>
          <BrandHeader compact theme="light" showTagline={false} />
          <Text style={styles.version}>Version {Constants.expoConfig?.version || 'Unknown'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>About Us</Text>
          <Text style={styles.cardText}>Lilycrest Dormitory provides premium co-living spaces designed for students and young professionals in Metro Manila. Our commitment is to provide safe, comfortable, and affordable accommodations with modern amenities.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Features</Text>
          <View style={styles.featureList}>
            <View style={styles.featureItem}><View style={styles.featureIcon}><Ionicons name="card" size={20} color={colors.heading} /></View><Text style={styles.featureText}>Easy Billing & Payments</Text></View>
            <View style={styles.featureItem}><View style={styles.featureIcon}><Ionicons name="construct" size={20} color={colors.heading} /></View><Text style={styles.featureText}>Maintenance Requests</Text></View>
            <View style={styles.featureItem}><View style={styles.featureIcon}><Ionicons name="megaphone" size={20} color={colors.heading} /></View><Text style={styles.featureText}>Real-time Announcements</Text></View>
            <View style={styles.featureItem}><View style={styles.featureIcon}><Ionicons name="chatbubbles" size={20} color={colors.heading} /></View><Text style={styles.featureText}>24/7 Support Chat</Text></View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Contact Us</Text>
          <TouchableOpacity style={styles.contactItem}><Ionicons name="call" size={20} color={colors.text} /><Text style={styles.contactText}>+63 912 345 6789</Text></TouchableOpacity>
          <TouchableOpacity style={styles.contactItem}><Ionicons name="mail" size={20} color={colors.text} /><Text style={styles.contactText}>support@lilycrest.ph</Text></TouchableOpacity>
          <TouchableOpacity style={styles.contactItem}><Ionicons name="location" size={20} color={colors.text} /><Text style={styles.contactText}>{user?.branch?.branchAddress || 'Branch location is not available yet.'}</Text></TouchableOpacity>
        </View>

        <View style={styles.linksSection}>
          <TouchableOpacity style={styles.linkItem} onPress={() => router.push('/privacy-policy')}><Text style={styles.linkText}>Privacy Policy</Text></TouchableOpacity>
          <Text style={styles.linkDivider}>|</Text>
          <TouchableOpacity style={styles.linkItem} onPress={() => router.push('/terms-of-service')}><Text style={styles.linkText}>Terms of Service</Text></TouchableOpacity>
        </View>

        <Text style={styles.copyright}>© 2024 Lilycrest Properties Inc.{"\n"}All rights reserved.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20 },
  logoSection: { alignItems: 'center', marginBottom: 24 },
  version: { fontSize: 12, color: c.textMuted, marginTop: 8 },
  card: { backgroundColor: c.surface, borderRadius: 12, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: c.border },
  cardTitle: { fontSize: 16, fontWeight: '600', color: c.text, marginBottom: 12 },
  cardText: { fontSize: 14, color: c.textSecondary, lineHeight: 22 },
  featureList: { gap: 12 },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: c.surfaceSecondary, justifyContent: 'center', alignItems: 'center' },
  featureText: { fontSize: 14, color: c.text, fontWeight: '500' },
  contactItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  contactText: { fontSize: 14, color: c.textSecondary },
  linksSection: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 8 },
  linkItem: {},
  linkText: { fontSize: 14, color: c.interactive, fontWeight: '500' },
  linkDivider: { color: c.border },
  copyright: { textAlign: 'center', fontSize: 12, color: c.textMuted, marginTop: 16, lineHeight: 18 },
});
