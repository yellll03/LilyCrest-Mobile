'use strict';

const fs = require('fs');
const path = require('path');
const fontkit = require('@pdf-lib/fontkit');
const { PDFDocument, rgb } = require('pdf-lib');
const { LONG_BOND, verifyTemplateIntegrity } = require('./templateRegistry');
const { fieldMapFor } = require('./templateFieldMaps');

const NOTO_SERIF_PATH = path.resolve(
  __dirname,
  '../../node_modules/@fontsource/noto-serif/files/noto-serif-latin-400-normal.woff',
);
const DIMENSION_TOLERANCE_POINTS = 0.1;
const FIELD_TOLERANCE_POINTS = 0.1;

const NUMBER_WORDS = Object.freeze([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two',
  'twenty-three', 'twenty-four',
]);

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('A valid contract date is required.');
  return date.toLocaleDateString('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function overlayValues(snapshot) {
  const generated = new Date(snapshot.generatedAt || Date.now());
  const duration = Number(snapshot.leaseDurationMonths);
  const advanceEnd = new Date(snapshot.contractStartDate);
  advanceEnd.setMonth(advanceEnd.getMonth() + 1);
  if (!Number.isInteger(duration) || duration < 1 || !NUMBER_WORDS[duration]) {
    throw new Error('Lease duration cannot be fitted to the approved template.');
  }
  return {
    executionDay: String(generated.getDate()),
    executionMonthYear: generated.toLocaleDateString('en-PH', {
      month: 'long', year: 'numeric', timeZone: 'Asia/Manila',
    }),
    tenantLegalName: String(snapshot.tenantLegalName || '').trim(),
    tenantAddress: String(snapshot.tenantResidentialAddress || '').trim(),
    roomNumber: String(snapshot.roomNumber || '').trim(),
    bedSlot: String(snapshot.bedSlotNumber || '').trim(),
    leaseDurationWords: NUMBER_WORDS[duration],
    leaseDurationNumber: String(duration),
    moveInDate: formatDate(snapshot.contractStartDate),
    moveOutDate: formatDate(snapshot.contractEndDate),
    advanceCoverageStart: formatDate(snapshot.contractStartDate),
    advanceCoverageEnd: formatDate(advanceEnd),
  };
}

function fittedText(font, value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error('An approved overlay value is missing.');
  let size = field.maxFontSize;
  while (size > field.minFontSize && font.widthOfTextAtSize(text, size) > field.width) size -= 0.1;
  const width = font.widthOfTextAtSize(text, size);
  if (width > field.width + FIELD_TOLERANCE_POINTS) {
    throw new Error(`Overlay value does not fit its approved field: ${text.slice(0, 24)}`);
  }
  const x = field.align === 'center'
    ? field.x + ((field.width - width) / 2)
    : field.align === 'right' ? field.x + field.width - width : field.x;
  return { text, size, width, x, y: field.y };
}

function validatePage(page) {
  const { width, height } = page.getSize();
  if (
    Math.abs(width - LONG_BOND.widthPoints) > DIMENSION_TOLERANCE_POINTS
    || Math.abs(height - LONG_BOND.heightPoints) > DIMENSION_TOLERANCE_POINTS
  ) {
    throw new Error(`Official template is not exact long bond size: ${width} x ${height}`);
  }
  return { width, height };
}

async function overlayOfficialTemplate(template, snapshot) {
  const integrity = verifyTemplateIntegrity(template);
  if (!integrity.ok) throw new Error(integrity.blockerCode);
  const fieldMap = fieldMapFor(template.key);
  if (!fieldMap) throw new Error('TEMPLATE_COORDINATE_MAP_NOT_FOUND');
  const values = overlayValues(snapshot);
  const pdf = await PDFDocument.load(integrity.bytes, { updateMetadata: false });
  pdf.registerFontkit(fontkit);
  if (pdf.getPageCount() !== 1) throw new Error('Official template page count changed.');
  const page = pdf.getPage(0);
  const pageSize = validatePage(page);
  const font = await pdf.embedFont(fs.readFileSync(NOTO_SERIF_PATH), { subset: true });
  const placements = [];

  for (const [fieldName, field] of Object.entries(fieldMap)) {
    if (field.page !== 1) throw new Error(`Unsupported overlay page for ${fieldName}.`);
    const fitted = fittedText(font, values[fieldName], field);
    page.drawText(fitted.text, {
      x: fitted.x,
      y: fitted.y,
      size: fitted.size,
      font,
      color: rgb(0, 0, 0),
      lineHeight: field.height,
    });
    placements.push({
      field: fieldName,
      page: field.page,
      x: Number(fitted.x.toFixed(2)),
      y: field.y,
      width: Number(fitted.width.toFixed(2)),
      boxWidth: field.width,
      fontSize: Number(fitted.size.toFixed(2)),
      alignment: field.align,
      fits: fitted.width <= field.width + FIELD_TOLERANCE_POINTS,
    });
  }

  pdf.setProducer('LILIORA Official Template Overlay');
  pdf.setCreator('LilyCrest Residences');
  pdf.setTitle('LilyCrest Lease Contract');
  pdf.setSubject(`Official template ${template.key}; immutable snapshot overlay`);
  const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  return {
    bytes,
    comparison: {
      templateKey: template.key,
      sourceSha256: integrity.actualSha256,
      sourcePageCount: 1,
      generatedPageCount: pdf.getPageCount(),
      sourcePageSize: pageSize,
      generatedPageSize: page.getSize(),
      dimensionsMatch: true,
      baseTemplatePreserved: true,
      legalTextRecreated: false,
      overlayFieldCount: placements.length,
      allFieldsFit: placements.every((placement) => placement.fits),
      placements,
    },
  };
}

module.exports = {
  DIMENSION_TOLERANCE_POINTS,
  FIELD_TOLERANCE_POINTS,
  fittedText,
  formatDate,
  overlayOfficialTemplate,
  overlayValues,
  validatePage,
};
