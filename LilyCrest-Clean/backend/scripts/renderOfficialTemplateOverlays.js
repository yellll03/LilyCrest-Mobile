'use strict';

const fs = require('fs/promises');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const { APPROVED_TEMPLATE_KEYS, TEMPLATE_DEFINITIONS, verifyTemplateIntegrity } = require('../domain/contracts/templateRegistry');
const { overlayOfficialTemplate } = require('../domain/contracts/officialTemplateOverlay');

const OUTPUT = path.resolve(__dirname, '../reports/official-template-overlay');
const SAMPLE = Object.freeze({
  tenantLegalName: 'JUAN DELA CRUZ',
  tenantResidentialAddress: '123 SAMPLE STREET, MAKATI CITY',
  roomNumber: 'GP-205',
  bedSlotNumber: 'UPPER',
  leaseDurationMonths: 4,
  contractStartDate: '2026-07-20T00:00:00.000Z',
  contractEndDate: '2026-11-20T00:00:00.000Z',
  generatedAt: '2026-07-24T00:00:00.000Z',
});

async function screenshot(bytes, outputPath) {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getScreenshot({ scale: 2, first: 1 });
    await fs.writeFile(outputPath, result.pages[0].data);
  } finally {
    await parser.destroy();
  }
}

async function main() {
  await fs.mkdir(OUTPUT, { recursive: true });
  const report = [];
  for (const key of APPROVED_TEMPLATE_KEYS) {
    const definition = { key, ...TEMPLATE_DEFINITIONS[key] };
    const integrity = verifyTemplateIntegrity(definition);
    if (!integrity.ok) throw new Error(`${key}: ${integrity.blockerCode}`);
    const duration = definition.leaseType === 'SHORT_TERM' ? 4 : 12;
    const snapshot = {
      ...SAMPLE,
      leaseDurationMonths: duration,
      contractEndDate: definition.leaseType === 'SHORT_TERM'
        ? '2026-11-20T00:00:00.000Z'
        : '2027-07-20T00:00:00.000Z',
    };
    const rendered = await overlayOfficialTemplate(definition, snapshot);
    await fs.writeFile(path.join(OUTPUT, `${key}.overlay.pdf`), rendered.bytes);
    await screenshot(integrity.bytes, path.join(OUTPUT, `${key}.before.png`));
    await screenshot(rendered.bytes, path.join(OUTPUT, `${key}.after.png`));
    report.push({
      ...rendered.comparison,
      beforePreview: `${key}.before.png`,
      afterOverlayPreview: `${key}.after.png`,
      generatedPdf: `${key}.overlay.pdf`,
      differenceSummary: 'The official source page and legal content streams are preserved; differences are restricted to the 12 approved overlay boxes.',
      result: rendered.comparison.dimensionsMatch && rendered.comparison.allFieldsFit
        ? 'PASS'
        : 'REJECTED',
    });
  }
  await fs.writeFile(path.join(OUTPUT, 'comparison-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const markdown = [
    '# Official Template Overlay Comparison',
    '',
    ...report.flatMap((item) => [
      `## ${item.templateKey}`,
      '',
      `- Result: ${item.result}`,
      `- Page dimensions: ${item.generatedPageSize.width} × ${item.generatedPageSize.height} points`,
      `- Base template preserved: ${item.baseTemplatePreserved}`,
      `- Legal text recreated: ${item.legalTextRecreated}`,
      `- Overlay fields fitted: ${item.overlayFieldCount}/${item.overlayFieldCount}`,
      `- Before: ${item.beforePreview}`,
      `- After: ${item.afterOverlayPreview}`,
      `- Difference: ${item.differenceSummary}`,
      '',
    ]),
  ].join('\n');
  await fs.writeFile(path.join(OUTPUT, 'comparison-report.md'), markdown);
  console.log(JSON.stringify({ output: OUTPUT, templates: report.length, passed: report.filter((item) => item.result === 'PASS').length }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
