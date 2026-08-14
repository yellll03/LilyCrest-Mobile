'use strict';

const fs = require('node:fs');
const path = require('node:path');

function ensureOutputDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function writeJson(filePath, value) {
  ensureOutputDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function csvCell(value) {
  const text = value === null || value === undefined
    ? ''
    : (typeof value === 'string' ? value : JSON.stringify(value));
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(filePath, records, fields) {
  ensureOutputDirectory(path.dirname(filePath));
  const lines = [
    fields.map(csvCell).join(','),
    ...records.map((record) => fields.map((field) => csvCell(record[field])).join(',')),
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function parseCliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

module.exports = { ensureOutputDirectory, writeJson, writeCsv, parseCliArgs };
