import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAlert } from '../src/context/AlertContext';
import { useAuth } from '../src/context/AuthContext';
import { useTheme } from '../src/context/ThemeContext';
import { useToast } from '../src/context/ToastContext';
import { apiService, getApiErrorMessage } from '../src/services/api';
import {
  ensureFirebaseStorageAttachments,
  IMAGE_UPLOAD_MIME_TYPES,
  MAX_IMAGE_UPLOAD_BYTES,
  toStoredAttachmentMetadata,
} from '../src/services/firebaseStorageUpload';
import { safeBack } from '../src/utils/navigation';
import { getSessionToken } from '../src/services/secureCredentials';
import { useTenantContract } from '../src/hooks/useTenantContract';
import { buildContractSummary } from '../src/utils/contractPresentation';
import { ScreenHeader } from '../src/components/ui/LilycrestUI';

// ── Document types for upload picker ──
const UPLOAD_TYPES = [
  { key: 'government_id', label: 'Government ID', icon: 'card', color: '#0A1628' },
  { key: 'passport', label: 'Passport', icon: 'globe', color: '#0A1628' },
  { key: 'drivers_license', label: "Driver's License", icon: 'car', color: '#0A1628' },
  { key: 'student_id', label: 'Student ID', icon: 'school', color: '#0A1628' },
  { key: 'company_id', label: 'Company/Employee ID', icon: 'business', color: '#0A1628' },
  { key: 'lease_extension', label: 'Lease Extension', icon: 'document-attach', color: '#B9921F' },
  { key: 'proof_of_income', label: 'Proof of Income', icon: 'cash', color: '#0A1628' },
  { key: 'authorization_letter', label: 'Authorization Letter', icon: 'mail', color: '#0A1628' },
  { key: 'other', label: 'Other Document', icon: 'document', color: '#0A1628' },
];

// ── Policy document registry ──
const POLICY_DOCUMENTS = [
  {
    id: 'contract', title: 'Lease Contract', description: 'Your rental agreement with LilyCrest', icon: 'document-text',
    color: '#0A1628', category: 'Policies', status: 'Available',
  },
  {
    id: 'house_rules', title: 'House Rules', description: 'General dormitory guidelines and policies', icon: 'home',
    color: '#0A1628', category: 'Policies', status: 'Active',
  },
  {
    id: 'curfew_policy', title: 'Curfew Policy', description: 'Entry and exit time guidelines', icon: 'time',
    color: '#0A1628', category: 'Policies', status: 'Active',
  },
  {
    id: 'visitor_policy', title: 'Visitor Policy', description: 'Guest registration and visitation rules', icon: 'people',
    color: '#0A1628', category: 'Policies', status: 'Active',
  },
  {
    id: 'payment_terms', title: 'Payment Terms', description: 'Billing methods, due dates, and late fees', icon: 'cash',
    color: '#B9921F', category: 'Billing', status: 'Active',
  },
  {
    id: 'emergency_procedures', title: 'Emergency Procedures', description: 'Safety protocols and emergency contacts', icon: 'alert-circle',
    color: '#991B1B', category: 'Safety', status: 'Active',
  },
];

const CATEGORIES = [
  { key: 'Personal', icon: 'person', color: '#0A1628', label: 'My Documents' },
  { key: 'Policies', icon: 'shield-checkmark', color: '#0A1628', label: 'Dormitory Policies' },
  { key: 'Billing', icon: 'wallet', color: '#B9921F', label: 'Billing & Payments' },
  { key: 'Safety', icon: 'warning', color: '#991B1B', label: 'Safety & Emergency' },
];

