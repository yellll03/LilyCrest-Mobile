'use strict';

const path = require('path');
const PDFDocument = require('pdfkit');
const { LONG_BOND } = require('./templateRegistry');

const FONT_ROOT = path.dirname(require.resolve('@fontsource/noto-serif/400.css'));
const FONTS = Object.freeze({
  regular: path.join(FONT_ROOT, 'files', 'noto-serif-latin-400-normal.woff'),
  bold: path.join(FONT_ROOT, 'files', 'noto-serif-latin-700-normal.woff'),
  italic: path.join(FONT_ROOT, 'files', 'noto-serif-latin-400-italic.woff'),
});
const MARGINS = Object.freeze({ top: 42, right: 45, bottom: 42, left: 45 });

function renderBlock(doc, text) {
  const heading = /^(?:CONTRACT OF LEASE|.+ (?:SHORT|LONG) TERM LEASE|KNOWN TO ALL MEN BY THESE PRESENTS:|WITNESSETH: That|TERMS AND CONDITIONS|SECTION \d|IN WITNESS WHEREOF|SIGNED IN THE PRESENCE OF:|ACKNOWLEDGMENT|REPUBLIC OF THE PHILIPPINES)/.test(text);
  const centered = /^(?:CONTRACT OF LEASE|.+ (?:SHORT|LONG) TERM LEASE|TERMS AND CONDITIONS|SIGNED IN THE PRESENCE OF:|ACKNOWLEDGMENT)$/.test(text);
  doc.font(heading ? FONTS.bold : FONTS.regular)
    .fontSize(heading ? 8.2 : 7.4)
    .text(text, {
      align: centered ? 'center' : 'justify',
      lineGap: 1.2,
      paragraphGap: heading ? 3.5 : 2.5,
      continued: false,
    });
}

function blocksFromDefinition(definition) {
  return [
    definition.introductoryClauses,
    ...definition.numberedSections.map((section) => section.text),
    definition.signatureAndWitnessSection,
    definition.notarialSection,
  ];
}

function readableDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('A valid contract date is required.');
  return date.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
}

function personalizeDefinition(definition, snapshot) {
  if (!snapshot) return definition;
  const legalName = String(snapshot.tenantLegalName || '').trim();
  const address = String(snapshot.tenantResidentialAddress || '').trim();
  const room = String(snapshot.roomNumber || '').trim();
  const bed = String(snapshot.bedSlotNumber || '').trim();
  const months = Number(snapshot.leaseDurationMonths);
  if (!legalName || !address || !room || !bed || !Number.isInteger(months) || months < 1) {
    throw new Error('Complete verified lease particulars are required.');
  }
  const generated = new Date(snapshot.generatedAt || Date.now());
  const start = readableDate(snapshot.contractStartDate);
  const end = readableDate(snapshot.contractEndDate);
  const advanceEnd = new Date(snapshot.contractStartDate);
  advanceEnd.setMonth(advanceEnd.getMonth() + 1);

  const introductoryClauses = definition.introductoryClauses
    .replace('this ______ day of ____________________', `this ${generated.getDate()} day of ${generated.toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' })}`)
    .replace(/_{20,}, of legal age/, `${legalName}, of legal age`)
    .replace(/postal and residential address at _{20,}/, `postal and residential address at ${address}`)
    .replace(/Room _+,\s*Bed\/Slot No\. _+/, `Room ${room}, Bed/Slot No. ${bed}`);

  const numberedSections = definition.numberedSections.map((section) => {
    let text = section.text;
    if (section.marker.startsWith('SECTION 2')) {
      text = text.replace(/period of _+ \( _+ \) months, from _+ to _+\./, `period of ${months} (${months}) months, from ${start} to ${end}.`);
    }
    if (section.marker.startsWith('SECTION 4')) {
      text = text.replace(/covering the period of _+ to _+,/, `covering the period of ${start} to ${readableDate(advanceEnd)},`);
    }
    return { ...section, text };
  });

  return {
    ...definition,
    introductoryClauses,
    numberedSections,
    signatureAndWitnessSection: `${definition.signatureAndWitnessSection} ${legalName} – LESSEE`,
  };
}

function renderOfficialLease(definition, metadata = {}, snapshot = null) {
  return new Promise((resolve, reject) => {
    const renderedDefinition = personalizeDefinition(definition, snapshot);
    const doc = new PDFDocument({
      size: [LONG_BOND.widthPoints, LONG_BOND.heightPoints],
      margins: MARGINS,
      bufferPages: true,
      autoFirstPage: true,
      info: {
        Title: `${definition.templateKey} Contract of Lease`,
        Subject: 'DRAFT — ADMINISTRATIVE REVIEW REQUIRED',
        Creator: `LilyCrest Contract Generator ${metadata.generatorVersion || 'option-a-v1'}`,
      },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    blocksFromDefinition(renderedDefinition).forEach((block) => renderBlock(doc, block));

    doc.end();
  });
}

module.exports = { FONTS, MARGINS, blocksFromDefinition, personalizeDefinition, renderOfficialLease };
