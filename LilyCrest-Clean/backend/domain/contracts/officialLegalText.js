'use strict';

const fs = require('fs');
const { PDFParse } = require('pdf-parse');
const { selectTemplate, verifyTemplateIntegrity } = require('./templateRegistry');

const SECTION_MARKERS = Object.freeze([
  'SECTION 1 – PURPOSE.',
  'SECTION 2 – DURATION.',
  'SECTION 3 – RENTAL RATE.',
  'SECTION 4 – DEPOSITS AND ADVANCES.',
  'SECTION 5 – FORCE MAJEURE.',
  'SECTION 6 – LESSOR’S RIGHT OF ENTRY.',
  'SECTION 7 – EXPIRATION OF LEASE.',
]);

function normalizeTechnicalExtraction(value) {
  return String(value || '')
    .replace(/\f/g, '\n')
    .replace(/-- \d+ of \d+ --/g, '')
    .replace(/(\p{L})-\s+(\p{L})/gu, '$1-$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function singleLineLegalText(value) {
  return normalizeTechnicalExtraction(value).replace(/\s+/g, ' ').trim();
}

function sectionSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`Official source is missing ${startMarker}`);
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : text.length;
  if (end < 0) throw new Error(`Official source is missing ${endMarker}`);
  return text.slice(start, end).trim();
}

function structureOfficialText(templateKey, extractedText) {
  const text = singleLineLegalText(extractedText);
  const firstSection = text.indexOf(SECTION_MARKERS[0]);
  const witness = text.indexOf('IN WITNESS WHEREOF');
  const acknowledgment = text.indexOf('ACKNOWLEDGMENT', witness);
  if (firstSection < 0 || witness < 0 || acknowledgment < 0) {
    throw new Error('Official source structure could not be verified.');
  }

  return Object.freeze({
    templateKey,
    title: 'CONTRACT OF LEASE',
    sourceText: text,
    introductoryClauses: text.slice(0, firstSection).trim(),
    numberedSections: Object.freeze(SECTION_MARKERS.map((marker, index) => Object.freeze({
      marker,
      text: sectionSlice(text, marker, SECTION_MARKERS[index + 1] || 'IN WITNESS WHEREOF'),
    }))),
    signatureAndWitnessSection: text.slice(witness, acknowledgment).trim(),
    notarialSection: text.slice(acknowledgment).trim(),
  });
}

async function extractOfficialLegalText(roomType, leaseType) {
  const template = selectTemplate(roomType, leaseType);
  if (!template) return { ok: false, blockerCode: 'TEMPLATE_NOT_FOUND' };
  const integrity = verifyTemplateIntegrity(template);
  if (!integrity.ok) return integrity;

  const parser = new PDFParse({ data: fs.readFileSync(integrity.sourcePath) });
  try {
    const result = await parser.getText();
    const definition = structureOfficialText(template.key, result.text);
    return { ok: true, template, integrity, definition };
  } finally {
    await parser.destroy();
  }
}

module.exports = {
  SECTION_MARKERS,
  extractOfficialLegalText,
  normalizeTechnicalExtraction,
  singleLineLegalText,
  structureOfficialText,
};
