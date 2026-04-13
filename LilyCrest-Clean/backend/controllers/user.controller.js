const { getDb } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// Normalize a raw MongoDB user document to the shape the app expects.
// Admin-panel documents use camelCase (fullName, emailAddress, contactNumber, etc.)
// while app-created documents use snake_case (name, email, phone).
// This bridges both schemas so the mobile app always sees consistent field names.
function normalizeUser(doc) {
  if (!doc) return doc;
  const u = { ...doc };

  // Name: fullName → name
  if (!u.name && u.fullName) u.name = u.fullName;

  // Email: emailAddress → email
  if (!u.email && u.emailAddress) u.email = u.emailAddress;

  // Phone: contactNumber / phoneNumber → phone
  if (!u.phone && (u.contactNumber || u.phoneNumber)) {
    u.phone = u.contactNumber || u.phoneNumber;
  }

  // Username: fallback to email prefix if missing
  if (!u.username && u.email) {
    u.username = u.email.split('@')[0];
  }

  return u;
}

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
const NAME_MIN = 2;
const NAME_MAX = 60;
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;
const PHONE_REGEX = /^\+63\d{10}$/;
const ADDRESS_MAX = 200;
const PICTURE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB base64 payload
const DOC_MAX_BYTES = 5 * 1024 * 1024; // 5 MB for document uploads

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim();
}

function validateField(field, value) {
  switch (field) {
    case 'name': {
      const clean = sanitize(value);
      if (!clean) return { ok: false, error: 'Name is required.' };
      if (clean.length < NAME_MIN) return { ok: false, error: `Name must be at least ${NAME_MIN} characters.` };
      if (clean.length > NAME_MAX) return { ok: false, error: `Name must be at most ${NAME_MAX} characters.` };
      if (!/^[a-zA-Z\u00c0-\u00ff\u00f1\u00d1\s.\-']+$/.test(clean)) return { ok: false, error: 'Name contains invalid characters.' };
      return { ok: true, value: clean };
    }
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
      if (value.length > PICTURE_MAX_BYTES) {
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

    const allowedFields = ['name', 'username', 'email', 'phone', 'address', 'picture'];
    const updateData = {};
    const fieldErrors = {};

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
    const { type, label, file_data } = req.body;

    if (!type || !ALLOWED_DOC_TYPES.includes(type)) {
      return res.status(400).json({ detail: `Invalid document type. Allowed: ${ALLOWED_DOC_TYPES.join(', ')}` });
    }
    if (!file_data || typeof file_data !== 'string') {
      return res.status(400).json({ detail: 'file_data is required (base64 encoded).' });
    }
    if (!file_data.startsWith('data:image/') && !file_data.startsWith('data:application/pdf')) {
      return res.status(400).json({ detail: 'File must be an image or PDF.' });
    }
    if (file_data.length > DOC_MAX_BYTES) {
      return res.status(400).json({ detail: 'File is too large (max 5 MB).' });
    }

    const docId = `doc_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    const docEntry = {
      doc_id: docId,
      type,
      label: sanitize(label) || DOC_TYPE_LABELS[type] || type,
      file_data,
      uploaded_at: new Date(),
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
    });
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ detail: 'Failed to upload document' });
  }
}

// Get user's uploaded documents (without file_data to keep response light)
async function getUserDocuments(req, res) {
  try {
    const db = getDb();
    const user = await db.collection('users').findOne(
      { user_id: req.user.user_id },
      { projection: { uploaded_documents: 1 } }
    );

    const docs = (user?.uploaded_documents || []).map(({ file_data, ...rest }) => rest);
    res.json(docs);
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
    const user = await db.collection('users').findOne(
      { user_id: req.user.user_id },
      { projection: { uploaded_documents: 1 } }
    );

    const doc = (user?.uploaded_documents || []).find(d => d.doc_id === docId);
    if (!doc) {
      return res.status(404).json({ detail: 'Document not found.' });
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

// Save push notification token
async function savePushToken(req, res) {
  try {
    const { push_token } = req.body;
    if (!push_token || typeof push_token !== 'string') {
      return res.status(400).json({ detail: 'push_token is required.' });
    }
    const db = getDb();
    await db.collection('users').updateOne(
      { user_id: req.user.user_id },
      { $set: { push_token, push_token_updated: new Date() } }
    );
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Save push token error:', error);
    res.status(500).json({ detail: 'Failed to save push token' });
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
};
