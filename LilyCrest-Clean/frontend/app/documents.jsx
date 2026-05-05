import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/context/ThemeContext';
import { useAlert } from '../src/context/AlertContext';
import { apiService } from '../src/services/api';

const documents = [
  { title: 'House Rules', icon: 'home', color: '#F59E0B', description: 'General dormitory guidelines', category: 'Policy' },
  { title: 'Curfew Policy', icon: 'time', color: '#9333EA', description: 'Entry and exit times', category: 'Policy' },
  { title: 'Visitor Policy', icon: 'people', color: '#06B6D4', description: 'Guest registration rules', category: 'Policy' },
  { title: 'Payment Terms', icon: 'cash', color: '#ff9000', description: 'Billing and payment policies', category: 'Billing' },
  { title: 'Emergency Procedures', icon: 'alert-circle', color: '#EF4444', description: 'Safety and emergency contacts', category: 'Safety' },
  { title: 'Contract Agreement', icon: 'document-text', color: '#3B82F6', description: 'Tenancy agreement terms', category: 'Contract', download: true },
];

export default function DocumentsScreen() {
  const router = useRouter();
  const { colors, isDarkMode } = useTheme();
  const { showAlert } = useAlert();

  const handlePress = async (doc) => {
    if (doc.download) {
      const url = apiService.downloadDocumentUrl('contract');
      try {
        const supported = await Linking.canOpenURL(url);
        if (supported) {
          await Linking.openURL(url);
        } else {
          showAlert({ title: 'Unable to Open', message: 'Could not open the download link. Please try again later.', type: 'error' });
        }
      } catch (error) {
        console.error('Contract download error:', error);
        showAlert({ title: 'Download Failed', message: 'There was a problem downloading the document. Please try again.', type: 'error' });
      }
    }
  };

  const styles = createStyles(colors, isDarkMode);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>House Rules & Documents</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.infoCard}>
          <View style={styles.infoIcon}>
            <Ionicons name="information-circle" size={22} color="#3B82F6" />
          </View>
          <Text style={styles.infoText}>Please read and understand all dormitory rules. Contact the admin if you have questions.</Text>
        </View>

        {documents.map((doc, index) => (
          <TouchableOpacity key={index} style={styles.documentCard} onPress={() => handlePress(doc)} activeOpacity={0.7}>
            <View style={[styles.documentIcon, { backgroundColor: `${doc.color}12` }]}>
              <Ionicons name={doc.icon} size={22} color={doc.color} />
            </View>
            <View style={styles.documentContent}>
              <Text style={styles.documentTitle}>{doc.title}</Text>
              <Text style={styles.documentDescription}>{doc.description}</Text>
            </View>
            <View style={[styles.categoryTag, { backgroundColor: `${doc.color}12` }]}>
              <Text style={[styles.categoryText, { color: doc.color }]}>{doc.category}</Text>
            </View>
            <Ionicons name={doc.download ? "download-outline" : "chevron-forward"} size={18} color={colors.textMuted} style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  backButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: colors.text, flex: 1, textAlign: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16 },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: isDarkMode ? 'rgba(59,130,246,0.12)' : '#EFF6FF', borderRadius: 14, padding: 14, marginBottom: 18, gap: 10 },
  infoIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: isDarkMode ? 'rgba(59,130,246,0.2)' : '#DBEAFE', justifyContent: 'center', alignItems: 'center' },
  infoText: { flex: 1, fontSize: 13, color: isDarkMode ? '#93C5FD' : '#1E40AF', lineHeight: 20 },
  documentCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: isDarkMode ? 1 : 0, borderColor: colors.border, ...Platform.select({ web: { boxShadow: '0 2px 6px rgba(0,0,0,0.05)' }, default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 } }) },
  documentIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  documentContent: { flex: 1 },
  documentTitle: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 3 },
  documentDescription: { fontSize: 12, color: colors.textSecondary },
  categoryTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  categoryText: { fontSize: 10, fontWeight: '700' },
});
