const { getDb } = require('../config/database');
const { ObjectId } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const { normalizeUser } = require('../utils/normalizeUser');

// Get current user profile
async function getMe(req, res) {
  try {
    const db = getDb();
    const user = await db.collection('users').findOne(
      { user_id: req.user.user_id },
      { projection: { _id: 0 } },
    );

    if (!user) {
      return res.status(404).json({ detail: 'User not found' });
    }

    res.json(normalizeUser(user));
  } catch (error) {
    console.error('getMe error:', error);
    res.status(500).json({ detail: 'Failed to load profile' });
  }
}

// ── Field-level validators ──
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;
const PHONE_REGEX = /^\+63\d{10}$/;
const ADDRESS_MAX = 200;
const PICTURE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB decoded image payload
const DOC_MAX_BYTES = 5 * 1024 * 1024; // 5 MB for document uploads
const LOCAL_ONLY_URI_PATTERN = /^(?:file|content|ph|assets-library|blob|ms-appdata):\/\/|^\/data\/user\/|^\/storage\/|^\/private\/var\/|^\/var\/mobile\/|(?:^|[\\/])cache(?:[\\/]|$)/i;
const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim();
}

function getDecodedBase64Bytes(value = '') {
  const raw = String(value || '').replace(/^data:[^;]+;base64,/, '');
  if (!raw) return 0;
  const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
  return Math.floor((raw.length * 3) / 4) - padding;
}

function isLocalOnlyStoredUrl(value = '') {
  const normalized = String(value || '').trim();
  return Boolean(normalized) && LOCAL_ONLY_URI_PATTERN.test(normalized);
}

function normalizeUploadedDocumentMetadata(body = {}) {
  const downloadUrl = sanitize(body.downloadUrl || body.file_url || body.url);
  const mimeType = sanitize(body.mimeType || body.type || '').toLowerCase();
  const originalName = sanitize(body.originalName || body.name || 'Uploaded document');
  const storagePath = sanitize(body.storagePath || '');
  const provider = sanitize(body.provider || 'firebase-storage') || 'firebase-storage';
  const size = Number(body.size);

  if (!downloadUrl) {
    return { error: 'downloadUrl is required.' };
  }
  if (isLocalOnlyStoredUrl(downloadUrl) || !/^https:\/\//i.test(downloadUrl)) {
    return { error: 'Document upload must use a Firebase HTTPS download URL.' };
  }
  if (provider !== 'firebase-storage') {
    return { error: 'Document upload provider must be firebase-storage.' };
  }
  if (!/firebasestorage(?:\.googleapis\.com|\.app)/i.test(downloadUrl)) {
    return { error: 'Document upload must use a Firebase Storage download URL.' };
  }
  if (!mimeType || !ALLOWED_DOCUMENT_MIME_TYPES.has(mimeType)) {
    return { error: 'File must be an image or PDF.' };
  }
  if (!storagePath) {
    return { error: 'storagePath is required.' };
  }
  if (Number.isFinite(size) && size > DOC_MAX_BYTES) {
    return { error: 'File is too large (max 5 MB).' };
  }

  return {
    value: {
      file_url: downloadUrl,
      downloadUrl,
      storagePath,
      originalName,
      mimeType,
      size: Number.isFinite(size) ? size : null,
      uploadedAt: body.uploadedAt ? new Date(body.uploadedAt) : new Date(),
      provider,
    },
  };
}

