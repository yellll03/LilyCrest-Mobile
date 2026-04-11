/**
 * LilyCrest Mobile App — Module Progress Checklist PDF Generator
 * Run: node backend/scripts/generateMobileChecklist.js
 * Output: backend/scripts/LilyCrest_Mobile_Module_Checklist.pdf
 */

const fs = require('fs');
const path = require('path');

// ── Brand Colors ────────────────────────────────────────────────────────────
const NAVY   = { r: 0.078, g: 0.212, b: 0.353 };
const ORANGE = { r: 0.831, g: 0.408, b: 0.165 };
const GREEN  = { r: 0.133, g: 0.545, b: 0.133 };
const AMBER  = { r: 0.800, g: 0.600, b: 0.000 };
const RED    = { r: 0.753, g: 0.114, b: 0.114 };
const LIGHT  = { r: 0.961, g: 0.969, b: 0.980 };
const WHITE  = { r: 1.000, g: 1.000, b: 1.000 };
const DGRAY  = { r: 0.200, g: 0.200, b: 0.200 };
const MGRAY  = { r: 0.450, g: 0.450, b: 0.450 };
const LGRAY  = { r: 0.878, g: 0.878, b: 0.878 };

const PAGE_W   = 612;
const PAGE_H   = 792;
const ML       = 48;
const MR       = 48;
const CW       = PAGE_W - ML - MR;
const HEADER_H = 72;
const FOOTER_H = 36;

function rgb(c) { return `${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)}`; }

