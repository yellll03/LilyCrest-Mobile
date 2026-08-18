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
