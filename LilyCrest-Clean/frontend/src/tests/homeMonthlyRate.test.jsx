/* global test */
import { render } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';
import HomeMonthlyRate from '../components/HomeMonthlyRate';
import { DARK_COLORS, LIGHT_COLORS } from '../theme/tokens';

const originalPlatform = Platform.OS;
afterAll(() => { Platform.OS = originalPlatform; });

describe.each(['android', 'ios'])('%s Home monthly rate', (platform) => {
  beforeEach(() => { Platform.OS = platform; });
  describe.each([['light', LIGHT_COLORS], ['dark', DARK_COLORS]])('%s theme', (_theme, colors) => {
    test.each([null, undefined, '', '   ', 'invalid', NaN, Infinity])('missing/invalid amount %s uses secondary fallback', (amount) => {
      const ui = render(<HomeMonthlyRate amount={amount} colors={colors} />);
      expect(ui.getByText('Monthly Rate')).toBeTruthy();
      const fallback = ui.getByText('Not available');
      expect(StyleSheet.flatten(fallback.props.style)).toMatchObject({ fontSize: 13, lineHeight: 18, fontWeight: '400', color: colors.textSecondary, maxWidth: '100%', flexShrink: 1 });
      expect(ui.queryByText('Amount unavailable')).toBeNull();
    });
    test.each([[6300, '₱6,300'], ['6300', '₱6,300'], [0, '₱0']])('available amount %s retains currency typography', (amount, expected) => {
      const ui = render(<HomeMonthlyRate amount={amount} colors={colors} />);
      expect(ui.getByText('Monthly Rate')).toBeTruthy();
      expect(StyleSheet.flatten(ui.getByText(expected).props.style)).toMatchObject({ fontSize: 18, fontWeight: '700', color: colors.interactive });
      expect(ui.queryByText('Not available')).toBeNull();
    });
  });
});
