'use strict';

// POST /upload/firebase-storage takes the file's mimeType from the client and
// safeFileName() preserves whatever extension the file already carried. Without
// a byte-level check, `payload.exe` declared as `application/pdf` would be
// stored with a trusted content type and then rendered inline by two clients.
//
// These cover the signature check that closes that, against the decoded buffer
// only — never against a client-supplied field.

const test = require('node:test');
const assert = require('node:assert/strict');

const { matchesDeclaredContent } = require('../routes/upload.routes').__test;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const GIF = Buffer.from('GIF89a-rest', 'ascii');
const BMP = Buffer.from('BM-rest', 'ascii');
const PDF = Buffer.from('%PDF-1.7\n%rest', 'ascii');
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
]);
// PE/DOS executable, ELF binary, and a shell script.
const EXE = Buffer.from('MZ\x90\x00\x03', 'binary');
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02]);
const SHELL = Buffer.from('#!/bin/sh\nrm -rf /', 'ascii');

test('genuine files match the type they declare', () => {
  assert.equal(matchesDeclaredContent(JPEG, 'image/jpeg'), true);
  assert.equal(matchesDeclaredContent(JPEG, 'image/jpg'), true);
  assert.equal(matchesDeclaredContent(PNG, 'image/png'), true);
  assert.equal(matchesDeclaredContent(GIF, 'image/gif'), true);
  assert.equal(matchesDeclaredContent(BMP, 'image/bmp'), true);
  assert.equal(matchesDeclaredContent(PDF, 'application/pdf'), true);
  assert.equal(matchesDeclaredContent(WEBP, 'image/webp'), true);
});

test('an executable or script renamed to a permitted extension is refused', () => {
  for (const declared of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) {
    for (const payload of [EXE, ELF, SHELL]) {
      assert.equal(
        matchesDeclaredContent(payload, declared),
        false,
        `${declared} must not accept a disguised binary or script`,
      );
    }
  }
});

test('one image type cannot masquerade as another', () => {
  assert.equal(matchesDeclaredContent(PNG, 'image/jpeg'), false);
  assert.equal(matchesDeclaredContent(JPEG, 'image/png'), false);
  assert.equal(matchesDeclaredContent(PDF, 'image/webp'), false);
  assert.equal(matchesDeclaredContent(JPEG, 'application/pdf'), false);
});

test('a RIFF container that is not WebP is refused', () => {
  const wav = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from('WAVE', 'ascii'),
  ]);
  assert.equal(matchesDeclaredContent(wav, 'image/webp'), false);
});

test('a truncated buffer never satisfies a signature', () => {
  assert.equal(matchesDeclaredContent(Buffer.from([0xff]), 'image/jpeg'), false);
  assert.equal(matchesDeclaredContent(Buffer.alloc(0), 'application/pdf'), false);
  assert.equal(matchesDeclaredContent(Buffer.from('RIFF', 'ascii'), 'image/webp'), false);
});

test('types with no reliable magic number are not guessed at', () => {
  // HEIC/HEIF and the office/text types stay allow-listed but unasserted —
  // asserting a wrong signature would reject legitimate uploads. The narrower
  // support-chat allow-list is what keeps this from mattering there.
  for (const mimeType of ['image/heic', 'image/heif', 'text/plain', 'text/csv']) {
    assert.equal(matchesDeclaredContent(Buffer.from('anything'), mimeType), true);
  }
});
