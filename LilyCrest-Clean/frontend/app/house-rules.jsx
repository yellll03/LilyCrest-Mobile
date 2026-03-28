import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/context/ThemeContext';

const HOUSE_RULES = [
  {
    title: '1. Quiet Hours',
    icon: 'volume-mute',
    color: '#3B82F6',
    rules: [
      'Quiet hours are from 10:00 PM to 7:00 AM daily',
      'No loud music, shouting, or disruptive noise during quiet hours',
      'Keep TV and music at reasonable volumes at all times',
      'Respect neighbors who may be studying or resting'
    ]
  },
  {
    title: '2. Visitor Policy',
    icon: 'people',
    color: '#22C55E',
    rules: [
      'Visitors are allowed from 8:00 AM to 9:00 PM only',
      'All visitors must register at the front desk with valid ID',
      'No overnight guests allowed',
      'Maximum of 2 visitors per tenant at a time',
      'Tenant is responsible for visitor behavior'
    ]
  },
  {
    title: '3. Curfew',
    icon: 'time',
    color: '#F59E0B',
    rules: [
      'Main gate closes at 11:00 PM',
      'Late entry after 11PM requires prior coordination with admin',
      'Emergency late entries may incur a late fee of ₱100',
      'Repeated late entries may result in disciplinary action'
    ]
  },
  {
    title: '4. Cleanliness',
    icon: 'sparkles',
    color: '#06B6D4',
    rules: [
      'Keep your room clean and tidy at all times',
      'No food waste or perishables to be left in rooms',
      'Dispose of garbage in designated areas only',
      'Clean up immediately after using common areas',
      'Report any pest sightings to admin immediately'
    ]
  },
  {
    title: '5. Prohibited Items',
    icon: 'ban',
    color: '#EF4444',
    rules: [
      'No pets of any kind allowed',
      'No cooking appliances in rooms (rice cookers, hot plates, etc.)',
      'No smoking inside the building or common areas',
      'No alcoholic beverages in common areas',
      'No illegal substances or weapons',
      'No candles or open flames'
    ]
  },
  {
    title: '6. Common Areas',
    icon: 'home',
    color: '#9333EA',
    rules: [
      'Kitchen available from 6:00 AM to 10:00 PM',
      'Clean up after using kitchen facilities',
      'Label your food items in the refrigerator',
      'Laundry area available on scheduled days',
      'Do not leave personal items in common areas',
      'Report any damages or malfunctions immediately'
    ]
  },
  {
    title: '7. Payment',
    icon: 'card',
    color: '#D4682A',
    rules: [
      'Monthly rent is due on the 5th of each month',
      'Grace period: 2 days (until the 7th)',
      'Late fee: ₱50.00 per day after grace period',
      'Accepted payments: Bank transfer (BDO/BPI), GCash, Maya',
      'Always submit proof of payment through the app'
    ]
  },
  {
    title: '8. Safety & Security',
    icon: 'shield-checkmark',
    color: '#1E3A5F',
    rules: [
      'Always lock your room when leaving',
      'Do not share your room key with others',
      'Report any suspicious activity to security',
      'Keep emergency exits clear at all times',
      'Know the location of fire extinguishers and exits',
      'In case of emergency, call admin at +63 912 345 6789'
    ]
  }
];

export default function HouseRulesScreen() {
  const router = useRouter();
  const { colors, isDarkMode } = useTheme();

  const styles = createStyles(colors, isDarkMode);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>House Rules</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.introCard}>
          <Ionicons name="document-text" size={32} color="#D4682A" />
          <View style={styles.introContent}>
            <Text style={styles.introTitle}>LilyCrest Dormitory Rules</Text>
            <Text style={styles.introText}>Please read and follow all rules to ensure a comfortable living environment for everyone.</Text>
          </View>
        </View>

        {HOUSE_RULES.map((section, index) => (
          <View key={index} style={styles.ruleSection}>
            <View style={styles.ruleSectionHeader}>
              <View style={[styles.ruleIcon, { backgroundColor: `${section.color}20` }]}>
                <Ionicons name={section.icon} size={24} color={section.color} />
              </View>
              <Text style={styles.ruleSectionTitle}>{section.title}</Text>
            </View>
            <View style={styles.rulesList}>
              {section.rules.map((rule, ruleIndex) => (
                <View key={ruleIndex} style={styles.ruleItem}>
                  <View style={styles.bulletPoint} />
                  <Text style={styles.ruleText}>{rule}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}

        <View style={styles.warningCard}>
          <Ionicons name="warning" size={24} color="#EF4444" />
          <Text style={styles.warningText}>
            Violation of house rules may result in warnings, fines, or termination of tenancy depending on the severity and frequency of violations.
          </Text>
        </View>

        <View style={styles.contactCard}>
          <Text style={styles.contactTitle}>Questions?</Text>
          <Text style={styles.contactText}>Contact the admin office or use the chatbot for clarifications about any rules.</Text>
          <TouchableOpacity style={styles.chatButton} onPress={() => router.push('/(tabs)/chatbot')}>
            <Ionicons name="chatbubbles" size={18} color="#FFFFFF" />
            <Text style={styles.chatButtonText}>Ask Lily</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
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
  introCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: isDarkMode ? 'rgba(212,148,42,0.1)' : '#FDF6EC', borderRadius: 16, padding: 16, marginBottom: 20, gap: 14 },
  introContent: { flex: 1 },
  introTitle: { fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: 4 },
  introText: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  ruleSection: { backgroundColor: colors.surface, borderRadius: 16, marginBottom: 16, overflow: 'hidden', borderWidth: isDarkMode ? 1 : 0, borderColor: colors.border },
  ruleSectionHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 },
  ruleIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  ruleSectionTitle: { fontSize: 16, fontWeight: '600', color: colors.text, flex: 1 },
  rulesList: { padding: 16, paddingTop: 12 },
  ruleItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, gap: 10 },
  bulletPoint: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary, marginTop: 6 },
  ruleText: { flex: 1, fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  warningCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: isDarkMode ? 'rgba(239,68,68,0.1)' : '#FEE2E2', borderRadius: 12, padding: 16, marginBottom: 16, gap: 12 },
  warningText: { flex: 1, fontSize: 13, color: '#DC2626', lineHeight: 20 },
  contactCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: isDarkMode ? 1 : 0, borderColor: colors.border },
  contactTitle: { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 8 },
  contactText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
  chatButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#D4682A', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, gap: 8 },
  chatButtonText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  bottomSpacer: { height: 32 },
});
