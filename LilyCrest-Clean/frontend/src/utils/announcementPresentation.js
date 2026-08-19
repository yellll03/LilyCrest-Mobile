const DEFAULT_PRESENTATION = Object.freeze({
  background: '#F1F5F9',
  foreground: '#4B5563',
  icon: 'information-circle-outline',
});

export const ANNOUNCEMENT_CATEGORY_PRESENTATION = Object.freeze({
  announcement: Object.freeze({ background: '#F1F5F9', foreground: '#2563EB', icon: 'megaphone-outline' }),
  general: Object.freeze({ background: '#EFF6FF', foreground: '#2563EB', icon: 'information-circle-outline' }),
  policy: Object.freeze({ background: '#F1F5F9', foreground: '#334155', icon: 'shield-checkmark-outline' }),
  alert: Object.freeze({ background: '#FEF2F2', foreground: '#DC2626', icon: 'warning-outline' }),
  reminder: Object.freeze({ background: '#FFFBEB', foreground: '#B45309', icon: 'notifications-outline' }),
  account: Object.freeze({ background: '#F1F5F9', foreground: '#4B5563', icon: 'person-circle-outline' }),
  billing: Object.freeze({ background: '#EFF6FF', foreground: '#2563EB', icon: 'card-outline' }),
  maintenance: Object.freeze({ background: '#FFFBEB', foreground: '#D97706', icon: 'construct-outline' }),
  assistant: Object.freeze({ background: '#FBF7EA', foreground: '#B9921F', icon: 'chatbubble-ellipses-outline' }),
  security: Object.freeze({ background: '#FEF2F2', foreground: '#DC2626', icon: 'shield-checkmark-outline' }),
  reservation: Object.freeze({ background: '#ECFDF5', foreground: '#059669', icon: 'calendar-outline' }),
  survey: Object.freeze({ background: '#EFF6FF', foreground: '#2563EB', icon: 'chatbox-ellipses-outline' }),
  rules: Object.freeze({ background: '#F1F5F9', foreground: '#2563EB', icon: 'document-text-outline' }),
  promo: Object.freeze({ background: '#ECFDF5', foreground: '#059669', icon: 'pricetag-outline' }),
  event: Object.freeze({ background: '#EFF6FF', foreground: '#2563EB', icon: 'calendar-outline' }),
});

export function getAnnouncementCategoryPresentation(category) {
  const key = String(category || '').trim().toLowerCase();
  const presentation = ANNOUNCEMENT_CATEGORY_PRESENTATION[key] || DEFAULT_PRESENTATION;
  return {
    bg: presentation.background,
    text: presentation.foreground,
    icon: presentation.icon,
  };
}