function validateField(field, value) {
  switch (field) {
    case 'username': {
      const clean = sanitize(value).toLowerCase();
      if (!clean) return { ok: false, error: 'Username is required.' };
      if (clean.length < USERNAME_MIN) return { ok: false, error: `Username must be at least ${USERNAME_MIN} characters.` };
      if (clean.length > USERNAME_MAX) return { ok: false, error: `Username must be at most ${USERNAME_MAX} characters.` };
      if (!USERNAME_REGEX.test(clean)) return { ok: false, error: 'Username can only contain letters, numbers, and underscores.' };
      return { ok: true, value: clean };
    }
    case 'email': {
      const clean = sanitize(value).toLowerCase();
      if (!clean) return { ok: false, error: 'Email is required.' };
      if (clean.length > EMAIL_MAX) return { ok: false, error: 'Email address is too long.' };
      if (!EMAIL_REGEX.test(clean)) return { ok: false, error: 'Please provide a valid email address.' };
      return { ok: true, value: clean };
    }
    case 'phone': {
      if (!value || value.trim() === '' || value.trim() === '+63') return { ok: true, value: '' }; // optional
      const compact = value.replace(/[\s\-()]/g, '');
      if (!PHONE_REGEX.test(compact)) return { ok: false, error: 'Phone must be in +63XXXXXXXXXX format (10 digits after +63).' };
      return { ok: true, value: compact };
    }
    case 'address': {
      const clean = sanitize(value);
      if (clean.length > ADDRESS_MAX) return { ok: false, error: `Address must be at most ${ADDRESS_MAX} characters.` };
      return { ok: true, value: clean };
    }
    case 'picture': {
      if (typeof value !== 'string') return { ok: false, error: 'Picture must be a string.' };
      if (!value.startsWith('data:image/') && !value.startsWith('http')) {
        return { ok: false, error: 'Invalid image format.' };
      }
      if (getDecodedBase64Bytes(value) > PICTURE_MAX_BYTES) {
        return { ok: false, error: 'Image is too large (max 2 MB).' };
      }
      return { ok: true, value };
    }
    default:
      return { ok: false, error: `Unknown field: ${field}` };
  }
}

// Update current user — with full validation + uniqueness checks
async function updateMe(req, res) {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ detail: 'Request body is required.' });
    }

    const allowedFields = ['username', 'email', 'phone', 'address', 'picture'];
    const updateData = {};
    const fieldErrors = {};

    if (updates.name !== undefined) {
      fieldErrors.name = 'Full name is managed from the tenant application. Please contact admin to request a change.';
    }

    // Only validate fields that were actually sent
    for (const field of allowedFields) {
      if (updates[field] === undefined) continue;

      const result = validateField(field, updates[field]);
      if (!result.ok) {
        fieldErrors[field] = result.error;
      } else {
        updateData[field] = result.value;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return res.status(400).json({ detail: 'Validation failed.', errors: fieldErrors });
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ detail: 'No valid fields provided to update.' });
    }

    const db = getDb();
    const userId = req.user.user_id;

    // Uniqueness checks for username and email
    if (updateData.username) {
      const usernameRegex = new RegExp(`^${updateData.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      const existingUsername = await db.collection('users').findOne({
        username: usernameRegex,
        user_id: { $ne: userId },
      });
      if (existingUsername) {
        return res.status(400).json({ detail: 'Validation failed.', errors: { username: 'This username is already taken.' } });
      }
    }

    if (updateData.email) {
      const emailRegex = new RegExp(`^${updateData.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      const existingEmail = await db.collection('users').findOne({
        email: emailRegex,
        user_id: { $ne: userId },
      });
      if (existingEmail) {
        return res.status(400).json({ detail: 'Validation failed.', errors: { email: 'This email is already in use.' } });
      }
    }

    updateData.updated_at = new Date();

    await db.collection('users').updateOne(
      { user_id: userId },
      { $set: updateData }
    );

    const updatedUser = await db.collection('users').findOne(
      { user_id: userId },
      { projection: { _id: 0 } }
    );

    res.json(normalizeUser(updatedUser));
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ detail: 'Failed to update user' });
  }
}

// ── Document upload/management ──

const ALLOWED_DOC_TYPES = [
  'government_id', 'passport', 'drivers_license', 'student_id', 'company_id',
  'lease_extension', 'proof_of_income', 'authorization_letter', 'other',
];

const DOC_TYPE_LABELS = {
  government_id: 'Government ID',
  passport: 'Passport',
  drivers_license: "Driver's License",
  student_id: 'Student ID',
  company_id: 'Company/Employee ID',
  lease_extension: 'Lease Extension',
  proof_of_income: 'Proof of Income',
  authorization_letter: 'Authorization Letter',
  other: 'Other Document',
};

