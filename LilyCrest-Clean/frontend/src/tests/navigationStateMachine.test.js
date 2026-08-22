/* global test */
import {
  HOME_ROUTE,
  isAuthenticatedNavigationReady,
  isAuthenticationPath,
  navigateToNotificationDestination,
  notificationDestinationKey,
  resetToHome,
  resetToLogin,
  safeBack,
} from '../utils/navigation';

describe('canonical navigation state helpers', () => {
  test.each([
    '/',
    '/login',
    '/otp-verify',
    '/forgot-password',
    '/reset-password',
    '/auth-callback',
    '/login/',
  ])('recognizes authentication entry path %s', (pathname) => {
    expect(isAuthenticationPath(pathname)).toBe(true);
    expect(isAuthenticatedNavigationReady('authenticated', pathname)).toBe(false);
  });

  test.each([
    '/(tabs)/home',
    '/home',
    '/contract-viewer',
    '/bill-details',
  ])('allows notifications only after the authenticated root path exists: %s', (pathname) => {
    expect(isAuthenticationPath(pathname)).toBe(false);
    expect(isAuthenticatedNavigationReady('authenticated', pathname)).toBe(true);
    expect(isAuthenticatedNavigationReady('unauthenticated', pathname)).toBe(false);
  });

  test('distinguishes Expo Router anchored Home from onboarding when both have pathname /', () => {
    expect(isAuthenticationPath('/', [])).toBe(true);
    expect(isAuthenticationPath('/', ['(tabs)'])).toBe(false);
    expect(isAuthenticationPath('/', ['(tabs)', 'home'])).toBe(false);
    expect(isAuthenticatedNavigationReady('authenticated', '/', ['(tabs)', 'home'])).toBe(true);
  });

  test('successful authentication removes dismissible auth history before replacing with Home', () => {
    const router = {
      canDismiss: jest.fn(() => true),
      dismissAll: jest.fn(),
      replace: jest.fn(),
    };

    expect(resetToHome(router)).toBe(true);
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(HOME_ROUTE);
    expect(router.dismissAll.mock.invocationCallOrder[0])
      .toBeLessThan(router.replace.mock.invocationCallOrder[0]);
  });

  test('a lone protected route is replaced with Login without relying on Back history', () => {
    const router = {
      canDismiss: jest.fn(() => false),
      dismissAll: jest.fn(),
      replace: jest.fn(),
    };

    expect(resetToLogin(router)).toBe(true);
    expect(router.dismissAll).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/login');
  });

  test('notification navigation reuses a destination instead of pushing duplicate routes', () => {
    const router = { navigate: jest.fn(), push: jest.fn() };
    const destination = { pathname: '/bill-details', params: { billId: 'bill-1' } };

    expect(navigateToNotificationDestination(router, destination)).toBe(true);
    expect(router.navigate).toHaveBeenCalledWith(destination);
    expect(router.push).not.toHaveBeenCalled();
  });

  test('notification destination keys are stable across parameter order', () => {
    expect(notificationDestinationKey({
      pathname: '/contract-viewer',
      params: { tenant: 'tenant-1', contractId: 'contract-1' },
    })).toBe(notificationDestinationKey({
      pathname: '/contract-viewer',
      params: { contractId: 'contract-1', tenant: 'tenant-1' },
    }));
  });

  test('nested Back uses route history, with an explicit Home fallback for a cold root', () => {
    const nestedRouter = { canGoBack: jest.fn(() => true), back: jest.fn(), replace: jest.fn() };
    safeBack(nestedRouter);
    expect(nestedRouter.back).toHaveBeenCalledTimes(1);
    expect(nestedRouter.replace).not.toHaveBeenCalled();

    const coldRouter = { canGoBack: jest.fn(() => false), back: jest.fn(), replace: jest.fn() };
    safeBack(coldRouter);
    expect(coldRouter.back).not.toHaveBeenCalled();
    expect(coldRouter.replace).toHaveBeenCalledWith(HOME_ROUTE);
  });
});
