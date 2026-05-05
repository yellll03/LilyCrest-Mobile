import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme, useThemedStyles } from '../src/context/ThemeContext';

export default function TermsOfServiceScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={colors.text} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Terms of Service</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.updateDate}>Last updated: January 2024</Text>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Acceptance of Terms</Text>
          <Text style={styles.paragraph}>By using the Lilycrest app, you agree to these terms. If you do not agree, please do not use our services.</Text>
        </View>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. User Responsibilities</Text>
          <Text style={styles.paragraph}>Users must provide accurate information, pay bills on time, follow house rules, and maintain respectful behavior towards staff and co-tenants.</Text>
        </View>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>3. Payment Terms</Text>
          <Text style={styles.paragraph}>Monthly rent and utilities are due by the 5th of each month. Late payments incur a ₱50/day penalty. Repeated non-payment may result in termination of tenancy.</Text>
        </View>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>4. House Rules</Text>
          <Text style={styles.paragraph}>All tenants must follow dormitory rules including curfew hours, visitor policies, noise regulations, and cleanliness standards.</Text>
        </View>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>5. Termination</Text>
          <Text style={styles.paragraph}>Either party may terminate the agreement with 30 days written notice. Violations of terms may result in immediate termination.</Text>
        </View>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>6. Contact</Text>
          <Text style={styles.paragraph}>For questions about these terms, contact us at legal@lilycrest.ph or visit the admin office.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border },
  backButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: c.text },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20 },
  updateDate: { fontSize: 13, color: c.textMuted, marginBottom: 24 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: c.text, marginBottom: 8 },
  paragraph: { fontSize: 14, color: c.textSecondary, lineHeight: 22 },
});
