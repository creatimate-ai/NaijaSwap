/**
 * Test & Verification script for Brevo Connection
 * Usage: node test-brevo.js
 */

const { brevoService } = require('./services/brevo-service');

async function main() {
  console.log('======================================================');
  console.log('🚀 Checking Brevo Connection for NigerSwap...');
  console.log('======================================================\n');

  if (!brevoService.isConfigured()) {
    console.log('❌ BREVO_API_KEY is not set in your .env file.');
    console.log('\nTo set it up:');
    console.log('1. Log into your Brevo account (brevo.com).');
    console.log('2. Click your account name at top right -> SMTP & API -> API Keys.');
    console.log('3. Generate a new key and add it to your .env file:');
    console.log('   BREVO_API_KEY=xkeysib-xxxxxxxxxxxxxxxxxxxx\n');
    process.exit(1);
  }

  console.log('🔑 API Key detected. Testing Brevo API v3 connection...');
  const res = await brevoService.testConnection();

  if (res.connected) {
    console.log('\n✅ Brevo connection successful!');
    console.log(`- Account Email:   ${res.email}`);
    console.log(`- Company Name:    ${res.companyName || 'Not specified'}`);
    console.log(`- Active Senders:  ${res.senders.length > 0 ? res.senders.map(s => s.email).join(', ') : 'No senders found'}`);
    console.log('\nYou can now operate in Brevo directly through code!');
  } else {
    console.log('\n❌ Connection failed:');
    console.log(res.error);
    if (res.details) {
      console.log('Details:', JSON.stringify(res.details, null, 2));
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
});
