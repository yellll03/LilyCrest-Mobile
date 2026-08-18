import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useThemedStyles } from '../src/context/ThemeContext';
import { safeBack } from '../src/utils/navigation';
import { ScreenHeader } from '../src/components/ui/LilycrestUI';

export default function TermsOfServiceScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader strong title="Terms of Service" subtitle="Tenant portal terms and responsibilities" onBack={() => safeBack(router, '/(tabs)/profile')} />
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
          <Text style={styles.paragraph}>Regular monthly rent is due on the same day number as your move-in date. A one-day grace period applies, then a ₱50/day penalty begins on the second day after the due date. Repeated non-payment may result in termination of tenancy.</Text>
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
  scrollView: { flex: 1 },
  scrollContent: { padding: 20 },
  updateDate: { fontSize: 13, color: c.textMuted, marginBottom: 24 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: c.text, marginBottom: 8 },
  paragraph: { fontSize: 14, color: c.textSecondary, lineHeight: 22 },
});
