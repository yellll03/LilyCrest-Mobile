export const extensionDate = (value) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' }) : 'Not available';
export function extensionPresentation(request) {
  const state = request?.status === 'approved' ? request.fulfillmentState || 'preparing' : request?.status;
  const start = request?.effectiveDate || request?.startDate || (request?.currentEndDate ? new Date(new Date(request.currentEndDate).getTime() + 86400000) : null);
  const states = {
    pending: ['Pending Admin Review', 'Administration will review your extension request.'],
    preparing: ['Approved — Preparing Your Contract', 'Administration is preparing your extension contract. Approval does not mean your extension is active yet.'],
    awaiting_contract: ['Approved — Contract Action Required', 'Check your Contract details and contact Administration to complete the required extension signing steps.'],
    awaiting_effective_date: [`Approved — Starts on ${extensionDate(start)}`, 'Your extension is waiting for its start date.'],
    action_required: ['Approved — Administration Is Resolving an Issue', "We couldn't finish preparing your extension yet. Lilycrest Administration is reviewing it."],
    effective: ['Extension Effective', 'Your extension is now active.'],
    rejected: ['Extension Request Declined', 'Contact Administration if you need help with your next steps.'],
  };
  const [label, nextAction] = states[state] || ['Status unavailable', 'Refresh to check your extension status.'];
  return { label, nextAction, start, contractAction: state === 'awaiting_contract' };
}
export function extensionError(error) {
  const detail = typeof error === 'string' ? error : error?.response?.data?.detail || error?.response?.data?.message || '';
  if (typeof error !== 'string' && !error?.response) return "You're offline. Check your connection and try again.";
  if (/already pending|renewal already exists|successor contract|existing renewal/i.test(detail)) return 'Your extension is already being processed. Please check the current status below.';
  if (/active stay|active tenants|lease must not have ended/i.test(detail)) return "You don't currently have an eligible stay to extend.";
  if (/current contract is required/i.test(detail)) return 'Your current contract must be available before you can request an extension.';
  if (/room transfer/i.test(detail)) return 'You already have a Room Transfer in progress. Please wait for it to be completed or contact Administration.';
  if (/move-out clearance/i.test(detail)) return 'A Move Out process is already in progress, so an extension cannot be requested.';
  if (/duration|whole months|requested end date/i.test(detail)) return 'Choose a valid extension duration and try again.';
  if (/pricing changed|stay.*changed/i.test(detail)) return 'Your stay details changed. Refresh and review the latest details before submitting.';
  if (/Admin review|unavailable|not started|termination/i.test(detail)) return 'Please contact Administration to review your stay before requesting an extension.';
  return "We couldn't process your extension request right now. Please try again.";
}

// A different latest row alone does not prove that this submitted intent succeeded.
export function isRecoveredExtension(request, previous, intent) {
  return Boolean(request?._id && String(request._id) !== String(previous?._id || '')
    && ['pending', 'approved'].includes(request.status)
    && String(request.stayId) === String(intent.stayId)
    && Number(request.months) === Number(intent.months)
    && Number(request.monthlyRent) === Number(intent.expectedMonthlyRent)
    && new Date(request.requestedEndDate).getTime() === new Date(intent.requestedEndDate).getTime());
}