// ── Structured document content for rich preview ──
function getDocumentSections(docId, user) {
  const today = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  const userName = user?.name || '';
  const userEmail = user?.email || '';

  const docs = {
    contract: undefined && {
      header: 'Lease Contract Agreement',
      subtitle: user?.branch?.branchName || 'LilyCrest Dormitory',
      date: today,
      sections: [
        { title: 'Tenant Information', items: [{ label: 'Name', value: userName }, { label: 'Email', value: userEmail }, { label: 'Status', value: 'Active Tenant', badge: true }] },
        { title: 'Rental Period', text: 'Refer to the authenticated approved lease PDF.' },
        { title: 'Payment Terms', text: 'Refer to the authenticated approved lease PDF.' },
        { title: 'Terms', text: 'Refer to the authenticated approved lease PDF.' },
      ],
    },
    house_rules: {
      header: 'House Rules',
      subtitle: 'LilyCrest Dormitory Guidelines',
      sections: [
        { title: 'Quiet Hours (10 PM - 7 AM)', bullets: ['No loud music or disruptive noise', 'Keep TV/music at reasonable volumes', 'Respect neighbors who may be resting'] },
        { title: 'Visitor Policy', bullets: ['Visitors allowed 8:00 AM - 9:00 PM only', 'Must register at front desk with valid ID', 'No overnight guests allowed', 'Max 2 visitors per tenant at a time'] },
        { title: 'Curfew', bullets: ['Main gate closes at 11:00 PM', 'Late entry requires prior coordination', 'Emergency late fee: PHP 100'] },
        { title: 'Cleanliness', bullets: ['Keep your room clean and tidy', 'No food waste in rooms', 'Dispose garbage properly', 'Report pest sightings immediately'] },
        { title: 'Prohibited Items', bullets: ['No pets of any kind', 'No cooking appliances in rooms', 'No smoking inside the building', 'No illegal substances or weapons'] },
        { title: 'Common Areas', bullets: ['Kitchen hours: 6:00 AM - 10:00 PM', 'Clean up after using facilities', 'Label food items in refrigerator'] },
        { title: 'Violations', text: 'May result in warnings, fines, or termination of tenancy.' },
      ],
    },
    curfew_policy: {
      header: 'Curfew Policy',
      subtitle: 'Entry & Exit Time Guidelines',
      sections: [
        { title: 'Effective Hours', items: [{ label: 'Gate Closes', value: '11:00 PM' }, { label: 'Gate Opens', value: '5:00 AM' }, { label: 'Quiet Hours', value: '10:00 PM – 7:00 AM' }] },
        { title: 'Late Entry Procedure', bullets: ['Coordinate with admin BEFORE 9:00 PM if expecting to arrive late', 'Call emergency hotline: +63 912 345 6790', 'Emergency late entry fee: ₱100 (waived for documented emergencies)', 'Security will verify identity before entry'] },
        { title: 'Repeated Violations', items: [{ label: '1st Offense', value: 'Verbal warning' }, { label: '2nd Offense', value: 'Written warning' }, { label: '3rd Offense', value: '₱500 fine' }, { label: '4th Offense', value: 'Tenancy review' }] },
        { title: 'Exceptions', bullets: ['Medical emergencies (with documentation)', 'Work requirements (with employer letter)', 'Pre-approved overnight activities'] },
      ],
    },
    visitor_policy: {
      header: 'Visitor Policy',
      subtitle: 'Guest Registration & Visitation',
      sections: [
        { title: 'Visiting Hours', text: 'Monday – Sunday: 8:00 AM to 9:00 PM' },
        { title: 'Registration', bullets: ['All visitors must register at the front desk', 'Present valid government-issued ID', 'Tenant must be present to receive visitor', 'Sign in and sign out required'] },
        { title: 'Limits', items: [{ label: 'Max Visitors', value: '2 per tenant at a time' }, { label: 'Overnight', value: 'Not allowed' }, { label: 'Room Access', value: 'Until 8:00 PM only' }] },
        { title: 'Tenant Responsibilities', text: 'Tenants are responsible for their visitor\'s behavior. Any damage caused by visitors will be charged to the tenant. Violations may result in visitor bans.' },
        { title: 'Special Occasions', text: 'For events or gatherings, submit a request to admin at least 3 days in advance.' },
      ],
    },
    payment_terms: {
      header: 'Payment Terms',
      subtitle: 'Billing & Payment Information',
      sections: [
        { title: 'Due Date', items: [{ label: 'Monthly Due', value: 'Same day number as move-in date' }, { label: 'Grace Period', value: '1 day' }, { label: 'Late Fee', value: '₱50/day beginning on day two after due date' }] },
        {
          title: 'Payment Methods', subsections: [
            { label: 'Bank Transfer', detail: 'BDO: 1234-5678-9012 / BPI: 9876-5432-1098\nAccount Name: LilyCrest Properties Inc.' },
            { label: 'GCash / Maya', detail: 'Number: 0912 345 6789\nName: LilyCrest Properties' },
            { label: 'Cash', detail: 'Admin Office: Mon-Sat, 8:00 AM - 5:00 PM' },
          ]
        },
        { title: 'Important Reminders', bullets: ['Use the secure Billing checkout for online payments', 'Keep your transaction receipts', 'Online payments are confirmed through the payment provider'] },
        { title: 'Utilities', items: [{ label: 'Water', value: 'Included' }, { label: 'WiFi', value: 'Included' }, { label: 'Electricity', value: 'Separate (sub-metered)' }] },
        { title: 'Non-Payment Consequences', items: [{ label: '15 days overdue', value: 'Final notice' }, { label: '30 days overdue', value: 'Service restrictions' }, { label: '45 days overdue', value: 'Tenancy review' }] },
      ],
    },
    emergency_procedures: {
      header: 'Emergency Procedures',
      subtitle: 'Safety Protocols & Contacts',
      sections: [
        { title: 'Emergency Contacts', items: [{ label: 'Dorm Admin', value: '+63 912 345 6789' }, { label: 'Emergency Hotline', value: '+63 912 345 6790' }, { label: 'Building Security', value: '24/7' }] },
        { title: 'Emergency Services', items: [{ label: 'Police (Makati)', value: '911 / (02) 8899-4083' }, { label: 'Fire Department', value: '911 / (02) 8807-8850' }, { label: 'Ambulance (Red Cross)', value: '(02) 8527-0000' }] },
        { title: 'Nearest Hospitals', items: [{ label: 'Makati Medical Center', value: '(02) 8888-8999 (~2 km)' }, { label: 'Ospital ng Makati', value: '(02) 8882-5802 (~1.5 km)' }] },
        { title: 'Fire Emergency', bullets: ['Sound the alarm / Shout "FIRE!"', 'Do NOT use elevators', 'Use nearest fire exit', 'Meet at assembly point (parking lot)', 'Call Fire Department: 911'] },
        { title: 'Earthquake', bullets: ['DROP, COVER, and HOLD ON', 'Stay away from windows', 'After shaking: evacuate if building is damaged', 'Meet at assembly point'] },
        { title: 'Medical Emergency', bullets: ['Call security immediately', 'Do not move the injured person', 'Admin will coordinate ambulance'] },
      ],
    },
  };
  return docs[docId] || null;
}