// Upload a document (ID or file)
async function uploadDocument(req, res) {
  try {
    const { type, label } = req.body;

    if (!type || !ALLOWED_DOC_TYPES.includes(type)) {
      return res.status(400).json({ detail: `Invalid document type. Allowed: ${ALLOWED_DOC_TYPES.join(', ')}` });
    }

    const docId = `doc_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    const uploadedAt = new Date();
    const metadata = normalizeUploadedDocumentMetadata(req.body);
    if (metadata.error) {
      return res.status(400).json({ detail: metadata.error });
    }

    const docEntry = {
      doc_id: docId,
      type,
      label: sanitize(label) || DOC_TYPE_LABELS[type] || type,
      ...metadata.value,
      uploaded_at: uploadedAt,
      status: 'pending_review',
    };

    const db = getDb();
    await db.collection('users').updateOne(
      { user_id: req.user.user_id },
      { $push: { uploaded_documents: docEntry } }
    );

    res.status(201).json({
      doc_id: docId,
      type: docEntry.type,
      label: docEntry.label,
      uploaded_at: docEntry.uploaded_at,
      status: docEntry.status,
      downloadUrl: docEntry.downloadUrl,
      storagePath: docEntry.storagePath,
      originalName: docEntry.originalName,
      mimeType: docEntry.mimeType,
      size: docEntry.size,
      provider: docEntry.provider,
    });
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ detail: 'Failed to upload document' });
  }
}

// ── Map reservation document fields to structured entries ──
const VALID_ID_TYPE_LABELS = {
  national_id: 'National ID',
  passport: 'Passport',
  drivers_license: "Driver's License",
  sss: 'SSS ID',
  philhealth: 'PhilHealth ID',
  tin: 'TIN ID',
  postal: 'Postal ID',
  voters: "Voter's ID",
  prc: 'PRC ID',
  umid: 'UMID',
  student_id: 'Student ID',
};

function buildReservationDocs(reservation) {
  if (!reservation) return [];
  const docs = [];
  const resId = reservation._id?.toString() || 'unknown';
  const submittedAt = reservation.applicationSubmittedAt || reservation.createdAt || new Date();

  if (reservation.validIDFrontUrl) {
    const idLabel = VALID_ID_TYPE_LABELS[reservation.validIDType] || 'Valid ID';
    docs.push({
      doc_id: `res_${resId}_valid_id_front`,
      type: 'government_id',
      label: `${idLabel} (Front)`,
      status: 'verified',
      uploaded_at: submittedAt,
      source: 'reservation',
      file_url: reservation.validIDFrontUrl,
    });
  }
  if (reservation.validIDBackUrl) {
    const idLabel = VALID_ID_TYPE_LABELS[reservation.validIDType] || 'Valid ID';
    docs.push({
      doc_id: `res_${resId}_valid_id_back`,
      type: 'government_id',
      label: `${idLabel} (Back)`,
      status: 'verified',
      uploaded_at: submittedAt,
      source: 'reservation',
      file_url: reservation.validIDBackUrl,
    });
  }
  if (reservation.selfiePhotoUrl) {
    docs.push({
      doc_id: `res_${resId}_selfie`,
      type: 'government_id',
      label: 'Selfie Photo',
      status: 'verified',
      uploaded_at: submittedAt,
      source: 'reservation',
      file_url: reservation.selfiePhotoUrl,
    });
  }
  if (reservation.nbiClearanceUrl) {
    docs.push({
      doc_id: `res_${resId}_nbi`,
      type: 'other',
      label: 'NBI Clearance',
      status: 'verified',
      uploaded_at: submittedAt,
      source: 'reservation',
      file_url: reservation.nbiClearanceUrl,
    });
  }
  if (reservation.companyIDUrl) {
    docs.push({
      doc_id: `res_${resId}_company_id`,
      type: 'company_id',
      label: 'Company / Employee ID',
      status: 'verified',
      uploaded_at: submittedAt,
      source: 'reservation',
      file_url: reservation.companyIDUrl,
    });
  }
  if (reservation.proofOfPaymentUrl) {
    docs.push({
      doc_id: `res_${resId}_proof_of_payment`,
      type: 'other',
      label: 'Proof of Payment',
      status: 'verified',
      uploaded_at: submittedAt,
      source: 'reservation',
      file_url: reservation.proofOfPaymentUrl,
    });
  }
  if (reservation.contractFileUrl) {
    docs.push({
      doc_id: `res_${resId}_contract`,
      type: 'other',
      label: 'Signed Contract',
      status: 'verified',
      uploaded_at: submittedAt,
      source: 'reservation',
      file_url: reservation.contractFileUrl,
    });
  }

  return docs;
}

// Get user's uploaded documents (without file_data to keep response light)
// Also includes documents submitted during the reservation process on the web
async function getUserDocuments(req, res) {
  try {
    const db = getDb();
    const user = await db.collection('users').findOne(
      { user_id: req.user.user_id },
      { projection: { uploaded_documents: 1, _id: 1 } }
    );

    // Mobile-uploaded documents (strip file_data for listing)
    const uploadedDocs = (user?.uploaded_documents || []).map(({ file_data, ...rest }) => rest);

    // Reservation documents (from the web admin reservation flow)
    let reservationDocs = [];
    const mongoId = user?._id;
    if (mongoId) {
      const reservation = await db.collection('reservations').findOne(
        { userId: mongoId, status: { $in: ['moveIn', 'active', 'completed', 'payment_pending', 'confirmed'] } },
        { sort: { createdAt: -1 } }
      );
      reservationDocs = buildReservationDocs(reservation);
    }

    // Reservation docs first (submitted during onboarding), then user-uploaded docs
    const allDocs = [...reservationDocs, ...uploadedDocs];
    res.json(allDocs);
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ detail: 'Failed to get documents' });
  }
}

// Get a single document with file data (for viewing/downloading)
async function getDocumentFile(req, res) {
  try {
    const { docId } = req.params;
    const db = getDb();

    // Reservation documents (ID starts with 'res_')
    if (docId.startsWith('res_')) {
      const user = await db.collection('users').findOne(
        { user_id: req.user.user_id },
        { projection: { _id: 1 } }
      );
      if (!user?._id) {
        return res.status(404).json({ detail: 'Document not found.' });
      }

      const reservation = await db.collection('reservations').findOne(
        { userId: user._id, status: { $in: ['moveIn', 'active', 'completed', 'payment_pending', 'confirmed'] } },
        { sort: { createdAt: -1 } }
      );
      if (!reservation) {
        return res.status(404).json({ detail: 'Document not found.' });
      }

      // Map the doc_id suffix to the reservation field
      const resDocs = buildReservationDocs(reservation);
      const doc = resDocs.find(d => d.doc_id === docId);
      if (!doc) {
        return res.status(404).json({ detail: 'Document not found.' });
      }

      // Return file_url as file_data so the frontend can display it
      return res.json({
        ...doc,
        file_data: doc.file_url,
      });
    }

    // Regular uploaded documents
    const user = await db.collection('users').findOne(
      { user_id: req.user.user_id },
      { projection: { uploaded_documents: 1 } }
    );

    const doc = (user?.uploaded_documents || []).find(d => d.doc_id === docId);
    if (!doc) {
      return res.status(404).json({ detail: 'Document not found.' });
    }

    if (doc.file_url || doc.downloadUrl) {
      return res.json({
        ...doc,
        file_data: doc.file_url || doc.downloadUrl,
      });
    }

    res.json(doc);
  } catch (error) {
    console.error('Get document file error:', error);
    res.status(500).json({ detail: 'Failed to get document' });
  }
}

// Delete an uploaded document
async function deleteDocument(req, res) {
  try {
    const { docId } = req.params;
    const db = getDb();

    const result = await db.collection('users').updateOne(
      { user_id: req.user.user_id },
      { $pull: { uploaded_documents: { doc_id: docId } } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ detail: 'Document not found.' });
    }

    res.json({ status: 'deleted', doc_id: docId });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ detail: 'Failed to delete document' });
  }
}

function normalizePushTokenEntry(entry) {
  if (typeof entry === 'string') {
    const token = entry.trim();
    return token
      ? { token, provider: null, platform: null, enabled: true, updated_at: null }
      : null;
  }

  if (!entry || typeof entry !== 'object') return null;

  const token = typeof entry.token === 'string'
    ? entry.token.trim()
    : (typeof entry.push_token === 'string' ? entry.push_token.trim() : '');

  if (!token) return null;

  return {
    token,
    provider: typeof entry.provider === 'string' ? entry.provider.trim().toLowerCase() : null,
    platform: typeof entry.platform === 'string'
      ? entry.platform.trim().toLowerCase()
      : (typeof entry.device_platform === 'string' ? entry.device_platform.trim().toLowerCase() : null),
    enabled: entry.enabled !== false,
    updated_at: entry.updated_at || null,
  };
}

// Save push notification token
async function savePushToken(req, res) {
  try {
    const rawPushToken = typeof req.body?.push_token === 'string' ? req.body.push_token.trim() : '';
    const notificationsEnabled = req.body?.notifications_enabled !== false;
    const provider = typeof req.body?.provider === 'string' ? req.body.provider.trim().toLowerCase() : null;
    const devicePlatform = typeof req.body?.device_platform === 'string' ? req.body.device_platform.trim().toLowerCase() : null;
    const db = getDb();
    const now = new Date();

    if (!rawPushToken && notificationsEnabled) {
      return res.status(400).json({ detail: 'push_token is required when notifications are enabled.' });
    }

    const user = await db.collection('users').findOne(
      { user_id: req.user.user_id },
      {
        projection: {
          push_token: 1,
          push_provider: 1,
          push_platform: 1,
          push_token_updated: 1,
          push_tokens: 1,
        },
      }
    );

    const existingEntries = [];
    if (Array.isArray(user?.push_tokens)) {
      existingEntries.push(...user.push_tokens.map(normalizePushTokenEntry));
    }
    if (user?.push_token) {
      existingEntries.push(normalizePushTokenEntry({
        token: user.push_token,
        provider: user.push_provider,
        platform: user.push_platform,
        updated_at: user.push_token_updated,
        enabled: true,
      }));
    }

    const filteredEntries = existingEntries
      .filter(Boolean)
      .filter((entry) => entry.token !== rawPushToken);

    if (rawPushToken) {
      filteredEntries.unshift({
        token: rawPushToken,
        provider,
        platform: devicePlatform,
        enabled: notificationsEnabled,
        updated_at: now,
      });
    }

    const seen = new Set();
    const nextPushTokens = filteredEntries.filter((entry) => {
      if (!entry?.token || seen.has(entry.token)) return false;
      seen.add(entry.token);
      return true;
    });

    const latestEnabledEntry = nextPushTokens.find((entry) => entry.enabled !== false) || null;

    await db.collection('users').updateOne(
      { user_id: req.user.user_id },
      {
        $set: {
          push_tokens: nextPushTokens,
          push_token: latestEnabledEntry?.token || null,
          push_provider: latestEnabledEntry?.provider || null,
          push_platform: latestEnabledEntry?.platform || null,
          push_token_updated: now,
        },
      }
    );

    res.json({
      status: 'ok',
      notifications_enabled: notificationsEnabled,
      token_saved: Boolean(rawPushToken && notificationsEnabled),
    });
  } catch (error) {
    console.error('Save push token error:', error);
    res.status(500).json({ detail: 'Failed to save push token' });
  }
}

// Admin: list all users (tenants + admins)
async function adminGetAllUsers(req, res) {
  try {
    const db = getDb();
    const users = await db.collection('users')
      .find({})
      .sort({ created_at: -1 })
      .toArray();
    res.json(users.map(u => ({ ...u, _id: undefined, password_hash: undefined })));
  } catch (error) {
    res.status(500).json({ detail: 'Failed to fetch users' });
  }
}

module.exports = {
  getMe,
  updateMe,
  savePushToken,
  uploadDocument,
  getUserDocuments,
  getDocumentFile,
  deleteDocument,
  adminGetAllUsers,
};
