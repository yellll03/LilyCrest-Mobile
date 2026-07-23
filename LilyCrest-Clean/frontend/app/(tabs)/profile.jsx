import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import { useAlert } from '../../src/context/AlertContext';
import { apiService, getApiErrorMessage } from '../../src/services/api';

const NAME_MAX = 60;
const USERNAME_MAX = 30;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024; // ~2 MB base64

const validatePhone = (phone) => {
  if (!phone || phone.trim() === '+63') return { valid: true, error: '' };
  const compact = phone.replace(/[\s\-\(\)]/g, '');
  if (!compact.startsWith('+63')) return { valid: false, error: 'Use format +63XXXXXXXXXX' };
  if (!/^\+63\d{10}$/.test(compact)) return { valid: false, error: 'Phone must be +63 followed by 10 digits' };
  return { valid: true, error: '' };
};

// Kept temporarily to preserve the existing name validation rules for future admin-managed flows.
// eslint-disable-next-line no-unused-vars
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
  if (!/^[a-zA-Z0-9_.]+$/.test(username.trim())) return { valid: false, error: 'Only letters, numbers, underscores, and periods are allowed' };
  return { valid: true, error: '' };
};

const formatDate = (value) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

const isProfilePayload = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && typeof value.user_id === 'string' && value.user_id.trim().length > 0;
const getDecodedBase64Bytes = (value = '') => {
  const raw = String(value || '').replace(/^data:image\/[^;]+;base64,/, '');
  if (!raw) return 0;
  const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
  return Math.floor((raw.length * 3) / 4) - padding;
};

