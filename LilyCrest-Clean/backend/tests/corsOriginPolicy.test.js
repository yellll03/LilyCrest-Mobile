'use strict';

// Regression coverage for the CORS misconfiguration behind "web chatbot
// blocked, mobile fine": production CORS_ORIGINS/FRONTEND_URL were blank,
// so the effective allow-list contained no browser-usable origin at all,
// and nothing warned about it. These tests exercise the extracted pure
// logic in config/corsOriginPolicy.js directly (no server bootstrap).

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAllowedOrigins, makeIsAllowedOrigin, hasBrowserOrigin } = require('../config/corsOriginPolicy');

test('buildAllowedOrigins is empty when CORS_ORIGINS/FRONTEND_URL/WEB_BASE_URL are all blank — the production incident', () => {
  const origins = buildAllowedOrigins({
    CORS_ORIGINS: '',
    FRONTEND_URL: '',
    WEB_BASE_URL: '',
    MOBILE_APP_URL: '',
    BACKEND_URL: 'https://api.lilycrest.space',
  });
  assert.deepEqual(origins, ['https://api.lilycrest.space']);
  assert.equal(hasBrowserOrigin(origins), true); // BACKEND_URL is itself https(s), just not the web app's own origin
});

test('a real browser request from the production web origin is rejected when it is not allow-listed', () => {
  const origins = buildAllowedOrigins({ BACKEND_URL: 'https://api.lilycrest.space' });
  const isAllowed = makeIsAllowedOrigin(origins, { allowLocalCors: false, allowMobileDevCors: true });
  assert.equal(isAllowed('https://www.lilycrest.space'), false);
});

test('setting CORS_ORIGINS/FRONTEND_URL/WEB_BASE_URL to the production web origin fixes it', () => {
  const origins = buildAllowedOrigins({
    CORS_ORIGINS: 'https://www.lilycrest.space',
    FRONTEND_URL: 'https://www.lilycrest.space',
    WEB_BASE_URL: 'https://www.lilycrest.space',
    MOBILE_APP_URL: 'frontend://',
    BACKEND_URL: 'https://api.lilycrest.space',
  });
  const isAllowed = makeIsAllowedOrigin(origins, { allowLocalCors: false, allowMobileDevCors: true });
  assert.equal(isAllowed('https://www.lilycrest.space'), true);
});

test('CORS_ORIGINS supports multiple comma-separated origins with surrounding whitespace trimmed', () => {
  const origins = buildAllowedOrigins({ CORS_ORIGINS: ' https://www.lilycrest.space , https://admin.lilycrest.space ' });
  assert.deepEqual(origins, ['https://www.lilycrest.space', 'https://admin.lilycrest.space']);
});

test('origin matching is exact — scheme, host, and port must all match, no partial/prefix match', () => {
  const origins = buildAllowedOrigins({ CORS_ORIGINS: 'https://www.lilycrest.space' });
  const isAllowed = makeIsAllowedOrigin(origins, { allowLocalCors: false, allowMobileDevCors: true });
  assert.equal(isAllowed('http://www.lilycrest.space'), false); // wrong scheme
  assert.equal(isAllowed('https://www.lilycrest.space.evil.com'), false); // suffix trick
  assert.equal(isAllowed('https://evil-www.lilycrest.space'), false); // prefix trick
  assert.equal(isAllowed('https://www.lilycrest.space:8443'), false); // wrong port
});

test('a foreign, unauthorized origin is never broadly allowed', () => {
  const origins = buildAllowedOrigins({ CORS_ORIGINS: 'https://www.lilycrest.space' });
  const isAllowed = makeIsAllowedOrigin(origins, { allowLocalCors: false, allowMobileDevCors: true });
  assert.equal(isAllowed('https://attacker.example'), false);
});

test('native app / server-to-server requests with no Origin header are always allowed (not subject to browser CORS)', () => {
  const origins = buildAllowedOrigins({});
  const isAllowed = makeIsAllowedOrigin(origins, { allowLocalCors: false, allowMobileDevCors: true });
  assert.equal(isAllowed(undefined), true);
});

test('Expo dev scheme and custom mobile schemes are always allowed regardless of allow-list', () => {
  const origins = buildAllowedOrigins({});
  const isAllowed = makeIsAllowedOrigin(origins, { allowLocalCors: false, allowMobileDevCors: false });
  assert.equal(isAllowed('exp://192.168.1.5:19000'), true);
  assert.equal(isAllowed('frontend://'), true);
  assert.equal(isAllowed('lilycrest://'), true);
});

test('localhost/private-network origins are rejected in production unless a dev-cors flag opts in', () => {
  const origins = buildAllowedOrigins({});
  const prodStrict = makeIsAllowedOrigin(origins, { allowLocalCors: false, allowMobileDevCors: false });
  assert.equal(prodStrict('http://localhost:3000'), false);
  assert.equal(prodStrict('http://192.168.1.10:19006'), false);

  const devFriendly = makeIsAllowedOrigin(origins, { allowLocalCors: false, allowMobileDevCors: true });
  assert.equal(devFriendly('http://localhost:3000'), true);
  assert.equal(devFriendly('http://192.168.1.10:19006'), true);
});

test('hasBrowserOrigin is false when the allow-list only contains mobile-scheme/blank values', () => {
  assert.equal(hasBrowserOrigin([]), false);
  assert.equal(hasBrowserOrigin(['frontend://']), false);
  assert.equal(hasBrowserOrigin(['https://api.lilycrest.space']), true);
});

// MOBILE_APP_URL ('frontend://') is not an http(s) origin at all, so it can
// never satisfy hasBrowserOrigin — confirms the P0 task's caution that a
// CORS variable existing does not by itself mean web traffic is unblocked.
test('MOBILE_APP_URL alone does not count as a configured browser origin', () => {
  const origins = buildAllowedOrigins({ MOBILE_APP_URL: 'frontend://', BACKEND_URL: '' });
  assert.equal(hasBrowserOrigin(origins), false);
});
