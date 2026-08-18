import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/context/ThemeContext';
import { safeBack } from '../src/utils/navigation';
import { ScreenHeader } from '../src/components/ui/LilycrestUI';

const documents = [
  { id: 'house_rules', title: 'House Rules', icon: 'home', color: '#0A1628', background: '#FBF7EA', description: 'General dormitory guidelines', category: 'Policy' },
  { id: 'curfew_policy', title: 'Curfew Policy', icon: 'time', color: '#0A1628', background: '#FBF7EA', description: 'Entry and exit times', category: 'Policy' },
  { id: 'visitor_policy', title: 'Visitor Policy', icon: 'people', color: '#0A1628', background: '#FBF7EA', description: 'Guest registration rules', category: 'Policy' },
  { id: 'payment_terms', title: 'Payment Terms', icon: 'cash', color: '#B9921F', background: '#FBF7EA', description: 'Billing and payment policies', category: 'Billing' },
  { id: 'emergency_procedures', title: 'Emergency Procedures', icon: 'alert-circle', color: '#991B1B', background: '#FEF2F2', description: 'Safety and emergency contacts', category: 'Safety' },
  { id: 'contract', title: 'Lease Contract', icon: 'document-text', color: '#0A1628', background: '#FBF7EA', description: 'Status, dates, and agreement', category: 'Contract', contract: true },
];

export default function DocumentsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const handlePress = (doc) => router.push(doc.contract
    ? '/contract-viewer'
    : { pathname: '/document-viewer', params: { kind: 'policy', id: doc.id, title: doc.title } });

  const styles = createStyles(colors);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        strong
        title="House Rules & Documents"
        subtitle="Policies, safety guidance, and your lease"
        onBack={() => safeBack(router, '/(tabs)/home')}
      />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.infoCard}>
          <View style={styles.infoIcon}>
            <Ionicons name="information-circle" size={22} color="#2563EB" />
          </View>
          <Text style={styles.infoText}>Please read and understand all dormitory rules. Contact the admin if you have questions.</Text>
        </View>

        {documents.map((doc, index) => (
          <TouchableOpacity key={index} style={styles.documentCard} onPress={() => handlePress(doc)} activeOpacity={0.7}>
            <View style={[styles.documentIcon, { backgroundColor: doc.background }]}>
              <Ionicons name={doc.icon} size={22} color={doc.color} />
            </View>
            <View style={styles.documentContent}>
              <Text style={styles.documentTitle}>{doc.title}</Text>
              <Text style={styles.documentDescription}>{doc.description}</Text>
            </View>
            <View style={[styles.categoryTag, { backgroundColor: doc.background }]}>
              <Text style={[styles.categoryText, { color: doc.color }]}>{doc.category}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16 },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.infoBg, borderRadius: 12, padding: 14, marginBottom: 18, gap: 10, borderWidth: 1, borderColor: colors.info },
  infoIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.infoBg, justifyContent: 'center', alignItems: 'center' },
  infoText: { flex: 1, fontSize: 13, color: colors.infoText, lineHeight: 20 },
  documentCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  documentIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  documentContent: { flex: 1 },
  documentTitle: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 3 },
  documentDescription: { fontSize: 12, color: colors.textSecondary },
  categoryTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  categoryText: { fontSize: 10, fontWeight: '700' },
});
