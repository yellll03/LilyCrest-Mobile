/**
 * Quick test: verify SMTP email delivery works.
 * Run: node _test_email.js
 */
require('dotenv').config();

const { sendPasswordChangedEmail } = require('./services/emailService');

async function main() {
  console.log('SMTP config:');
  console.log('  HOST:', process.env.SMTP_HOST);
  console.log('  PORT:', process.env.SMTP_PORT);
  console.log('  USER:', process.env.SMTP_USER);
  console.log('  FROM:', process.env.SMTP_FROM);
  console.log('  PASS:', process.env.SMTP_PASS ? '***set***' : '*** MISSING ***');
  console.log();

  // Send a test email to the SMTP user themselves
  const testEmail = process.env.SMTP_USER;
  console.log(`Sending test email to: ${testEmail}...`);
  
  const result = await sendPasswordChangedEmail(testEmail, 'Test Tenant', '127.0.0.1');
  
  if (result) {
    console.log('✅ Email sent successfully! Check your inbox.');
  } else {
    console.log('❌ Email failed. Check the error messages above.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
