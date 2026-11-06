/**
 * NigerSwap - Brevo Setup & Template Synchronizer
 * Automatically configures Brevo lists and uploads branded NigerSwap templates.
 * Run with: node services/brevo-setup.js
 */

const { brevoService } = require('./brevo-service');
const templates = require('./email-templates');

async function setupBrevo() {
  console.log('======================================================');
  console.log('📦 Setting up NigerSwap in Brevo...');
  console.log('======================================================\n');

  // 1. Verify Connection
  console.log('1. Checking connection...');
  const conn = await brevoService.testConnection();
  if (!conn.connected) {
    console.error('❌ Cannot connect to Brevo:', conn.error);
    process.exit(1);
  }
  console.log(`✅ Connected as ${conn.email} (${conn.companyName || 'NigerSwap'})\n`);

  // Sender email to use
  let senderEmail = process.env.BREVO_SENDER_EMAIL;
  if (!senderEmail || senderEmail.includes('example.com') || senderEmail.includes('naijaswap.ng')) {
    if (conn.senders && conn.senders.length > 0) {
      senderEmail = conn.senders[0].email;
      console.log(`ℹ️ Using verified Brevo sender: ${senderEmail}`);
    } else {
      senderEmail = conn.email;
      console.log(`ℹ️ Using account email as sender: ${senderEmail}`);
    }
  }

  const sender = {
    name: 'NigerSwap',
    email: senderEmail
  };

  // 2. Setup Contact Lists
  console.log('2. Configuring Contact Lists / Audiences...');
  let existingLists = [];
  try {
    const listRes = await brevoService.getContactLists();
    existingLists = listRes.lists || [];
    console.log(`Found ${existingLists.length} existing contact list(s) in Brevo.`);
  } catch (err) {
    console.warn('Note retrieving lists:', err.message);
  }

  const targetLists = [
    'NigerSwap - Swappers',
    'NigerSwap - Verified Dealers',
    'NigerSwap - New Inventory Alerts'
  ];

  const listMap = {};
  for (const listName of targetLists) {
    const found = existingLists.find(l => l.name.toLowerCase() === listName.toLowerCase());
    if (found) {
      listMap[listName] = found.id;
      console.log(`  ✓ List "${listName}" already exists (ID: ${found.id})`);
    } else {
      try {
        const created = await brevoService.createContactList(listName);
        listMap[listName] = created.id;
        console.log(`  + Created list "${listName}" (ID: ${created.id})`);
      } catch (e) {
        console.warn(`  ! Could not create list "${listName}":`, e.message);
      }
    }
  }

  // 3. Upload & Synchronize Email Templates into Brevo
  console.log('\n3. Uploading NigerSwap Branded Templates to Brevo...');
  const templatesToSync = [
    {
      templateName: 'NigerSwap - Email Verification Code',
      subject: 'Your 6-digit NigerSwap verification code: {{params.CODE}}',
      htmlContent: templates.templateVerifyEmail({
        code: '{{params.CODE}}',
        firstName: '{{params.FIRSTNAME}}',
        email: '{{params.EMAIL}}'
      }).html
    },
    {
      templateName: 'NigerSwap - Welcome to NigerSwap',
      subject: 'Welcome to NigerSwap - Swap Phones Safely in Nigeria!',
      htmlContent: templates.templateWelcome({
        firstName: '{{params.FIRSTNAME}}',
        role: 'customer'
      }).html
    },
    {
      templateName: 'NigerSwap - New Login Security Alert',
      subject: 'Security Alert: New login detected on your NigerSwap account',
      htmlContent: templates.templateNewLoginAlert({
        firstName: '{{params.FIRSTNAME}}',
        ipAddress: '{{params.IP_ADDRESS}}',
        userAgent: '{{params.USER_AGENT}}',
        location: '{{params.LOCATION}}',
        timestamp: '{{params.TIMESTAMP}}'
      }).html
    },
    {
      templateName: 'NigerSwap - New Inventory Drop Alert',
      subject: '🔥 New Verified Phones Just Added on NigerSwap!',
      htmlContent: templates.templateListingPublished({
        dealerName: '{{params.DEALER_NAME}}',
        phoneTitle: '{{params.PHONE_TITLE}}',
        listingId: '{{params.LISTING_ID}}',
        listingUrl: `${process.env.APP_BASE_URL || 'https://naijaswap.web.app'}/store.html`
      }).html
    }
  ];

  let existingTemplates = [];
  try {
    const tplRes = await brevoService.getTemplates();
    existingTemplates = tplRes.templates || [];
  } catch (_) {}

  for (const tpl of templatesToSync) {
    const existing = existingTemplates.find(t => t.name === tpl.templateName);
    if (existing) {
      try {
        await brevoService.updateTemplate(existing.id, {
          templateName: tpl.templateName,
          subject: tpl.subject,
          htmlContent: tpl.htmlContent,
          isActive: true
        });
        console.log(`  ✓ Updated template: "${tpl.templateName}" (ID: ${existing.id})`);
      } catch (err) {
        console.warn(`  ! Could not update template "${tpl.templateName}":`, err.message);
      }
    } else {
      try {
        const created = await brevoService.createTemplate({
          templateName: tpl.templateName,
          subject: tpl.subject,
          htmlContent: tpl.htmlContent,
          sender,
          isActive: true
        });
        console.log(`  + Created template: "${tpl.templateName}" (ID: ${created.id})`);
      } catch (err) {
        console.warn(`  ! Could not create template "${tpl.templateName}":`, err.message);
      }
    }
  }

  console.log('\n======================================================');
  console.log('🎉 Brevo setup complete! NigerSwap is ready.');
  console.log('======================================================');
}

if (require.main === module) {
  setupBrevo().catch(err => {
    console.error('Brevo setup error:', err.message);
  });
}

module.exports = { setupBrevo };
