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

function renderOfficialLease(definition, metadata = {}) {
  return new Promise((resolve, reject) => {
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

    blocksFromDefinition(definition).forEach((block) => renderBlock(doc, block));

    doc.end();
  });
}

module.exports = { FONTS, MARGINS, blocksFromDefinition, renderOfficialLease };
