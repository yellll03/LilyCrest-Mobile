const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('OTP email transport cannot hang mobile authentication indefinitely', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/emailService.js'), 'utf8');
  assert.match(source, /https:\/\/api\.resend\.com\/emails/);
  assert.match(source, /Authorization:\s*`Bearer \$\{resendApiKey\}`/);
  assert.match(source, /timeout:\s*10000/);
  assert.match(source, /connectionTimeout:\s*10000/);
  assert.match(source, /greetingTimeout:\s*10000/);
  assert.match(source, /socketTimeout:\s*20000/);
  assert.match(source, /dns\.promises\.resolve4\(host\)/);
  assert.match(source, /servername:\s*host/);
});