// ── Section Renderer for Rich Preview ──
function PreviewSection({ section, colors, isDarkMode }) {
  if (section.items) {
    return (
      <View style={pStyles.section}>
        <Text style={[pStyles.sectionTitle, { color: colors.text }]}>{section.title}</Text>
        {section.items.map((item, i) => (
          <View key={i} style={pStyles.row}>
            <Text style={[pStyles.rowLabel, { color: colors.textSecondary }]}>{item.label}</Text>
            {item.badge ? (
              <View style={pStyles.badge}><Text style={pStyles.badgeText}>{item.value}</Text></View>
            ) : (
              <Text style={[pStyles.rowValue, { color: colors.text }]}>{item.value}</Text>
            )}
          </View>
        ))}
      </View>
    );
  }
  if (section.bullets) {
    return (
      <View style={pStyles.section}>
        <Text style={[pStyles.sectionTitle, { color: colors.text }]}>{section.title}</Text>
        {section.bullets.map((b, i) => (
          <View key={i} style={pStyles.bulletRow}>
            <View style={[pStyles.bulletDot, { backgroundColor: colors.primary }]} />
            <Text style={[pStyles.bulletText, { color: colors.textSecondary }]}>{b}</Text>
          </View>
        ))}
      </View>
    );
  }
  if (section.subsections) {
    return (
      <View style={pStyles.section}>
        <Text style={[pStyles.sectionTitle, { color: colors.text }]}>{section.title}</Text>
        {section.subsections.map((sub, i) => (
          <View key={i} style={[pStyles.subCard, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.04)' : '#F8FAFC', borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : '#E5E7EB' }]}>
            <Text style={[pStyles.subLabel, { color: colors.text }]}>{sub.label}</Text>
            <Text style={[pStyles.subDetail, { color: colors.textSecondary }]}>{sub.detail}</Text>
          </View>
        ))}
      </View>
    );
  }
  if (section.text) {
    return (
      <View style={pStyles.section}>
        <Text style={[pStyles.sectionTitle, { color: colors.text }]}>{section.title}</Text>
        <Text style={[pStyles.sectionText, { color: colors.textSecondary }]}>{section.text}</Text>
      </View>
    );
  }
  return null;
}

const pStyles = StyleSheet.create({
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 10 },
  sectionText: { fontSize: 14, lineHeight: 22 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.06)' },
  rowLabel: { fontSize: 13, fontWeight: '500' },
  rowValue: { fontSize: 13, fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 12 },
  badge: { backgroundColor: '#ECFDF5', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 12, fontWeight: '700', color: '#065F46' },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  bulletText: { fontSize: 14, lineHeight: 22, flex: 1 },
  subCard: { padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  subLabel: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  subDetail: { fontSize: 13, lineHeight: 20 },
});

// ── Status badge color ──
function statusColor(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (['verified', 'active', 'available', 'approved', 'final notarized contract'].includes(normalized)) {
    return { bg: '#ECFDF5', text: '#065F46', solid: '#059669' };
  }
  if (['pending', 'pending_review', 'under review', 'generated draft — for signing'].includes(normalized)) {
    return { bg: '#FFFBEB', text: '#92400E', solid: '#D97706' };
  }
  if (normalized === 'rejected') return { bg: '#FEF2F2', text: '#991B1B', solid: '#DC2626' };
  if (normalized === 'on file') return { bg: '#EFF6FF', text: '#1E40AF', solid: '#2563EB' };
  return { bg: '#F1F5F9', text: '#4B5563', solid: '#6B7280' };
}

function statusLabel(status) {
  switch (status) {
    case 'pending_review': return 'Pending Review';
    case 'verified': return 'Verified';
    case 'rejected': return 'Rejected';
    default: return status || 'Active';
  }
}

// ── Main Screen ──
export default function MyDocumentsScreen() {
  const router = useRouter();
  const { user, authReady, authStatus } = useAuth();
  const { colors, isDarkMode } = useTheme();
  const { showAlert } = useAlert();
  const { showToast } = useToast();
  const [downloading, setDownloading] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [activeCategory, setActiveCategory] = useState(null);
  const [uploadedDocs, setUploadedDocs] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [showUploadPicker, setShowUploadPicker] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingDocId, setDeletingDocId] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [docsError, setDocsError] = useState('');
  const userId = user?.user_id || user?.id || null;

  // Fetch uploaded documents
  const fetchUploadedDocs = useCallback(async ({ showLoader = true } = {}) => {
    if (!authReady) {
      if (showLoader) setLoadingDocs(true);
      setRefreshing(false);
      return;
    }
    if (authStatus !== 'authenticated' || !userId) {
      setUploadedDocs([]);
      setDocsError('Please sign in to view your documents.');
      setLoadingDocs(false);
      setRefreshing(false);
      return;
    }

    try {
      if (showLoader) setLoadingDocs(true);
      setDocsError('');
      const response = await apiService.getUserDocuments();
      setUploadedDocs(response?.data || []);
    } catch (error) {
      console.warn('Failed to fetch documents:', error?.normalized || error?.message);
      setDocsError(getApiErrorMessage(error, 'Unable to load documents. Pull to retry.'));
    } finally {
      if (showLoader) setLoadingDocs(false);
      setRefreshing(false);
    }
  }, [authReady, authStatus, userId]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchUploadedDocs({ showLoader: false });
  }, [fetchUploadedDocs]);

  useEffect(() => {
    if (!authReady || authStatus !== 'authenticated' || !userId) return;
    fetchUploadedDocs();
  }, [authReady, authStatus, fetchUploadedDocs, userId]);

  const { contract: tenantContract, error: contractError } = useTenantContract();

  // Group policy documents by category
  const groupedPolicies = useMemo(() => {
    const map = {};
    POLICY_DOCUMENTS.forEach(sourceDoc => {
      const doc = sourceDoc.id === 'contract'
        ? {
            ...sourceDoc,
            // A short lifecycle label ("Final Notarized Contract" / "Preparing
            // Contract"), not contract.displayStatus's full sentence — this
            // renders inside a small status pill next to the title, and a
            // long sentence there breaks the row layout (see statusColor()'s
            // 'final notarized contract' case, sized for this short label).
            status: tenantContract ? (buildContractSummary(tenantContract)?.lifecycleLabel || 'Available') : 'Not Available',
            description: tenantContract
              ? sourceDoc.description
              : (contractError || 'No current contract is available.'),
          }
        : sourceDoc;
      if (!map[doc.category]) map[doc.category] = [];
      map[doc.category].push(doc);
    });
    return map;
  }, [tenantContract, contractError]);

  const visibleCategories = activeCategory
    ? CATEGORIES.filter(c => c.key === activeCategory)
    : CATEGORIES;

  const handlePreview = (doc) => {
    if (doc.id === 'contract') {
      router.push('/contract-viewer');
      return;
    }
    const sections = getDocumentSections(doc.id, user);
    setPreviewDoc({ ...doc, ...sections });
    setShowPreview(true);
  };

  const closePreview = useCallback(() => {
    setShowPreview(false);
  }, []);

  const clearClosedPreview = useCallback(() => {
    setPreviewDoc(null);
  }, []);

  const handleDownload = async (doc) => {
    if (doc.id === 'contract') {
      router.push('/contract-viewer');
      return;
    }
    try {
      setDownloading(doc.id);
      const fileName = `LilyCrest_${doc.title.replace(/\s+/g, '_')}.pdf`;
      const downloadUrl = apiService.downloadDocumentUrl(doc.id);
      const token = await getSessionToken();

      if (Platform.OS === 'web') {
        const response = await fetch(downloadUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        window.URL.revokeObjectURL(url);
        showToast({ type: 'success', title: 'Download Complete', message: `${doc.title} downloaded successfully.` });
      } else {
        const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
        const dl = FileSystem.createDownloadResumable(downloadUrl, fileUri, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const { uri } = await dl.downloadAsync();
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `${doc.title} PDF` });
        } else {
          showToast({ type: 'success', title: 'Saved', message: `${doc.title} saved successfully.` });
        }
      }
    } catch (error) {
      console.error('Download error:', error?.message || error);
      showToast({ type: 'error', title: 'Download Failed', message: getApiErrorMessage(error, 'Failed to download document. Please try again.') });
    } finally {
      setDownloading(null);
    }
  };

  // ── Upload document ──
  const handleUpload = async (docType) => {
    setShowUploadPicker(false);
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        showAlert({ title: 'Permission Required', message: 'Please allow access to your photo library to upload documents.', type: 'warning' });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.7,
        base64: false,
      });

      const asset = result.assets?.[0];
      if (result.canceled || !asset?.uri) return;

      const attachment = {
        name: asset.fileName || asset.uri?.split('/')?.pop() || `${docType.key}.jpg`,
        uri: asset.uri,
        type: asset.mimeType || 'image/jpeg',
        size: asset.fileSize || asset.size,
      };

      if (attachment.size && attachment.size > MAX_IMAGE_UPLOAD_BYTES) {
        showAlert({ title: 'File Too Large', message: 'Please select a file under 5 MB.', type: 'warning' });
        return;
      }

      setUploading(true);
      setUploadStatus('Uploading attachment...');
      const [uploadedDocument] = await ensureFirebaseStorageAttachments([attachment], {
        allowedMimeTypes: IMAGE_UPLOAD_MIME_TYPES,
        entityId: docType.key,
        folder: 'tenant-documents',
        maxBytes: MAX_IMAGE_UPLOAD_BYTES,
        tenantId: user?.user_id || user?.id || 'unknown-tenant',
      });
      setUploadStatus('Attachment uploaded');

      await apiService.uploadUserDocument({
        type: docType.key,
        label: docType.label,
        ...toStoredAttachmentMetadata(uploadedDocument),
      });

      await fetchUploadedDocs();
      showToast({
        type: 'success',
        title: 'Upload Successful',
        message: `${docType.label} uploaded successfully. It will be reviewed by the admin.`,
      });
    } catch (error) {
      console.error('Upload error:', error?.message || error);
      setUploadStatus('Upload failed, please retry');
      showToast({
        type: 'error',
        title: 'Upload Failed',
        message: getApiErrorMessage(error, error?.message || 'Please try again.'),
      });
    } finally {
      setUploading(false);
    }
  };

  // ── Delete document ──
  const handleDelete = async (docId) => {
    if (!docId || deletingDocId) return;

    setDeleteTarget(null);
    setDeletingDocId(docId);
    try {
      await apiService.deleteUserDocument(docId);
      setUploadedDocs(prev => prev.filter(d => d.doc_id !== docId));
      showToast({
        type: 'success',
        title: 'Deleted',
        message: 'Successfully deleted the document.',
      });
    } catch (error) {
      console.error('Delete error:', error?.message || error);
      showToast({
        type: 'error',
        title: 'Delete Failed',
        message: getApiErrorMessage(error, 'Failed to delete document. Please try again.'),
      });
    } finally {
      setDeletingDocId(null);
    }
  };

  // ── View uploaded document image ──
  const handleViewUploadedDoc = async (doc) => {
    try {
      const mimeType = String(doc.mimeType || '').toLowerCase();
      const isPdf = mimeType === 'application/pdf' || doc.doc_id.endsWith('_contract');
      const isImage = mimeType.startsWith('image/') || ['government_id', 'company_id'].includes(doc.type);
      if (isPdf) {
        router.push({ pathname: '/document-viewer', params: { kind: 'user', id: doc.doc_id, title: doc.label || 'Document' } });
      } else if (isImage) {
        router.push({ pathname: '/image-viewer', params: { id: doc.doc_id, title: doc.label || 'Document' } });
      } else {
        setPreviewImage({
          label: doc.label,
          status: doc.status,
          uploaded_at: doc.uploaded_at,
          source: doc.source,
          error: 'Document file is missing or no longer available.',
        });
      }
    } catch (error) {
      console.error('View doc error:', error?.message || error);
      showAlert({ title: 'Error', message: getApiErrorMessage(error, 'Failed to load document.'), type: 'error' });
    }
  };

  const styles = createStyles(colors, isDarkMode);

  const ID_TYPES = ['government_id', 'passport', 'drivers_license', 'student_id', 'company_id'];

  // Contracts generated by LilyCrest are immutable tenant records, just like
  // reservation documents. Only documents explicitly uploaded by the tenant
  // belong in the deletable groups below.
  const immutableSources = new Set(['reservation', 'generated_contract']);
  const reservationDocs = uploadedDocs.filter(d => immutableSources.has(d.source));
  const userUploadedDocs = uploadedDocs.filter(d => !immutableSources.has(d.source));

  // Split within each source
  const reservationIdDocs = reservationDocs.filter(d => ID_TYPES.includes(d.type));
  const reservationOtherDocs = reservationDocs.filter(d => !ID_TYPES.includes(d.type));
  const idDocs = userUploadedDocs.filter(d => ID_TYPES.includes(d.type));
  const otherDocs = userUploadedDocs.filter(d => !ID_TYPES.includes(d.type));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        strong
        title="My Documents"
        subtitle={`${POLICY_DOCUMENTS.length + uploadedDocs.length} records and policies`}
        onBack={() => safeBack(router)}
      />

      {/* Category Filter Chips */}
      <View style={styles.chipBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chip, !activeCategory && styles.chipActive]}
            onPress={() => setActiveCategory(null)}
          >
            <Ionicons name="apps" size={14} color={!activeCategory ? '#0A1628' : colors.textMuted} />
            <Text style={[styles.chipText, !activeCategory && styles.chipTextActive]}>All</Text>
          </TouchableOpacity>
          {CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat.key}
              style={[styles.chip, activeCategory === cat.key && styles.chipActive]}
              onPress={() => setActiveCategory(prev => prev === cat.key ? null : cat.key)}
            >
              <Ionicons name={cat.icon} size={14} color={activeCategory === cat.key ? '#0A1628' : colors.textMuted} />
              <Text style={[styles.chipText, activeCategory === cat.key && styles.chipTextActive]}>{cat.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Document List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[colors.accent]}
            tintColor={colors.accent}
          />
        )}
      >
        {docsError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="warning" size={15} color="#92400E" />
            <Text style={styles.errorBannerText}>{docsError}</Text>
            <TouchableOpacity onPress={() => fetchUploadedDocs({ showLoader: false })}>
              <Text style={styles.errorRetryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ── Personal Documents (Uploaded IDs & Documents) ── */}
        {(!activeCategory || activeCategory === 'Personal') && (
          <View style={styles.categoryGroup}>
            <View style={styles.categoryHeader}>
              <View style={[styles.categoryIcon, { backgroundColor: '#2563EB15' }]}>
                <Ionicons name="person" size={16} color="#2563EB" />
              </View>
              <Text style={styles.categoryTitle}>My Documents</Text>
              <TouchableOpacity
                style={styles.uploadButton}
                onPress={() => {
                  setUploadStatus('');
                  setShowUploadPicker(true);
                }}
                disabled={uploading || Boolean(deletingDocId)}
              >
                {uploading ? (
                  <ActivityIndicator size="small" color="#0A1628" />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={14} color="#0A1628" />
                    <Text style={styles.uploadButtonText}>Upload</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
            {uploadStatus ? (
              <Text style={[styles.emptyUploadHint, { marginBottom: 10, textAlign: 'left' }]}>
                {uploadStatus}
              </Text>
            ) : null}

            {/* ── Reservation Documents (submitted during web reservation) ── */}
            {reservationDocs.length > 0 && (
              <View style={styles.subSection}>
                <View style={styles.reservationBadgeRow}>
                  <Ionicons name="checkmark-circle" size={14} color="#059669" />
                  <Text style={styles.reservationBadgeText}>Submitted During Reservation</Text>
                </View>
                {reservationIdDocs.length > 0 && (
                  <>
                    <Text style={styles.subSectionTitle}>Valid IDs</Text>
                    {reservationIdDocs.map(doc => {
                      const sc = statusColor(doc.status);
                      const typeInfo = UPLOAD_TYPES.find(t => t.key === doc.type);
                      return (
                        <TouchableOpacity key={doc.doc_id} style={styles.uploadedDocCard} onPress={() => handleViewUploadedDoc(doc)} activeOpacity={0.7}>
                          <View style={[styles.uploadedDocIcon, { backgroundColor: `${typeInfo?.color || '#6B7280'}12` }]}>
                            <Ionicons name={typeInfo?.icon || 'card'} size={22} color={typeInfo?.color || '#6B7280'} />
                          </View>
                          <View style={styles.uploadedDocContent}>
                            <View style={styles.uploadedDocTitleRow}>
                              <Text style={styles.uploadedDocTitle} numberOfLines={1}>{doc.label}</Text>
                              <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                                <Text style={[styles.statusText, { color: sc.text }]}>{statusLabel(doc.status)}</Text>
                              </View>
                            </View>
                            <Text style={styles.uploadedDocDate}>
                              Submitted {new Date(doc.uploaded_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </Text>
                          </View>
                          <View style={styles.reservationLock}>
                            <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}
                {reservationOtherDocs.length > 0 && (
                  <>
                    <Text style={[styles.subSectionTitle, reservationIdDocs.length > 0 && { marginTop: 12 }]}>Other Documents</Text>
                    {reservationOtherDocs.map(doc => {
                      const sc = statusColor(doc.status);
                      const typeInfo = UPLOAD_TYPES.find(t => t.key === doc.type);
                      return (
                        <TouchableOpacity key={doc.doc_id} style={styles.uploadedDocCard} onPress={() => handleViewUploadedDoc(doc)} activeOpacity={0.7}>
                          <View style={[styles.uploadedDocIcon, { backgroundColor: `${typeInfo?.color || '#6B7280'}12` }]}>
                            <Ionicons name={typeInfo?.icon || 'document'} size={22} color={typeInfo?.color || '#6B7280'} />
                          </View>
                          <View style={styles.uploadedDocContent}>
                            <View style={styles.uploadedDocTitleRow}>
                              <Text style={styles.uploadedDocTitle} numberOfLines={1}>{doc.label}</Text>
                              <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                                <Text style={[styles.statusText, { color: sc.text }]}>{statusLabel(doc.status)}</Text>
                              </View>
                            </View>
                            <Text style={styles.uploadedDocDate}>
                              Submitted {new Date(doc.uploaded_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </Text>
                          </View>
                          <View style={styles.reservationLock}>
                            <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}
              </View>
            )}

            {/* ── User-Uploaded Valid IDs ── */}
            {idDocs.length > 0 && (
              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>Valid IDs</Text>
                {idDocs.map(doc => {
                  const sc = statusColor(doc.status);
                  const typeInfo = UPLOAD_TYPES.find(t => t.key === doc.type);
                  return (
                    <TouchableOpacity key={doc.doc_id} style={styles.uploadedDocCard} onPress={() => handleViewUploadedDoc(doc)} activeOpacity={0.7}>
                      <View style={[styles.uploadedDocIcon, { backgroundColor: `${typeInfo?.color || '#6B7280'}12` }]}>
                        <Ionicons name={typeInfo?.icon || 'card'} size={22} color={typeInfo?.color || '#6B7280'} />
                      </View>
                      <View style={styles.uploadedDocContent}>
                        <View style={styles.uploadedDocTitleRow}>
                          <Text style={styles.uploadedDocTitle} numberOfLines={1}>{doc.label}</Text>
                          <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                            <Text style={[styles.statusText, { color: sc.text }]}>{statusLabel(doc.status)}</Text>
                          </View>
                        </View>
                        <Text style={styles.uploadedDocDate}>
                          Uploaded {new Date(doc.uploaded_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        onPress={(e) => { e.stopPropagation(); setDeleteTarget(doc); }}
                        disabled={Boolean(deletingDocId)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="trash-outline" size={16} color="#DC2626" />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* ── User-Uploaded Other Documents ── */}
            {otherDocs.length > 0 && (
              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>Documents Uploaded</Text>
                {otherDocs.map(doc => {
                  const sc = statusColor(doc.status);
                  const typeInfo = UPLOAD_TYPES.find(t => t.key === doc.type);
                  return (
                    <TouchableOpacity key={doc.doc_id} style={styles.uploadedDocCard} onPress={() => handleViewUploadedDoc(doc)} activeOpacity={0.7}>
                      <View style={[styles.uploadedDocIcon, { backgroundColor: `${typeInfo?.color || '#6B7280'}12` }]}>
                        <Ionicons name={typeInfo?.icon || 'document'} size={22} color={typeInfo?.color || '#6B7280'} />
                      </View>
                      <View style={styles.uploadedDocContent}>
                        <View style={styles.uploadedDocTitleRow}>
                          <Text style={styles.uploadedDocTitle} numberOfLines={1}>{doc.label}</Text>
                          <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                            <Text style={[styles.statusText, { color: sc.text }]}>{statusLabel(doc.status)}</Text>
                          </View>
                        </View>
                        <Text style={styles.uploadedDocDate}>
                          Uploaded {new Date(doc.uploaded_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        onPress={(e) => { e.stopPropagation(); setDeleteTarget(doc); }}
                        disabled={Boolean(deletingDocId)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="trash-outline" size={16} color="#DC2626" />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Empty state for no uploaded docs */}
            {uploadedDocs.length === 0 && !loadingDocs && (
              <View style={styles.emptyUpload}>
                <Ionicons name="cloud-upload-outline" size={36} color={colors.textMuted} />
                <Text style={styles.emptyUploadTitle}>No documents uploaded yet</Text>
                <Text style={styles.emptyUploadHint}>Tap &quot;Upload&quot; above to submit your Valid ID or documents</Text>
              </View>
            )}

            {loadingDocs && uploadedDocs.length === 0 && (
              <View style={styles.emptyUpload}>
                <ActivityIndicator size="small" color={colors.textMuted} />
                <Text style={styles.emptyUploadHint}>Loading documents...</Text>
              </View>
            )}

            {/* Info card about stay extension */}
            <View style={styles.extensionInfoCard}>
              <Ionicons name="information-circle" size={20} color="#2563EB" />
              <Text style={styles.extensionInfoText}>
                Need to extend your stay? Upload updated Valid IDs and required documents here. The admin will review and process your extension.
              </Text>
            </View>
          </View>
        )}

        {/* ── Policy & Other Document Categories ── */}
        {visibleCategories.filter(c => c.key !== 'Personal').map(cat => {
          const docs = groupedPolicies[cat.key];
          if (!docs?.length) return null;
          return (
            <View key={cat.key} style={styles.categoryGroup}>
              <View style={styles.categoryHeader}>
                <View style={[styles.categoryIcon, { backgroundColor: `${cat.color}15` }]}>
                  <Ionicons name={cat.icon} size={16} color={cat.color} />
                </View>
                <Text style={styles.categoryTitle}>{cat.label}</Text>
                <View style={styles.countBadge}><Text style={styles.countText}>{docs.length}</Text></View>
              </View>

              {docs.map(doc => {
                const sc = statusColor(doc.status);
                return (
                  <TouchableOpacity key={doc.id} style={styles.documentCard} onPress={() => handlePreview(doc)} activeOpacity={0.7}>
                    <View style={[styles.documentIcon, { backgroundColor: `${doc.color}12` }]}>
                      <Ionicons name={doc.icon} size={24} color={doc.color} />
                    </View>
                    <View style={styles.documentContent}>
                      <View style={styles.docTitleRow}>
                        <Text style={styles.documentTitle}>{doc.title}</Text>
                        <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                          <Text style={[styles.statusText, { color: sc.text }]}>{doc.status}</Text>
                        </View>
                      </View>
                      <Text style={styles.documentDescription} numberOfLines={1}>{doc.description}</Text>
                    </View>
                    <View style={styles.actionButtons}>
                      <TouchableOpacity
                        style={[styles.downloadButton, downloading === doc.id && styles.downloadButtonDisabled]}
                        onPress={(e) => { e.stopPropagation(); handleDownload(doc); }}
                        disabled={downloading === doc.id}
                      >
                        {downloading === doc.id ? (
                          <ActivityIndicator size="small" color="#0A1628" />
                        ) : (
                          <Ionicons name="download-outline" size={18} color="#0A1628" />
                        )}
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}

        <View style={styles.helpCard}>
          <Ionicons name="help-circle" size={22} color="#D4AF37" />
          <Text style={styles.helpText}>Need a document not listed here? Contact the admin office or chat with Lily for assistance.</Text>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Upload Type Picker Modal ── */}
      <Modal visible={showUploadPicker} transparent animationType="slide" onRequestClose={() => setShowUploadPicker(false)}>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Select Document Type</Text>
            <Text style={styles.pickerSubtitle}>Choose the type of document you&apos;re uploading</Text>
            <ScrollView style={styles.pickerList} showsVerticalScrollIndicator={false}>
              {UPLOAD_TYPES.map(type => (
                <TouchableOpacity key={type.key} style={styles.pickerItem} onPress={() => handleUpload(type)} activeOpacity={0.7}>
                  <View style={[styles.pickerItemIcon, { backgroundColor: `${type.color}15` }]}>
                    <Ionicons name={type.icon} size={20} color={type.color} />
                  </View>
                  <Text style={styles.pickerItemLabel}>{type.label}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.pickerCancel} onPress={() => setShowUploadPicker(false)}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Delete Confirmation Modal ── */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalIconWrap}><Ionicons name="trash-outline" size={32} color="#DC2626" /></View>
            <Text style={styles.modalTitle}>Delete Document?</Text>
            <Text style={styles.modalMessage}>Are you sure you want to delete &quot;{deleteTarget?.label}&quot;? This action cannot be undone.</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setDeleteTarget(null)} disabled={Boolean(deletingDocId)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalDeleteBtn} onPress={() => handleDelete(deleteTarget?.doc_id)} disabled={Boolean(deletingDocId)}>
                {deletingDocId === deleteTarget?.doc_id ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalDeleteText}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Image Preview Modal ── */}
      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <SafeAreaView style={styles.imagePreviewContainer}>
          <View style={styles.imagePreviewHeader}>
            <TouchableOpacity onPress={() => setPreviewImage(null)} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.imagePreviewTitle} numberOfLines={1}>{previewImage?.label || 'Document'}</Text>
              {previewImage?.status && (
                <View style={[styles.statusBadge, { backgroundColor: statusColor(previewImage.status).bg, marginTop: 4 }]}>
                  <Text style={[styles.statusText, { color: statusColor(previewImage.status).text }]}>{statusLabel(previewImage.status)}</Text>
                </View>
              )}
            </View>
            <View style={{ width: 40 }} />
          </View>
          <View style={styles.imagePreviewBody}>
            {previewImage?.uri ? (
              <Image
                source={{ uri: previewImage.uri }}
                style={styles.imagePreviewImage}
                resizeMode="contain"
                onError={() => setPreviewImage((prev) => prev ? { ...prev, uri: '', error: 'Could not load this document preview.' } : prev)}
              />
            ) : (
              <View style={{ alignItems: 'center', gap: 10, paddingHorizontal: 28 }}>
                <Ionicons name="document-text-outline" size={42} color={colors.textMuted} />
                <Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 14 }}>
                  {previewImage?.error || 'Document preview is unavailable.'}
                </Text>
              </View>
            )}
          </View>
          {previewImage?.uploaded_at && (
            <Text style={styles.imagePreviewDate}>
              {previewImage.source === 'reservation' ? 'Submitted during reservation' : 'Uploaded'} {new Date(previewImage.uploaded_at).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
            </Text>
          )}
        </SafeAreaView>
      </Modal>

      {/* ── Rich Document Preview Modal ── */}
      <Modal
        visible={showPreview}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        allowSwipeDismissal={Platform.OS === 'ios'}
        onRequestClose={closePreview}
        onDismiss={clearClosedPreview}
      >
        <SafeAreaView style={styles.previewContainer}>
          <View style={styles.previewHeader}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={closePreview}
              hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Close document preview"
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.previewHeaderTitle} numberOfLines={1}>{previewDoc?.title || 'Document'}</Text>
            <TouchableOpacity style={styles.downloadBtnSmall} onPress={() => { setShowPreview(false); handleDownload(previewDoc); }}>
              <Ionicons name="download-outline" size={22} color={colors.primary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.previewScroll} contentContainerStyle={styles.previewScrollContent}>
            {previewDoc?.header && (
              <View style={[styles.previewBanner, { backgroundColor: `${previewDoc.color || '#2563EB'}10` }]}>
                <View style={[styles.previewBannerIcon, { backgroundColor: `${previewDoc.color || '#2563EB'}20` }]}>
                  <Ionicons name={previewDoc.icon || 'document-text'} size={28} color={previewDoc.color || '#2563EB'} />
                </View>
                <Text style={[styles.previewBannerTitle, { color: colors.text }]}>{previewDoc.header}</Text>
                {previewDoc.subtitle ? <Text style={[styles.previewBannerSub, { color: colors.textSecondary }]}>{previewDoc.subtitle}</Text> : null}
                {previewDoc.date ? (
                  <View style={styles.dateBadge}>
                    <Ionicons name="calendar-outline" size={12} color={colors.textMuted} />
                    <Text style={[styles.dateText, { color: colors.textMuted }]}>{previewDoc.date}</Text>
                  </View>
                ) : null}
              </View>
            )}

            <View style={styles.previewBody}>
              {previewDoc?.sections?.map((section, i) => (
                <PreviewSection key={i} section={section} colors={colors} isDarkMode={isDarkMode} />
              ))}
            </View>

            <View style={styles.previewFooter}>
              <Text style={[styles.previewFooterText, { color: colors.textMuted }]}>
                This is an electronically generated document from LilyCrest Dormitory Management System.
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  // Chips
  chipBar: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10 },
  chipRow: { paddingHorizontal: 16, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.06)' : '#F1F5F9', borderWidth: 1, borderColor: isDarkMode ? 'rgba(255,255,255,0.1)' : '#E5E7EB' },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  chipTextActive: { color: '#0A1628' },
  // List
  scrollView: { flex: 1 },
  scrollContent: { padding: 16 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.warning, borderRadius: 12, padding: 12, marginBottom: 14 },
  errorBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.warningText },
  errorRetryText: { fontSize: 13, fontWeight: '800', color: colors.primary },
  categoryGroup: { marginBottom: 24 },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  categoryIcon: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  categoryTitle: { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 },
  countBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.08)' : '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  countText: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  // Upload button
  uploadButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.accent },
  uploadButtonText: { color: '#0A1628', fontSize: 12, fontWeight: '700' },
  // Uploaded documents
  subSection: { marginBottom: 14 },
  subSectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginLeft: 4 },
  uploadedDocCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  uploadedDocIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  uploadedDocContent: { flex: 1 },
  uploadedDocTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  uploadedDocTitle: { fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1 },
  uploadedDocDate: { fontSize: 11, color: colors.textMuted },
  deleteBtn: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginLeft: 8, backgroundColor: colors.errorBg },
  // Empty state
  emptyUpload: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyUploadTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  emptyUploadHint: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  // Extension info
  extensionInfoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.infoBg, padding: 12, borderRadius: 12, marginTop: 4, borderWidth: 1, borderColor: colors.info },
  extensionInfoText: { flex: 1, fontSize: 12, color: colors.infoText, lineHeight: 18 },
  // Policy doc cards
  documentCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  documentIcon: { width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  documentContent: { flex: 1 },
  docTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  documentTitle: { fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1 },
  documentDescription: { fontSize: 12, color: colors.textSecondary },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, marginLeft: 8 },
  statusText: { fontSize: 10, fontWeight: '700' },
  actionButtons: { marginLeft: 8 },
  downloadButton: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  downloadButtonDisabled: { backgroundColor: colors.textMuted },
  helpCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.warningBg, borderRadius: 12, padding: 14, marginTop: 8, gap: 10, borderWidth: 1, borderColor: colors.warning },
  helpText: { flex: 1, fontSize: 13, color: colors.warningText, lineHeight: 20 },
  // Reservation document styles
  reservationBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.successBg, borderRadius: 8, alignSelf: 'flex-start' },
  reservationBadgeText: { fontSize: 11, fontWeight: '700', color: colors.successText, letterSpacing: 0.3 },
  reservationLock: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginLeft: 8, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : '#F8FAFC' },
  // Upload Type Picker
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingHorizontal: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 20, maxHeight: '70%', borderWidth: 1, borderColor: colors.border },
  pickerHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 12, marginBottom: 16 },
  pickerTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 },
  pickerSubtitle: { fontSize: 13, color: colors.textMuted, marginBottom: 16 },
  pickerList: { maxHeight: 400 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerItemIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  pickerItemLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text },
  pickerCancel: { marginTop: 12, paddingVertical: 14, borderRadius: 12, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.06)' : '#F1F5F9', alignItems: 'center' },
  pickerCancelText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: colors.surface, borderRadius: 12, padding: 24, width: '100%', maxWidth: 320, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  modalIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.errorBg, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '600', color: colors.text, marginBottom: 8 },
  modalMessage: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  modalButtons: { flexDirection: 'row', gap: 12, width: '100%' },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center' },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  modalDeleteBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#DC2626', alignItems: 'center' },
  modalDeleteText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  // Image Preview
  imagePreviewContainer: { flex: 1, backgroundColor: colors.background },
  imagePreviewHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  imagePreviewTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  imagePreviewBody: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  imagePreviewImage: { width: '100%', height: '100%', borderRadius: 12 },
  imagePreviewDate: { textAlign: 'center', fontSize: 12, color: colors.textMuted, paddingVertical: 12 },
  closeButton: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  // Preview Modal
  previewContainer: { flex: 1, backgroundColor: colors.background },
  previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  previewHeaderTitle: { fontSize: 16, fontWeight: '600', color: colors.text, flex: 1, textAlign: 'center' },
  downloadBtnSmall: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  previewScroll: { flex: 1 },
  previewScrollContent: { padding: 16 },
  previewBanner: { borderRadius: 12, padding: 24, alignItems: 'center', marginBottom: 20 },
  previewBannerIcon: { width: 56, height: 56, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  previewBannerTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  previewBannerSub: { fontSize: 13, textAlign: 'center' },
  dateBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.04)' },
  dateText: { fontSize: 11, fontWeight: '600' },
  previewBody: { backgroundColor: colors.surface, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: colors.border },
  previewFooter: { marginTop: 20, paddingVertical: 16, alignItems: 'center' },
  previewFooterText: { fontSize: 11, textAlign: 'center', fontStyle: 'italic' },
});
