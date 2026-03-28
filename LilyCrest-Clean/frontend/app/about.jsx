import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/context/ThemeContext';

export default function AboutScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>About</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.logoSection}>
          <View style={styles.logoIcon}><Ionicons name="home" size={48} color="#FFFFFF" /></View>
          <Text style={styles.appName}>Lilycrest</Text>
          <Text style={styles.tagline}>Dormitory Management System</Text>
          <Text style={styles.version}>Version 1.0.0</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>About Us</Text>
          <Text style={styles.cardText}>Lilycrest Dormitory provides premium co-living spaces designed for students and young professionals in Metro Manila. Our commitment is to provide safe, comfortable, and affordable accommodations with modern amenities.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Features</Text>
          <View style={styles.featureList}>
            <View style={styles.featureItem}><View style={styles.featureIcon}><Ionicons name="card" size={20} color="#3B82F6" /></View><Text style={styles.featureText}>Easy Billing & Payments</Text></View>
            <View style={styles.featureItem}><View style={styles.featureIcon}><Ionicons name="construct" size={20} color="#F59E0B" /></View><Text style={styles.featureText}>Maintenance Requests</Text></View>
            <View style={styles.featureItem}><View style={styles.featureIcon}><Ionicons name="megaphone" size={20} color="#22C55E" /></View><Text style={styles.featureText}>Real-time Announcements</Text></View>
            <View style={styles.featureItem}><View style={styles.featureIcon}><Ionicons name="chatbubbles" size={20} color="#9333EA" /></View><Text style={styles.featureText}>24/7 Support Chat</Text></View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Contact Us</Text>
          <TouchableOpacity style={styles.contactItem}><Ionicons name="call" size={20} color={colors.text} /><Text style={styles.contactText}>+63 912 345 6789</Text></TouchableOpacity>
          <TouchableOpacity style={styles.contactItem}><Ionicons name="mail" size={20} color={colors.text} /><Text style={styles.contactText}>support@lilycrest.ph</Text></TouchableOpacity>
          <TouchableOpacity style={styles.contactItem}><Ionicons name="location" size={20} color={colors.text} /><Text style={styles.contactText}>#7 Gil Puyat Ave., Makati City</Text></TouchableOpacity>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  backButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#1E3A5F' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20 },
  logoSection: { alignItems: 'center', marginBottom: 24 },
  logoIcon: { width: 80, height: 80, borderRadius: 24, backgroundColor: '#D4682A', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  appName: { fontSize: 28, fontWeight: '700', color: '#1E3A5F' },
  tagline: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  version: { fontSize: 12, color: '#9CA3AF', marginTop: 8 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, marginBottom: 16, ...Platform.select({ web: { boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }, default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 } }) },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#1E3A5F', marginBottom: 12 },
  cardText: { fontSize: 14, color: '#4B5563', lineHeight: 22 },
  featureList: { gap: 12 },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  featureText: { fontSize: 14, color: '#1F2937', fontWeight: '500' },
  contactItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  contactText: { fontSize: 14, color: '#4B5563' },
  linksSection: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 8 },
  linkItem: {},
  linkText: { fontSize: 14, color: '#D4682A', fontWeight: '500' },
  linkDivider: { color: '#D1D5DB' },
  copyright: { textAlign: 'center', fontSize: 12, color: '#9CA3AF', marginTop: 16, lineHeight: 18 },
});
