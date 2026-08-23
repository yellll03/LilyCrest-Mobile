export const HOME_ROUTE = '/(tabs)/home';
export const LOGIN_ROUTE = '/login';

const AUTHENTICATION_PATHS = new Set([
  '/',
  '/login',
  '/forgot-password',
  '/otp-verify',
  '/auth-callback',
]);

export function isPasswordResetPath(pathname = '') {
  const normalizedPath = typeof pathname === 'string'
    ? pathname.split('?')[0].replace(/\/+$/, '') || '/'
    : '';
  return normalizedPath === '/reset-password';
}

export function isAuthenticationPath(pathname = '', segments = []) {
  // Expo can collapse the anchored initial tab route to pathname "/" after
  // Back from a cold deep link. Route segments retain the important identity:
  // `(tabs)/home` is Home, not onboarding.
  if (Array.isArray(segments) && segments.includes('(tabs)')) return false;

  const normalizedPath = typeof pathname === 'string'
    ? pathname.split('?')[0].replace(/\/+$/, '') || '/'
    : '';
  return AUTHENTICATION_PATHS.has(normalizedPath);
}

export function isAuthenticatedNavigationReady(authStatus, pathname, segments = []) {
  return authStatus === 'authenticated' && !isAuthenticationPath(pathname, segments);
}

function resetToRoute(router, destination) {
  if (!router || typeof router.replace !== 'function') return false;

  // POP_TO_TOP followed by REPLACE leaves one root route even when the current
  // flow was onboarding -> Login -> OTP. canDismiss is intentionally used
  // instead of canGoBack: tab history can go back too, but it is not auth
  // stack history and must not be treated as such.
  try {
    if (typeof router.canDismiss === 'function' && router.canDismiss()) {
      router.dismissAll();
    }
  } catch (_error) {
    // Replacing the current route is still the safest available fallback.
  }

  router.replace(destination);
  return true;
}

export function resetToHome(router) {
  return resetToRoute(router, HOME_ROUTE);
}

export function resetToLogin(router) {
  return resetToRoute(router, LOGIN_ROUTE);
}

export function notificationDestinationKey(destination) {
  if (!destination) return '';
  if (typeof destination === 'string') return destination;

  const pathname = destination.pathname || '';
  const params = destination.params && typeof destination.params === 'object'
    ? Object.entries(destination.params)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('&')
    : '';
  return params ? `${pathname}?${params}` : pathname;
}

export function navigateToNotificationDestination(router, destination) {
  if (!router || !destination) return false;

  // navigate is idempotent for an existing route, unlike push, so repeated OS
  // delivery of the same notification cannot build duplicate Back entries.
  if (typeof router.navigate === 'function') {
    router.navigate(destination);
    return true;
  }
  if (typeof router.push === 'function') {
    router.push(destination);
    return true;
  }
  return false;
}

export function safeBack(router, fallback = HOME_ROUTE) {
  if (!router) return;

  try {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
      return;
    }
  } catch (_error) {
    // Fall through to the fallback route.
  }

  if (fallback && typeof router.replace === 'function') {
    router.replace(fallback);
  }
}
