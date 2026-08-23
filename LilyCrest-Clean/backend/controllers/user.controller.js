const { getDb } = require('../config/database');
const { ObjectId } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const { normalizeUser, sanitizeUserForClient, sanitizeUserForAdminList } = require('../utils/normalizeUser');
const { admin, resolveStorageBucket } = require('../config/firebase');
const { resolveTenantBranch } = require('../services/branchLocation.service');
const { extractMoveInFinancials } = require('../domain/billing/moveInFinancials');
const { authorizeTenantStorageObject } = require('../services/documentStorageAuthorization.service');

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
const approvedReservationFilter = {
  $or: [
    { status: { $regex: /^(approved|confirmed|active|completed|checked_in|movein|paid)$/i } },
    { applicationStatus: { $regex: /^(approved|confirmed|active|completed|checked_in|movein|paid)$/i } },
    { approvalStatus: { $regex: /^(approved|confirmed|active|completed|checked_in|movein|paid)$/i } },
    { isApproved: true },
  ],
};
const TENANT_VISIBLE_CONTRACT_STATUSES = ['PRE_RELEASE_TEST', 'APPROVED', 'ACTIVE'];

async function findTenantVisibleContract(db, user) {
  if (!user?._id || !user?.user_id) return null;
  return db.collection('generatedContracts').findOne({
    status: { $in: TENANT_VISIBLE_CONTRACT_STATUSES },
    publicDocumentId: { $type: 'string', $ne: '' },
    $or: [
      { userId: user.user_id },
      { tenantId: user.user_id },
      { tenantId: user._id },
      { tenantId: String(user._id) },
    ],
  }, { sort: { approvedAt: -1, testPublishedAt: -1, generatedAt: -1 } });
}

function tenantContractFileUrl(contract) {
  if (!contract) return null;
  return ['APPROVED', 'ACTIVE'].includes(contract.status)
    ? contract.finalFileUrl
    : (contract.status === 'PRE_RELEASE_TEST' ? contract.testFileUrl : null);
}

function tenantContractStoragePath(contract) {
  if (!contract) return null;
  return ['APPROVED', 'ACTIVE'].includes(contract.status)
    ? contract.finalStoragePath
    : (contract.status === 'PRE_RELEASE_TEST' ? contract.testStoragePath : null);
}

function tenantContractStatusLabel(contract) {
  if (contract?.status === 'PRE_RELEASE_TEST') return 'Pre-release Test Contract';
  if (contract?.status === 'ACTIVE') return 'Active';
  if (contract?.status === 'APPROVED') return 'Approved';
  return null;
}

function tenantContractDocument(contract) {
  const fileUrl = tenantContractFileUrl(contract);
  const storagePath = tenantContractStoragePath(contract);
  if (!contract?.publicDocumentId || !(fileUrl || storagePath)) return null;
  const snapshot = contract.snapshot || {};
  return {
    doc_id: `lease_${contract.publicDocumentId}`,
    type: 'lease_contract',
    label: 'Lease Contract',
    status: tenantContractStatusLabel(contract),
    uploaded_at: contract.approvedAt || contract.testPublishedAt || contract.generatedAt,
    source: 'generated_contract',
    file_url: fileUrl,
    storagePath,
    mimeType: 'application/pdf',
    contractPeriod: {
      startDate: snapshot.contractStartDate || null,
      endDate: snapshot.contractEndDate || null,
    },
    roomNumber: snapshot.roomNumber || null,
    branchName: snapshot.branchName || null,
    leaseType: snapshot.leaseType === 'SHORT_TERM' ? 'Short-term' : (snapshot.leaseType === 'LONG_TERM' ? 'Long-term' : null),
  };
}

function addressParts(source = {}) {
  const candidates = [
    source.address,
    source.completeAddress,
    source.fullAddress,
    source.homeAddress,
    source.currentAddress,
    source.applicantDetails?.address,
    source.applicantDetails?.completeAddress,
    source.applicantDetails?.homeAddress,
    source.applicantDetails?.currentAddress,
    source.applicant_details?.address,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const parts = [
      candidate.addressLine1, candidate.address_line_1, candidate.street, candidate.streetAddress,
      candidate.addressLine2, candidate.address_line_2,
      candidate.barangay, candidate.city, candidate.municipality,
      candidate.province, candidate.state, candidate.postalCode, candidate.postal_code,
      candidate.country,
    ].filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim());
    if (parts.length) return parts;
  }
  return [];
}

