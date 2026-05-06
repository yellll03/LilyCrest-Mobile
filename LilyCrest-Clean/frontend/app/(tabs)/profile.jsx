import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import { useAlert } from '../../src/context/AlertContext';
import { apiService } from '../../src/services/api';

const NAME_MAX = 60;
const USERNAME_MAX = 30;
const EMAIL_MAX = 254;
const ADDRESS_MAX = 200;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024; // ~2 MB base64

const validatePhone = (phone) => {
  if (!phone || phone.trim() === '+63') return { valid: true, error: '' };
  const compact = phone.replace(/[\s\-\(\)]/g, '');
  if (!compact.startsWith('+63')) return { valid: false, error: 'Use format +63XXXXXXXXXX' };
  if (!/^\+63\d{10}$/.test(compact)) return { valid: false, error: 'Phone must be +63 followed by 10 digits' };
  return { valid: true, error: '' };
};

const validateName = (name) => {
  if (!name.trim()) return { valid: false, error: 'Name is required' };
  if (name.trim().length < 2) return { valid: false, error: 'Name must be at least 2 characters' };
  if (name.trim().length > NAME_MAX) return { valid: false, error: `Name must be at most ${NAME_MAX} characters` };
  if (!/^[a-zA-ZÀ-ÿñÑ\s.\-']+$/.test(name.trim())) return { valid: false, error: 'Name can only contain letters, spaces, hyphens, and periods' };
  return { valid: true, error: '' };
};

const validateUsername = (username) => {
  if (!username.trim()) return { valid: false, error: 'Username is required' };
  if (username.trim().length < 3) return { valid: false, error: 'Username must be at least 3 characters' };
  if (username.trim().length > USERNAME_MAX) return { valid: false, error: `Username must be at most ${USERNAME_MAX} characters` };
  if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) return { valid: false, error: 'Only letters, numbers, and underscores allowed' };
  return { valid: true, error: '' };
};

const validateEmail = (email) => {
  if (!email.trim()) return { valid: false, error: 'Email is required' };
  if (email.trim().length > EMAIL_MAX) return { valid: false, error: 'Email is too long' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return { valid: false, error: 'Please enter a valid email address' };
  return { valid: true, error: '' };
};

const validateAddress = (address) => {
  if (!address || !address.trim()) return { valid: true, error: '' }; // optional
  if (address.trim().length > ADDRESS_MAX) return { valid: false, error: `Address must be at most ${ADDRESS_MAX} characters` };
  return { valid: true, error: '' };
};

const isProfilePayload = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && typeof value.user_id === 'string' && value.user_id.trim().length > 0;
const getDecodedBase64Bytes = (value = '') => {
  const raw = String(value || '').replace(/^data:image\/[^;]+;base64,/, '');
  if (!raw) return 0;
  const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
  return Math.floor((raw.length * 3) / 4) - padding;
};

export default function ProfileScreen() {
  const { user, logout, updateUser, checkAuth, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { colors, isDarkMode } = useTheme();
  const { showAlert } = useAlert();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || '',
    username: user?.username || '',
    email: user?.email || '',
    phone: user?.phone || '+63',
    address: user?.address || '',
  });
  const [errors, setErrors] = useState({ name: '', username: '', email: '', phone: '', address: '' });
  const [discardModalVisible, setDiscardModalVisible] = useState(false);
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileBanner, setProfileBanner] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const userId = user?.user_id || null;

  useEffect(() => {
    setFormData({
      name: user?.name || '',
      username: user?.username || '',
      email: user?.email || '',
      phone: user?.phone || '+63',
      address: user?.address || '',
    });
  }, [user?.name, user?.username, user?.email, user?.phone, user?.address]);

  const fetchProfile = useCallback(async () => {
    setProfileError('');
    try {
      const response = await apiService.getProfile();
      if (isProfilePayload(response?.data)) {
        updateUser(response.data);
      } else {
        throw new Error('Invalid profile response shape');
      }
    } catch (error) {
      const status = error?.response?.status;
      if (status === 401) {
        try { await checkAuth?.(); } catch (_) {}
      }
      setProfileError('Unable to load profile. Pull to refresh and try again.');
    } finally {
      setRefreshing(false);
    }
  }, [checkAuth, updateUser]);

  const handleRefresh = useCallback(() => {
    if (isEditing) return;
    setRefreshing(true);
    fetchProfile();
  }, [fetchProfile, isEditing]);

  useFocusEffect(
    useCallback(() => {
      if (!authLoading && userId) {
        fetchProfile();
      }
    }, [authLoading, fetchProfile, userId])
  );

  useEffect(() => {
    if (isEditing) {
      const nameValidation = validateName(formData.name);
      const usernameValidation = validateUsername(formData.username);
      const emailValidation = validateEmail(formData.email);
      const phoneValidation = validatePhone(formData.phone);
      const addressValidation = validateAddress(formData.address);
      setErrors({
        name: nameValidation.error,
        username: usernameValidation.error,
        email: emailValidation.error,
        phone: phoneValidation.error,
        address: addressValidation.error,
      });
    }
  }, [formData, isEditing]);

  useEffect(() => {
    if (!profileBanner) return;
    const t = setTimeout(() => setProfileBanner(null), 3000);
    return () => clearTimeout(t);
  }, [profileBanner]);

  const handleLogout = () => setLogoutModalVisible(true);

  const confirmLogout = async () => {
    setLogoutModalVisible(false);
    await logout();
    router.replace('/login');
  };

  const hasChanges = () => {
    return (
      formData.name.trim() !== (user?.name || '').trim() ||
      formData.username.trim() !== (user?.username || '').trim() ||
      formData.email.trim().toLowerCase() !== (user?.email || '').trim().toLowerCase() ||
      (formData.phone || '').trim() !== (user?.phone || '+63').trim() ||
      (formData.address || '').trim() !== (user?.address || '').trim()
    );
  };

  const handleSave = async () => {
    const nameValidation = validateName(formData.name);
    const usernameValidation = validateUsername(formData.username);
    const emailValidation = validateEmail(formData.email);
    const phoneValidation = validatePhone(formData.phone);
    const addressValidation = validateAddress(formData.address);
    if (!nameValidation.valid || !usernameValidation.valid || !emailValidation.valid || !phoneValidation.valid || !addressValidation.valid) {
      setProfileBanner({ type: 'error', text: 'Please fix the highlighted fields.' });
      return;
    }
    if (!hasChanges()) {
      setProfileBanner({ type: 'warning', text: 'No changes to save.' });
      return;
    }

    setIsLoading(true);
    try {
      const payload = {
        name: formData.name.trim(),
        username: formData.username.trim().toLowerCase(),
        email: formData.email.trim().toLowerCase(),
        phone: formData.phone.trim() === '+63' ? '' : formData.phone.trim(),
        address: formData.address.trim(),
      };
      const response = await apiService.updateProfile(payload);
      if (!isProfilePayload(response?.data)) {
        throw new Error('Invalid profile update response shape');
      }
      updateUser(response.data);
      setFormData({
        name: response.data?.name || '',
        username: response.data?.username || '',
        email: response.data?.email || '',
        phone: response.data?.phone || '+63',
        address: response.data?.address || '',
      });
      setIsEditing(false);
      setProfileBanner({ type: 'success', text: 'Profile updated successfully.' });
    } catch (error) {
      const status = error?.response?.status;
      if (status === 400 && error?.response?.data?.errors) {
        const backendErrors = error.response.data.errors;
        setErrors((prev) => ({
          ...prev,
          name: backendErrors.name || prev.name,
          username: backendErrors.username || prev.username,
          email: backendErrors.email || prev.email,
          phone: backendErrors.phone || prev.phone,
          address: backendErrors.address || prev.address,
        }));
        setProfileBanner({ type: 'error', text: error.response.data.detail || 'Validation failed.' });
      } else {
        setProfileBanner({ type: 'error', text: 'Failed to update profile. Please try again.' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const pickImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) { showAlert({ title: 'Permission Required', message: 'Please allow access to your photo library to change your profile picture.', type: 'warning' }); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5, base64: true });
    if (!result.canceled && result.assets[0].base64) {
      const base64Image = `data:image/jpeg;base64,${result.assets[0].base64}`;
      const fileSizeBytes = getDecodedBase64Bytes(base64Image);
      if (fileSizeBytes > IMAGE_MAX_BYTES) {
        setProfileBanner({ type: 'error', text: 'Image is too large (max 2 MB). Please choose a smaller photo.' });
        return;
      }
      setIsLoading(true);
      try {
        const response = await apiService.updateProfile({ picture: base64Image });
        if (!isProfilePayload(response?.data)) {
          throw new Error('Invalid profile picture response shape');
        }
        updateUser(response.data);
        setProfileBanner({ type: 'success', text: 'Profile picture updated.' });
      } catch (error) {
        setProfileBanner({ type: 'error', text: error?.response?.data?.errors?.picture || 'Failed to update profile picture.' });
      } finally {
        setIsLoading(false);
      }
    }
  };

  const iconColor = colors.accent;
  const menuGroups = [
    {
      label: 'ACCOUNT',
      items: [
        { icon: 'person-outline', label: 'Edit Profile', onPress: () => setIsEditing(true), color: iconColor },
      ],
    },
    {
      label: 'APP',
      items: [
        { icon: 'receipt-outline', label: 'Billing History', onPress: () => router.push({ pathname: '/(tabs)/billing', params: { from: 'profile' } }), color: iconColor },
        { icon: 'folder-outline', label: 'Documents', onPress: () => router.push('/my-documents'), color: iconColor },
        { icon: 'settings-outline', label: 'Settings', onPress: () => router.push('/settings'), color: iconColor },
      ],
    },
    {
      label: 'SUPPORT',
      items: [
        { icon: 'chatbubbles-outline', label: 'Help & Support', onPress: () => router.push('/(tabs)/chatbot'), color: iconColor },
        { icon: 'information-circle-outline', label: 'About', onPress: () => router.push('/about'), color: iconColor },
      ],
    },
  ];

  const isFormValid = !errors.name && !errors.username && !errors.email && !errors.phone && !errors.address && formData.name.trim().length > 0 && formData.username.trim().length > 0 && formData.email.trim().length > 0 && hasChanges();

  const handleDiscardEdit = () => {
    if (hasChanges()) {
      setDiscardModalVisible(true);
    } else {
      setIsEditing(false);
      setFormData({
        name: user?.name || '',
        username: user?.username || '',
        email: user?.email || '',
        phone: user?.phone || '+63',
        address: user?.address || '',
      });
    }
  };

  const confirmDiscard = () => {
    setDiscardModalVisible(false);
    setIsEditing(false);
    setFormData({
      name: user?.name || '',
      username: user?.username || '',
      email: user?.email || '',
      phone: user?.phone || '+63',
      address: user?.address || '',
    });
    setErrors({ name: '', username: '', email: '', phone: '', address: '' });
  };

  const styles = createStyles(colors, isDarkMode);

  const bannerBg = profileBanner
    ? profileBanner.type === 'success'
      ? isDarkMode ? 'rgba(34,197,94,0.15)' : '#ecfdf3'
      : profileBanner.type === 'warning'
      ? isDarkMode ? 'rgba(245,158,11,0.15)' : '#fffbeb'
      : isDarkMode ? 'rgba(239,68,68,0.15)' : '#fef2f2'
    : 'transparent';
  const bannerBorder = profileBanner
    ? profileBanner.type === 'success'
      ? isDarkMode ? 'rgba(34,197,94,0.4)' : '#bbf7d0'
      : profileBanner.type === 'warning'
      ? isDarkMode ? 'rgba(245,158,11,0.4)' : '#fde68a'
      : isDarkMode ? 'rgba(239,68,68,0.4)' : '#fecaca'
    : 'transparent';
  const bannerIconColor = profileBanner
    ? profileBanner.type === 'success' ? '#22c55e' : profileBanner.type === 'warning' ? '#f59e0b' : '#ef4444'
    : '#000';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>
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

        {profileBanner ? (
          <View style={[styles.banner, { backgroundColor: bannerBg, borderColor: bannerBorder }]}>
            <Ionicons
              name={profileBanner.type === 'success' ? 'checkmark-circle' : profileBanner.type === 'warning' ? 'alert-circle' : 'close-circle'}
              size={18}
              color={bannerIconColor}
            />
            <Text style={styles.bannerText}>{profileBanner.text}</Text>
            <TouchableOpacity onPress={() => setProfileBanner(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : null}

        {profileError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="warning" size={16} color="#b91c1c" />
            <Text style={styles.errorText}>{profileError}</Text>
            <TouchableOpacity onPress={fetchProfile}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.profileCard}>
          <TouchableOpacity style={styles.avatarContainer} onPress={pickImage}>
            {user?.picture
              ? <Image source={{ uri: user.picture }} style={styles.avatar} />
              : <View style={styles.avatarPlaceholder}><Ionicons name="person" size={44} color={colors.textMuted} /></View>
            }
            <View style={styles.editAvatarButton}><Ionicons name="camera" size={14} color="#FFFFFF" /></View>
          </TouchableOpacity>
          <Text style={styles.userName}>{user?.name || 'User'}</Text>
          {user?.username ? <Text style={styles.userHandle}>@{user.username}</Text> : null}
          <Text style={styles.userEmail}>{user?.email || ''}</Text>
          <View style={styles.statusContainer}>
            <View style={styles.statusBadge}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>Active Tenant</Text>
            </View>
          </View>
        </View>

        {isEditing ? (
          <View style={styles.editForm}>
            <View style={styles.formHeader}>
              <Text style={styles.sectionTitle}>Edit Profile</Text>
              <TouchableOpacity onPress={handleDiscardEdit}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Full Name *</Text>
              <TextInput style={[styles.input, errors.name ? styles.inputError : null]} value={formData.name} onChangeText={(text) => setFormData({ ...formData, name: text.slice(0, NAME_MAX) })} placeholder="Enter your full name" placeholderTextColor={colors.textMuted} maxLength={NAME_MAX} />
              <View style={styles.fieldFooter}>
                {errors.name ? <View style={styles.errorContainer}><Ionicons name="alert-circle" size={14} color="#EF4444" /><Text style={styles.fieldErrorText}>{errors.name}</Text></View> : <View />}
                <Text style={styles.charCount}>{formData.name.length}/{NAME_MAX}</Text>
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Username *</Text>
              <View style={[styles.inputWithPrefix, errors.username ? styles.inputError : null]}>
                <Text style={styles.inputPrefix}>@</Text>
                <TextInput
                  style={styles.inputInner}
                  value={formData.username}
                  onChangeText={(text) => setFormData({ ...formData, username: text.replace(/\s/g, '').slice(0, USERNAME_MAX) })}
                  placeholder="your_username"
                  placeholderTextColor={colors.textMuted}
                  maxLength={USERNAME_MAX}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.fieldFooter}>
                {errors.username ? <View style={styles.errorContainer}><Ionicons name="alert-circle" size={14} color="#EF4444" /><Text style={styles.fieldErrorText}>{errors.username}</Text></View> : <View />}
                <Text style={styles.charCount}>{formData.username.length}/{USERNAME_MAX}</Text>
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Email Address *</Text>
              <TextInput
                style={[styles.input, errors.email ? styles.inputError : null]}
                value={formData.email}
                onChangeText={(text) => setFormData({ ...formData, email: text.replace(/\s/g, '').slice(0, EMAIL_MAX) })}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                maxLength={EMAIL_MAX}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {errors.email ? <View style={styles.errorContainer}><Ionicons name="alert-circle" size={14} color="#EF4444" /><Text style={styles.fieldErrorText}>{errors.email}</Text></View> : null}
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Phone Number</Text>
              <TextInput
                style={[styles.input, errors.phone ? styles.inputError : null]}
                value={formData.phone}
                onChangeText={(text) => {
                  const raw = text.startsWith('+63') ? text : `+63${text.replace(/[^\d]/g, '')}`;
                  const compact = raw.replace(/[^\d+]/g, '');
                  const clamped = compact.startsWith('+63') ? `+63${compact.slice(3, 13)}` : `+63${compact.slice(0, 10)}`;
                  setFormData({ ...formData, phone: clamped });
                }}
                placeholder="+63XXXXXXXXXX"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
              />
              {errors.phone ? <View style={styles.errorContainer}><Ionicons name="alert-circle" size={14} color="#EF4444" /><Text style={styles.fieldErrorText}>{errors.phone}</Text></View> : null}
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Address</Text>
              <TextInput style={[styles.input, styles.textArea, errors.address ? styles.inputError : null]} value={formData.address} onChangeText={(text) => setFormData({ ...formData, address: text.slice(0, ADDRESS_MAX) })} placeholder="Enter your address (optional)" placeholderTextColor={colors.textMuted} multiline numberOfLines={3} maxLength={ADDRESS_MAX} />
              <View style={styles.fieldFooter}>
                {errors.address ? <View style={styles.errorContainer}><Ionicons name="alert-circle" size={14} color="#EF4444" /><Text style={styles.fieldErrorText}>{errors.address}</Text></View> : <View />}
                <Text style={styles.charCount}>{(formData.address || '').length}/{ADDRESS_MAX}</Text>
              </View>
            </View>

            <TouchableOpacity style={[styles.saveButton, !isFormValid && styles.saveButtonDisabled]} onPress={handleSave} disabled={isLoading || !isFormValid}>
              {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <><Ionicons name="checkmark" size={20} color="#FFFFFF" /><Text style={styles.saveButtonText}>Save Changes</Text></>}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.menuContainer}>
            {menuGroups.map((group) => (
              <View key={group.label} style={styles.menuGroupWrapper}>
                <Text style={styles.menuGroupLabel}>{group.label}</Text>
                <View style={styles.menuSection}>
                  {group.items.map((item, index) => (
                    <TouchableOpacity
                      key={index}
                      style={[styles.menuItem, index === group.items.length - 1 && styles.menuItemLast]}
                      onPress={item.onPress}
                      activeOpacity={0.7}
                    >
                      <View style={styles.menuItemLeft}>
                        <View style={[styles.menuIconContainer, { backgroundColor: isDarkMode ? `${item.color}25` : `${item.color}15` }]}>
                          <Ionicons name={item.icon} size={20} color={item.color} />
                        </View>
                        <Text style={styles.menuItemText}>{item.label}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        {!isEditing && (
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color="#EF4444" />
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        )}
        {!isEditing && <Text style={styles.versionText}>Version 1.0.0</Text>}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      <Modal visible={logoutModalVisible} transparent={true} animationType="fade" onRequestClose={() => setLogoutModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalIconContainer}><Ionicons name="log-out-outline" size={32} color="#EF4444" /></View>
            <Text style={styles.modalTitle}>Sign Out?</Text>
            <Text style={styles.modalMessage}>Are you sure you want to sign out?</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setLogoutModalVisible(false)}><Text style={styles.modalCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmButton} onPress={confirmLogout}><Text style={styles.modalConfirmText}>Sign Out</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={discardModalVisible} transparent={true} animationType="fade" onRequestClose={() => setDiscardModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={[styles.modalIconContainer, { backgroundColor: isDarkMode ? 'rgba(245,158,11,0.2)' : '#FEF3C7' }]}><Ionicons name="alert-circle" size={32} color="#F59E0B" /></View>
            <Text style={styles.modalTitle}>Discard Changes?</Text>
            <Text style={styles.modalMessage}>You have unsaved edits. Are you sure you want to discard them?</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setDiscardModalVisible(false)}><Text style={styles.modalCancelText}>Keep Editing</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalConfirmButton, { backgroundColor: '#F59E0B' }]} onPress={confirmDiscard}><Text style={styles.modalConfirmText}>Discard</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 16 },

  header: {
    backgroundColor: colors.headerBg,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 3,
    borderBottomColor: '#ff9000',
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 4,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 4,
    padding: 12,
    borderRadius: 10,
    backgroundColor: isDarkMode ? 'rgba(248,113,113,0.15)' : '#FEE2E2',
    borderWidth: 1,
    borderColor: isDarkMode ? 'rgba(248,113,113,0.4)' : '#FCA5A5',
    gap: 8,
  },
  errorText: { flex: 1, fontSize: 13, color: isDarkMode ? '#fca5a5' : '#b91c1c' },
  retryText: { color: '#b91c1c', fontWeight: '600' },

  profileCard: {
    backgroundColor: colors.surface,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 20,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    borderWidth: isDarkMode ? 1 : 0,
    borderColor: colors.border,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12 },
      android: { elevation: 4 },
      web: { boxShadow: '0 4px 12px rgba(0,0,0,0.08)' },
    }),
  },
  avatarContainer: { position: 'relative', marginBottom: 16 },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: '#ff9000' },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.inputBg,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#ff9000',
  },
  editAvatarButton: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#ff9000',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  userName: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 3 },
  userHandle: { fontSize: 14, color: colors.accent, marginBottom: 4, fontWeight: '600' },
  userEmail: { fontSize: 13, color: colors.textSecondary, marginBottom: 14 },
  statusContainer: { flexDirection: 'row', alignItems: 'center' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDarkMode ? 'rgba(34,197,94,0.18)' : '#DCFCE7',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E' },
  statusText: { fontSize: 13, fontWeight: '600', color: isDarkMode ? '#4ade80' : '#166534' },

  menuContainer: { gap: 4 },
  menuGroupWrapper: { marginHorizontal: 20, marginBottom: 8 },
  menuGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 1.2,
    marginBottom: 8,
    marginLeft: 2,
  },
  menuSection: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: isDarkMode ? 1 : 0,
    borderColor: colors.border,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
      android: { elevation: 2 },
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
    }),
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuItemLast: { borderBottomWidth: 0 },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center' },
  menuIconContainer: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  menuItemText: { fontSize: 15, color: colors.text, fontWeight: '500' },

  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: isDarkMode ? 'rgba(239,68,68,0.3)' : '#FEE2E2',
    backgroundColor: isDarkMode ? 'rgba(239,68,68,0.1)' : '#FEF2F2',
    gap: 8,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: '#EF4444' },
  versionText: { textAlign: 'center', fontSize: 12, color: colors.textMuted, marginTop: 16 },

  editForm: {
    backgroundColor: colors.surface,
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 20,
    borderWidth: isDarkMode ? 1 : 0,
    borderColor: colors.border,
  },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  inputContainer: { marginBottom: 16 },
  inputLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: colors.text, backgroundColor: colors.inputBg },
  inputWithPrefix: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.inputBg, overflow: 'hidden' },
  inputPrefix: { paddingLeft: 16, fontSize: 15, fontWeight: '600', color: colors.textMuted },
  inputInner: { flex: 1, paddingHorizontal: 4, paddingVertical: 14, fontSize: 15, color: colors.text, paddingRight: 16 },
  inputError: { borderColor: '#EF4444', backgroundColor: isDarkMode ? 'rgba(239,68,68,0.1)' : '#FEF2F2' },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  errorContainer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  fieldErrorText: { fontSize: 12, color: '#EF4444' },
  fieldFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  charCount: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  saveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, paddingVertical: 14, borderRadius: 12, marginTop: 8, gap: 8 },
  saveButtonDisabled: { backgroundColor: colors.textMuted, opacity: 0.6 },
  saveButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  bottomSpacer: { height: Platform.OS === 'ios' ? 100 : 80 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: colors.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 320, alignItems: 'center' },
  modalIconContainer: { width: 64, height: 64, borderRadius: 32, backgroundColor: isDarkMode ? 'rgba(239,68,68,0.2)' : '#FEE2E2', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 8 },
  modalMessage: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  modalButtons: { flexDirection: 'row', gap: 12, width: '100%' },
  modalCancelButton: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center' },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  modalConfirmButton: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#EF4444', alignItems: 'center' },
  modalConfirmText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
});
