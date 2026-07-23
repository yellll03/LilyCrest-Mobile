'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TEMPLATE_ROOT = path.resolve(__dirname, '../../assets/contract-templates');
const LONG_BOND = Object.freeze({ widthPoints: 612, heightPoints: 936, widthInches: 8.5, heightInches: 13 });

const TEMPLATE_DEFINITIONS = Object.freeze({
  PRIVATE_ROOM_SHORT_TERM: Object.freeze({
    roomType: 'PRIVATE_ROOM', leaseType: 'SHORT_TERM',
    filename: 'Lease_Private_Room_ShortTerm.pdf',
    sha256: '503ca04f7e954b5112418cf58732fe4e57e0475404eb764cb053c10f5379533c',
    approvedBranchCode: 'GIL_PUYAT',
  }),
  PRIVATE_ROOM_LONG_TERM: Object.freeze({
    roomType: 'PRIVATE_ROOM', leaseType: 'LONG_TERM',
    filename: 'Lease_Private_Room_LongTerm.pdf',
    sha256: 'da2d514a498ace822e791438c8aae5cb123f9466d7090521bf116734356c34cf',
    approvedBranchCode: 'GIL_PUYAT',
  }),
  DOUBLE_SHARING_SHORT_TERM: Object.freeze({
    roomType: 'DOUBLE_SHARING', leaseType: 'SHORT_TERM',
    filename: 'Lease_Double_Sharing_ShortTerm.pdf',
    sha256: 'cb31224d8da20a77112bf8d852e43b87e6d11ebd9baf64c9236df9b3793e5f82',
    approvedBranchCode: 'GIL_PUYAT',
  }),
  DOUBLE_SHARING_LONG_TERM: Object.freeze({
    roomType: 'DOUBLE_SHARING', leaseType: 'LONG_TERM',
    filename: 'Lease_Double_Sharing_LongTerm.pdf',
    sha256: '2237ce7724a05fad558a0f584b77c6871f6d516591867cd080a903a0136f81bf',
    approvedBranchCode: 'GIL_PUYAT',
  }),
  QUADRUPLE_SHARING_SHORT_TERM: Object.freeze({
    roomType: 'QUADRUPLE_SHARING', leaseType: 'SHORT_TERM',
    filename: 'Lease_Quadruple_Sharing_ShortTerm.pdf',
    sha256: '9f80573491518335c0dc10b21274257c02fa4e4a538fcae71c2ea9716da62b91',
    approvedBranchCode: 'GIL_PUYAT',
  }),
  QUADRUPLE_SHARING_LONG_TERM: Object.freeze({
    roomType: 'QUADRUPLE_SHARING', leaseType: 'LONG_TERM',
    filename: 'Lease_Quadruple_Sharing_LongTerm.pdf',
    sha256: '37c678867452a7b1c6fff6a2146f11d5454d035db58e91d906ad273bbb0a6856',
    approvedBranchCode: 'GIL_PUYAT',
  }),
});

const APPROVED_TEMPLATE_KEYS = Object.freeze(Object.keys(TEMPLATE_DEFINITIONS));
const APPROVED_TEMPLATE_KEY_SET = new Set(APPROVED_TEMPLATE_KEYS);

function isApprovedTemplateKey(value) {
  return typeof value === 'string' && APPROVED_TEMPLATE_KEY_SET.has(value);
}

function selectTemplate(roomType, leaseType) {
  const room = String(roomType || '').trim().toUpperCase();
  const lease = String(leaseType || '').trim().toUpperCase();
  const key = `${room}_${lease}`;
  return TEMPLATE_DEFINITIONS[key] ? { key, ...TEMPLATE_DEFINITIONS[key] } : null;
}

function templatePath(definition) {
  if (!definition?.filename) return null;
  return path.join(TEMPLATE_ROOT, definition.filename);
}

function verifyTemplateIntegrity(definition) {
  const sourcePath = templatePath(definition);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, blockerCode: 'TEMPLATE_NOT_FOUND' };
  }
  const bytes = fs.readFileSync(sourcePath);
  const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== definition.sha256) {
    return { ok: false, blockerCode: 'TEMPLATE_INTEGRITY_MISMATCH', actualSha256 };
  }
  return { ok: true, sourcePath, bytes, actualSha256 };
}

function validateTemplateReadiness({ roomType, leaseType, branchCode }) {
  const template = selectTemplate(roomType, leaseType);
  if (!template) return { ok: false, blockerCode: 'TEMPLATE_NOT_FOUND' };
  if (String(branchCode || '').trim().toUpperCase() !== template.approvedBranchCode) {
    return { ok: false, blockerCode: 'TEMPLATE_BRANCH_MISMATCH', template };
  }
  const integrity = verifyTemplateIntegrity(template);
  return integrity.ok ? { ok: true, template, integrity, pageSize: LONG_BOND } : { ...integrity, template };
}

module.exports = {
  APPROVED_TEMPLATE_KEYS,
  TEMPLATE_DEFINITIONS,
  LONG_BOND,
  isApprovedTemplateKey,
  selectTemplate,
  templatePath,
  verifyTemplateIntegrity,
  validateTemplateReadiness,
};
