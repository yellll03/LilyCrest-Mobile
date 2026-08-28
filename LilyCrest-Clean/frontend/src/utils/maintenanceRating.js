export const MAINTENANCE_RATING_LABELS = Object.freeze({
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Very Good',
  5: 'Excellent',
});

export function getMaintenanceResolutionConfirmation(request) {
  return request?.resolutionConfirmation || request?.resolution_confirmation || null;
}

export function getSubmittedMaintenanceRating(request) {
  const confirmation = getMaintenanceResolutionConfirmation(request);
  const rating = confirmation?.rating;
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
}

export function hasSubmittedMaintenanceRating(request) {
  const confirmation = getMaintenanceResolutionConfirmation(request);
  return Boolean(
    request?.tenant_confirmed_resolved
      || confirmation?.confirmedAt
      || confirmation?.confirmed_at,
  );
}

export function canRateMaintenanceRequest(request) {
  return String(request?.status || '').trim().toLowerCase() === 'resolved'
    && !hasSubmittedMaintenanceRating(request);
}

export function buildMaintenanceRatingPayload(rating, feedback = '') {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('Please choose a rating from 1 to 5.');
  }
  const trimmedFeedback = String(feedback || '').trim();
  return {
    action: 'confirm',
    confirmed: true,
    rating,
    ...(trimmedFeedback ? { feedback: trimmedFeedback } : {}),
  };
}
