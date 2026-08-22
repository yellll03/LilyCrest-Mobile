'use strict';

// Small, focused text-retrieval helper for the AI assistant's "what does my
// contract say about X" capability. This is deliberately separate from
// officialLegalText.js: that module parses the blank OFFICIAL TEMPLATE (fixed
// structure, verified integrity, read from a local file) used to render
// generated contracts, whereas this module parses an individual tenant's own
// signed/generated document fetched over HTTP from the Capstone-Website
// bridge (routes/contracts.routes.js) — different content shape, no fixed
// section structure to rely on, and no filesystem access.
//
// No vector DB / embeddings — a simple paragraph-level keyword search is
// sufficient for a handful of well-known lease topics, and keeps this
// dependency-free and easy to verify.

const { PDFParse } = require('pdf-parse');

async function extractContractDocumentText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return '';
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return String(result?.text || '');
  } finally {
    await parser.destroy();
  }
}

// Maps a handful of common tenant-question topics to the keyword stems most
// likely to appear in the corresponding lease clause. Extend as needed; a
// message that doesn't match any topic still falls back to matching its own
// significant words directly against the document (see below).
const TOPIC_KEYWORDS = Object.freeze({
  visitor: ['visitor', 'guest'],
  termination: ['terminat', 'expir', 'notice to vacate', 'end of lease'],
  deposit: ['deposit', 'refund', 'security deposit'],
  curfew: ['curfew', 'gate', 'quiet hour', 'house rule'],
  payment: ['rent', 'payment', 'due date', 'penalty', 'late fee', 'grace period'],
  renewal: ['renew', 'extension'],
  utilities: ['electric', 'water', 'utilit'],
  pets: ['pet', 'animal'],
  damage: ['damage', 'repair', 'liable', 'liability'],
  entry: ['right of entry', 'inspection', 'access the'],
});

const STOP_WORDS = new Set([
  'the', 'my', 'is', 'are', 'does', 'do', 'what', 'when', 'how', 'about', 'contract', 'lease',
  'say', 'says', 'said', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'i', 'me', 'can',
  'will', 'be', 'it', 'this', 'that', 'if', 'am', 'was', 'were', 'have', 'has',
]);

function messageKeywords(message) {
  return String(message || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
}

function keywordsForMessage(message) {
  const lower = String(message || '').toLowerCase();
  const matchedTopics = Object.values(TOPIC_KEYWORDS).filter((stems) =>
    stems.some((stem) => lower.includes(stem)));
  if (matchedTopics.length) return matchedTopics.flat();
  return messageKeywords(message);
}

function splitIntoParagraphs(fullText) {
  return String(fullText || '')
    .split(/\n{2,}|(?<=\.)\n(?=[A-Z0-9])/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 20);
}

function scoreParagraph(paragraph, keywords) {
  const lower = paragraph.toLowerCase();
  return keywords.reduce((score, keyword) => (lower.includes(keyword) ? score + 1 : score), 0);
}

// Returns up to maxExcerpts short paragraph excerpts (never the whole
// document) that best match the tenant's question, or [] if nothing in the
// document appears relevant — callers must treat an empty result as "clause
// not found," never fabricate an answer.
function findRelevantContractExcerpts(fullText, userMessage, { maxExcerpts = 2, maxCharsPerExcerpt = 700 } = {}) {
  const keywords = keywordsForMessage(userMessage);
  if (!keywords.length) return [];

  const paragraphs = splitIntoParagraphs(fullText);
  const scored = paragraphs
    .map((paragraph) => ({ paragraph, score: scoreParagraph(paragraph, keywords) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scored.slice(0, maxExcerpts).map((entry) =>
    (entry.paragraph.length > maxCharsPerExcerpt
      ? `${entry.paragraph.slice(0, maxCharsPerExcerpt)}…`
      : entry.paragraph));
}

module.exports = {
  extractContractDocumentText,
  findRelevantContractExcerpts,
  TOPIC_KEYWORDS,
};
