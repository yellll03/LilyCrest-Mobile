export function safeBack(router, fallback = '/(tabs)/home') {
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