function completeAddress(source = {}) {
  const structured = addressParts(source);
  if (structured.length) return [...new Set(structured)].join(', ');
  const direct = firstValue(
    source.completeAddress, source.fullAddress, source.address,
    source.homeAddress, source.currentAddress,
    source.applicantDetails?.completeAddress, source.applicantDetails?.address,
    source.applicantDetails?.homeAddress, source.applicantDetails?.currentAddress,
  );
  if (typeof direct === 'string') return direct.trim();
  return [
    source.addressLine1, source.addressLine2, source.street, source.barangay,
    source.city, source.province, source.postalCode, source.country,
  ].filter(Boolean).map(String).map((part) => part.trim()).filter(Boolean).join(', ');
}

function normalizePhilippinePhone(value) {
  const compact = String(value || '').replace(/[\s()-]/g, '');
  if (/^09\d{9}$/.test(compact)) return `+63${compact.slice(1)}`;
  if (/^\+63\d{10}$/.test(compact)) return compact;
  return String(value || '').trim();
}

function applicationPhone(source = {}) {
  return normalizePhilippinePhone(firstValue(
    source.phone,
    source.phoneNumber,
    source.contactNumber,
    source.mobileNumber,
    source.applicantDetails?.phone,
    source.applicantDetails?.phoneNumber,
    source.applicantDetails?.contactNumber,
    source.applicantDetails?.mobileNumber,
    source.applicant_details?.phone,
    source.applicant_details?.phone_number,
    source.applicant_details?.contact_number,
  ));
}

async function buildTenantProfile(db, user) {
  const identityFilters = [
    { user_id: user.user_id },
    { userId: user.user_id },
    { tenant_id: user.user_id },
    { tenantId: user.user_id },
  ];
  if (user._id) {
    identityFilters.push(
      { userId: user._id }, { tenantId: user._id },
      { user_id: String(user._id) }, { tenant_id: String(user._id) },
    );
  }
  const reservation = await db.collection('reservations').findOne(
    { $and: [{ $or: identityFilters }, approvedReservationFilter] },
    { sort: { approvedAt: -1, updatedAt: -1, createdAt: -1 } },
  );

  const normalized = normalizeUser(user);
  // An approved reservation is authoritative; never fall back to an editable profile address.
  normalized.address = reservation ? completeAddress(reservation) : '';
  normalized.addressSource = reservation && normalized.address ? 'approved_application' : null;
  // Unlike address, phone is tenant-editable (see updateMe's allowedFields).
  // The tenant's own saved phone must win once set; the approved application's
  // phone is only a hydration fallback for tenants who haven't set one yet —
  // otherwise every profile fetch after a phone edit would silently revert
  // to the original application value.
  const tenantPhone = normalizePhilippinePhone(normalized.phone);
  normalized.phone = tenantPhone || applicationPhone(reservation) || '';
  normalized.phoneSource = tenantPhone ? 'verified_tenant' : (applicationPhone(reservation) ? 'approved_application' : null);
  const lastUsernameChangedAt = user.lastUsernameChangedAt ? new Date(user.lastUsernameChangedAt) : null;
  normalized.usernameNextAllowedAt = lastUsernameChangedAt && !Number.isNaN(lastUsernameChangedAt.getTime())
    ? new Date(lastUsernameChangedAt.getTime() + USERNAME_COOLDOWN_MS).toISOString()
    : null;
  normalized.serverTime = new Date().toISOString();

  let branch = null;
  try {
    const resolved = await resolveTenantBranch(db, user);
    branch = resolved.branch;
  } catch (branchError) {
    if (branchError?.code === 'BRANCH_ASSIGNMENT_CONFLICT') throw branchError;
  }

  const generatedContract = await findTenantVisibleContract(db, user);
  const contractDocument = tenantContractDocument(generatedContract);
  const moveInFinancials = reservation ? extractMoveInFinancials(reservation) : null;
  normalized.branch = branch;
  normalized.contract = contractDocument ? {
    status: contractDocument.status,
    startDate: contractDocument.contractPeriod.startDate,
    endDate: contractDocument.contractPeriod.endDate,
    roomNumber: contractDocument.roomNumber,
    property: contractDocument.branchName,
    branch: branch || null,
    leaseType: contractDocument.leaseType,
    documentId: contractDocument.doc_id,
    fileAvailable: true,
    generatedDate: contractDocument.uploaded_at,
    documentVersion: generatedContract.version || null,
    moveInFinancials,
  } : null;
  normalized.survey = null;
  return sanitizeUserForClient(normalized);
}

