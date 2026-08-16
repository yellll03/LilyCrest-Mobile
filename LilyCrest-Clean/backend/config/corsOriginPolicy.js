'use strict';

// Pure CORS allow-list logic, extracted from server.js so it can be unit
// tested without booting the full server (Mongo connect, Firebase init,
// app.listen). server.js imports these same functions — this is not a
// parallel implementation, just the existing inline logic given a name.

const PRIVATE_NETWORK_ORIGIN_PATTERN = /^https?:\/\/(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)\d+\.\d+(?::\d+)?$/;
const LOCAL_HOSTNAME_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
const EXPO_ORIGIN_PATTERN = /^exps?:\/\/(localhost|127\.0\.0\.1|\[::1\]|(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)\d+\.\d+)(?::\d+)?$/;
const MOBILE_SCHEME_ORIGIN_PATTERN = /^(frontend|lilycrest):\/\/(?:localhost)?$/;
const BROWSER_ORIGIN_PATTERN = /^https?:\/\//i;

function buildAllowedOrigins(env = process.env) {
  const allowedOrigins = [
    ...(env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',').map((origin) => origin.trim()) : []),
    env.FRONTEND_URL,
    env.WEB_BASE_URL,
    env.MOBILE_APP_URL,
    env.BACKEND_URL,
  ].filter(Boolean);
  return [...new Set(allowedOrigins)];
}

function makeIsAllowedOrigin(uniqueAllowedOrigins, { allowLocalCors, allowMobileDevCors }) {
  return function isAllowedOrigin(origin) {
    if (!origin) return true;
    if (uniqueAllowedOrigins.includes(origin)) return true;
    if (EXPO_ORIGIN_PATTERN.test(origin) || MOBILE_SCHEME_ORIGIN_PATTERN.test(origin)) return true;
    if (allowMobileDevCors && (PRIVATE_NETWORK_ORIGIN_PATTERN.test(origin) || LOCAL_HOSTNAME_ORIGIN_PATTERN.test(origin))) return true;
    if (allowLocalCors && (PRIVATE_NETWORK_ORIGIN_PATTERN.test(origin) || LOCAL_HOSTNAME_ORIGIN_PATTERN.test(origin))) return true;
    return false;
  };
}

// True when at least one allow-listed origin is an actual http(s) browser
// origin — i.e. excludes mobile-only entries like MOBILE_APP_URL's
// "frontend://" scheme value. Used to warn when production has no way for
// any browser-hosted client to pass CORS at all.
function hasBrowserOrigin(uniqueAllowedOrigins) {
  return uniqueAllowedOrigins.some((origin) => BROWSER_ORIGIN_PATTERN.test(origin));
}

module.exports = {
  buildAllowedOrigins,
  makeIsAllowedOrigin,
  hasBrowserOrigin,
  PRIVATE_NETWORK_ORIGIN_PATTERN,
  LOCAL_HOSTNAME_ORIGIN_PATTERN,
  EXPO_ORIGIN_PATTERN,
  MOBILE_SCHEME_ORIGIN_PATTERN,
};
