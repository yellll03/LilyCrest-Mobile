import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/context/ThemeContext';

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={colors.text} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.updateDate}>Last updated: January 2024</Text>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Information We Collect</Text>
          <Text style={styles.paragraph}>We collect personal information you provide including name, email address, phone number, and payment information to manage your tenancy.</Text>
        </View>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. How We Use Your Information</Text>
          <Text style={styles.paragraph}>Your information is used to process billing, communicate important announcements, handle maintenance requests, and improve our services.</Text>
        </View>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>3. Data Security</Text>
          <Text style={styles.paragraph}>We implement industry-standard security measures to protect your data. Your information is stored securely and accessed only by authorized personnel.</Text>
        </View>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>4. Your Rights</Text>
          <Text style={styles.paragraph}>You have the right to access, correct, or delete your personal data. Contact us at support@lilycrest.ph for any data-related requests.</Text>
        </View>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>5. Contact Us</Text>
          <Text style={styles.paragraph}>For questions about this privacy policy, please contact our Data Protection Officer at privacy@lilycrest.ph.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  backButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#1E3A5F' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20 },
  updateDate: { fontSize: 13, color: '#9CA3AF', marginBottom: 24 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1E3A5F', marginBottom: 8 },
  paragraph: { fontSize: 14, color: '#4B5563', lineHeight: 22 },
});