// Get current user profile
async function getMe(req, res) {
  try {
    const db = getDb();
    const user = await db.collection('users').findOne({ user_id: req.user.user_id });

    if (!user) {
      return res.status(404).json({ detail: 'User not found' });
    }

    res.json(await buildTenantProfile(db, user));
  } catch (error) {
    console.error('getMe error:', error);
    if (error?.code === 'BRANCH_ASSIGNMENT_CONFLICT') {
      return res.status(409).json({ detail: 'Multiple branch assignments were found. Please contact the admin office.' });
    }
    res.status(500).json({ detail: 'Failed to load profile' });
  }
}

// ── Field-level validators ──
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const USERNAME_REGEX = /^[a-zA-Z0-9_.]+$/;
const USERNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;
const PHONE_REGEX = /^\+63\d{10}$/;
const ADDRESS_MAX = 200;
const PICTURE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB decoded image payload
const DOC_MAX_BYTES = 5 * 1024 * 1024; // 5 MB for document uploads
const DOCUMENT_CONTENT_MAX_BYTES = 50 * 1024 * 1024;
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

// Validates a downloaded buffer's magic bytes against a declared/expected
// content type. Shared between the storagePath (Firebase Admin) and
// file_url (upstream fetch) read paths — a declared image/jpeg backed by
// non-JPEG bytes (or vice versa) is rejected rather than served, and a
// PDF-only path never wrongly demands PDF magic bytes from an uploaded
// image document.
function matchesDeclaredFileType(buffer, contentType) {
  const normalized = String(contentType || '').toLowerCase();
  const isPdf = buffer.subarray(0, 5).toString() === '%PDF-';
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  if (normalized === 'application/pdf') return isPdf;
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return isJpeg;
  if (normalized === 'image/png') return isPng;
  if (normalized === 'image/webp') return isWebp;
  // No specific magic-byte signature is checked for other declared image
  // types (gif/bmp/heic/heif) — fall back to accepting them, matching prior
  // behavior for those types.
  return normalized.startsWith('image/');
}

function usernameCooldownState(lastUsernameChangedAt, now = new Date()) {
  const lastChanged = lastUsernameChangedAt ? new Date(lastUsernameChangedAt) : null;
  if (!lastChanged || Number.isNaN(lastChanged.getTime())) {
    return { active: false, nextAllowedAt: null };
  }
  const nextAllowedAt = new Date(lastChanged.getTime() + USERNAME_COOLDOWN_MS);
  return { active: now < nextAllowedAt, nextAllowedAt };
}

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

