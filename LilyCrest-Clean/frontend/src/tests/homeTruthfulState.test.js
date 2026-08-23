/* global __dirname, test */
import fs from 'fs';
import path from 'path';
import {
  formatHomeCurrency,
  formatRoomCapacity,
  formatRoomFloor,
  formatRoomNumber,
  formatRoomType,
} from '../utils/homePresentation';

const projectRoot = path.resolve(__dirname, '../..');
const homeSource = fs.readFileSync(path.join(projectRoot, 'app/(tabs)/home.jsx'), 'utf8');
const headerSource = fs.readFileSync(path.join(projectRoot, 'src/components/AppHeader.js'), 'utf8');

describe('Home truthful missing-value presentation', () => {
  test('missing room fields are explicit instead of plausible defaults', () => {
    expect(formatRoomNumber(null)).toBe('Room number unavailable');
    expect(formatRoomType('')).toBe('Room type unavailable');
    expect(formatRoomCapacity(undefined)).toBe('Capacity unavailable');
    expect(formatRoomFloor('   ')).toBe('Floor information unavailable');
    expect(formatHomeCurrency(null)).toBe('Amount unavailable');
    expect(formatHomeCurrency('not-a-number')).toBe('Amount unavailable');
  });

  test('canonical zero and populated values remain representable', () => {
    expect(formatRoomNumber('204')).toBe('Room 204');
    expect(formatRoomType('Deluxe')).toBe('Deluxe');
    expect(formatRoomCapacity(4)).toBe('4 pax');
    expect(formatRoomCapacity(0)).toBe('0 pax');
    expect(formatRoomFloor(2)).toBe('Floor 2');
    expect(formatHomeCurrency(0)).toBe('₱0');
  });

  test('Home no longer invents standard type, first floor, zero capacity, or a stock room photo', () => {
    expect(homeSource).not.toMatch(/room_type\s*\|\|\s*['"]Standard['"]/);
    expect(homeSource).not.toMatch(/capacity\s*\|\|\s*0/);
    expect(homeSource).not.toMatch(/floor\s*\|\|\s*1/);
    expect(homeSource).not.toContain("require('../../assets/images/Pic-quad.jpg')");
    expect(homeSource).toContain('No room photo');
  });
});

describe('Home load-state separation and tenant ownership', () => {
  test('first-load failure is blocking while refresh failure keeps saved data quietly visible', () => {
    expect(homeSource).toContain('loadError && !hasCurrentDashboard');
    expect(homeSource).toContain('loadError && hasCurrentDashboard');
    expect(homeSource).toContain('Home could not be loaded');
    expect(homeSource).toContain('Showing saved information. Pull to refresh.');
  });

  test('dashboard responses and rendering are scoped to the current authenticated user', () => {
    expect(homeSource).toContain('activeUserIdRef.current !== requestUserId');
    expect(homeSource).toContain('setDashboardOwnerId(requestUserId)');
    expect(homeSource).toContain('dashboardOwnerId === userId');
    expect(homeSource).toContain('Never keep one tenant\'s saved dashboard visible');
  });
});

describe('App header safe-area spacing', () => {
  test('the header derives compact padding from actual device insets', () => {
    expect(headerSource).toContain("import { useSafeAreaInsets } from 'react-native-safe-area-context'");
    expect(headerSource).toContain('paddingTop: insets.top + 8');
    expect(headerSource).toContain('paddingBottom: 10');
    expect(headerSource).not.toContain("Platform.OS === 'ios' ? 56");
  });
});
