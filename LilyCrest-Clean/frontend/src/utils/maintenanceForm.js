const MIN_DESCRIPTION_LENGTH = 10;
const MAX_DESCRIPTION_LENGTH = 1000;

export function getCreateRequestDescriptionError(value = '') {
  const trimmedLength = String(value || '').trim().length;
  if (trimmedLength === 0) return 'Description is required.';
  if (trimmedLength < MIN_DESCRIPTION_LENGTH) {
    return `Please describe your concern (min ${MIN_DESCRIPTION_LENGTH} characters)`;
  }
  if (trimmedLength > MAX_DESCRIPTION_LENGTH) {
    return `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`;
  }
  return '';
}

export function getMaintenanceAttachmentErrorMessage(error) {
  const message = String(error?.message || '').trim();
  if (/attachment exceeds\s+5\s*mb limit/i.test(message)) {
    return 'File must be 5 MB or smaller.';
  }
  if (message === 'Upload failed, please retry' || message === 'Unsupported file type.') {
    return message;
  }
  return error?.response?.data?.detail || 'Failed to submit request. Please try again.';
}

export function getMaintenanceAttachmentSelectionError(file, { maxBytes, supported } = {}) {
  if (!supported) return 'Please select an image, PDF, document, text, or CSV file.';
  if (file?.size && Number.isFinite(maxBytes) && file.size > maxBytes) {
    return 'File must be 5 MB or smaller.';
  }
  return '';
}

export function shouldConfirmCreateRequestClose({ isDirty = false, hasAttemptedSubmit = false } = {}) {
  return Boolean(isDirty || hasAttemptedSubmit);
}