export default function ProfileScreen() {
  const { user, authReady, authStatus, logout, updateUser, checkAuth, isLoading: authLoading } = useAuth();
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
  const [errors, setErrors] = useState({ username: '', email: '', phone: '' });
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
    if (!authReady || authLoading) return;
    if (authStatus !== 'authenticated' || !userId) {
      setProfileError('Please sign in to view your profile.');
      setRefreshing(false);
      return;
    }

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
      setProfileError(getApiErrorMessage(error, 'Unable to load profile. Pull to refresh and try again.'));
    } finally {
      setRefreshing(false);
    }
  }, [authLoading, authReady, authStatus, checkAuth, updateUser, userId]);

  const handleRefresh = useCallback(() => {
    if (isEditing) return;
    setRefreshing(true);
    fetchProfile();
  }, [fetchProfile, isEditing]);

  useFocusEffect(
    useCallback(() => {
      if (authReady && !authLoading && authStatus === 'authenticated' && userId) {
        fetchProfile();
      }
    }, [authLoading, authReady, authStatus, fetchProfile, userId])
  );

  useEffect(() => {
    if (isEditing) {
      const usernameValidation = validateUsername(formData.username);
      const phoneValidation = validatePhone(formData.phone);
      setErrors({
        username: usernameValidation.error,
        email: '',
        phone: phoneValidation.error,
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
      formData.username.trim() !== (user?.username || '').trim() ||
      (formData.phone || '').trim() !== (user?.phone || '+63').trim()
    );
  };

  const handleSave = async () => {
    const usernameValidation = validateUsername(formData.username);
    const phoneValidation = validatePhone(formData.phone);
    if (!usernameValidation.valid || !phoneValidation.valid) {
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
        username: formData.username.trim().toLowerCase(),
        phone: formData.phone.trim() === '+63' ? '' : formData.phone.trim(),
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
          username: backendErrors.username || prev.username,
          email: backendErrors.email || prev.email,
          phone: backendErrors.phone || prev.phone,
        }));
        setProfileBanner({ type: 'error', text: error.response.data.detail || 'Validation failed.' });
      } else if (status === 429 && error?.response?.data?.code === 'USERNAME_COOLDOWN') {
        setErrors((prev) => ({ ...prev, username: error.response.data.errors?.username || 'Username change is still under cooldown.' }));
        updateUser({
          ...user,
          usernameNextAllowedAt: error.response.data.nextAllowedAt,
          serverTime: error.response.data.serverTime,
        });
        setProfileBanner({ type: 'error', text: error.response.data.detail });
      } else {
        setProfileBanner({ type: 'error', text: getApiErrorMessage(error, 'Failed to update profile. Please try again.') });
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
        setProfileBanner({ type: 'error', text: error?.response?.data?.errors?.picture || getApiErrorMessage(error, 'Failed to update profile picture.') });
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

  const nextUsernameChangeAt = user?.usernameNextAllowedAt
    ? new Date(user.usernameNextAllowedAt)
    : null;
  const profileServerTime = user?.serverTime ? new Date(user.serverTime) : null;
  const usernameCooldownActive = Boolean(
    nextUsernameChangeAt
    && !Number.isNaN(nextUsernameChangeAt.getTime())
    && profileServerTime
    && !Number.isNaN(profileServerTime.getTime())
    && nextUsernameChangeAt > profileServerTime
  );
  const usernameChanged = formData.username.trim().toLowerCase() !== (user?.username || '').trim().toLowerCase();
  const usernameOnCooldown = usernameChanged && usernameCooldownActive;
  const isFormValid = !errors.username && !errors.email && !errors.phone && !usernameOnCooldown && formData.username.trim().length > 0 && formData.email.trim().length > 0 && hasChanges();

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
    setErrors({ username: '', email: '', phone: '' });
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
              <Text style={styles.inputLabel}>Full Name</Text>
              <TextInput
                style={[styles.input, styles.readOnlyInput]}
                value={formData.name}
                editable={false}
                selectTextOnFocus={false}
                placeholder="No full name on file"
                placeholderTextColor={colors.textMuted}
              />
              <View style={styles.helperRow}>
                <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
                <Text style={styles.helperText}>Full name comes from your tenant application. Please contact admin if you need it changed.</Text>
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Username *</Text>
              <View style={[styles.inputWithPrefix, errors.username ? styles.inputError : null]}>
                <Text style={styles.inputPrefix}>@</Text>
                <TextInput
                  style={styles.inputInner}
                  value={formData.username}
                  onChangeText={(text) => setFormData({ ...formData, username: text.slice(0, USERNAME_MAX) })}
                  placeholder="aya.argueza"
                  placeholderTextColor={colors.textMuted}
                  maxLength={USERNAME_MAX}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!usernameCooldownActive}
                />
              </View>
              <View style={styles.fieldFooter}>
                {errors.username ? <View style={styles.errorContainer}><Ionicons name="alert-circle" size={14} color="#EF4444" /><Text style={styles.fieldErrorText}>{errors.username}</Text></View> : <View />}
                <Text style={styles.charCount}>{formData.username.length}/{USERNAME_MAX}</Text>
              </View>
              {usernameCooldownActive ? (
                <Text style={styles.cooldownText}>You can change your username again on {formatDate(nextUsernameChangeAt)}.</Text>
              ) : (
                <Text style={styles.helperText}>3–30 characters. Use letters, numbers, underscores, or periods.</Text>
              )}
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Email Address</Text>
              <TextInput
                style={[styles.input, styles.readOnlyInput]}
                value={formData.email}
                editable={false}
                selectTextOnFocus={false}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.helperText}>Contact admin to change the email linked to your sign-in account.</Text>
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
              <TextInput
                style={[styles.input, styles.textArea, styles.readOnlyInput]}
                value={formData.address || 'No address available.'}
                editable={false}
                selectTextOnFocus={false}
                multiline
              />
              <View style={styles.helperRow}>
                <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
                <Text style={styles.helperText}>Address comes from your approved tenant application.</Text>
              </View>
            </View>

            <TouchableOpacity style={[styles.saveButton, !isFormValid && styles.saveButtonDisabled]} onPress={handleSave} disabled={isLoading || !isFormValid}>
              {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <><Ionicons name="checkmark" size={20} color="#FFFFFF" /><Text style={styles.saveButtonText}>Save Changes</Text></>}
            </TouchableOpacity>
          </View>
        ) : (
          <>
          <View style={styles.infoSection}>
            <Text style={styles.menuGroupLabel}>BRANCH INFORMATION</Text>
            <View style={styles.infoCard}>
              {user?.branch ? (
                <>
                  <InfoRow icon="business-outline" label="Branch Name" value={user.branch.branchName || 'Not available'} colors={colors} styles={styles} />
                  <InfoRow icon="location-outline" label="Complete Address" value={user.branch.branchAddress || 'No address available.'} colors={colors} styles={styles} />
                  <TouchableOpacity
                    style={styles.outlineButton}
                    onPress={async () => {
                      const destination = user.branch.googleMapsUrl;
                      try {
                        if (!/^https:\/\//i.test(destination || '')) throw new Error('MAPS_URL_MISSING');
                        const supported = await Linking.canOpenURL(destination);
                        if (!supported) throw new Error('MAPS_OPEN_FAILED');
                        await Linking.openURL(destination);
                      } catch (_) {
                        showAlert({
                          title: 'Map unavailable',
                          message: 'Unable to open the branch location. Please try again.',
                          type: 'error',
                        });
                      }
                    }}
                    disabled={!user.branch.isActive || !/^https:\/\//i.test(user.branch.googleMapsUrl || '')}
                  >
                    <Ionicons name="map-outline" size={18} color={colors.accent} />
                    <Text style={styles.outlineButtonText}>View Location</Text>
                  </TouchableOpacity>
                </>
              ) : <Text style={styles.emptyText}>Branch location is not available yet.</Text>}
            </View>
          </View>

          <View style={styles.menuContainer}>
            {menuGroups.slice(0, 2).map((group) => (
              <View key={group.label} style={styles.menuGroupWrapper}>
                <Text style={styles.menuGroupLabel}>{group.label === 'APP' ? 'APP SHORTCUTS' : group.label}</Text>
                <View style={styles.menuSection}>
                  {group.items.map((item, index) => (
                    <TouchableOpacity key={item.label} style={[styles.menuItem, index === group.items.length - 1 && styles.menuItemLast]} onPress={item.onPress} activeOpacity={0.7}>
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

          <View style={styles.infoSection}>
            <Text style={styles.menuGroupLabel}>CONTRACT</Text>
            <View style={styles.infoCard}>
              {user?.contract ? (
                <>
                  <InfoRow icon="shield-checkmark-outline" label="Contract Status" value={user.contract.status || 'Not available'} colors={colors} styles={styles} />
                  <InfoRow icon="calendar-outline" label="Contract Start Date" value={formatDate(user.contract.startDate)} colors={colors} styles={styles} />
                  <InfoRow icon="calendar-outline" label="Contract End Date" value={formatDate(user.contract.endDate)} colors={colors} styles={styles} />
                  <TouchableOpacity style={styles.outlineButton} onPress={() => router.push('/contract-viewer')}>
                    <Ionicons name="document-text-outline" size={18} color={colors.accent} />
                    <Text style={styles.outlineButtonText}>View Contract</Text>
                  </TouchableOpacity>
                </>
              ) : <Text style={styles.emptyText}>No contract available yet.</Text>}
            </View>
          </View>

          <View style={styles.infoSection}>
            <Text style={styles.menuGroupLabel}>FEEDBACK &amp; SURVEY</Text>
            <View style={styles.infoCard}>
              <View style={styles.surveyHeader}>
                <Ionicons name="chatbox-ellipses-outline" size={22} color={colors.accent} />
                <Text style={styles.surveyTitle}>{user?.survey?.type === 'quarterly' ? 'Quarterly Survey Available' : user?.survey?.type === 'move-out' ? 'Move-out Survey Available' : 'No survey available'}</Text>
              </View>
              <Text style={styles.helperText}>View active surveys, save a draft, or review your submitted feedback.</Text>
              <TouchableOpacity style={styles.outlineButton} onPress={() => router.push('/surveys')}>
                <Text style={styles.outlineButtonText}>Open Survey Dashboard</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.menuContainer}>
            {menuGroups.slice(2).map((group) => (
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
          </>
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

function InfoRow({ icon, label, value, colors, styles }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoRowIcon}><Ionicons name={icon} size={18} color={colors.accent} /></View>
      <View style={styles.infoRowText}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const createStyles = (colors, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 16 },
  infoSection: { paddingHorizontal: 20, marginBottom: 20 },
  infoCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16, gap: 14 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  infoRowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: isDarkMode ? `${colors.accent}25` : `${colors.accent}12` },
  infoRowText: { flex: 1, minWidth: 0 },
  infoLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 3 },
  infoValue: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  emptyText: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  outlineButton: { minHeight: 44, borderWidth: 1, borderColor: colors.accent, borderRadius: 12, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  outlineButtonText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  surveyHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  surveyTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  cooldownText: { color: '#D97706', fontSize: 12, lineHeight: 18, marginTop: 6 },

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
  readOnlyInput: { color: colors.textSecondary, backgroundColor: isDarkMode ? 'rgba(148,163,184,0.12)' : '#F8FAFC' },
  inputWithPrefix: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.inputBg, overflow: 'hidden' },
  inputPrefix: { paddingLeft: 16, fontSize: 15, fontWeight: '600', color: colors.textMuted },
  inputInner: { flex: 1, paddingHorizontal: 4, paddingVertical: 14, fontSize: 15, color: colors.text, paddingRight: 16 },
  inputError: { borderColor: '#EF4444', backgroundColor: isDarkMode ? 'rgba(239,68,68,0.1)' : '#FEF2F2' },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  errorContainer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  fieldErrorText: { fontSize: 12, color: '#EF4444' },
  fieldFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  helperRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8 },
  helperText: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.textMuted },
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
