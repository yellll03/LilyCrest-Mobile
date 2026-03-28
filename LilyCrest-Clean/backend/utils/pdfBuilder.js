/**
 * Professional PDF builder for LilyCrest
 * Generates branded PDF documents with header, footer, tables, and styled sections.
 * Uses raw PDF operators (no external dependencies).
 *
 * Brand Colors:
 *   Navy  : #14365A  (RGB 0.078 0.212 0.353)
 *   Orange: #D4682A  (RGB 0.831 0.408 0.165)
 *   Light : #F0F4F8  (RGB 0.941 0.957 0.973)
 */

const NAVY  = { r: 0.078, g: 0.212, b: 0.353 };
const GOLD  = { r: 0.831, g: 0.408, b: 0.165 };
const LIGHT = { r: 0.941, g: 0.957, b: 0.973 };
const WHITE = { r: 1, g: 1, b: 1 };
const DGRAY = { r: 0.25,  g: 0.25,  b: 0.25  };
const MGRAY = { r: 0.45,  g: 0.45,  b: 0.45  };
const LGRAY = { r: 0.85,  g: 0.85,  b: 0.85  };

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_L = 50;
const MARGIN_R = 50;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
const HEADER_H = 85;
const FOOTER_H = 50;

function esc(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022|\u25CF/g, '-')
    .replace(/\u20B1/g, 'PHP ')
    .replace(/\u2713|\u2714/g, 'Yes')
    .replace(/[^\x20-\x7E]/g, '');
}

function rgb(c) { return `${c.r} ${c.g} ${c.b}`; }

function textWidth(text, fontSize) {
  // Approximate Helvetica width: ~0.52 * fontSize per char
  return String(text || '').length * fontSize * 0.52;
}

/**
 * Build a professional branded PDF.
 *
 * @param {Object} options
 * @param {string} options.title       - Document title (shown in header)
 * @param {string} [options.subtitle]  - Optional subtitle below title
 * @param {string} [options.docType]   - e.g. 'BILLING STATEMENT', 'LEASE CONTRACT'
 * @param {string} [options.refNumber] - Reference/billing ID
 * @param {string} [options.date]      - Document date string
 * @param {Array}  [options.infoRows]  - Key-value pairs for info section [{label, value}]
 * @param {Array}  [options.tableRows] - Table rows [{label, value}] for charges/items
 * @param {Object} [options.totalRow]  - {label, value} for total/grand total
 * @param {Array}  [options.breakdownSections] - [{heading, icon, segments:[{rows:[{label,value}], highlight:{label,value}}]}]
 * @param {Array}  [options.sections]  - [{heading, lines:[string]}] for policy docs
 * @param {Array}  [options.lines]     - Simple text lines fallback
 * @param {string} [options.footer]    - Custom footer text
 * @returns {Buffer} PDF buffer
 */