function esc(t) {
  return String(t || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

// ── Module Data ─────────────────────────────────────────────────────────────
// Status: 'done' | 'partial' | 'none'
const MODULES = [
  {
    id: '01',
    name: 'Authentication and Access Control Module',
    role: 'Tenant',
    features: [
      { text: 'Login with email and password',                  status: 'done'    },
      { text: 'Login with Google account',                      status: 'done'    },
      { text: 'Biometric login (Fingerprint / Face ID)',         status: 'done'    },
      { text: 'Logout and session termination',                 status: 'done'    },
      { text: 'Forgot password (email reset link)',             status: 'done'    },
      { text: 'Change password from within the app',            status: 'done'    },
      { text: 'Verify session on app launch',                   status: 'done'    },
      { text: 'Check account status (active / inactive)',       status: 'done'    },
      { text: 'Remember me and saved email preference',         status: 'done'    },
      { text: 'Update profile information (name, phone, photo)',status: 'done'    },
      { text: 'Input validation and security error handling',   status: 'done'    },
    ],
  },
  {
    id: '02',
    name: 'Room and Bed Management Module',
    role: 'Tenant (View Only)',
    features: [
      { text: 'View assigned room number and floor',            status: 'done'    },
      { text: 'View room type (Quad, Double, Private)',         status: 'done'    },
      { text: 'View bed position (Upper / Lower)',              status: 'done'    },
      { text: 'View number of occupants (pax)',                 status: 'done'    },
      { text: 'View move-in and move-out dates',                status: 'done'    },
      { text: 'View occupancy status (Active Tenant badge)',    status: 'done'    },
      { text: 'Submit room or bed concerns via service request',status: 'partial' },
    ],
  },
  {
    id: '03',
    name: 'Billing, Payments, and AI-Assisted Billing Module',
    role: 'Tenant',
    features: [
      { text: 'View current billing statement',                 status: 'done'    },
      { text: 'View full billing history',                      status: 'done'    },
      { text: 'View charge breakdown (rent, electricity, water, penalties)', status: 'done' },
      { text: 'View electricity meter reading breakdown',       status: 'done'    },
      { text: 'View water consumption breakdown',               status: 'done'    },
      { text: 'View bill status (Pending, Overdue, Paid)',      status: 'done'    },
      { text: 'Pay bills online via PayMongo',                  status: 'done'    },
      { text: 'Payment via GCash',                              status: 'done'    },
      { text: 'Payment via Maya',                               status: 'done'    },
      { text: 'Payment via GrabPay',                            status: 'done'    },
      { text: 'Payment via Credit / Debit Card',                status: 'done'    },
      { text: 'View total outstanding balance',                 status: 'done'    },
      { text: 'Download bill as branded PDF receipt',           status: 'done'    },
      { text: 'Track payment date and reference number',        status: 'done'    },
      { text: 'Filter bills by status (All, Pending, Overdue, Paid)', status: 'done' },
      { text: 'AI explains billing charges via Lily Assistant', status: 'done'    },
      { text: 'Real-time payment redirect and confirmation',    status: 'partial' },
    ],
  },
  {
    id: '04',
    name: 'Maintenance and Service Requests Module',
    role: 'Tenant',
    features: [
      { text: 'Submit maintenance request',                     status: 'done'    },
      { text: 'Select request type (Maintenance, Plumbing, Electrical, Aircon, Cleaning, Pest, Furniture)', status: 'done' },
      { text: 'Set urgency level (Low, Normal, Urgent)',        status: 'done'    },
      { text: 'Attach photos or files to a request',           status: 'done'    },
      { text: 'View request status (Pending, In Progress, Resolved)', status: 'done' },
      { text: 'View request timeline and history',              status: 'done'    },
      { text: 'Cancel a pending request',                       status: 'done'    },
      { text: 'Reopen a resolved request',                      status: 'done'    },
      { text: 'Estimated resolution time displayed per urgency',status: 'done'    },
      { text: 'View admin responses on request',                status: 'partial' },
    ],
  },
  {
    id: '05',
    name: 'Announcements and Policies Module',
    role: 'Tenant (View Only)',
    features: [
      { text: 'View all dormitory announcements',               status: 'done'    },
      { text: 'Filter announcements by category',               status: 'done'    },
      { text: 'View announcement priority (Urgent / Normal / Low)', status: 'done' },
      { text: 'Pull to refresh announcements',                  status: 'done'    },
      { text: 'View house rules policy document',               status: 'done'    },
      { text: 'View privacy policy',                            status: 'done'    },
      { text: 'View terms of service',                          status: 'done'    },
      { text: 'View and upload personal documents (IDs, files)',status: 'done'    },
      { text: 'View dormitory policy documents (Lease Contract, Curfew, Visitor)', status: 'done' },
      { text: 'Acknowledge notices / read receipts',            status: 'none'    },
    ],
  },
  {
    id: '06',
    name: 'Support and AI Chatbot Module',
    role: 'Tenant',
    features: [
      { text: 'AI Chatbot (Lily Assistant) powered by Gemini', status: 'done'    },
      { text: 'Ask billing and payment questions',              status: 'done'    },
      { text: 'Ask room and reservation questions',             status: 'done'    },
      { text: 'Ask general account and policy questions',       status: 'done'    },
      { text: 'View Frequently Asked Questions (FAQ)',          status: 'done'    },
      { text: 'Filter FAQs by category',                        status: 'done'    },
      { text: 'Create support ticket',                          status: 'done'    },
      { text: 'View support ticket status',                     status: 'done'    },
      { text: 'Respond to support ticket thread',               status: 'done'    },
      { text: 'Close support ticket',                           status: 'done'    },
      { text: 'Reset chat session',                             status: 'done'    },
      { text: 'Track support ticket history',                   status: 'partial' },
    ],
  },
];

// ── PDF Assembly ─────────────────────────────────────────────────────────────

function buildPdf() {
  const pages = [];    // array of content stream strings
  let page = [];       // current page ops
  let y = 0;

  const CONTENT_TOP = PAGE_H - HEADER_H - 16;
  const CONTENT_BOT = FOOTER_H + 16;

  function newPage(isFirst = false) {
    if (page.length) pages.push(page.join('\n'));
    page = [];
    y = CONTENT_TOP;
    drawHeader(page, isFirst);
  }

  function ensureSpace(need) {
    if (y - need < CONTENT_BOT) {
      newPage(false);
    }
  }

  // ── Header ──
  function drawHeader(p, isFirst) {
    // Navy band
    p.push(`${rgb(NAVY)} rg`);
    p.push(`0 ${PAGE_H - HEADER_H} ${PAGE_W} ${HEADER_H} re f`);
    // Orange accent
    p.push(`${rgb(ORANGE)} rg`);
    p.push(`0 ${PAGE_H - HEADER_H - 3} ${PAGE_W} 3 re f`);
    // Logo diamond
    const lx = ML, ly = PAGE_H - 26;
    p.push(`${rgb(ORANGE)} rg`);
    p.push(`${lx+10} ${ly+10} m ${lx+20} ${ly} l ${lx+10} ${ly-10} l ${lx} ${ly} l f`);
    p.push(`${rgb(NAVY)} rg`);
    p.push(`${lx+10} ${ly+5} m ${lx+15} ${ly} l ${lx+10} ${ly-5} l ${lx+5} ${ly} l f`);
    // Brand
    p.push('BT'); p.push(`${rgb(WHITE)} rg`); p.push('/F2 15 Tf');
    p.push(`${lx+28} ${ly-4} Td`); p.push(`(${esc('LilyCrest')}) Tj`); p.push('ET');
    p.push('BT'); p.push('0.65 0.65 0.65 rg'); p.push('/F1 7 Tf');
    p.push(`${lx+28} ${ly-14} Td`); p.push(`(${esc('DORMITORY MANAGEMENT SYSTEM')}) Tj`); p.push('ET');

    if (isFirst) {
      // Document title on first page header
      p.push('BT'); p.push(`${rgb(WHITE)} rg`); p.push('/F2 9 Tf');
      const label = 'MOBILE APP - MODULE PROGRESS CHECKLIST';
      const lw = label.length * 9 * 0.52;
      p.push(`${PAGE_W - MR - lw} ${ly-1} Td`); p.push(`(${esc(label)}) Tj`); p.push('ET');
      const dated = `Generated: April 10, 2026`;
      const dw = dated.length * 7 * 0.52;
      p.push('BT'); p.push('0.65 0.65 0.65 rg'); p.push('/F1 7 Tf');
      p.push(`${PAGE_W - MR - dw} ${ly-12} Td`); p.push(`(${esc(dated)}) Tj`); p.push('ET');
    }
  }

  // ── Footer ──
  function drawFooter(p, pageNum, total) {
    p.push(`${rgb(ORANGE)} rg`);
    p.push(`0 ${FOOTER_H - 4} ${PAGE_W} 2 re f`);
    p.push('BT'); p.push(`${rgb(MGRAY)} rg`); p.push('/F1 8 Tf');
    p.push(`${ML} ${FOOTER_H - 18} Td`);
    p.push(`(${esc('LilyCrest Dormitory Management System - Mobile Application')}) Tj`); p.push('ET');
    const pnText = `Page ${pageNum}`;
    const pw = pnText.length * 8 * 0.52;
    p.push('BT'); p.push(`${rgb(MGRAY)} rg`); p.push('/F1 8 Tf');
    p.push(`${PAGE_W - MR - pw} ${FOOTER_H - 18} Td`);
    p.push(`(${esc(pnText)}) Tj`); p.push('ET');
    p.push(`${rgb(LGRAY)} rg`);
    p.push(`${ML} ${FOOTER_H - 4} ${CW} 0.5 re f`);
  }

  // ── Cover Info Block ──
  function drawCoverBlock(p) {
    // Title block
    y -= 8;
    const titleY = y;
    p.push(`${rgb(LIGHT)} rg`);
    p.push(`${ML} ${titleY - 80} ${CW} 80 re f`);
    p.push(`${rgb(NAVY)} rg`);
    p.push(`${ML} ${titleY - 80} 4 80 re f`);

    p.push('BT'); p.push(`${rgb(NAVY)} rg`); p.push('/F2 20 Tf');
    p.push(`${ML + 18} ${titleY - 24} Td`);
    p.push(`(${esc('Mobile Application')}) Tj`); p.push('ET');

    p.push('BT'); p.push(`${rgb(NAVY)} rg`); p.push('/F2 14 Tf');
    p.push(`${ML + 18} ${titleY - 44} Td`);
    p.push(`(${esc('Module Progress Checklist')}) Tj`); p.push('ET');

    p.push('BT'); p.push(`${rgb(MGRAY)} rg`); p.push('/F1 9 Tf');
    p.push(`${ML + 18} ${titleY - 60} Td`);
    p.push(`(${esc('Assessment of implemented features and current system progress')}) Tj`); p.push('ET');

    p.push('BT'); p.push(`${rgb(MGRAY)} rg`); p.push('/F1 8 Tf');
    p.push(`${ML + 18} ${titleY - 74} Td`);
    p.push(`(${esc('April 10, 2026  |  Tenant-Facing Mobile App  |  React Native / Expo')}) Tj`); p.push('ET');

    y -= 96;

    // Legend
    y -= 12;
    p.push('BT'); p.push(`${rgb(NAVY)} rg`); p.push('/F2 9 Tf');
    p.push(`${ML} ${y} Td`); p.push(`(${esc('STATUS LEGEND')}) Tj`); p.push('ET');
    p.push(`${rgb(ORANGE)} rg`);
    p.push(`${ML} ${y - 2} ${CW} 1 re f`);
    y -= 14;

    const legendItems = [
      { color: GREEN,  symbol: '[DONE]',    label: 'Implemented — fully functional and tested' },
      { color: AMBER,  symbol: '[PARTIAL]', label: 'Partial — exists but has known limitations' },
      { color: RED,    symbol: '[PENDING]', label: 'Not yet implemented' },
    ];
    legendItems.forEach(li => {
      p.push('BT'); p.push(`${rgb(li.color)} rg`); p.push('/F2 9 Tf');
      p.push(`${ML + 8} ${y} Td`); p.push(`(${esc(li.symbol)}) Tj`); p.push('ET');
      p.push('BT'); p.push(`${rgb(DGRAY)} rg`); p.push('/F1 9 Tf');
      p.push(`${ML + 80} ${y} Td`); p.push(`(${esc(li.label)}) Tj`); p.push('ET');
      y -= 14;
    });
    y -= 8;

    // Summary counts
    let totalDone = 0, totalPartial = 0, totalPending = 0;
    MODULES.forEach(m => m.features.forEach(f => {
      if (f.status === 'done') totalDone++;
      else if (f.status === 'partial') totalPartial++;
      else totalPending++;
    }));
    const totalFeatures = totalDone + totalPartial + totalPending;
    const pct = Math.round((totalDone / totalFeatures) * 100);

    p.push(`${rgb(LIGHT)} rg`);
    p.push(`${ML} ${y - 48} ${CW} 48 re f`);
    p.push(`${rgb(LGRAY)} RG`); p.push('0.5 w');
    p.push(`${ML} ${y - 48} ${CW} 48 re S`);

    const col = CW / 4;
    [
      { label: 'Total Features', value: String(totalFeatures), color: NAVY },
      { label: 'Implemented',    value: String(totalDone),     color: GREEN },
      { label: 'Partial',        value: String(totalPartial),  color: AMBER },
      { label: 'Completion',     value: `${pct}%`,             color: ORANGE },
    ].forEach((stat, i) => {
      const sx = ML + i * col + col / 2;
      const vw = stat.value.length * 16 * 0.52;
      p.push('BT'); p.push(`${rgb(stat.color)} rg`); p.push('/F2 16 Tf');
      p.push(`${sx - vw / 2} ${y - 22} Td`); p.push(`(${esc(stat.value)}) Tj`); p.push('ET');
      const lw2 = stat.label.length * 8 * 0.52;
      p.push('BT'); p.push(`${rgb(MGRAY)} rg`); p.push('/F1 8 Tf');
      p.push(`${sx - lw2 / 2} ${y - 36} Td`); p.push(`(${esc(stat.label)}) Tj`); p.push('ET');
    });
    y -= 60;
  }

  // ── Module Section ──
  // NOTE: uses `page` from closure directly — `ensureSpace` can replace `page`
  // with a new array mid-draw, so we must NOT capture it as a parameter.
  function drawModule(mod) {
    // Count stats for this module
    const done    = mod.features.filter(f => f.status === 'done').length;
    const partial = mod.features.filter(f => f.status === 'partial').length;
    const none    = mod.features.filter(f => f.status === 'none').length;
    const total   = mod.features.length;
    const modPct  = Math.round((done / total) * 100);

    // Module heading bar (need space for bar + features)
    ensureSpace(38 + mod.features.length * 17 + 10);

    // Heading bar — use `page` (current page after any ensureSpace-triggered break)
    page.push(`${rgb(NAVY)} rg`);
    page.push(`${ML} ${y - 28} ${CW} 28 re f`);

    // Module number pill
    page.push(`${rgb(ORANGE)} rg`);
    page.push(`${ML + 6} ${y - 22} 22 16 re f`);
    page.push('BT'); page.push(`${rgb(WHITE)} rg`); page.push('/F2 8 Tf');
    const numW = mod.id.length * 8 * 0.52;
    page.push(`${ML + 6 + (22 - numW) / 2} ${y - 17} Td`);
    page.push(`(${esc(mod.id)}) Tj`); page.push('ET');

    // Module name
    page.push('BT'); page.push(`${rgb(WHITE)} rg`); page.push('/F2 10 Tf');
    page.push(`${ML + 36} ${y - 18} Td`);
    page.push(`(${esc(mod.name)}) Tj`); page.push('ET');

    // Role label (right-aligned in header)
    const roleLabel = `Role: ${mod.role}`;
    const rlw = roleLabel.length * 7 * 0.52;
    page.push('BT'); page.push('0.7 0.7 0.7 rg'); page.push('/F1 7 Tf');
    page.push(`${PAGE_W - MR - rlw} ${y - 10} Td`);
    page.push(`(${esc(roleLabel)}) Tj`); page.push('ET');

    // Stats (right side of header)
    const statsText = `${done}/${total} done  |  ${modPct}%`;
    const stw = statsText.length * 7 * 0.52;
    page.push('BT'); page.push(`${rgb(ORANGE)} rg`); page.push('/F1 7 Tf');
    page.push(`${PAGE_W - MR - stw} ${y - 20} Td`);
    page.push(`(${esc(statsText)}) Tj`); page.push('ET');

    y -= 28;

    // Feature rows
    mod.features.forEach((feat, idx) => {
      const rowH = 17;
      const isEven = idx % 2 === 0;

      if (isEven) {
        page.push(`${rgb(LIGHT)} rg`);
        page.push(`${ML} ${y - rowH} ${CW} ${rowH} re f`);
      }
      // Bottom separator
      page.push(`${rgb(LGRAY)} RG`); page.push('0.3 w');
      page.push(`${ML} ${y - rowH} m ${ML + CW} ${y - rowH} l S`);

      y -= 12;

      // Status pill
      const statusColor = feat.status === 'done' ? GREEN : feat.status === 'partial' ? AMBER : RED;
      const statusLabel = feat.status === 'done' ? 'DONE' : feat.status === 'partial' ? 'PARTIAL' : 'PENDING';
      const pillW = 44;
      page.push(`${rgb(statusColor)} rg`);
      page.push(`${ML + 8} ${y - 4} ${pillW} 13 re f`);
      const slw = statusLabel.length * 7 * 0.52;
      page.push('BT'); page.push(`${rgb(WHITE)} rg`); page.push('/F2 7 Tf');
      page.push(`${ML + 8 + (pillW - slw) / 2} ${y} Td`);
      page.push(`(${esc(statusLabel)}) Tj`); page.push('ET');

      // Feature text
      page.push('BT'); page.push(`${rgb(DGRAY)} rg`); page.push('/F1 9 Tf');
      page.push(`${ML + 60} ${y} Td`);
      page.push(`(${esc(feat.text)}) Tj`); page.push('ET');

      y -= 5;
    });
    y -= 12;
  }

  // ── Build pages ──────────────────────────────────────────────────────────
  newPage(true);
  drawCoverBlock(page);

  MODULES.forEach(mod => drawModule(mod));

  // Finalize last page
  pages.push(page.join('\n'));

  // ── Assemble PDF ─────────────────────────────────────────────────────────
  const totalPages = pages.length;
  const streams = pages.map((s, i) => {
    const p = [];
    drawFooter(p, i + 1, totalPages);
    return s + '\n' + p.join('\n');
  });

  const objects = [];
  let oid = 1;

  // Object helpers
  const obj = (id, dict, stream) => {
    let body = `${id} 0 obj\n${dict}`;
    if (stream !== undefined) {
      body += `\nstream\n${stream}\nendstream`;
    }
    body += '\nendobj';
    return body;
  };

  // Font resources
  const fontF1 = oid++;  // Helvetica
  const fontF2 = oid++;  // Helvetica-Bold
  objects.push(obj(fontF1, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
  objects.push(obj(fontF2, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'));

  const resources = `<< /Font << /F1 ${fontF1} 0 R /F2 ${fontF2} 0 R >> >>`;

  // Page content streams + page objects
  const pageOids = [];
  const contentOids = [];
  streams.forEach((s) => {
    const contentId = oid++;
    contentOids.push(contentId);
    objects.push(obj(contentId, `<< /Length ${s.length} >>`, s));
    const pageId = oid++;
    pageOids.push(pageId);
    objects.push(obj(pageId, `<< /Type /Page /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${resources} /Contents ${contentId} 0 R /Parent 999 0 R >>`));
  });

  // Page tree (placeholder id 999)
  const kidsStr = pageOids.map(id => `${id} 0 R`).join(' ');
  const pagesObj = obj(999, `<< /Type /Pages /Kids [${kidsStr}] /Count ${pageOids.length} >>`);

  // Catalog
  const catalogId = oid++;
  objects.push(obj(catalogId, `<< /Type /Catalog /Pages 999 0 R >>`));

  // Assemble body
  const header = '%PDF-1.4\n';
  let body = '';
  const offsets = {};

  // pages tree first (id 999)
  offsets[999] = header.length + body.length;
  body += pagesObj + '\n';

  objects.forEach(o => {
    const idMatch = o.match(/^(\d+) 0 obj/);
    if (idMatch) {
      offsets[parseInt(idMatch[1])] = header.length + body.length;
    }
    body += o + '\n';
  });

  const xrefStart = header.length + body.length;
  const allIds = [999, ...Object.keys(offsets).filter(k => k !== '999').map(Number)].sort((a, b) => a - b);
  const maxId = Math.max(...allIds);

  let xref = `xref\n0 ${maxId + 2}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxId + 1; i++) {
    const off = offsets[i];
    if (off !== undefined) {
      xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    } else {
      xref += `0000000000 65535 f \n`;
    }
  }

  const trailer = `trailer\n<< /Size ${maxId + 2} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(header + body + xref + trailer, 'latin1');
}

// ── Write File ───────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, 'LilyCrest_Mobile_Module_Checklist.pdf');
const pdfBuffer = buildPdf();
fs.writeFileSync(outPath, pdfBuffer);
console.log(`PDF generated: ${outPath}`);
console.log(`Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);
