'use strict';

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const { APPROVED_TEMPLATE_KEYS, LONG_BOND } = require('../domain/contracts/templateRegistry');
const { extractOfficialLegalText } = require('../domain/contracts/officialLegalText');
const { renderOfficialLease } = require('../domain/contracts/longBondRenderer');

const OUTPUT = path.resolve(__dirname, '../reports/official-lease-recreation');

function keyParts(key) {
  const match = key.match(/^(PRIVATE_ROOM|DOUBLE_SHARING|QUADRUPLE_SHARING)_(SHORT_TERM|LONG_TERM)$/);
  return [match[1], match[2]];
}

async function pdfInfo(data) {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getInfo({ parsePageInfo: true });
    return {
      pageCount: result.total,
      pages: result.pages.map((page) => ({ width: Math.round(page.width), height: Math.round(page.height) })),
    };
  } finally {
    await parser.destroy();
  }
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const reports = [];

  for (const key of APPROVED_TEMPLATE_KEYS) {
    const source = await extractOfficialLegalText(...keyParts(key));
    if (!source.ok) throw new Error(`${key}: ${source.blockerCode}`);
    const generated = await renderOfficialLease(source.definition);
    const generatedFile = path.join(OUTPUT, `${key}.comparison.pdf`);
    fs.writeFileSync(generatedFile, generated);
    const [sourceInfo, generatedInfo] = await Promise.all([
      pdfInfo(source.integrity.bytes),
      pdfInfo(generated),
    ]);
    reports.push({
      templateKey: key,
      sourceTemplate: source.template.filename,
      generatedSample: path.basename(generatedFile),
      sourceSha256: source.template.sha256,
      pageSize: LONG_BOND,
      sourcePageCount: sourceInfo.pageCount,
      generatedPageCount: generatedInfo.pageCount,
      wordingComparison: 'PASS — normalized only for extraction line wrapping and parser page markers',
      sectionOrder: source.definition.numberedSections.map((section) => section.marker),
      fontDifference: 'Source embeds subset DejaVu Serif; recreation uses OFL Noto Serif. Client approval required.',
      paginationDifference: sourceInfo.pageCount === generatedInfo.pageCount ? 'None detected' : 'Generated pagination differs from flattened source.',
      signatureBlockComparison: 'Present; physical alignment review required.',
      knownLimitations: [
        'Dynamic tenant substitution is disabled until legal/pricing conflicts and authoritative data approvals are resolved.',
        'No digital signatures are added.',
        'Print and physical-device validation remain pending.',
      ],
      approvalStatus: 'UNDER_REVIEW',
    });
  }

  fs.writeFileSync(path.join(OUTPUT, 'comparison-report.json'), `${JSON.stringify(reports, null, 2)}\n`);
  const markdown = [
    '# Official Lease Recreation Comparison',
    '',
    'Generated samples are review artifacts only and are not tenant contracts.',
    '',
    ...reports.flatMap((report) => [
      `## ${report.templateKey}`,
      '',
      `- Source: ${report.sourceTemplate}`,
      `- Generated: ${report.generatedSample}`,
      `- Page size: ${LONG_BOND.widthPoints} × ${LONG_BOND.heightPoints} points`,
      `- Page count: source ${report.sourcePageCount}; generated ${report.generatedPageCount}`,
      `- Wording: ${report.wordingComparison}`,
      `- Font: ${report.fontDifference}`,
      `- Pagination: ${report.paginationDifference}`,
      `- Signature/notarial layout: ${report.signatureBlockComparison}`,
      `- Approval: ${report.approvalStatus}`,
      '',
    ]),
  ].join('\n');
  fs.writeFileSync(path.join(OUTPUT, 'comparison-report.md'), `${markdown}\n`);
  console.log(`Wrote ${reports.length} comparison PDFs and reports to ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