function buildBrandedPdf(options) {
  const {
    title = 'Document',
    subtitle = '',
    docType = '',
    refNumber = '',
    date = '',
    infoRows = [],
    tableRows = [],
    totalRow = null,
    breakdownSections = [],
    sections = [],
    lines = [],
    footer = '',
  } = options;

  const s = []; // content stream operators
  let y = PAGE_H - MARGIN_L; // current y cursor

  // ─── HEADER BAND ───
  // Navy background bar
  s.push(`${rgb(NAVY)} rg`);
  s.push(`0 ${PAGE_H - HEADER_H} ${PAGE_W} ${HEADER_H} re f`);

  // Gold accent line below header
  s.push(`${rgb(GOLD)} rg`);
  s.push(`0 ${PAGE_H - HEADER_H - 3} ${PAGE_W} 3 re f`);

  // Diamond logo shape (small golden diamond in header)
  const logoX = MARGIN_L + 2;
  const logoY = PAGE_H - 32;
  s.push(`${rgb(GOLD)} rg`);
  s.push(`${logoX + 10} ${logoY + 10} m`);
  s.push(`${logoX + 20} ${logoY} l`);
  s.push(`${logoX + 10} ${logoY - 10} l`);
  s.push(`${logoX} ${logoY} l`);
  s.push('f');

  // Inner diamond cutout (navy)
  s.push(`${rgb(NAVY)} rg`);
  s.push(`${logoX + 10} ${logoY + 5} m`);
  s.push(`${logoX + 15} ${logoY} l`);
  s.push(`${logoX + 10} ${logoY - 5} l`);
  s.push(`${logoX + 5} ${logoY} l`);
  s.push('f');

  // Brand name
  s.push('BT');
  s.push(`${rgb(WHITE)} rg`);
  s.push('/F2 18 Tf');
  s.push(`${logoX + 28} ${logoY - 5} Td`);
  s.push(`(${esc('LilyCrest')}) Tj`);
  s.push('ET');

  // "Tenant Portal" label
  s.push('BT');
  s.push('0.7 0.7 0.7 rg');
  s.push('/F1 8 Tf');
  s.push(`${logoX + 28} ${logoY - 16} Td`);
  s.push(`(${esc('TENANT PORTAL')}) Tj`);
  s.push('ET');

  // Document type label (right side)
  if (docType) {
    const dtW = textWidth(docType, 10);
    s.push('BT');
    s.push(`${rgb(GOLD)} rg`);
    s.push('/F2 10 Tf');
    s.push(`${PAGE_W - MARGIN_R - dtW} ${logoY - 2} Td`);
    s.push(`(${esc(docType)}) Tj`);
    s.push('ET');
  }

  // Reference number (right, below doc type)
  if (refNumber) {
    const refText = `Ref: ${refNumber}`;
    const refW = textWidth(refText, 8);
    s.push('BT');
    s.push('0.8 0.8 0.8 rg');
    s.push('/F1 8 Tf');
    s.push(`${PAGE_W - MARGIN_R - refW} ${logoY - 14} Td`);
    s.push(`(${esc(refText)}) Tj`);
    s.push('ET');
  }

  y = PAGE_H - HEADER_H - 20;

  // ─── TITLE ───
  s.push('BT');
  s.push(`${rgb(NAVY)} rg`);
  s.push('/F2 16 Tf');
  s.push(`${MARGIN_L} ${y} Td`);
  s.push(`(${esc(title)}) Tj`);
  s.push('ET');
  y -= 16;

  if (subtitle) {
    s.push('BT');
    s.push(`${rgb(MGRAY)} rg`);
    s.push('/F1 10 Tf');
    s.push(`${MARGIN_L} ${y} Td`);
    s.push(`(${esc(subtitle)}) Tj`);
    s.push('ET');
    y -= 14;
  }

  if (date) {
    s.push('BT');
    s.push(`${rgb(MGRAY)} rg`);
    s.push('/F1 9 Tf');
    s.push(`${MARGIN_L} ${y} Td`);
    s.push(`(${esc(date)}) Tj`);
    s.push('ET');
    y -= 12;
  }

  y -= 10;

  // ─── GOLD DIVIDER ───
  const drawDivider = () => {
    s.push(`${rgb(GOLD)} rg`);
    s.push(`${MARGIN_L} ${y} ${CONTENT_W} 1.5 re f`);
    y -= 14;
  };
  drawDivider();

  // ─── INFO ROWS (key-value pairs) ───
  if (infoRows.length > 0) {
    // Light background
    const infoH = infoRows.length * 18 + 12;
    s.push(`${rgb(LIGHT)} rg`);
    s.push(`${MARGIN_L} ${y - infoH + 6} ${CONTENT_W} ${infoH} re f`);

    // Border
    s.push('0.82 0.82 0.82 RG');
    s.push('0.5 w');
    s.push(`${MARGIN_L} ${y - infoH + 6} ${CONTENT_W} ${infoH} re S`);

    y -= 4;
    infoRows.forEach(row => {
      y -= 18;
      // Label
      s.push('BT');
      s.push(`${rgb(MGRAY)} rg`);
      s.push('/F1 9 Tf');
      s.push(`${MARGIN_L + 12} ${y} Td`);
      s.push(`(${esc(row.label || '')}) Tj`);
      s.push('ET');
      // Value
      s.push('BT');
      s.push(`${rgb(DGRAY)} rg`);
      s.push('/F2 9 Tf');
      s.push(`${MARGIN_L + 180} ${y} Td`);
      s.push(`(${esc(row.value || '---')}) Tj`);
      s.push('ET');
    });
    y -= 16;
  }

  // ─── TABLE (charges/items) ───
  if (tableRows.length > 0) {
    // Table header
    const tableHeaderH = 22;
    s.push(`${rgb(NAVY)} rg`);
    s.push(`${MARGIN_L} ${y - tableHeaderH} ${CONTENT_W} ${tableHeaderH} re f`);

    s.push('BT');
    s.push(`${rgb(WHITE)} rg`);
    s.push('/F2 9 Tf');
    s.push(`${MARGIN_L + 12} ${y - 15} Td`);
    s.push(`(${esc('Description')}) Tj`);
    s.push('ET');

    s.push('BT');
    s.push(`${rgb(WHITE)} rg`);
    s.push('/F2 9 Tf');
    const amtHeaderW = textWidth('Amount', 9);
    s.push(`${PAGE_W - MARGIN_R - amtHeaderW - 12} ${y - 15} Td`);
    s.push(`(${esc('Amount')}) Tj`);
    s.push('ET');

    y -= tableHeaderH;

    // Table rows
    tableRows.forEach((row, idx) => {
      const rowH = 20;
      const isEven = idx % 2 === 0;

      if (isEven) {
        s.push(`${rgb(LIGHT)} rg`);
        s.push(`${MARGIN_L} ${y - rowH} ${CONTENT_W} ${rowH} re f`);
      }

      // Bottom border
      s.push(`${rgb(LGRAY)} RG`);
      s.push('0.3 w');
      s.push(`${MARGIN_L} ${y - rowH} m ${PAGE_W - MARGIN_R} ${y - rowH} l S`);

      y -= 14;

      // Label
      s.push('BT');
      s.push(`${rgb(DGRAY)} rg`);
      s.push('/F1 9 Tf');
      s.push(`${MARGIN_L + 12} ${y} Td`);
      s.push(`(${esc(row.label || '')}) Tj`);
      s.push('ET');

      // Value (right-aligned)
      const valText = String(row.value || '');
      const valW = textWidth(valText, 9);
      s.push('BT');
      s.push(`${rgb(DGRAY)} rg`);
      s.push('/F2 9 Tf');
      s.push(`${PAGE_W - MARGIN_R - valW - 12} ${y} Td`);
      s.push(`(${esc(valText)}) Tj`);
      s.push('ET');

      y -= 6;
    });

    // Total row
    if (totalRow) {
      const totalH = 24;
      s.push(`${rgb(NAVY)} rg`);
      s.push(`${MARGIN_L} ${y - totalH} ${CONTENT_W} ${totalH} re f`);

      s.push('BT');
      s.push(`${rgb(WHITE)} rg`);
      s.push('/F2 10 Tf');
      s.push(`${MARGIN_L + 12} ${y - 16} Td`);
      s.push(`(${esc(totalRow.label || 'TOTAL')}) Tj`);
      s.push('ET');

      const totalValText = String(totalRow.value || '');
      const totalValW = textWidth(totalValText, 11);
      s.push('BT');
      s.push(`${rgb(GOLD)} rg`);
      s.push('/F2 11 Tf');
      s.push(`${PAGE_W - MARGIN_R - totalValW - 12} ${y - 16} Td`);
      s.push(`(${esc(totalValText)}) Tj`);
      s.push('ET');

      y -= totalH + 8;
    }

    y -= 10;
  }

  // ── COMPUTATION BREAKDOWN SECTIONS (electricity/water) ──
  if (breakdownSections.length > 0) {
    for (const section of breakdownSections) {
      if (y < 120) continue; // safety: skip sections that don't fit

      // Section heading with gold accent
      s.push(`${rgb(GOLD)} rg`);
      s.push(`${MARGIN_L} ${y} ${3} ${14} re f`);
      s.push('BT');
      s.push(`${rgb(NAVY)} rg`);
      s.push('/F2 10 Tf');
      s.push(`${MARGIN_L + 10} ${y + 2} Td`);
      s.push(`(${esc(section.heading || 'Breakdown')}) Tj`);
      s.push('ET');
      y -= 20;

      // Electricity table format (matching reference billing)
      if (section.type === 'electricity' && section.segments) {
        section.segments.forEach((seg) => {
          if (y < 140) return;

          const col1X = MARGIN_L;
          const col2X = MARGIN_L + CONTENT_W * 0.45;
          const col3X = MARGIN_L + CONTENT_W * 0.75;
          const rowH = 16;

          // --- Occupants header (navy bar) ---
          const occH = 20;
          s.push(`${rgb(NAVY)} rg`);
          s.push(`${col1X} ${y - occH} ${CONTENT_W} ${occH} re f`);
          s.push('BT');
          s.push(`${rgb(WHITE)} rg`);
          s.push('/F2 9 Tf');
          s.push(`${col1X + 8} ${y - 14} Td`);
          s.push(`(${esc('No. of occupants in the room:')}) Tj`);
          s.push('ET');
          const occVal = String(seg.occupants || 1);
          const occValW = textWidth(occVal, 10);
          s.push('BT');
          s.push(`${rgb(WHITE)} rg`);
          s.push('/F2 10 Tf');
          s.push(`${col1X + CONTENT_W - occValW - 10} ${y - 14} Td`);
          s.push(`(${esc(occVal)}) Tj`);
          s.push('ET');
          y -= occH;

          // --- Column headers ---
          s.push(`${rgb(LIGHT)} rg`);
          s.push(`${col1X} ${y - rowH} ${CONTENT_W} ${rowH} re f`);
          s.push(`${rgb(LGRAY)} RG`);
          s.push('0.3 w');
          s.push(`${col1X} ${y - rowH} m ${col1X + CONTENT_W} ${y - rowH} l S`);
          // "Date" header
          s.push('BT');
          s.push(`${rgb(MGRAY)} rg`);
          s.push('/F2 8 Tf');
          s.push(`${col2X} ${y - 11} Td`);
          s.push(`(${esc('Date')}) Tj`);
          s.push('ET');
          // "kwh" header
          const kwhW = textWidth('kwh', 8);
          s.push('BT');
          s.push(`${rgb(MGRAY)} rg`);
          s.push('/F2 8 Tf');
          s.push(`${col3X + (CONTENT_W * 0.25 - kwhW) / 2} ${y - 11} Td`);
          s.push(`(${esc('kwh')}) Tj`);
          s.push('ET');
          y -= rowH;

          // --- 1st reading row ---
          s.push(`${rgb(LGRAY)} RG`);
          s.push('0.3 w');
          s.push(`${col1X} ${y - rowH} m ${col1X + CONTENT_W} ${y - rowH} l S`);
          s.push('BT');
          s.push(`${rgb(DGRAY)} rg`);
          s.push('/F1 8 Tf');
          s.push(`${col1X + 8} ${y - 11} Td`);
          s.push(`(${esc('1st reading')}) Tj`);
          s.push('ET');
          s.push('BT');
          s.push(`${rgb(DGRAY)} rg`);
          s.push('/F1 8 Tf');
          s.push(`${col2X} ${y - 11} Td`);
          s.push(`(${esc(seg.reading_date_from || '---')}) Tj`);
          s.push('ET');
          const rf = String(seg.reading_from || 0);
          const rfW = textWidth(rf, 9);
          s.push('BT');
          s.push(`${rgb(DGRAY)} rg`);
          s.push('/F2 9 Tf');
          s.push(`${col3X + (CONTENT_W * 0.25 - rfW) / 2} ${y - 11} Td`);
          s.push(`(${esc(rf)}) Tj`);
          s.push('ET');
          y -= rowH;

          // --- 2nd reading row ---
          s.push(`${rgb(LGRAY)} RG`);
          s.push('0.3 w');
          s.push(`${col1X} ${y - rowH} m ${col1X + CONTENT_W} ${y - rowH} l S`);
          s.push('BT');
          s.push(`${rgb(DGRAY)} rg`);
          s.push('/F1 8 Tf');
          s.push(`${col1X + 8} ${y - 11} Td`);
          s.push(`(${esc('2nd reading')}) Tj`);
          s.push('ET');
          s.push('BT');
          s.push(`${rgb(DGRAY)} rg`);
          s.push('/F1 8 Tf');
          s.push(`${col2X} ${y - 11} Td`);
          s.push(`(${esc(seg.reading_date_to || '---')}) Tj`);
          s.push('ET');
          const rt = String(seg.reading_to || 0);
          const rtW = textWidth(rt, 9);
          s.push('BT');
          s.push(`${rgb(DGRAY)} rg`);
          s.push('/F2 9 Tf');
          s.push(`${col3X + (CONTENT_W * 0.25 - rtW) / 2} ${y - 11} Td`);
          s.push(`(${esc(rt)}) Tj`);
          s.push('ET');
          y -= rowH;

          // --- Total consumption row ---
          s.push(`${rgb(LGRAY)} RG`);
          s.push('0.3 w');
          s.push(`${col1X} ${y - rowH} m ${col1X + CONTENT_W} ${y - rowH} l S`);
          s.push('BT');
          s.push(`${rgb(DGRAY)} rg`);
          s.push('/F1 8 Tf');
          s.push(`${col1X + 8} ${y - 11} Td`);
          s.push(`(${esc('Total consumption')}) Tj`);
          s.push('ET');
          const cons = String(seg.consumption || 0);
          const consW = textWidth(cons, 9);
          s.push('BT');
          s.push(`${rgb(DGRAY)} rg`);
          s.push('/F2 9 Tf');
          s.push(`${col3X + (CONTENT_W * 0.25 - consW) / 2} ${y - 11} Td`);
          s.push(`(${esc(cons)}) Tj`);
          s.push('ET');
          y -= rowH;

          // --- Amount due per person (gold highlight) ---
          const amtH = 18;
          s.push(`${rgb(GOLD)} RG`);
          s.push('0.8 w');
          s.push(`${col1X} ${y - amtH} ${CONTENT_W} ${amtH} re S`);
          const amtLabel = `Amount due (Php ${seg.rate || 0} / kwh) per person`;
          s.push('BT');
          s.push(`${rgb(GOLD)} rg`);
          s.push('/F1 8 Tf');
          s.push(`${col1X + 8} ${y - 13} Td`);
          s.push(`(${esc(amtLabel)}) Tj`);
          s.push('ET');
          const amtVal = String(seg.share_per_tenant || '');
          const amtValW = textWidth(amtVal, 10);
          s.push('BT');
          s.push(`${rgb(GOLD)} rg`);
          s.push('/F2 10 Tf');
          s.push(`${col1X + CONTENT_W - amtValW - 10} ${y - 13} Td`);
          s.push(`(${esc(amtVal)}) Tj`);
          s.push('ET');
          y -= amtH + 10;
        });

        // ── Summary table: per-segment shares + total + due date ──
        if (y > 120) {
          const segs = section.segments;

          // Per-segment share lines
          segs.forEach((seg) => {
            if (y < 80) return;
            const lineH = 14;
            const segLabel = `${seg.reading_date_from || '---'} - ${seg.reading_date_to || '---'} (${seg.occupants || 1} occupants)`;
            s.push('BT');
            s.push(`${rgb(MGRAY)} rg`);
            s.push('/F1 8 Tf');
            s.push(`${MARGIN_L + 8} ${y - 10} Td`);
            s.push(`(${esc(segLabel)}) Tj`);
            s.push('ET');
            const segAmt = String(seg.share_per_tenant || '');
            const segAmtW = textWidth(segAmt, 9);
            s.push('BT');
            s.push(`${rgb(DGRAY)} rg`);
            s.push('/F2 9 Tf');
            s.push(`${MARGIN_L + CONTENT_W - segAmtW - 8} ${y - 10} Td`);
            s.push(`(${esc(segAmt)}) Tj`);
            s.push('ET');
            s.push(`${rgb(LGRAY)} RG`);
            s.push('0.3 w');
            s.push(`${MARGIN_L} ${y - lineH} m ${MARGIN_L + CONTENT_W} ${y - lineH} l S`);
            y -= lineH;
          });

          // Addition line (multi-segment)
          if (segs.length > 1) {
            const addText = segs.map(s2 => String(s2.share_per_tenant || '')).join(' + ');
            const addW = textWidth(addText, 8);
            s.push('BT');
            s.push(`${rgb(MGRAY)} rg`);
            s.push('/F1 8 Tf');
            s.push(`${MARGIN_L + CONTENT_W - addW - 8} ${y - 10} Td`);
            s.push(`(${esc(addText)}) Tj`);
            s.push('ET');
            y -= 14;
          }

          // Total Amount Due bar
          const totalDueH = 22;
          s.push(`${rgb(NAVY)} rg`);
          s.push(`${MARGIN_L} ${y - totalDueH} ${CONTENT_W} ${totalDueH} re f`);
          s.push('BT');
          s.push(`${rgb(WHITE)} rg`);
          s.push('/F2 10 Tf');
          s.push(`${MARGIN_L + 8} ${y - 15} Td`);
          s.push(`(${esc('Total Amount Due')}) Tj`);
          s.push('ET');
          const totalDue = segs.reduce((sum, seg2) => {
            const val = String(seg2.share_per_tenant || '');
            const num = parseFloat(val.replace(/[^0-9.]/g, '')) || 0;
            return sum + num;
          }, 0);
          const totalDueText = `PHP ${totalDue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
          const totalDueW = textWidth(totalDueText, 11);
          s.push('BT');
          s.push(`${rgb(GOLD)} rg`);
          s.push('/F2 11 Tf');
          s.push(`${MARGIN_L + CONTENT_W - totalDueW - 8} ${y - 15} Td`);
          s.push(`(${esc(totalDueText)}) Tj`);
          s.push('ET');
          y -= totalDueH;
        }

        y -= 6;
        continue;
      }

      // Generic key-value segment cards (water etc.)
      (section.segments || []).forEach((seg, segIdx) => {
        if (y < 100) return;

        // Segment background
        const segRows = seg.rows || [];
        const segH = segRows.length * 16 + (seg.highlight ? 22 : 0) + 10;
        s.push(`${rgb(LIGHT)} rg`);
        s.push(`${MARGIN_L} ${y - segH + 4} ${CONTENT_W} ${segH} re f`);
        s.push('0.82 0.82 0.82 RG');
        s.push('0.5 w');
        s.push(`${MARGIN_L} ${y - segH + 4} ${CONTENT_W} ${segH} re S`);

        y -= 2;
        segRows.forEach(row => {
          y -= 16;
          // Label
          s.push('BT');
          s.push(`${rgb(MGRAY)} rg`);
          s.push('/F1 8 Tf');
          s.push(`${MARGIN_L + 10} ${y} Td`);
          s.push(`(${esc(row.label || '')}) Tj`);
          s.push('ET');
          // Value
          const rowVal = String(row.value || '');
          const rowValW = textWidth(rowVal, 9);
          s.push('BT');
          s.push(`${rgb(DGRAY)} rg`);
          s.push('/F2 9 Tf');
          s.push(`${PAGE_W - MARGIN_R - rowValW - 10} ${y} Td`);
          s.push(`(${esc(rowVal)}) Tj`);
          s.push('ET');
        });

        // Highlighted row (Your Share)
        if (seg.highlight) {
          y -= 4;
          const hlH = 18;
          s.push(`${rgb(GOLD)} RG`);
          s.push('0.8 w');
          s.push(`${MARGIN_L + 6} ${y - hlH} ${CONTENT_W - 12} ${hlH} re S`);

          s.push('BT');
          s.push(`${rgb(GOLD)} rg`);
          s.push('/F2 9 Tf');
          s.push(`${MARGIN_L + 12} ${y - 13} Td`);
          s.push(`(${esc(seg.highlight.label || 'Your Share')}) Tj`);
          s.push('ET');

          const hlVal = String(seg.highlight.value || '');
          const hlValW = textWidth(hlVal, 10);
          s.push('BT');
          s.push(`${rgb(GOLD)} rg`);
          s.push('/F2 10 Tf');
          s.push(`${PAGE_W - MARGIN_R - hlValW - 12} ${y - 13} Td`);
          s.push(`(${esc(hlVal)}) Tj`);
          s.push('ET');

          y -= hlH;
        }

        y -= 12;
      });

      y -= 6;
    }
  }

  // ─── SECTIONS (for policy documents) ───
  if (sections.length > 0) {
    sections.forEach(section => {
      if (y < 100) return; // safety: don't overflow

      // Section heading
      if (section.heading) {
        s.push(`${rgb(NAVY)} rg`);
        s.push(`${MARGIN_L} ${y} ${CONTENT_W} 0.8 re f`);
        y -= 8;
        s.push('BT');
        s.push(`${rgb(NAVY)} rg`);
        s.push('/F2 11 Tf');
        s.push(`${MARGIN_L} ${y} Td`);
        s.push(`(${esc(section.heading)}) Tj`);
        s.push('ET');
        y -= 16;
      }

      // Section body lines
      (section.lines || []).forEach(line => {
        if (y < 80) return;
        const isBullet = line.startsWith('-') || line.startsWith('*');
        const indent = isBullet ? 12 : 0;
        const displayLine = isBullet ? line.substring(1).trim() : line;

        if (isBullet) {
          // Gold bullet dot
          s.push(`${rgb(GOLD)} rg`);
          s.push(`${MARGIN_L + 4} ${y + 3} 3 3 re f`);
        }

        s.push('BT');
        s.push(`${rgb(DGRAY)} rg`);
        s.push('/F1 9 Tf');
        s.push(`${MARGIN_L + indent + 6} ${y} Td`);
        s.push(`(${esc(displayLine)}) Tj`);
        s.push('ET');
        y -= 14;
      });

      y -= 6;
    });
  }

  // ─── PLAIN LINES (fallback) ───
  if (lines.length > 0 && sections.length === 0 && tableRows.length === 0) {
    lines.forEach(line => {
      if (y < 80) return;

      if (!line.trim()) {
        y -= 8;
        return;
      }

      const isHeading = line.endsWith(':') && line.length < 40;
      const isBullet = line.startsWith('-') || line.startsWith('*');

      if (isHeading) {
        s.push('BT');
        s.push(`${rgb(NAVY)} rg`);
        s.push('/F2 10 Tf');
        s.push(`${MARGIN_L} ${y} Td`);
        s.push(`(${esc(line)}) Tj`);
        s.push('ET');
        y -= 16;
      } else if (isBullet) {
        s.push(`${rgb(GOLD)} rg`);
        s.push(`${MARGIN_L + 4} ${y + 3} 3 3 re f`);
        s.push('BT');
        s.push(`${rgb(DGRAY)} rg`);
        s.push('/F1 9 Tf');
        s.push(`${MARGIN_L + 16} ${y} Td`);
        s.push(`(${esc(line.substring(1).trim())}) Tj`);
        s.push('ET');
        y -= 14;
      } else {
        s.push('BT');
        s.push(`${rgb(DGRAY)} rg`);
        s.push('/F1 9 Tf');
        s.push(`${MARGIN_L} ${y} Td`);
        s.push(`(${esc(line)}) Tj`);
        s.push('ET');
        y -= 14;
      }
    });
  }

  // ─── FOOTER ───
  const footerY = 40;

  // Footer line
  s.push(`${rgb(LGRAY)} rg`);
  s.push(`${MARGIN_L} ${footerY + 16} ${CONTENT_W} 0.5 re f`);

  // Footer text
  const footerText = footer || 'LilyCrest Properties Inc. | #7 Gil Puyat Ave. cor Marconi St., Brgy Palanan, Makati City';
  s.push('BT');
  s.push(`${rgb(MGRAY)} rg`);
  s.push('/F1 7 Tf');
  s.push(`${MARGIN_L} ${footerY + 4} Td`);
  s.push(`(${esc(footerText)}) Tj`);
  s.push('ET');

  // Contact
  s.push('BT');
  s.push(`${rgb(MGRAY)} rg`);
  s.push('/F1 7 Tf');
  s.push(`${MARGIN_L} ${footerY - 6} Td`);
  s.push(`(${esc('admin@lilycrest.ph | +63 912 345 6789 | www.lilycrest.ph')}) Tj`);
  s.push('ET');

  // "Generated" timestamp (right side)
  const now = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const genText = `Generated: ${now}`;
  const genW = textWidth(genText, 7);
  s.push('BT');
  s.push(`${rgb(MGRAY)} rg`);
  s.push('/F1 7 Tf');
  s.push(`${PAGE_W - MARGIN_R - genW} ${footerY + 4} Td`);
  s.push(`(${esc(genText)}) Tj`);
  s.push('ET');

  // ─── BUILD PDF STRUCTURE ───
  const streamStr = s.join('\n');
  const streamLen = Buffer.byteLength(streamStr, 'utf8');

  let off = 0;
  const parts = [];
  const offsets = [0];
  const add = (str) => { parts.push(str); off += Buffer.byteLength(str, 'utf8'); };

  add('%PDF-1.4\n');

  offsets.push(off);
  add('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n');

  offsets.push(off);
  add('2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n');

  offsets.push(off);
  add(`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >> endobj\n`);

  offsets.push(off);
  add(`4 0 obj << /Length ${streamLen} >> stream\n${streamStr}\nendstream endobj\n`);

  offsets.push(off);
  add('5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n');

  offsets.push(off);
  add('6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n');

  const xrefOff = off;
  add(`xref\n0 ${offsets.length}\n`);
  add('0000000000 65535 f \n');
  for (let i = 1; i < offsets.length; i++) {
    add(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }

  add(`trailer << /Size ${offsets.length} /Root 1 0 R >>\n`);
  add('startxref\n');
  add(`${xrefOff}\n`);
  add('%%EOF');

  return Buffer.from(parts.join(''), 'utf8');
}

module.exports = { buildBrandedPdf, esc };
