export const BRAND = Object.freeze({
  primary: '#0A1628',
  primaryHover: '#13243D',
  accent: '#D4AF37',
  accentHover: '#B9921F',
  accentLight: '#F3E4B0',
  accentSoft: '#F7EEC8',
  accentSubtle: '#FBF7EA',
});

export const STATUS = Object.freeze({
  success: Object.freeze({ solid: '#059669', background: '#ECFDF5', text: '#065F46' }),
  warning: Object.freeze({ solid: '#D97706', background: '#FFFBEB', text: '#92400E' }),
  danger: Object.freeze({ solid: '#DC2626', background: '#FEF2F2', text: '#991B1B' }),
  info: Object.freeze({ solid: '#2563EB', background: '#EFF6FF', text: '#1E40AF' }),
  neutral: Object.freeze({ solid: '#6B7280', background: '#F1F5F9', text: '#4B5563' }),
});

export const SURFACES = Object.freeze({
  light: Object.freeze({ page: '#F8FAFC', card: '#FFFFFF', muted: '#F1F5F9', border: '#E5E7EB' }),
  dark: Object.freeze({ page: '#08111F', section: '#0B1628', card: '#111C31', border: '#27334A' }),
});

export const TEXT = Object.freeze({
  light: Object.freeze({ heading: '#0A1628', body: '#1E293B', secondary: '#4B5563', muted: '#6B7280' }),
  dark: Object.freeze({ heading: '#F8FAFC', body: '#D0D7E2', secondary: '#A8B3C3', muted: '#4B5563' }),
});

export const SPACING = Object.freeze({ xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 });
export const RADII = Object.freeze({ sm: 6, md: 8, lg: 12, xl: 16, pill: 999 });

export const LIGHT_COLORS = Object.freeze({
  background: SURFACES.light.page,
  surface: SURFACES.light.card,
  surfaceSecondary: SURFACES.light.muted,
  text: TEXT.light.body,
  textPrimary: TEXT.light.body,
  heading: TEXT.light.heading,
  textSecondary: TEXT.light.secondary,
  textMuted: TEXT.light.muted,
  border: SURFACES.light.border,
  primary: BRAND.primary,
  interactive: BRAND.primary,
  primaryLight: BRAND.accentSubtle,
  primaryHover: BRAND.primaryHover,
  accent: BRAND.accent,
  accentHover: BRAND.accentHover,
  accentLight: BRAND.accentLight,
  accentSoft: BRAND.accentSoft,
  accentSubtle: BRAND.accentSubtle,
  success: STATUS.success.solid,
  successBg: STATUS.success.background,
  successText: STATUS.success.text,
  error: STATUS.danger.solid,
  errorBg: STATUS.danger.background,
  errorText: STATUS.danger.text,
  warning: STATUS.warning.solid,
  warningBg: STATUS.warning.background,
  warningText: STATUS.warning.text,
  info: STATUS.info.solid,
  infoBg: STATUS.info.background,
  infoText: STATUS.info.text,
  disabled: '#6B7280',
  onPrimary: '#FFFFFF',
  onAccent: BRAND.primary,
  inputBackground: SURFACES.light.muted,
  modalBackground: SURFACES.light.card,
  overlay: 'rgba(0,0,0,0.50)',
  iconPrimary: TEXT.light.body,
  iconSecondary: TEXT.light.secondary,
  card: SURFACES.light.card,
  cardBg: SURFACES.light.card,
  inputBg: SURFACES.light.muted,
  headerBg: BRAND.primary,
});

export const DARK_COLORS = Object.freeze({
  background: SURFACES.dark.page,
  surface: SURFACES.dark.card,
  surfaceSecondary: SURFACES.dark.section,
  text: TEXT.dark.body,
  textPrimary: TEXT.dark.body,
  heading: TEXT.dark.heading,
  textSecondary: TEXT.dark.secondary,
  textMuted: '#94A3B8',
  border: SURFACES.dark.border,
  primary: BRAND.primaryHover,
  interactive: BRAND.accent,
  primaryLight: SURFACES.dark.section,
  primaryHover: BRAND.accentHover,
  accent: BRAND.accent,
  accentHover: BRAND.accentHover,
  accentLight: BRAND.accentLight,
  accentSoft: BRAND.accentSoft,
  accentSubtle: SURFACES.dark.section,
  success: STATUS.success.solid,
  successBg: '#0B2D26',
  successText: '#6EE7B7',
  error: STATUS.danger.solid,
  errorBg: '#3A1519',
  errorText: '#FCA5A5',
  warning: STATUS.warning.solid,
  warningBg: '#35250E',
  warningText: '#F3E4B0',
  info: STATUS.info.solid,
  infoBg: '#10264B',
  infoText: '#93C5FD',
  disabled: '#64748B',
  onPrimary: '#FFFFFF',
  onAccent: BRAND.primary,
  inputBackground: SURFACES.dark.section,
  modalBackground: SURFACES.dark.card,
  overlay: 'rgba(0,0,0,0.68)',
  iconPrimary: TEXT.dark.body,
  iconSecondary: TEXT.dark.secondary,
  card: SURFACES.dark.card,
  cardBg: SURFACES.dark.card,
  inputBg: SURFACES.dark.section,
  headerBg: BRAND.primary,
});

const SUCCESS_STATES = new Set(['paid', 'active', 'verified', 'approved', 'completed', 'resolved', 'solved', 'online']);
const WARNING_STATES = new Set(['pending', 'unpaid', 'awaiting tenant', 'awaiting_tenant', 'under review', 'under_review', 'open', 'waiting_tenant', 'not started', 'not_started']);
const DANGER_STATES = new Set(['overdue', 'rejected', 'terminated', 'delete', 'deleted', 'failed', 'cancelled', 'canceled']);
const INFO_STATES = new Set(['processing', 'in progress', 'in_progress', 'scheduled', 'submitted', 'viewed', 'assigned']);

export function statusTone(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (SUCCESS_STATES.has(normalized)) return 'success';
  if (WARNING_STATES.has(normalized)) return 'warning';
  if (DANGER_STATES.has(normalized)) return 'danger';
  if (INFO_STATES.has(normalized)) return 'info';
  return 'neutral';
}

export function statusColors(value) {
  return STATUS[statusTone(value)];
}

export function semanticStatusPalette(colors, tone = 'neutral') {
  const palettes = {
    success: { solid: colors.success, background: colors.successBg, text: colors.successText },
    warning: { solid: colors.warning, background: colors.warningBg, text: colors.warningText },
    danger: { solid: colors.error, background: colors.errorBg, text: colors.errorText },
    info: { solid: colors.info, background: colors.infoBg, text: colors.infoText },
    neutral: { solid: colors.disabled, background: colors.surfaceSecondary, text: colors.textSecondary },
  };
  return palettes[tone] || palettes.neutral;
}