function isApprovedProfileImageUrl(value = '') {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const configuredHosts = String(process.env.PROFILE_IMAGE_CDN_HOSTS || '')
      .split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
    return /(^|\.)firebasestorage\.googleapis\.com$|(^|\.)firebasestorage\.app$/i.test(url.hostname)
      || configuredHosts.includes(url.hostname.toLowerCase());
  } catch (_) {
    return false;
  }
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
      if (!USERNAME_REGEX.test(clean)) return { ok: false, error: 'Username can only contain letters, numbers, underscores, and periods.' };
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
      if (!value.startsWith('data:image/') && !isApprovedProfileImageUrl(value)) {
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

    const allowedFields = ['username', 'phone', 'picture'];
    const updateData = {};
    const fieldErrors = {};

    if (updates.name !== undefined) {
      fieldErrors.name = 'Full name is managed from the tenant application. Please contact admin to request a change.';
    }
    if (updates.email !== undefined) {
      fieldErrors.email = 'Email is managed by the administrator to keep your sign-in account synchronized.';
    }
    if (updates.address !== undefined) {
      fieldErrors.address = 'Address is managed from the approved tenant application. Please contact the administrator to request a change.';
    }

    // Only validate fields that were actually sent
    for (const field of allowedFields) {
      if (updates[field] === undefined) continue;

      const result = validateField(field, updates[field]);
      if (!result.ok) {
        fieldErrors[field] = result.error;
      } else {
        updateData[field] = result.value;
        if (field === 'username') updateData.username_normalized = result.value;
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
    const currentUser = await db.collection('users').findOne({ user_id: userId });
    if (!currentUser) {
      return res.status(404).json({ detail: 'User not found.' });
    }

    // Username is case-insensitively unique and may only change once every 7 days.
    let changesUsername = Boolean(updateData.username);
    if (changesUsername) {
      const currentUsername = String(currentUser.username || '').trim().toLowerCase();
      if (updateData.username === currentUsername) {
        delete updateData.username;
        delete updateData.username_normalized;
        changesUsername = false;
      } else {
        const cooldown = usernameCooldownState(currentUser.lastUsernameChangedAt);
        if (cooldown.active) {
          return res.status(429).json({
            detail: `You can change your username again on ${cooldown.nextAllowedAt.toISOString()}.`,
            code: 'USERNAME_COOLDOWN',
            nextAllowedAt: cooldown.nextAllowedAt.toISOString(),
            nextUsernameChangeAt: cooldown.nextAllowedAt.toISOString(),
            serverTime: new Date().toISOString(),
            errors: { username: 'Username changes are limited to once every 7 days.' },
          });
        }
      }
    }

    if (updateData.username) {
      const usernameRegex = new RegExp(`^${updateData.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      const existingUsername = await db.collection('users').findOne({
        $or: [
          { username_normalized: updateData.username },
          { username: usernameRegex },
        ],
        user_id: { $ne: userId },
      });
      if (existingUsername) {
        return res.status(400).json({ detail: 'Validation failed.', errors: { username: 'This username is already taken.' } });
      }
      updateData.lastUsernameChangedAt = new Date();
    }

    updateData.updated_at = new Date();

    const updateFilter = { user_id: userId };
    if (changesUsername) {
      updateFilter.$or = currentUser.lastUsernameChangedAt == null
        ? [{ lastUsernameChangedAt: { $exists: false } }, { lastUsernameChangedAt: null }]
        : [{ lastUsernameChangedAt: currentUser.lastUsernameChangedAt }];
    }
    const updateResult = await db.collection('users').updateOne(
      updateFilter,
      { $set: updateData }
    );
    if (changesUsername && updateResult.modifiedCount !== 1) {
      return res.status(409).json({
        detail: 'Your profile changed while this request was processing. Please reload and try again.',
        code: 'PROFILE_UPDATE_CONFLICT',
      });
    }

    const updatedUser = await db.collection('users').findOne({ user_id: userId });

    res.json(await buildTenantProfile(db, updatedUser));
  } catch (error) {
    console.error('Update user error:', error);
    if (error?.code === 11000) {
      const field = error?.keyPattern?.username_normalized ? 'username' : 'email';
      return res.status(409).json({ detail: 'Validation failed.', errors: { [field]: `This ${field} is already in use.` } });
    }
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

    // Prove the submitted storagePath is genuinely this tenant's own object
    // (own upload prefix, and downloadUrl decodes to that exact bucket/path)
    // before any privileged Firebase Admin access is ever performed against
    // it from getDocumentContent/deleteDocument below. Fail closed.
    const authorization = authorizeTenantStorageObject({
      downloadUrl: metadata.value.downloadUrl,
      storagePath: metadata.value.storagePath,
      userId: req.user.user_id,
      configuredBucket: resolveStorageBucket(),
    });
    if (!authorization.authorized) {
      return res.status(400).json({ detail: 'Document storage location could not be verified.' });
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
      mimeType: 'image/jpeg',
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
      mimeType: 'image/jpeg',
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
      mimeType: 'image/jpeg',
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
      mimeType: 'image/jpeg',
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
      mimeType: 'image/jpeg',
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
      mimeType: 'image/jpeg',
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

    // Reservation documents (from the web admin reservation flow). The
    // tenant's Lease Contract itself is intentionally NOT listed here: it is
    // owned by Capstone-Website's Contract model/mobileContractRoutes.js
    // (GET /api/m/contracts/current, see useTenantContract.js) and rendered
    // on the dedicated Contract screen. `generatedContracts` in this backend
    // is a separate, QA-only record (see publishTenantTestContract) — never
    // surfacing it here avoids showing a second, non-authoritative "Lease
    // Contract" entry alongside the real one.
    let reservationDocs = [];
    const mongoId = user?._id;
    if (mongoId) {
      const reservation = await db.collection('reservations').findOne(
        { $and: [{ $or: [{ userId: mongoId }, { tenantId: mongoId }, { user_id: req.user.user_id }, { tenant_id: req.user.user_id }] }, approvedReservationFilter] },
        { sort: { createdAt: -1 } }
      );
      reservationDocs = buildReservationDocs(reservation);
    }

    // Reservation docs first (submitted during onboarding), then user-uploaded docs
    const allDocs = [...reservationDocs, ...uploadedDocs].map(({ file_url, downloadUrl, storagePath, ...doc }) => doc);
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
    if (docId.startsWith('lease_')) {
      const user = await db.collection('users').findOne({ user_id: req.user.user_id }, { projection: { _id: 1, user_id: 1 } });
      const contract = await findTenantVisibleContract(db, user);
      const contractDocument = tenantContractDocument(contract);
      if (!contractDocument || contractDocument.doc_id !== docId) return res.status(404).json({ detail: 'Document not found.' });
      return res.json({ ...contractDocument, file_url: undefined, fileAvailable: true });
    }

    if (docId.startsWith('res_')) {
      const user = await db.collection('users').findOne(
        { user_id: req.user.user_id },
        { projection: { _id: 1 } }
      );
      if (!user?._id) {
        return res.status(404).json({ detail: 'Document not found.' });
      }

      const reservation = await db.collection('reservations').findOne(
        { $and: [{ $or: [{ userId: user._id }, { tenantId: user._id }, { user_id: req.user.user_id }, { tenant_id: req.user.user_id }] }, approvedReservationFilter] },
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

      return res.json({
        ...doc,
        file_url: undefined,
        fileAvailable: true,
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
        file_url: undefined,
        downloadUrl: undefined,
        storagePath: undefined,
        fileAvailable: true,
      });
    }

    res.json(doc);
  } catch (error) {
    console.error('Get document file error:', error);
    res.status(500).json({ detail: 'Failed to get document' });
  }
}

async function getDocumentContent(req, res) {
  try {
    const { docId } = req.params;
    const db = getDb();
    const user = await db.collection('users').findOne(
      { user_id: req.user.user_id },
      { projection: { _id: 1, uploaded_documents: 1 } },
    );
    if (!user) return res.status(404).json({ detail: 'Document not found.' });

    let doc;
    if (docId.startsWith('lease_')) {
      const contract = await findTenantVisibleContract(db, { _id: user._id, user_id: req.user.user_id });
      doc = tenantContractDocument(contract);
      if (doc?.doc_id !== docId) doc = null;
    } else if (docId.startsWith('res_')) {
      const reservation = await db.collection('reservations').findOne(
        { $and: [{ $or: [{ userId: user._id }, { tenantId: user._id }, { user_id: req.user.user_id }, { tenant_id: req.user.user_id }] }, approvedReservationFilter] },
        { sort: { createdAt: -1 } },
      );
      doc = buildReservationDocs(reservation).find((entry) => entry.doc_id === docId);
    } else {
      doc = (user.uploaded_documents || []).find((entry) => entry.doc_id === docId);
    }
    if (!doc) return res.status(404).json({ detail: 'Document not found.' });

    if (doc.file_data && /^data:/i.test(doc.file_data)) {
      const match = doc.file_data.match(/^data:([^;,]+);base64,(.+)$/i);
      if (!match) return res.status(422).json({ detail: 'Document file is invalid.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (!buffer.length || buffer.length > DOCUMENT_CONTENT_MAX_BYTES) return res.status(422).json({ detail: 'Document file is invalid.' });
      res.setHeader('Content-Type', match[1]);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.send(buffer);
    }

    if (doc.storagePath) {
      const bucketName = resolveStorageBucket();
      if (!bucketName) return res.status(503).json({ detail: 'Document storage is not configured.' });
      // Re-verify ownership before every privileged read, not just at
      // registration time, so a record stored before this invariant existed
      // (or corrupted/tampered after the fact) can never be served.
      const authorization = authorizeTenantStorageObject({
        downloadUrl: doc.downloadUrl,
        storagePath: doc.storagePath,
        userId: req.user.user_id,
        configuredBucket: bucketName,
      });
      if (!authorization.authorized) {
        return res.status(409).json({ detail: 'This document could not be verified and must be re-uploaded.' });
      }
      const [buffer] = await admin.storage().bucket(bucketName).file(doc.storagePath).download();
      const declaredType = String(doc.mimeType || 'application/pdf').toLowerCase();
      if (!buffer.length || buffer.length > DOCUMENT_CONTENT_MAX_BYTES || !matchesDeclaredFileType(buffer, declaredType)) {
        return res.status(422).json({ detail: 'Document file is invalid.' });
      }
      res.setHeader('Content-Type', declaredType);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', 'inline');
      return res.send(buffer);
    }

    const sourceUrl = firstValue(doc.file_url, doc.downloadUrl);
    if (!sourceUrl || !/^https:\/\//i.test(sourceUrl)) return res.status(404).json({ detail: 'Document file is missing.' });
    const upstream = await fetch(sourceUrl, { signal: AbortSignal.timeout(15000) });
    if (!upstream.ok) return res.status(502).json({ detail: 'Document file is unavailable.' });
    const contentType = String(upstream.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!contentType.startsWith('image/') && contentType !== 'application/pdf') {
      return res.status(415).json({ detail: 'Document type is not supported.' });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (!buffer.length || buffer.length > DOCUMENT_CONTENT_MAX_BYTES || !matchesDeclaredFileType(buffer, contentType)) {
      return res.status(422).json({ detail: 'Document file is invalid.' });
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    return res.send(buffer);
  } catch (error) {
    if (error?.name === 'TimeoutError') return res.status(504).json({ detail: 'Document request timed out.' });
    console.error('Get document content error:', error);
    return res.status(500).json({ detail: 'Failed to load document.' });
  }
}

// Delete an uploaded document
async function deleteDocument(req, res) {
  try {
    const { docId } = req.params;
    const db = getDb();

    const owner = await db.collection('users').findOne(
      { user_id: req.user.user_id, 'uploaded_documents.doc_id': docId },
      { projection: { uploaded_documents: 1 } },
    );
    const document = owner?.uploaded_documents?.find((entry) => entry.doc_id === docId);
    if (!document) return res.status(404).json({ detail: 'Document not found.' });

    const marked = await db.collection('users').updateOne(
      { user_id: req.user.user_id, uploaded_documents: { $elemMatch: { doc_id: docId, deletion_pending: { $ne: true } } } },
      { $set: { 'uploaded_documents.$.deletion_pending': true, 'uploaded_documents.$.deletion_requested_at': new Date() } },
    );
    if (marked.matchedCount === 0 && document.deletion_pending !== true) {
      return res.status(409).json({ detail: 'Document changed before deletion could start. Please try again.' });
    }

    if (document.storagePath) {
      const bucketName = resolveStorageBucket();
      if (!bucketName) return res.status(503).json({ detail: 'Document storage is not configured.' });
      // Re-verify ownership before every privileged delete — same invariant
      // as getDocumentContent above.
      const authorization = authorizeTenantStorageObject({
        downloadUrl: document.downloadUrl,
        storagePath: document.storagePath,
        userId: req.user.user_id,
        configuredBucket: bucketName,
      });
      if (!authorization.authorized) {
        // The record belongs to this tenant but its stored path can't be
        // verified (e.g. predates this invariant, or was tampered with) —
        // never issue a privileged delete against an unverified path. Undo
        // the pending-deletion marker and leave the record for review
        // instead of silently discarding it.
        await db.collection('users').updateOne(
          { user_id: req.user.user_id, 'uploaded_documents.doc_id': docId },
          { $unset: { 'uploaded_documents.$.deletion_pending': '', 'uploaded_documents.$.deletion_requested_at': '' } },
        ).catch(() => {});
        return res.status(409).json({ detail: 'This document could not be verified and must be re-uploaded.' });
      }
      try {
        await admin.storage().bucket(bucketName).file(document.storagePath).delete({ ignoreNotFound: true });
      } catch (storageError) {
        console.error('Delete document storage error:', storageError);
        await db.collection('users').updateOne(
          { user_id: req.user.user_id, 'uploaded_documents.doc_id': docId },
          { $unset: { 'uploaded_documents.$.deletion_pending': '', 'uploaded_documents.$.deletion_requested_at': '' } },
        ).catch(() => {});
        return res.status(503).json({ detail: 'Document file could not be deleted. Please try again.' });
      }
    }

    const result = await db.collection('users').updateOne(
      { user_id: req.user.user_id, 'uploaded_documents.doc_id': docId },
      { $pull: { uploaded_documents: { doc_id: docId } } }
    );

    if (result.modifiedCount === 0) {
      return res.status(503).json({ detail: 'Document file was deleted, but its record could not be finalized. Retrying is safe.' });
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

// Core push-token upsert/disable logic, shared by the normal authenticated
// save-token endpoint and the recently-expired-session teardown endpoint
// (see sessionTeardown in auth.controller.js) so there is exactly one place
// that decides how a device's push-token association is stored per user.
async function persistPushTokenForUser(db, userId, { rawPushToken = '', notificationsEnabled = true, provider = null, devicePlatform = null } = {}) {
  const now = new Date();

  const user = await db.collection('users').findOne(
    { user_id: userId },
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
    { user_id: userId },
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

  return { tokenSaved: Boolean(rawPushToken && notificationsEnabled) };
}

// Save push notification token
async function savePushToken(req, res) {
  try {
    const rawPushToken = typeof req.body?.push_token === 'string' ? req.body.push_token.trim() : '';
    const notificationsEnabled = req.body?.notifications_enabled !== false;
    const provider = typeof req.body?.provider === 'string' ? req.body.provider.trim().toLowerCase() : null;
    const devicePlatform = typeof req.body?.device_platform === 'string' ? req.body.device_platform.trim().toLowerCase() : null;
    const db = getDb();

    if (!rawPushToken && notificationsEnabled) {
      return res.status(400).json({ detail: 'push_token is required when notifications are enabled.' });
    }

    const { tokenSaved } = await persistPushTokenForUser(db, req.user.user_id, {
      rawPushToken, notificationsEnabled, provider, devicePlatform,
    });

    res.json({
      status: 'ok',
      notifications_enabled: notificationsEnabled,
      token_saved: tokenSaved,
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
    res.json(users.map((user) => sanitizeUserForAdminList(normalizeUser(user))));
  } catch (error) {
    res.status(500).json({ detail: 'Failed to fetch users' });
  }
}

module.exports = {
  getMe,
  updateMe,
  savePushToken,
  persistPushTokenForUser,
  uploadDocument,
  getUserDocuments,
  getDocumentFile,
  getDocumentContent,
  deleteDocument,
  adminGetAllUsers,
  __test: {
    completeAddress, applicationPhone, normalizePhilippinePhone, usernameCooldownState, approvedReservationFilter,
    findTenantVisibleContract, tenantContractDocument, tenantContractStatusLabel,
  },
};
