/* global test */
import { render } from '@testing-library/react-native';
import { CommonActions, StackRouter, TabRouter } from '@react-navigation/routers';
import WaterBreakdown, { formatMeterValue } from '../components/WaterBreakdown';
import { DARK_COLORS, LIGHT_COLORS, semanticStatusPalette, statusTone } from '../theme/tokens';
import { getBillPaymentMethodLabel } from '../utils/billingStatus';

test('water table keeps raw readings intact and renders tenant share separately from room total', () => {
  const breakdown = Object.freeze({ period_start: '2026-09-12', period_end: '2026-09-15', reading_from: 12, reading_to: 14.98, consumption: 2.9800000000000004, rate: 1.05, total: 3.13, my_share: 1.57, tenants_sharing: 2 });
  const ui = render(<WaterBreakdown breakdown={breakdown} total={1.57} dueDate="2026-09-19" styles={{}} currency={(n) => n == null ? 'Not available' : `PHP ${n.toFixed(2)}`} date={(n) => n || 'Not available'} />);
  expect(ui.getByText('Opening reading')).toBeTruthy();
  expect(ui.getByText('Closing reading')).toBeTruthy();
  expect(ui.getByText('2.98')).toBeTruthy();
  expect(ui.queryByText('2.9800000000000004')).toBeNull();
  expect(ui.getByText('Room total')).toBeTruthy();
  expect(ui.getByText('PHP 3.13')).toBeTruthy();
  expect(ui.getAllByText('PHP 1.57')).toHaveLength(2);
  expect(ui.getByText('2026-09-19')).toBeTruthy();
  expect(breakdown.consumption).toBe(2.9800000000000004);
});
test('historical water data never fabricates physical consumption', () => {
  const ui = render(<WaterBreakdown breakdown={{ calculationVersion: 'legacy', record: { cycleStart: '2026-08-01', cycleEnd: '2026-08-31', usage: 99, myShare: 40, roomTotal: 80 }, billingBasis: 'Historical allocation' }} total={40} dueDate="2026-09-07" styles={{}} currency={(n) => String(n ?? 'Not available')} date={(n) => n} />);
  expect(ui.queryByText('99')).toBeNull();
  expect(ui.getAllByText('Not available').length).toBeGreaterThan(2);
  expect(ui.getByText('Historical allocation')).toBeTruthy();
  expect(formatMeterValue(0)).toBe('0');
});
const luminance = (hex) => hex.match(/[a-f\d]{2}/gi).map((n) => parseInt(n, 16) / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
test.each([LIGHT_COLORS, DARK_COLORS])('transfer and status foregrounds remain readable in both themes', (colors) => {
  for (const [foreground, background] of [[colors.selectionText, colors.selectionBg], [colors.infoText, colors.infoBg], [colors.errorText, colors.surface], [colors.textMuted, colors.inputBackground]]) expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  for (const status of ['paid', 'partially_paid', 'unpaid', 'overdue']) {
    const palette = semanticStatusPalette(colors, statusTone(status));
    expect(contrast(palette.text, palette.background)).toBeGreaterThanOrEqual(4.5);
  }
});
test.each(['gcash', 'paymaya', 'card', 'bank'])('uses the canonical serialized transaction label for %s', (method) => {
  expect(getBillPaymentMethodLabel({ payment_method: 'Cash (Branch)', payment_method_label: method })).toBe(method);
});
test.each(['home', 'profile', 'announcements'])('native tab history returns from Billing to %s', (origin) => {
  const options = { routeNames: ['home', 'profile', 'announcements', 'billing'], routeParamList: {}, routeGetIdList: {} };
  const router = TabRouter({ initialRouteName: 'home', backBehavior: 'history' });
  let state = router.getInitialState(options);
  state = router.getStateForAction(state, CommonActions.navigate(origin), options);
  state = router.getStateForAction(state, CommonActions.navigate('billing'), options);
  state = router.getStateForAction(state, CommonActions.goBack(), options);
  expect(state.routes[state.index].name).toBe(origin);
});
test.each([['home', 'contract'], ['profile', 'contract'], ['news', 'details']])('native stack Back restores %s from %s', (origin, destination) => {
  const options = { routeNames: [origin, destination], routeParamList: {}, routeGetIdList: {} };
  const router = StackRouter({ initialRouteName: origin });
  let state = router.getInitialState(options);
  state = router.getStateForAction(state, CommonActions.navigate(destination), options);
  state = router.getStateForAction(state, CommonActions.goBack(), options);
  expect(state.routes[state.index].name).toBe(origin);
});
