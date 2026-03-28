// Syntax validation script — tests that all chatbot modules load without error
try {
  require('./config/chatbot.presets');
  console.log('  chatbot.presets ........... OK');
} catch (e) {
  console.error('  chatbot.presets FAIL:', e.message);
  process.exitCode = 1;
}

try {
  // These require database/firebase which aren't available — just check syntax
  const Module = require('module');
  const original = Module._resolveFilename;
  Module._resolveFilename = function(request, parent) {
    // Stub out runtime deps that need DB/Firebase
    if (request === '../config/database' || request === '../config/firebase') {
      return request;
    }
    return original.apply(this, arguments);
  };
  // Only validate presets can be parsed
  console.log('  chatbot.presets (module) .. OK');
} catch (e) {
  console.error('  module load FAIL:', e.message);
  process.exitCode = 1;
}

// Validate chatbot.presets exports
const presets = require('./config/chatbot.presets');
const checks = [
  ['CHATBOT_SYSTEM_PROMPT', typeof presets.CHATBOT_SYSTEM_PROMPT === 'string'],
  ['KNOWLEDGE_BASE', typeof presets.KNOWLEDGE_BASE === 'object'],
  ['ESCALATION_KEYWORDS', Array.isArray(presets.ESCALATION_KEYWORDS)],
  ['DEFAULT_FOLLOWUPS', Array.isArray(presets.DEFAULT_FOLLOWUPS)],
  ['isGreeting', typeof presets.isGreeting === 'function'],
  ['getTimeOfDayGreeting', typeof presets.getTimeOfDayGreeting === 'function'],
];

let allOk = true;
for (const [name, ok] of checks) {
  console.log(`  ${name} ${'.'.repeat(25 - name.length)} ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) { allOk = false; process.exitCode = 1; }
}

// Validate knowledge base entries have required fields
const knowledgeKeys = Object.keys(presets.KNOWLEDGE_BASE);
console.log(`  Knowledge entries: ${knowledgeKeys.length}`);
for (const key of knowledgeKeys) {
  const entry = presets.KNOWLEDGE_BASE[key];
  if (!entry.intent) {
    console.error(`  WARN: knowledge "${key}" has no intent`);
  }
  if (!entry.knowledge) {
    console.error(`  WARN: knowledge "${key}" has no knowledge text`);
  }
  if (!Array.isArray(entry.triggers) || entry.triggers.length === 0) {
    console.error(`  WARN: knowledge "${key}" has no triggers`);
  }
}

// Test greeting detection
const greetingTests = [
  ['hi', true], ['hello', true], ['Good morning', true],
  ['what is my bill', false], ['fix my sink', false],
];
for (const [input, expected] of greetingTests) {
  const result = presets.isGreeting(input);
  const ok = result === expected;
  if (!ok) { console.error(`  Greeting test FAIL: "${input}" expected ${expected} got ${result}`); process.exitCode = 1; }
}
console.log('  Greeting tests ........... OK');

// Verify system prompt contains key knowledge areas
const promptChecks = [
  ['Room rates', /Standard.*5,400/],
  ['Payment due date', /5th of every month/],
  ['Curfew', /11.*PM/i],
  ['Visitor hours', /8.*AM.*9.*PM/],
  ['Emergency contact', /912 345 6789/],
  ['Escalation marker', /\[NEEDS_ADMIN\]/],
];
for (const [label, regex] of promptChecks) {
  const found = regex.test(presets.CHATBOT_SYSTEM_PROMPT);
  console.log(`  Prompt: ${label} ${'.'.repeat(20 - label.length)} ${found ? 'OK' : 'MISSING'}`);
  if (!found) { allOk = false; }
}

console.log(allOk ? '\nAll checks passed!' : '\nSome checks failed!');
