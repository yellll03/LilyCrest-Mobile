function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function normalizeUser(doc) {
  if (!doc) return doc;
  const user = { ...doc };

  const applicant = (user.applicantDetails && typeof user.applicantDetails === 'object')
    ? user.applicantDetails
    : ((user.applicant_details && typeof user.applicant_details === 'object') ? user.applicant_details : {});

  const applicantFirstName = firstNonEmptyString(
    applicant.firstName,
    applicant.first_name,
    user.firstName,
    user.first_name,
  );
  const applicantLastName = firstNonEmptyString(
    applicant.lastName,
    applicant.last_name,
    user.lastName,
    user.last_name,
  );

  if (!user.firstName && applicantFirstName) user.firstName = applicantFirstName;
  if (!user.lastName && applicantLastName) user.lastName = applicantLastName;

  const applicantFullName = [applicantFirstName, applicantLastName].filter(Boolean).join(' ').trim();
  if (applicantFullName) {
    user.name = applicantFullName;
  } else if (user.fullName) {
    user.name = firstNonEmptyString(user.fullName);
  }

  if (!user.email && user.emailAddress) user.email = user.emailAddress;

  if (!user.phone && (user.contactNumber || user.phoneNumber)) {
    user.phone = user.contactNumber || user.phoneNumber;
  }

  if (!user.address) {
    user.address = firstNonEmptyString(
      applicant.address,
      applicant.homeAddress,
      applicant.home_address,
      applicant.currentAddress,
      applicant.current_address,
      user.homeAddress,
      user.home_address,
    );
  }

  if (!user.username && user.email) {
    user.username = user.email.split('@')[0];
  }

  return user;
}

// authMiddleware attaches the FULL Mongo user document to req.user for
// internal use (ownership checks, identity resolution, etc). Controllers that
// echo req.user (or a normalizeUser'd copy of it) back to the mobile client
// must route it through this sanitizer first.
//
// This is an allowlist, not a denylist: only fields the tenant mobile app
// actually reads are ever returned (confirmed against every frontend consumer
// of GET /auth/me, GET/PUT /users/me, and the dashboard response — profile.jsx,
// home.jsx, settings.jsx, services.jsx, document-viewer.jsx, image-viewer.jsx,
// my-documents.jsx, survey-form.jsx, surveys.jsx, LilyAssistantScreen.jsx).
// A denylist can only ever exclude fields this repo knows to write to the
// `users` collection — a separate admin/web codebase writing to the same
// MongoDB collection could add a field neither list anticipates. An allowlist
// is safe against that by construction: an unrecognized field is simply never
// forwarded, sensitive or not.
const CLIENT_VISIBLE_USER_FIELDS = [
  'user_id',
  'email',
  'name',
  'firstName',
  'lastName',
  'phone',
  'phoneSource',
  'address',
  'addressSource',
  'username',
  'usernameNextAllowedAt',
  'picture',
  'branch',
  'contract',
  'survey',
  'serverTime',
  'role',
];

function sanitizeUserForClient(user) {
  if (!user) return user;
  const safe = {};
  for (const field of CLIENT_VISIBLE_USER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(user, field)) {
      safe[field] = user[field];
    }
  }
  return safe;
}

const ADMIN_LIST_USER_FIELDS = [
  'user_id',
  'email',
  'emailAddress',
  'google_email',
  'name',
  'fullName',
  'firstName',
  'lastName',
  'role',
  'room_number',
  'roomNumber',
  'room',
  'status',
  'isActive',
  'is_active',
  'branch',
  'branch_id',
  'created_at',
  'createdAt',
];

function sanitizeUserForAdminList(user) {
  if (!user) return user;
  const safe = {};
  for (const field of ADMIN_LIST_USER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(user, field)) {
      safe[field] = user[field];
    }
  }
  return safe;
}

module.exports = {
  normalizeUser,
  firstNonEmptyString,
  sanitizeUserForClient,
  sanitizeUserForAdminList,
};
