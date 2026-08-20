'use strict';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const LEFT = 48;
const RIGHT = 48;
const TOP = 92;
const BOTTOM = 62;
const WIDTH = PAGE_W - LEFT - RIGHT;
// Matches frontend/src/theme/tokens.js BRAND.primary (#0A1628) and
// BRAND.accent (#D4AF37) exactly, so generated PDFs use the same navy/gold
// as the rest of the app rather than an unrelated, uncalibrated palette.
const NAVY = '0.039 0.086 0.157';
const GOLD = '0.831 0.686 0.216';
const DARK = '0.25 0.25 0.25';
const MID = '0.45 0.45 0.45';
const LIGHT = '0.941 0.957 0.973';

function unicodeSafeText(value) {
  return String(value ?? '')
    .replace(/\u20B1/g, 'PHP ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2022\u25cf]/g, '-')
    .replace(/[\u2713\u2714]/g, 'Yes')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?');
}

function esc(value) {
  return unicodeSafeText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function textWidth(value, size) {
  return unicodeSafeText(value).length * size * 0.51;
}

function wrapText(value, size, maxWidth) {
  const paragraphs = unicodeSafeText(value).split(/\r?\n/);
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (textWidth(word, size) <= maxWidth) {
        line = word;
        continue;
      }
      let chunk = '';
      for (const char of word) {
        if (textWidth(chunk + char, size) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = char;
        } else chunk += char;
      }
      line = chunk;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function buildBrandedPdf(options = {}) {
  const pages = [];
  let ops;
  let y;

  function text(x, baseline, value, { size = 9, bold = false, color = DARK, align = 'left' } = {}) {
    const safe = unicodeSafeText(value);
    const drawX = align === 'right' ? x - textWidth(safe, size) : x;
    ops.push('BT', `${color} rg`, `/${bold ? 'F2' : 'F1'} ${size} Tf`, `${drawX.toFixed(2)} ${baseline.toFixed(2)} Td`, `(${esc(safe)}) Tj`, 'ET');
  }

  function line(x1, y1, x2, y2, color = '0.85 0.85 0.85', width = 0.5) {
    ops.push(`${color} RG`, `${width} w`, `${x1} ${y1} m ${x2} ${y2} l S`);
  }

  function rect(x, bottom, width, height, color) {
    ops.push(`${color} rg`, `${x} ${bottom} ${width} ${height} re f`);
  }

  function startPage() {
    ops = [];
    pages.push(ops);
    rect(0, PAGE_H - 72, PAGE_W, 72, NAVY);
    rect(0, PAGE_H - 75, PAGE_W, 3, GOLD);
    text(LEFT, PAGE_H - 37, 'LilyCrest', { size: 18, bold: true, color: '1 1 1' });
    text(LEFT, PAGE_H - 52, 'TENANT PORTAL', { size: 7, color: '0.8 0.8 0.8' });
    if (options.docType) text(PAGE_W - RIGHT, PAGE_H - 37, options.docType, { size: 9, bold: true, color: GOLD, align: 'right' });
    if (options.refNumber) text(PAGE_W - RIGHT, PAGE_H - 51, `Ref: ${options.refNumber}`, { size: 7, color: '0.8 0.8 0.8', align: 'right' });
    y = PAGE_H - TOP;
  }

  function ensure(height) {
    if (y - height >= BOTTOM) return;
    startPage();
  }

  function wrapped(value, config = {}) {
    const size = config.size || 9;
    const lineHeight = config.lineHeight || size + 4;
    const width = config.width || WIDTH;
    const lines = wrapText(value, size, width);
    for (const item of lines) {
      ensure(lineHeight);
      text(config.x || LEFT, y, item, config);
      y -= lineHeight;
    }
    return lines.length;
  }

  function heading(value) {
    ensure(34);
    line(LEFT, y + 8, PAGE_W - RIGHT, y + 8, NAVY, 0.8);
    y -= 5;
    wrapped(value, { size: 11, bold: true, color: NAVY, lineHeight: 15 });
    y -= 5;
  }

  function keyValue(label, value, shaded = false) {
    const labelWidth = 155;
    const valueLines = wrapText(value || '---', 9, WIDTH - labelWidth - 22);
    const rowHeight = Math.max(22, valueLines.length * 13 + 8);
    ensure(rowHeight);
    if (shaded) rect(LEFT, y - rowHeight + 5, WIDTH, rowHeight, LIGHT);
    text(LEFT + 10, y - 10, label, { size: 8, color: MID });
    valueLines.forEach((item, index) => text(LEFT + labelWidth, y - 10 - index * 13, item, { size: 9, bold: true }));
    line(LEFT, y - rowHeight + 5, PAGE_W - RIGHT, y - rowHeight + 5);
    y -= rowHeight;
  }

  function tableRow(label, value, index) {
    const valueWidth = 120;
    const labelLines = wrapText(label, 9, WIDTH - valueWidth - 28);
    const valueLines = wrapText(value, 9, valueWidth);
    const rowHeight = Math.max(labelLines.length, valueLines.length) * 13 + 9;
    ensure(rowHeight);
    if (index % 2 === 0) rect(LEFT, y - rowHeight + 4, WIDTH, rowHeight, LIGHT);
    labelLines.forEach((item, i) => text(LEFT + 10, y - 10 - i * 13, item, { size: 9 }));
    valueLines.forEach((item, i) => text(PAGE_W - RIGHT - 10, y - 10 - i * 13, item, { size: 9, bold: true, align: 'right' }));
    line(LEFT, y - rowHeight + 4, PAGE_W - RIGHT, y - rowHeight + 4);
    y -= rowHeight;
  }

  startPage();
  wrapped(options.title || 'Document', { size: 17, bold: true, color: NAVY, lineHeight: 21 });
  if (options.subtitle) wrapped(options.subtitle, { size: 10, color: MID, lineHeight: 14 });
  if (options.date) wrapped(options.date, { size: 9, color: MID, lineHeight: 13 });
  y -= 7;

  (options.infoRows || []).forEach((row, index) => keyValue(row.label || '', row.value || '---', index % 2 === 0));
  if (options.infoRows?.length) y -= 8;

  if (options.tableRows?.length) {
    ensure(28);
    rect(LEFT, y - 22, WIDTH, 22, NAVY);
    text(LEFT + 10, y - 15, 'Description', { size: 9, bold: true, color: '1 1 1' });
    text(PAGE_W - RIGHT - 10, y - 15, 'Amount', { size: 9, bold: true, color: '1 1 1', align: 'right' });
    y -= 22;
    options.tableRows.forEach((row, index) => tableRow(row.label || '', String(row.value || ''), index));
    if (options.totalRow) {
      ensure(28);
      rect(LEFT, y - 25, WIDTH, 25, NAVY);
      text(LEFT + 10, y - 17, options.totalRow.label || 'TOTAL', { size: 10, bold: true, color: '1 1 1' });
      text(PAGE_W - RIGHT - 10, y - 17, options.totalRow.value || '', { size: 11, bold: true, color: GOLD, align: 'right' });
      y -= 33;
    }
  }

  for (const section of options.breakdownSections || []) {
    heading(section.heading || 'Breakdown');
    for (const segment of section.segments || []) {
      const rows = segment.rows || [
        ...(segment.occupants != null ? [{ label: 'Occupants', value: segment.occupants }] : []),
        ...(segment.reading_date_from ? [{ label: 'Reading period', value: `${segment.reading_date_from} - ${segment.reading_date_to || '---'}` }] : []),
        ...(segment.reading_from != null ? [{ label: 'Meter readings', value: `${segment.reading_from} to ${segment.reading_to}` }] : []),
        ...(segment.consumption != null ? [{ label: 'Consumption', value: `${segment.consumption} kWh` }] : []),
        ...(segment.rate != null ? [{ label: 'Rate', value: `PHP ${segment.rate} / kWh` }] : []),
        ...(segment.share_per_tenant != null ? [{ label: 'Tenant share', value: segment.share_per_tenant }] : []),
      ];
      rows.forEach((row, index) => keyValue(row.label || '', String(row.value ?? ''), index % 2 === 0));
      if (segment.highlight) keyValue(segment.highlight.label || 'Amount', String(segment.highlight.value || ''), true);
      y -= 6;
    }
  }

  for (const section of options.sections || []) {
    heading(section.heading || '');
    for (const source of section.lines || []) {
      const bullet = /^[-*]/.test(source);
      const value = bullet ? source.slice(1).trim() : source;
      const x = bullet ? LEFT + 15 : LEFT;
      if (bullet) {
        ensure(14);
        rect(LEFT + 3, y + 3, 3, 3, GOLD);
      }
      wrapped(value, { x, width: WIDTH - (x - LEFT), size: 9, lineHeight: 13 });
    }
    y -= 7;
  }

  if (!options.sections?.length && !options.tableRows?.length) {
    for (const source of options.lines || []) {
      if (!String(source).trim()) { y -= 7; continue; }
      wrapped(source, { size: 9, lineHeight: 13 });
    }
  }

  const generated = new Date().toISOString();
  pages.forEach((page, index) => {
    page.push('0.85 0.85 0.85 RG', '0.5 w', `${LEFT} 48 m ${PAGE_W - RIGHT} 48 l S`);
    const footer = unicodeSafeText(options.footer || 'LilyCrest Properties Inc.');
    page.push('BT', `${MID} rg`, '/F1 7 Tf', `${LEFT} 35 Td`, `(${esc(footer)}) Tj`, 'ET');
    page.push('BT', `${MID} rg`, '/F1 7 Tf', `${PAGE_W - RIGHT - 150} 35 Td`, `(${esc(`Page ${index + 1} of ${pages.length}`)}) Tj`, 'ET');
    page.push('BT', `${MID} rg`, '/F1 6 Tf', `${LEFT} 24 Td`, `(${esc(`Generated: ${generated}`)}) Tj`, 'ET');
  });

  return assemblePdf(pages);
}

function assemblePdf(pages) {
  const pageCount = pages.length;
  const pageStart = 3;
  const contentStart = pageStart + pageCount;
  const fontRegular = contentStart + pageCount;
  const fontBold = fontRegular + 1;
  const maxObject = fontBold;
  const objects = new Array(maxObject + 1);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Count ${pageCount} /Kids [${pages.map((_, i) => `${pageStart + i} 0 R`).join(' ')}] >>`;
  pages.forEach((operators, index) => {
    const stream = operators.join('\n');
    objects[pageStart + index] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentStart + index} 0 R /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> >>`;
    objects[contentStart + index] = `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontRegular] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[fontBold] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  let output = '%PDF-1.4\n';
  const offsets = new Array(maxObject + 1).fill(0);
  for (let id = 1; id <= maxObject; id += 1) {
    offsets[id] = Buffer.byteLength(output, 'utf8');
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output, 'utf8');
  output += `xref\n0 ${maxObject + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxObject; id += 1) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  output += `trailer << /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output, 'utf8');
}

module.exports = { assemblePdf, buildBrandedPdf, esc, unicodeSafeText, wrapText };
