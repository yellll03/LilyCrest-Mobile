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

module.exports = {
  normalizeUser,
  firstNonEmptyString,
};
