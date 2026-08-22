'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'index.html'), 'utf8');
const inlineScript = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .join('\n');

test('announcement admin script parses and uses only the privileged management feed for listing', () => {
  assert.doesNotThrow(() => new vm.Script(inlineScript));
  assert.match(inlineScript, /apiFetch\(`\/announcements\/admin\?\$\{query\.toString\(\)\}`\)/);
  assert.match(inlineScript, /Array\.isArray\(data\.items\)/);
  assert.match(inlineScript, /data\.pagination/);
  assert.doesNotMatch(inlineScript, /apiFetch\('\/announcements'\)\s*;/);
});

test('announcement composer exposes canonical audience, scheduling, expiry, and idempotency inputs', () => {
  for (const id of [
    'ann-audience-type',
    'ann-branch',
    'ann-tenant',
    'ann-tenant-search',
    'ann-publish-at',
    'ann-expires-at',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(inlineScript, /apiFetch\(`\/announcements\/admin\/options\$\{query\}`\)/);
  assert.match(inlineScript, /is_private: audienceType === 'private'/);
  assert.match(inlineScript, /client_request_id: announcementClientRequestId/);
  assert.match(inlineScript, /publish_at: publishAt\.toISOString\(\)/);
  assert.match(inlineScript, /expires_at: expiresAt\.toISOString\(\)/);
  assert.match(inlineScript, /Expiry must be after the publish time/);
  assert.match(inlineScript, /Select a branch for a branch announcement/);
  assert.match(inlineScript, /Select a tenant for a private announcement/);
});

test('announcement table presents lifecycle and delivery truth with non-destructive controls', () => {
  assert.match(html, /<th>Audience<\/th><th>Lifecycle<\/th><th>Delivery<\/th><th>Publish<\/th><th>Actions<\/th>/);
  assert.match(html, /id="ann-filter-status"/);
  assert.match(html, /id="ann-prev-btn"/);
  assert.match(html, /id="ann-next-btn"/);
  assert.match(inlineScript, /a\.lifecycle_status/);
  assert.match(inlineScript, /a\.delivery\?\.status/);
  assert.match(inlineScript, /data-lifecycle-action="archive"/);
  assert.match(inlineScript, /data-lifecycle-action="activate"/);
  assert.match(inlineScript, /data-lifecycle-action="retry_delivery"/);
  assert.match(inlineScript, /method: 'PATCH'/);
  assert.match(inlineScript, /encodeURIComponent\(announcementId\)/);
  assert.doesNotMatch(inlineScript, /method: 'DELETE'/);
});

test('announcement controls remain CSP-safe and every HTML id is unique', () => {
  assert.doesNotMatch(html, /\son(?:click|change|input)=/i);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});
