export function acknowledgementError(error) {
  if (error?.response?.status === 404) return 'This announcement is no longer available.';
  if (error?.response?.status === 400) return 'No acknowledgement is needed for this announcement.';
  if (!error?.response) return "We couldn't confirm your acknowledgement. Check your connection and try again.";
  return 'Acknowledgement is temporarily unavailable. Please try again later.';
}
// Always reconcile before a write, and again after an ambiguous response.
export async function confirmAcknowledgement(api, id, { isCurrent = () => true } = {}) {
  const assertCurrent = () => {
    if (!isCurrent()) throw Object.assign(new Error('Acknowledgement flow closed.'), { code: 'ENGAGEMENT_CANCELLED' });
  };
  assertCurrent();
  const current = (await api.getAnnouncement(id)).data;
  assertCurrent();
  if (current.acknowledged || !current.requiresAcknowledgment) return current;
  try { return (await api.acknowledgeAnnouncement(id)).data; }
  catch (error) {
    assertCurrent();
    try {
      const recovered = (await api.getAnnouncement(id)).data;
      assertCurrent();
      if (recovered.acknowledged) return recovered;
    } catch (_) { /* Keep the original friendly failure. */ }
    throw error;
  }
}
