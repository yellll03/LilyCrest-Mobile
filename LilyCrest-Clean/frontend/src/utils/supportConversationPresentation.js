export const INQUIRY_TICKET_ID_PATTERN = /^INQ-\d{4}-\d{6}$/;

export function inquiryTicketLabel(ticketId) {
  const value = String(ticketId || '').trim().toUpperCase();
  return INQUIRY_TICKET_ID_PATTERN.test(value) ? value : 'Inquiry ID pending';
}

export function getLatestOutgoingMessageId(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.sender === 'user') return messages[index].id;
  }
  return null;
}

export function tenantMessageDeliveryStatus(message) {
  if (message?.sender !== 'user') return '';
  return message.readAt ? 'Seen' : 'Sent';
}

const SUPPORT_STATUS_LABELS = Object.freeze({
  open: 'Open',
  in_review: 'In Review',
  waiting_tenant: 'Waiting for You',
  resolved: 'Resolved',
  closed: 'Closed',
});

export function supportStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return SUPPORT_STATUS_LABELS[normalized] || 'Open';
}

export function supportStatusGroup(status) {
  return ['resolved', 'closed'].includes(String(status || '').trim().toLowerCase())
    ? 'solved'
    : 'pending';
}
