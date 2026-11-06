/**
 * NaijaSwap - Central Email Template Engine
 * Generates mobile-responsive, brand-compliant HTML & plain-text emails.
 * Brand palette: Primary Emerald (#10B981 / #00D26A), Dark Onyx (#080C0E / #0F172A), Slate Muted (#94A3B8).
 */

const APP_NAME = 'NaijaSwap';
const DEFAULT_BASE_URL = process.env.APP_BASE_URL || 'https://naijaswap.web.app';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@naijaswap.ng';

function renderBaseLayout({ title, previewText, contentHtml, footerHtml, isMarketing = false, unsubscribeUrl = '' }) {
  const currentYear = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    /* Reset & Base */
    body, p, h1, h2, h3, h4, table, td { margin: 0; padding: 0; }
    body {
      background-color: #080C0E;
      color: #E2E8F0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      -ms-text-size-adjust: 100%;
      -webkit-text-size-adjust: 100%;
    }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    table { border-collapse: collapse !important; }
    a { color: #10B981; text-decoration: none; }
    a:hover { text-decoration: underline; }
    
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; padding: 12px !important; }
      .email-card { padding: 24px 18px !important; }
      .code-display { font-size: 28px !important; letter-spacing: 6px !important; }
      .cta-button { display: block !important; width: 100% !important; text-align: center !important; }
    }
  </style>
</head>
<body style="background-color: #080C0E; margin: 0; padding: 24px 0;">
  <!-- Preview Text Hack -->
  <div style="display: none; max-height: 0px; overflow: hidden; opacity: 0; font-size: 1px; line-height: 1px; color: #080C0E;">
    ${escapeHtml(previewText || title)}
    &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #080C0E;">
    <tr>
      <td align="center" style="padding: 12px;">
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
          
          <!-- BRAND HEADER -->
          <tr>
            <td align="center" style="padding: 16px 0 24px 0;">
              <a href="${DEFAULT_BASE_URL}" style="text-decoration: none; display: inline-block;">
                <img src="${DEFAULT_BASE_URL}/assets/naijaswap-logo.png" alt="NaijaSwap" width="180" style="display: block; width: 180px; max-width: 100%; height: auto; border: 0; outline: none; text-decoration: none; margin: 0 auto;" />
              </a>
            </td>
          </tr>

          <!-- MAIN EMAIL CARD -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-card" style="background-color: #0F172A; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 18px; padding: 36px 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.35);">
                <tr>
                  <td>
                    ${contentHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BRAND FOOTER -->
          <tr>
            <td style="padding: 28px 16px 12px 16px; text-align: center; font-size: 12px; color: #64748B; line-height: 1.8;">
              <p style="margin-bottom: 8px;">
                NaijaSwap — Nigeria's Premier Phone Swapping & Verified Dealer Marketplace
              </p>
              ${footerHtml || ''}
              ${isMarketing && unsubscribeUrl ? `
                <p style="margin-top: 14px; font-size: 11px; color: #475569;">
                  You received this email because you opted in to NaijaSwap updates. 
                  <a href="${unsubscribeUrl}" style="color: #94A3B8; text-decoration: underline;">Unsubscribe immediately</a> or 
                  <a href="${DEFAULT_BASE_URL}/settings.html" style="color: #94A3B8; text-decoration: underline;">manage preferences</a>.
                </p>
              ` : `
                <p style="margin-top: 12px; font-size: 11px; color: #475569;">
                  This is an important transactional notification regarding your NaijaSwap account.
                </p>
              `}
              <p style="margin-top: 12px; font-size: 11px; color: #475569;">
                &copy; ${currentYear} NaijaSwap Nigeria. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buttonHtml({ text, url, color = '#10B981' }) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0 20px 0;">
      <tr>
        <td align="center" style="border-radius: 9999px; background-color: ${color};">
          <a href="${url}" class="cta-button" target="_blank" style="font-size: 15px; font-weight: 700; color: #080C0E; text-decoration: none; padding: 14px 32px; border-radius: 9999px; display: inline-block; background-color: ${color}; letter-spacing: 0.2px;">
            ${escapeHtml(text)}
          </a>
        </td>
      </tr>
    </table>
  `;
}

// -------------------------------------------------------------
// TEMPLATES
// -------------------------------------------------------------

/**
 * 1. Email Verification Code Template
 */
function templateVerifyEmail({ code, firstName, email }) {
  const safeName = firstName ? escapeHtml(firstName) : 'there';
  const title = 'Verify your NaijaSwap account';
  const previewText = `Your NaijaSwap 6-digit verification code is ${code}. Valid for 10 minutes.`;

  const contentHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="display: inline-block; width: 52px; height: 52px; line-height: 52px; border-radius: 50%; background: rgba(16, 185, 129, 0.15); font-size: 26px;">
        ✉️
      </span>
    </div>
    <h1 style="color: #FFFFFF; font-size: 24px; font-weight: 800; margin-bottom: 14px; text-align: center; letter-spacing: -0.5px;">
      Verify your NaijaSwap account
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px; text-align: center;">
      Welcome to NaijaSwap, ${safeName}!<br>
      We're excited to have you here. To complete your registration and secure your account, enter the verification code below:
    </p>

    <!-- 6-DIGIT CODE DISPLAY -->
    <div style="margin: 28px 0; text-align: center;">
      <div style="display: inline-block; background: #080C0E; border: 2px solid #10B981; border-radius: 14px; padding: 18px 32px; box-shadow: 0 0 24px rgba(16, 185, 129, 0.25);">
        <span class="code-display" style="font-family: 'JetBrains Mono', Consolas, Monaco, monospace; font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #10B981;">
          ${escapeHtml(code)}
        </span>
      </div>
    </div>

    <div style="background: rgba(245, 158, 11, 0.1); border-left: 3px solid #F59E0B; border-radius: 6px; padding: 12px 16px; margin: 24px 0 16px 0;">
      <p style="color: #FCD34D; font-size: 13px; margin: 0; line-height: 1.5;">
        ⏳ <strong>This code expires in 10 minutes.</strong> For your security, never share this verification code with anyone.
      </p>
    </div>

    <p style="color: #64748B; font-size: 13px; line-height: 1.5; margin-top: 24px; text-align: center;">
      If you didn't create a NaijaSwap account, you can safely ignore this email.
    </p>
  `;

  const text = `Welcome to NaijaSwap!

We're excited to have you here.

To complete your registration, enter the verification code below:

${code}

This code expires in 10 minutes.

If you didn't create a NaijaSwap account, you can safely ignore this email.`;

  return {
    subject: title,
    html: renderBaseLayout({ title, previewText, contentHtml }),
    text
  };
}

/**
 * 2. Welcome Email (Personalized Swapper vs Dealer)
 */
function templateWelcome({ firstName, role = 'customer', shopName = '' }) {
  const isDealer = role === 'dealer';
  const safeName = firstName || (isDealer && shopName ? shopName : 'there');
  const subject = 'Welcome to NaijaSwap! Your next swap starts here.';
  const previewText = 'Your NaijaSwap account is verified and ready. Start exploring swaps today.';

  const dealerSpecificHtml = `
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.7; margin-bottom: 16px;">
      As a <strong>Verified Phone Dealer</strong>, you can showcase your gadget inventory to thousands of active phone swappers looking to upgrade their devices with legitimate stores.
    </p>
    <div style="background: #080C0E; border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid rgba(255,255,255,0.06);">
      <h3 style="color: #FFFFFF; font-size: 15px; margin-bottom: 10px;">🏪 Next steps for your store:</h3>
      <ul style="color: #94A3B8; font-size: 14px; padding-left: 20px; line-height: 1.8;">
        <li>Complete your dealer profile and physical hub location</li>
        <li>Upload your first phone inventory listings (Starter gives 5 free active listings)</li>
        <li>Receive direct swap requests with cash top-up proposals</li>
      </ul>
    </div>
    ${buttonHtml({ text: 'Open Dealer Dashboard', url: `${DEFAULT_BASE_URL}/dealer-dashboard.html` })}
  `;

  const swapperSpecificHtml = `
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.7; margin-bottom: 16px;">
      NaijaSwap makes upgrading your smartphone simple, transparent, and secure. Browse available phones from verified dealers, propose a swap, agree on cash top-ups, and verify devices safely.
    </p>
    <div style="background: #080C0E; border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid rgba(255,255,255,0.06);">
      <h3 style="color: #FFFFFF; font-size: 15px; margin-bottom: 10px;">🚀 Ready to make your first swap?</h3>
      <ul style="color: #94A3B8; font-size: 14px; padding-left: 20px; line-height: 1.8;">
        <li>Complete your profile in account settings</li>
        <li>Browse verified iPhones, Samsungs, and Android flagships</li>
        <li>Submit a swap request with your current device</li>
      </ul>
    </div>
    ${buttonHtml({ text: 'Explore Available Phones', url: `${DEFAULT_BASE_URL}/index.html` })}
  `;

  const contentHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="display: inline-block; width: 56px; height: 56px; line-height: 56px; border-radius: 50%; background: rgba(0, 210, 106, 0.15); font-size: 28px;">
        🎉
      </span>
    </div>
    <h1 style="color: #FFFFFF; font-size: 24px; font-weight: 800; margin-bottom: 14px; text-align: center; letter-spacing: -0.5px;">
      Welcome to NaijaSwap, ${escapeHtml(safeName)}!
    </h1>
    <p style="color: #CBD5E1; font-size: 16px; line-height: 1.6; margin-bottom: 20px; text-align: center;">
      Your email is verified and your account is now fully active.
    </p>

    ${isDealer ? dealerSpecificHtml : swapperSpecificHtml}

    <p style="color: #64748B; font-size: 13px; line-height: 1.6; margin-top: 24px; text-align: center;">
      Need any assistance? Our support team is here to help at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
    </p>
  `;

  const text = `Welcome to NaijaSwap, ${safeName}!

Your email is verified and your account is now fully active.

NaijaSwap connects people who want to swap phones with verified phone dealers across Nigeria.

Next steps:
- Log in to your account
- Explore available phones or list your device
- Complete your profile

Explore NaijaSwap now: ${DEFAULT_BASE_URL}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 3. Password Reset Request
 */
function templatePasswordReset({ resetLink, firstName, expiryMinutes = 60 }) {
  const safeName = firstName ? escapeHtml(firstName) : 'there';
  const subject = 'Reset your NaijaSwap password';
  const previewText = `Use this secure link to reset your password. Link expires in ${expiryMinutes} minutes.`;

  const contentHtml = `
    <div style="text-align: center; margin-bottom: 20px;">
      <span style="display: inline-block; width: 50px; height: 50px; line-height: 50px; border-radius: 50%; background: rgba(239, 68, 68, 0.15); font-size: 24px;">
        🔒
      </span>
    </div>
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px; text-align: center;">
      Reset your password
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${safeName},<br>
      We received a request to reset the password for your NaijaSwap account. Click the button below to choose a new password:
    </p>

    ${buttonHtml({ text: 'Reset Password', url: resetLink, color: '#10B981' })}

    <div style="background: rgba(255,255,255,0.04); border-radius: 8px; padding: 12px 16px; margin: 20px 0; font-size: 13px; color: #94A3B8;">
      ⏳ This single-use link will expire in <strong>${expiryMinutes} minutes</strong>.
    </div>

    <p style="color: #64748B; font-size: 13px; line-height: 1.5; margin-top: 24px;">
      If you did not request a password reset, please ignore this email or review your account security if you suspect unauthorized activity.
    </p>
  `;

  const text = `Reset your NaijaSwap password

Hi ${firstName || 'there'},

We received a request to reset your NaijaSwap account password.
Click the link below to set a new password:

${resetLink}

This link expires in ${expiryMinutes} minutes.

If you didn't request this, you can safely ignore this email.`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 4. Password Successfully Changed Alert
 */
function templatePasswordChanged({ firstName, timestamp, ipAddress, userAgent }) {
  const subject = 'Your NaijaSwap password was changed';
  const previewText = 'Your account password was successfully updated.';

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Password successfully updated
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${firstName ? escapeHtml(firstName) : 'there'},<br>
      The password for your NaijaSwap account was successfully changed on <strong>${escapeHtml(timestamp || new Date().toUTCString())}</strong>.
    </p>

    ${ipAddress ? `
      <div style="background: #080C0E; border-radius: 8px; padding: 14px; margin: 18px 0; font-size: 13px; color: #94A3B8;">
        <strong>Details:</strong><br>
        IP Address: ${escapeHtml(ipAddress)}<br>
        ${userAgent ? `Device: ${escapeHtml(userAgent)}` : ''}
      </div>
    ` : ''}

    <div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid #EF4444; border-radius: 6px; padding: 12px 16px; margin: 20px 0;">
      <p style="color: #FCA5A5; font-size: 13px; margin: 0; line-height: 1.5;">
        ⚠️ If you did NOT initiate this change, your account may be compromised. 
        Please contact our support team immediately at <a href="mailto:${SUPPORT_EMAIL}" style="color: #FFFFFF; text-decoration: underline;">${SUPPORT_EMAIL}</a>.
      </p>
    </div>
  `;

  const text = `Your NaijaSwap password was changed on ${timestamp || new Date().toUTCString()}.
If you did not make this change, contact support immediately at ${SUPPORT_EMAIL}.`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 5. Email Address Change Verification
 */
function templateEmailChangeVerification({ newEmail, code, firstName, verifyLink }) {
  const subject = 'Confirm your new NaijaSwap email address';
  const previewText = `Verification code for changing your email address: ${code}`;

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Confirm your new email address
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${firstName ? escapeHtml(firstName) : 'there'},<br>
      You requested to update your NaijaSwap account email to <strong>${escapeHtml(newEmail)}</strong>.
    </p>

    <div style="margin: 24px 0; text-align: center;">
      <div style="display: inline-block; background: #080C0E; border: 2px solid #10B981; border-radius: 14px; padding: 16px 28px;">
        <span class="code-display" style="font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #10B981;">
          ${escapeHtml(code)}
        </span>
      </div>
    </div>

    <p style="color: #94A3B8; font-size: 13px; text-align: center;">
      This code expires in 10 minutes. If you did not request this change, do not share this code and secure your account immediately.
    </p>
  `;

  const text = `Confirm your new NaijaSwap email address

Code: ${code}
Expires in 10 minutes. If you did not request this, please secure your account.`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 6. Email Address Changed Confirmation
 */
function templateEmailChanged({ oldEmail, newEmail, firstName }) {
  const subject = 'Your NaijaSwap email address was updated';
  const previewText = `Your account email was successfully changed to ${newEmail}.`;

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Email address updated
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${firstName ? escapeHtml(firstName) : 'there'},<br>
      Your NaijaSwap email address was successfully updated from <strong>${escapeHtml(oldEmail)}</strong> to <strong>${escapeHtml(newEmail)}</strong>.
    </p>
    <p style="color: #94A3B8; font-size: 13px; line-height: 1.5;">
      If you did not authorize this modification, please contact support right away at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
    </p>
  `;

  const text = `Your NaijaSwap email was updated to ${newEmail}. If you did not make this change, contact support immediately.`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 7. Unrecognised / New Login Alert
 */
function templateNewLoginAlert({ firstName, ipAddress, userAgent, location, timestamp }) {
  const subject = 'Security Alert: New sign-in to your NaijaSwap account';
  const previewText = 'We noticed a login from an unfamiliar device or location.';

  const contentHtml = `
    <div style="text-align: center; margin-bottom: 20px;">
      <span style="display: inline-block; width: 50px; height: 50px; line-height: 50px; border-radius: 50%; background: rgba(245, 158, 11, 0.15); font-size: 24px;">
        ⚠️
      </span>
    </div>
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px; text-align: center;">
      New login detected
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${firstName ? escapeHtml(firstName) : 'there'},<br>
      Your NaijaSwap account was just accessed from a new device or location:
    </p>

    <div style="background: #080C0E; border-radius: 12px; padding: 18px; margin: 20px 0; border: 1px solid rgba(255,255,255,0.06);">
      <p style="color: #E2E8F0; font-size: 14px; margin: 4px 0;"><strong>Date & Time:</strong> ${escapeHtml(timestamp || new Date().toUTCString())}</p>
      ${ipAddress ? `<p style="color: #E2E8F0; font-size: 14px; margin: 4px 0;"><strong>IP Address:</strong> ${escapeHtml(ipAddress)}</p>` : ''}
      ${location ? `<p style="color: #E2E8F0; font-size: 14px; margin: 4px 0;"><strong>Approximate Location:</strong> ${escapeHtml(location)}</p>` : ''}
      ${userAgent ? `<p style="color: #E2E8F0; font-size: 14px; margin: 4px 0;"><strong>Browser / Device:</strong> ${escapeHtml(userAgent)}</p>` : ''}
    </div>

    <p style="color: #94A3B8; font-size: 14px; line-height: 1.5; margin-bottom: 14px;">
      If this was you, you can safely disregard this alert. If you do not recognize this activity, please reset your password immediately.
    </p>

    ${buttonHtml({ text: 'Review Security Settings', url: `${DEFAULT_BASE_URL}/settings.html`, color: '#F59E0B' })}
  `;

  const text = `Security Alert: New sign-in to your NaijaSwap account.
Time: ${timestamp || new Date().toUTCString()}
IP: ${ipAddress || 'Unknown'}
Device: ${userAgent || 'Unknown'}

If this was not you, change your password immediately: ${DEFAULT_BASE_URL}/settings.html`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 8. Suspicious Activity Alert
 */
function templateSuspiciousActivityAlert({ firstName, reason, actionUrl }) {
  const subject = 'Urgent: Suspicious activity on your NaijaSwap account';
  const previewText = 'We noticed unusual security events related to your account.';

  const contentHtml = `
    <h1 style="color: #EF4444; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Suspicious activity alert
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${firstName ? escapeHtml(firstName) : 'there'},<br>
      Our automated security systems detected unusual activity on your account:
    </p>

    <div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid #EF4444; border-radius: 6px; padding: 14px 18px; margin: 20px 0;">
      <p style="color: #FCA5A5; font-size: 14px; margin: 0; line-height: 1.5;">
        ${escapeHtml(reason || 'Repeated failed verification or access attempts detected.')}
      </p>
    </div>

    <p style="color: #94A3B8; font-size: 14px; line-height: 1.5;">
      We recommend updating your password and reviewing your account activity.
    </p>

    ${buttonHtml({ text: 'Secure Account Now', url: actionUrl || `${DEFAULT_BASE_URL}/settings.html`, color: '#EF4444' })}
  `;

  const text = `Suspicious activity alert for NaijaSwap:
${reason}
Secure your account: ${actionUrl || `${DEFAULT_BASE_URL}/settings.html`}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 9. Listing Published Successfully
 */
function templateListingPublished({ dealerName, phoneTitle, listingId, listingUrl }) {
  const subject = 'Your phone listing is now live on NaijaSwap!';
  const previewText = `Your listing for ${phoneTitle} is published and active.`;
  const url = listingUrl || `${DEFAULT_BASE_URL}/phone-details.html?id=${listingId || ''}`;

  const contentHtml = `
    <div style="text-align: center; margin-bottom: 20px;">
      <span style="display: inline-block; width: 50px; height: 50px; line-height: 50px; border-radius: 50%; background: rgba(16, 185, 129, 0.15); font-size: 24px;">
        🚀
      </span>
    </div>
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px; text-align: center;">
      Your listing is now live!
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 20px; text-align: center;">
      Great news, ${escapeHtml(dealerName || 'Dealer')}! Your phone listing has been published and is now visible to active swappers across Nigeria.
    </p>

    <div style="background: #080C0E; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
      <p style="color: #94A3B8; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Published Device</p>
      <h2 style="color: #10B981; font-size: 20px; font-weight: 800; margin: 0;">
        ${escapeHtml(phoneTitle)}
      </h2>
    </div>

    ${buttonHtml({ text: 'View Live Listing', url })}

    <p style="color: #94A3B8; font-size: 13px; text-align: center; line-height: 1.5; margin-top: 18px;">
      💡 Tip: Share your listing link with customers on WhatsApp and social media to speed up swap inquiries!
    </p>
  `;

  const text = `Your phone listing is now live on NaijaSwap!
Device: ${phoneTitle}
View your listing: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 10. Listing Needs Attention
 */
function templateListingNeedsAttention({ dealerName, phoneTitle, reason, editUrl }) {
  const subject = 'Your NaijaSwap listing needs attention';
  const previewText = `Action required on your listing: ${phoneTitle}`;
  const url = editUrl || `${DEFAULT_BASE_URL}/dealer-listings.html`;

  const contentHtml = `
    <h1 style="color: #F59E0B; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Listing needs attention
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${escapeHtml(dealerName || 'Dealer')},<br>
      Your listing for <strong>${escapeHtml(phoneTitle)}</strong> requires corrections before it can be publicly displayed:
    </p>

    <div style="background: rgba(245, 158, 11, 0.1); border-left: 3px solid #F59E0B; border-radius: 6px; padding: 14px 18px; margin: 20px 0;">
      <p style="color: #FCD34D; font-size: 14px; margin: 0; line-height: 1.5;">
        <strong>Reason:</strong> ${escapeHtml(reason || 'Listing information needs verification or image updates.')}
      </p>
    </div>

    <p style="color: #94A3B8; font-size: 14px; line-height: 1.5;">
      Please click below to update the listing details and resubmit for review:
    </p>

    ${buttonHtml({ text: 'Edit Listing', url, color: '#F59E0B' })}
  `;

  const text = `Your NaijaSwap listing for "${phoneTitle}" needs attention.
Reason: ${reason}
Edit listing: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 11. Listing Views Milestone
 */
function templateListingViewsMilestone({ dealerName, phoneTitle, viewCount, listingUrl }) {
  const subject = `Your ${phoneTitle} is getting attention!`;
  const previewText = `Your listing just reached ${viewCount} verified views on NaijaSwap.`;
  const url = listingUrl || `${DEFAULT_BASE_URL}/dealer-listings.html`;

  const contentHtml = `
    <div style="text-align: center; margin-bottom: 20px;">
      <span style="display: inline-block; width: 50px; height: 50px; line-height: 50px; border-radius: 50%; background: rgba(6, 182, 212, 0.15); font-size: 24px;">
        🔥
      </span>
    </div>
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px; text-align: center;">
      Your listing is trending!
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 20px; text-align: center;">
      Hi ${escapeHtml(dealerName || 'Dealer')}, your listing for <strong>${escapeHtml(phoneTitle)}</strong> just crossed a major milestone:
    </p>

    <div style="background: #080C0E; border: 1px solid rgba(6, 182, 212, 0.3); border-radius: 14px; padding: 24px; text-align: center; margin: 24px 0;">
      <span style="font-size: 42px; font-weight: 800; color: #06B6D4; display: block; line-height: 1;">
        ${escapeHtml(viewCount)}+
      </span>
      <span style="color: #94A3B8; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-top: 8px; display: block;">
        Unique Views
      </span>
    </div>

    ${buttonHtml({ text: 'Check Listing Activity', url, color: '#06B6D4' })}
  `;

  const text = `Your ${phoneTitle} is getting attention!
It has reached ${viewCount} unique views on NaijaSwap.
Check your listing: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 12. Listing Activity Summary (Periodic)
 */
function templateListingActivitySummary({ dealerName, totalViews, newRequests, topListings = [], reportingPeriod = 'this week' }) {
  const subject = "Here's how your listings are performing";
  const previewText = `Your performance report: ${totalViews} views, ${newRequests} swap requests ${reportingPeriod}.`;

  const topListingsHtml = topListings.length > 0 ? `
    <div style="background: #080C0E; border-radius: 12px; padding: 18px; margin: 20px 0; border: 1px solid rgba(255,255,255,0.06);">
      <h3 style="color: #FFFFFF; font-size: 14px; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Most Viewed Listings</h3>
      ${topListings.map(item => `
        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 14px;">
          <span style="color: #E2E8F0;">${escapeHtml(item.title || item.model)}</span>
          <span style="color: #10B981; font-weight: 700;">${item.views || 0} views</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Listing performance summary
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
      Hi ${escapeHtml(dealerName || 'Dealer')}, here is a snapshot of your phone listing activity on NaijaSwap ${escapeHtml(reportingPeriod)}:
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0;">
      <tr>
        <td width="48%" style="background: #080C0E; border-radius: 12px; padding: 18px; border: 1px solid rgba(255,255,255,0.06); text-align: center;">
          <span style="font-size: 28px; font-weight: 800; color: #10B981; display: block;">${escapeHtml(totalViews)}</span>
          <span style="color: #94A3B8; font-size: 12px; text-transform: uppercase;">Total Views</span>
        </td>
        <td width="4%"></td>
        <td width="48%" style="background: #080C0E; border-radius: 12px; padding: 18px; border: 1px solid rgba(255,255,255,0.06); text-align: center;">
          <span style="font-size: 28px; font-weight: 800; color: #06B6D4; display: block;">${escapeHtml(newRequests)}</span>
          <span style="color: #94A3B8; font-size: 12px; text-transform: uppercase;">New Swap Requests</span>
        </td>
      </tr>
    </table>

    ${topListingsHtml}

    ${buttonHtml({ text: 'View Detailed Analytics', url: `${DEFAULT_BASE_URL}/dealer-dashboard.html` })}
  `;

  const text = `Listing performance summary for ${dealerName}:
Total Views: ${totalViews}
New Swap Requests: ${newRequests}
Check your dashboard: ${DEFAULT_BASE_URL}/dealer-dashboard.html`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 13. New Swap Request Received (To Listing Owner)
 */
function templateSwapRequestReceived({ recipientName, requesterName, targetPhone, offeredPhone, cashDifference, swapUrl, requestId }) {
  const subject = "You've received a new swap request!";
  const previewText = `${requesterName || 'A customer'} submitted a swap proposal for your ${targetPhone}.`;
  const url = swapUrl || `${DEFAULT_BASE_URL}/dealer-requests.html?id=${requestId || ''}`;

  const cashFormatted = cashDifference > 0 
    ? `₦${Number(cashDifference).toLocaleString('en-NG')}` 
    : (cashDifference < 0 ? `-₦${Math.abs(Number(cashDifference)).toLocaleString('en-NG')}` : 'Direct swap (₦0 top-up)');

  const contentHtml = `
    <div style="text-align: center; margin-bottom: 20px;">
      <span style="display: inline-block; width: 50px; height: 50px; line-height: 50px; border-radius: 50%; background: rgba(0, 210, 106, 0.15); font-size: 24px;">
        🔄
      </span>
    </div>
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px; text-align: center;">
      New swap request received!
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 20px; text-align: center;">
      Hi ${escapeHtml(recipientName || 'there')}, <strong>${escapeHtml(requesterName || 'A swapper')}</strong> has submitted a swap offer for your listing.
    </p>

    <div style="background: #080C0E; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 22px; margin: 24px 0;">
      <table role="presentation" width="100%" cellpadding="6" cellspacing="0" border="0" style="font-size: 14px;">
        <tr>
          <td style="color: #94A3B8; width: 40%;">Your Phone:</td>
          <td style="color: #FFFFFF; font-weight: 700;">${escapeHtml(targetPhone)}</td>
        </tr>
        <tr>
          <td style="color: #94A3B8;">Offered Phone:</td>
          <td style="color: #10B981; font-weight: 700;">${escapeHtml(offeredPhone)}</td>
        </tr>
        <tr>
          <td style="color: #94A3B8;">Proposed Cash Top-up:</td>
          <td style="color: #FCD34D; font-weight: 700;">${escapeHtml(cashFormatted)}</td>
        </tr>
      </table>
    </div>

    ${buttonHtml({ text: 'Review Swap Request', url })}

    <p style="color: #64748B; font-size: 12px; text-align: center; margin-top: 18px;">
      Timely responses help build trust and close deals faster!
    </p>
  `;

  const text = `You've received a new swap request on NaijaSwap!
From: ${requesterName || 'A swapper'}
Your Phone: ${targetPhone}
Offered Phone: ${offeredPhone}
Cash Top-up: ${cashFormatted}

Review this request: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 14. Swap Request Confirmation (To Requester)
 */
function templateSwapRequestConfirmation({ requesterName, targetPhone, dealerName, swapUrl, requestId }) {
  const subject = 'Your swap request has been sent!';
  const previewText = `Your swap request for ${targetPhone} was delivered to ${dealerName || 'the dealer'}.`;
  const url = swapUrl || `${DEFAULT_BASE_URL}/my-swaps.html?id=${requestId || ''}`;

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Your swap request is on its way!
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${escapeHtml(requesterName || 'there')},<br>
      Your swap offer for the <strong>${escapeHtml(targetPhone)}</strong> has been successfully delivered to <strong>${escapeHtml(dealerName || 'the dealer')}</strong>.
    </p>

    <div style="background: #080C0E; border-radius: 12px; padding: 18px; margin: 20px 0; border: 1px solid rgba(255,255,255,0.06); font-size: 14px; color: #94A3B8;">
      💡 You will receive an immediate notification as soon as the dealer reviews, accepts, or responds with a counteroffer.
    </div>

    ${buttonHtml({ text: 'Track Your Swap Request', url })}
  `;

  const text = `Your swap request has been sent!
Target Phone: ${targetPhone}
Dealer: ${dealerName || 'Verified Dealer'}
Track status: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 15. Swap Request Accepted (To Requester)
 */
function templateSwapRequestAccepted({ requesterName, targetPhone, dealerName, swapUrl, requestId }) {
  const subject = 'Great news! Your swap request was accepted.';
  const previewText = `${dealerName || 'The dealer'} accepted your swap proposal for ${targetPhone}!`;
  const url = swapUrl || `${DEFAULT_BASE_URL}/my-swaps.html?id=${requestId || ''}`;

  const contentHtml = `
    <div style="text-align: center; margin-bottom: 20px;">
      <span style="display: inline-block; width: 52px; height: 52px; line-height: 52px; border-radius: 50%; background: rgba(16, 185, 129, 0.2); font-size: 26px;">
        🤝
      </span>
    </div>
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px; text-align: center;">
      Swap proposal accepted!
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 20px; text-align: center;">
      Congratulations ${escapeHtml(requesterName || 'there')}! <strong>${escapeHtml(dealerName || 'The dealer')}</strong> has accepted your swap request for the <strong>${escapeHtml(targetPhone)}</strong>.
    </p>

    <div style="background: #080C0E; border: 1px solid #10B981; border-radius: 12px; padding: 20px; margin: 24px 0;">
      <h3 style="color: #10B981; font-size: 15px; margin-bottom: 8px;">Next steps to complete the swap:</h3>
      <ol style="color: #94A3B8; font-size: 14px; padding-left: 20px; line-height: 1.8;">
        <li>Open the swap chat to finalize hub meeting details</li>
        <li>Present both devices for physical verification at a certified hub</li>
        <li>Inspect battery health, IMEI, and original screen</li>
        <li>Complete secure handover & escrow release</li>
      </ol>
    </div>

    ${buttonHtml({ text: 'View Swap & Chat with Dealer', url })}
  `;

  const text = `Great news! Your swap request was accepted.
Device: ${targetPhone}
Dealer: ${dealerName}
View swap details: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 16. Swap Request Declined (To Requester)
 */
function templateSwapRequestDeclined({ requesterName, targetPhone, dealerName, browseUrl }) {
  const subject = 'Update on your NaijaSwap request';
  const previewText = `Your swap proposal for ${targetPhone} was declined. Explore other available phones.`;
  const url = browseUrl || `${DEFAULT_BASE_URL}/index.html`;

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Swap proposal update
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${escapeHtml(requesterName || 'there')},<br>
      The dealer for <strong>${escapeHtml(targetPhone)}</strong> was unable to accept your swap proposal at this time.
    </p>
    <p style="color: #94A3B8; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
      Don't worry — hundreds of other verified phones are uploaded daily across NaijaSwap hubs in Lagos, Abuja, Port Harcourt, and more. Find an alternative phone that matches your device:
    </p>

    ${buttonHtml({ text: 'Explore Other Available Phones', url })}
  `;

  const text = `Update on your NaijaSwap request:
Your swap proposal for ${targetPhone} was declined.
Explore other available devices: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 17. Counteroffer Received
 */
function templateCounterofferReceived({ recipientName, senderName, targetPhone, offeredPhone, cashDifference, swapUrl, requestId }) {
  const subject = "You've received a new swap offer!";
  const previewText = `${senderName || 'The dealer'} sent a counteroffer for ${targetPhone}.`;
  const url = swapUrl || `${DEFAULT_BASE_URL}/my-swaps.html?id=${requestId || ''}`;

  const cashFormatted = cashDifference > 0 
    ? `₦${Number(cashDifference).toLocaleString('en-NG')}` 
    : (cashDifference < 0 ? `-₦${Math.abs(Number(cashDifference)).toLocaleString('en-NG')}` : '₦0');

  const contentHtml = `
    <div style="text-align: center; margin-bottom: 20px;">
      <span style="display: inline-block; width: 50px; height: 50px; line-height: 50px; border-radius: 50%; background: rgba(245, 158, 11, 0.15); font-size: 24px;">
        💡
      </span>
    </div>
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px; text-align: center;">
      New counteroffer received!
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 20px; text-align: center;">
      Hi ${escapeHtml(recipientName || 'there')}, <strong>${escapeHtml(senderName || 'The counterparty')}</strong> has proposed updated terms for the swap:
    </p>

    <div style="background: #080C0E; border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 14px; padding: 22px; margin: 24px 0;">
      <table role="presentation" width="100%" cellpadding="6" cellspacing="0" border="0" style="font-size: 14px;">
        <tr>
          <td style="color: #94A3B8; width: 40%;">Phone:</td>
          <td style="color: #FFFFFF; font-weight: 700;">${escapeHtml(targetPhone)}</td>
        </tr>
        <tr>
          <td style="color: #94A3B8;">Proposed Cash Difference:</td>
          <td style="color: #F59E0B; font-weight: 800; font-size: 16px;">${escapeHtml(cashFormatted)}</td>
        </tr>
      </table>
    </div>

    ${buttonHtml({ text: 'Review & Respond to Counteroffer', url, color: '#F59E0B' })}
  `;

  const text = `You've received a new swap offer!
From: ${senderName}
Device: ${targetPhone}
New Cash Difference: ${cashFormatted}
Review offer: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 18. New Message Received (Swap Chat)
 */
function templateNewMessageReceived({ recipientName, senderName, targetPhone, chatUrl, requestId }) {
  const subject = 'You have a new message on NaijaSwap';
  const previewText = `${senderName || 'Someone'} sent you a message regarding ${targetPhone || 'your swap'}.`;
  const url = chatUrl || `${DEFAULT_BASE_URL}/chat.html?id=${requestId || ''}`;

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      You have a new message
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${escapeHtml(recipientName || 'there')},<br>
      <strong>${escapeHtml(senderName || 'Your swap partner')}</strong> sent you a message regarding the <strong>${escapeHtml(targetPhone || 'swap negotiation')}</strong>.
    </p>
    <p style="color: #94A3B8; font-size: 13px; line-height: 1.5; margin-bottom: 20px;">
      For your privacy and security, message content is kept secure inside NaijaSwap. Click below to view the message and reply:
    </p>

    ${buttonHtml({ text: 'Open Conversation', url })}
  `;

  const text = `You have a new message on NaijaSwap from ${senderName || 'your swap partner'} regarding ${targetPhone}.
View and reply: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 19. Pending Swap Request Reminder
 */
function templatePendingSwapReminder({ recipientName, requesterName, targetPhone, swapUrl, requestId }) {
  const subject = 'Reminder: Pending swap request awaiting your review';
  const previewText = `Don't forget to respond to ${requesterName}'s swap offer for ${targetPhone}.`;
  const url = swapUrl || `${DEFAULT_BASE_URL}/dealer-requests.html?id=${requestId || ''}`;

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Pending swap proposal reminder
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${escapeHtml(recipientName || 'there')},<br>
      <strong>${escapeHtml(requesterName || 'A customer')}</strong> submitted a swap request for your <strong>${escapeHtml(targetPhone)}</strong> that is still awaiting your review.
    </p>

    ${buttonHtml({ text: 'Review Request Now', url })}
  `;

  const text = `Reminder: Pending swap request awaiting your review.
Target Phone: ${targetPhone}
Requester: ${requesterName}
Review here: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 20. Lifecycle: Day 2 Onboarding Nudge (24 Hours)
 */
function templateOnboardingNudgeDay2({ firstName, accountType = 'customer', actionUrl }) {
  const isDealer = accountType === 'dealer';
  const subject = "You're one step closer to your next swap.";
  const previewText = isDealer ? 'Complete your dealer storefront on NaijaSwap.' : 'Find your first swap match on NaijaSwap.';
  const url = actionUrl || (isDealer ? `${DEFAULT_BASE_URL}/dealer-dashboard.html` : `${DEFAULT_BASE_URL}/index.html`);

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      You're one step closer to your next swap
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${firstName ? escapeHtml(firstName) : 'there'},<br>
      ${isDealer
        ? 'Your dealer account is active, but you have not uploaded your first phone listing yet. Verified stores with active listings get 5x more customer swap inquiries!'
        : 'You recently joined NaijaSwap! Take a minute to complete your profile and explore thousands of smartphones available for swap across verified hubs.'
      }
    </p>

    ${buttonHtml({ text: isDealer ? 'Add Your First Listing' : 'Explore Available Swaps', url })}
  `;

  const text = `You're one step closer to your next swap.
Get started here: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 21. Lifecycle: Day 3 Onboarding Guide (72 Hours)
 */
function templateOnboardingGuideDay3({ firstName, accountType = 'customer', actionUrl }) {
  const isDealer = accountType === 'dealer';
  const subject = 'Ready to get started on NaijaSwap?';
  const previewText = 'Here is how to get the most out of NaijaSwap.';
  const url = actionUrl || `${DEFAULT_BASE_URL}/faq.html`;

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Ready to get started on NaijaSwap?
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${firstName ? escapeHtml(firstName) : 'there'},<br>
      We want to make sure you have everything you need to swap smartphones safely and smoothly.
    </p>

    <div style="background: #080C0E; border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid rgba(255,255,255,0.06); font-size: 14px; color: #CBD5E1; line-height: 1.8;">
      <strong>3 Golden Rules of Safe Phone Swapping:</strong><br>
      1. Always verify IMEI and battery health before concluding any deal.<br>
      2. Agree on realistic cash top-ups using market price references.<br>
      3. Meet at verified inspection hubs or reputable dealer stores.
    </div>

    ${buttonHtml({ text: 'Read Swap Guide & FAQs', url })}
  `;

  const text = `Ready to get started on NaijaSwap?
Check out our safety tips and swap guide: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 22. Inactivity Reminder (7, 14, 30 Days)
 */
function templateInactivityReminder({ firstName, daysInactive = 7, returnUrl }) {
  const subject = daysInactive >= 30 
    ? 'We miss you on NaijaSwap!' 
    : 'New phone swaps are waiting for you on NaijaSwap';
  const previewText = 'Check out the latest inventory arrivals and swap proposals.';
  const url = returnUrl || `${DEFAULT_BASE_URL}/index.html`;

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      ${daysInactive >= 30 ? 'We miss you on NaijaSwap!' : 'Check out what is new on NaijaSwap'}
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${firstName ? escapeHtml(firstName) : 'there'},<br>
      It has been a little while since your last visit. Verified dealers just added fresh inventory, including popular iPhone and Samsung Galaxy flagships available for swap.
    </p>

    ${buttonHtml({ text: 'Browse New Inventory', url })}
  `;

  const text = `We miss you on NaijaSwap!
Browse new phone listings and swap opportunities: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 23. Dealer: Premium Subscription Activated
 */
function templateDealerPremiumActivated({ dealerName, renewalDate, dashboardUrl }) {
  const subject = 'Welcome to NaijaSwap Premium!';
  const previewText = 'Your Premium subscription is now active with unlimited listings.';
  const url = dashboardUrl || `${DEFAULT_BASE_URL}/dealer-dashboard.html`;

  const contentHtml = `
    <div style="text-align: center; margin-bottom: 20px;">
      <span style="display: inline-block; width: 56px; height: 56px; line-height: 56px; border-radius: 50%; background: linear-gradient(135deg, rgba(0,210,106,0.2), rgba(6,182,212,0.2)); font-size: 28px;">
        ⭐
      </span>
    </div>
    <h1 style="color: #FFFFFF; font-size: 24px; font-weight: 800; margin-bottom: 14px; text-align: center;">
      Welcome to NaijaSwap Premium!
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 20px; text-align: center;">
      Congratulations ${escapeHtml(dealerName || 'Dealer')}! Your monthly subscription to <strong>NaijaSwap Premium (₦9,900/month)</strong> has been activated.
    </p>

    <div style="background: #080C0E; border: 1px solid #10B981; border-radius: 14px; padding: 22px; margin: 24px 0;">
      <h3 style="color: #10B981; font-size: 16px; margin-bottom: 10px;">🌟 Premium Benefits Unlocked:</h3>
      <ul style="color: #CBD5E1; font-size: 14px; padding-left: 20px; line-height: 1.9;">
        <li><strong>Unlimited Active Listings</strong> (No 5-listing cap)</li>
        <li>Priority visibility in swapper search results</li>
        <li>Verified Premium dealer badge on all storefront pages</li>
        <li>Comprehensive analytics and swap conversion reports</li>
      </ul>
      ${renewalDate ? `<p style="color: #94A3B8; font-size: 13px; margin-top: 14px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px;">Next renewal date: <strong>${escapeHtml(renewalDate)}</strong></p>` : ''}
    </div>

    ${buttonHtml({ text: 'Access Premium Storefront', url })}
  `;

  const text = `Welcome to NaijaSwap Premium!
Unlimited listings unlocked for ₦9,900/month.
Manage your store: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 24. Dealer: Subscription Payment Receipt
 */
function templateDealerPaymentReceipt({ dealerName, amount = 9900, currency = 'NGN', paymentDate, billingPeriod, reference, renewalDate }) {
  const subject = 'Your NaijaSwap Premium payment was successful';
  const previewText = `Payment receipt: ₦${Number(amount).toLocaleString('en-NG')} for NaijaSwap Premium.`;

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Payment receipt
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
      Hi ${escapeHtml(dealerName || 'Dealer')},<br>
      Thank you for your payment. Your NaijaSwap Premium subscription has been successfully renewed.
    </p>

    <div style="background: #080C0E; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 22px; margin: 20px 0;">
      <table role="presentation" width="100%" cellpadding="6" cellspacing="0" border="0" style="font-size: 14px;">
        <tr>
          <td style="color: #94A3B8;">Plan:</td>
          <td style="color: #FFFFFF; font-weight: 700;">NaijaSwap Premium (Monthly)</td>
        </tr>
        <tr>
          <td style="color: #94A3B8;">Amount Paid:</td>
          <td style="color: #10B981; font-weight: 800; font-size: 16px;">₦${Number(amount).toLocaleString('en-NG')} ${escapeHtml(currency)}</td>
        </tr>
        <tr>
          <td style="color: #94A3B8;">Payment Date:</td>
          <td style="color: #FFFFFF;">${escapeHtml(paymentDate || new Date().toLocaleDateString('en-NG'))}</td>
        </tr>
        ${billingPeriod ? `
          <tr>
            <td style="color: #94A3B8;">Billing Period:</td>
            <td style="color: #FFFFFF;">${escapeHtml(billingPeriod)}</td>
          </tr>
        ` : ''}
        ${reference ? `
          <tr>
            <td style="color: #94A3B8;">Payment Reference:</td>
            <td style="color: #94A3B8; font-family: monospace;">${escapeHtml(reference)}</td>
          </tr>
        ` : ''}
        ${renewalDate ? `
          <tr>
            <td style="color: #94A3B8;">Next Renewal Date:</td>
            <td style="color: #FFFFFF;">${escapeHtml(renewalDate)}</td>
          </tr>
        ` : ''}
      </table>
    </div>

    ${buttonHtml({ text: 'View Billing Details', url: `${DEFAULT_BASE_URL}/dealer-dashboard.html` })}
  `;

  const text = `Your NaijaSwap Premium payment was successful.
Amount: ₦${Number(amount).toLocaleString('en-NG')} ${currency}
Reference: ${reference || 'N/A'}
Date: ${paymentDate || new Date().toLocaleDateString()}
Next Renewal: ${renewalDate || 'N/A'}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 25. Dealer: Upcoming Renewal Reminder
 */
function templateDealerUpcomingRenewal({ dealerName, amount = 9900, currency = 'NGN', renewalDate }) {
  const subject = 'Upcoming NaijaSwap Premium renewal';
  const previewText = `Your subscription will renew on ${renewalDate} for ₦${Number(amount).toLocaleString('en-NG')}.`;

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Upcoming subscription renewal
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${escapeHtml(dealerName || 'Dealer')},<br>
      This is a friendly advance reminder that your NaijaSwap Premium plan will automatically renew on <strong>${escapeHtml(renewalDate)}</strong> for <strong>₦${Number(amount).toLocaleString('en-NG')} ${escapeHtml(currency)}</strong>.
    </p>
    <p style="color: #94A3B8; font-size: 14px; line-height: 1.6;">
      Your unlimited listings and verified dealer badges will remain completely uninterrupted.
    </p>

    ${buttonHtml({ text: 'Manage Subscription', url: `${DEFAULT_BASE_URL}/dealer-dashboard.html` })}
  `;

  const text = `Upcoming NaijaSwap Premium renewal on ${renewalDate} for ₦${amount}. Manage here: ${DEFAULT_BASE_URL}/dealer-dashboard.html`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 26. Dealer: Payment Failed Alert
 */
function templateDealerPaymentFailed({ dealerName, amount = 9900, retryUrl }) {
  const subject = "We couldn't process your NaijaSwap Premium payment";
  const previewText = 'Please update your payment method to maintain unlimited active listings.';
  const url = retryUrl || `${DEFAULT_BASE_URL}/dealer-dashboard.html`;

  const contentHtml = `
    <h1 style="color: #EF4444; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Payment processing issue
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${escapeHtml(dealerName || 'Dealer')},<br>
      We were unable to process your recent renewal payment of <strong>₦${Number(amount).toLocaleString('en-NG')}</strong> for NaijaSwap Premium.
    </p>

    <div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid #EF4444; border-radius: 6px; padding: 14px 18px; margin: 20px 0; font-size: 14px; color: #FCA5A5;">
      To keep your unlimited active listings live and visible to buyers, please click below to update your payment details or retry.
    </div>

    ${buttonHtml({ text: 'Retry Payment Securely', url, color: '#EF4444' })}
  `;

  const text = `We couldn't process your NaijaSwap Premium payment of ₦${amount}. Please retry: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 27. Dealer: Subscription Cancelled
 */
function templateDealerSubscriptionCancelled({ dealerName, periodEndDate }) {
  const subject = 'Your NaijaSwap Premium subscription cancellation';
  const previewText = `Your Premium benefits will remain active until ${periodEndDate}.`;

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Subscription cancelled
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${escapeHtml(dealerName || 'Dealer')},<br>
      We have received your cancellation request for NaijaSwap Premium. Your Premium benefits (unlimited active listings) will remain active until the end of your billing cycle on <strong>${escapeHtml(periodEndDate || 'the current period end')}</strong>.
    </p>
    <p style="color: #94A3B8; font-size: 14px; line-height: 1.6;">
      After this date, your store will seamlessly transition back to our <strong>Starter Plan (free forever, maximum 5 active listings)</strong>. None of your listings will be deleted.
    </p>
  `;

  const text = `Your NaijaSwap Premium subscription was cancelled. Premium benefits remain until ${periodEndDate}.`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 28. Dealer: Subscription Expired & Reverted to Starter
 */
function templateDealerSubscriptionExpired({ dealerName, starterLimit = 5 }) {
  const subject = 'Your NaijaSwap Premium subscription has ended';
  const previewText = `Your account has returned to Starter with a ${starterLimit}-listing limit.`;

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      Account returned to Starter Plan
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${escapeHtml(dealerName || 'Dealer')},<br>
      Your NaijaSwap Premium billing cycle has ended, and your store has returned to the <strong>Starter Plan</strong>.
    </p>

    <div style="background: #080C0E; border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid rgba(255,255,255,0.06); font-size: 14px; color: #CBD5E1;">
      <strong>Important information about your listings:</strong><br>
      • Starter plan includes up to <strong>${starterLimit} active listings</strong> completely free forever.<br>
      • Your excess listings are safely preserved in your catalog but are temporarily inactive until you renew Premium or select your 5 active listings.
    </div>

    ${buttonHtml({ text: 'Upgrade to Premium for ₦9,900', url: `${DEFAULT_BASE_URL}/dealer-dashboard.html` })}
  `;

  const text = `Your NaijaSwap Premium subscription has ended. Your account has returned to Starter (max ${starterLimit} active listings). All listings are preserved. Renew anytime: ${DEFAULT_BASE_URL}/dealer-dashboard.html`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 29. Dealer: Starter Listing Limit Warning (4 of 5 active)
 */
function templateDealerStarterLimitWarning({ dealerName, currentCount = 4, maxLimit = 5, upgradeUrl }) {
  const subject = 'You have 1 active listing slot remaining on NaijaSwap Starter';
  const previewText = `You currently have ${currentCount} of ${maxLimit} active listings.`;
  const url = upgradeUrl || `${DEFAULT_BASE_URL}/dealer-dashboard.html`;

  const contentHtml = `
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px;">
      1 listing slot remaining
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 18px;">
      Hi ${escapeHtml(dealerName || 'Dealer')},<br>
      You currently have <strong>${currentCount} active listings</strong> out of your free Starter limit of <strong>${maxLimit}</strong>.
    </p>
    <p style="color: #94A3B8; font-size: 14px; line-height: 1.6;">
      Want to upload unlimited inventory without limits? Upgrade to <strong>NaijaSwap Premium for ₦9,900/month</strong> and unlock unlimited listings, priority search placement, and premium store badges.
    </p>

    ${buttonHtml({ text: 'Upgrade to Premium (Unlimited)', url })}
  `;

  const text = `You have 1 active listing slot remaining on Starter (${currentCount}/${maxLimit}).
Upgrade to Premium for ₦9,900/month for unlimited listings: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 30. Dealer: Starter Listing Limit Reached (5 of 5 active)
 */
function templateDealerStarterLimitReached({ dealerName, currentCount = 5, maxLimit = 5, upgradeUrl }) {
  const subject = "You've reached your 5 active listings limit on Starter";
  const previewText = 'Upgrade to NaijaSwap Premium for ₦9,900/month to list unlimited phones.';
  const url = upgradeUrl || `${DEFAULT_BASE_URL}/dealer-dashboard.html`;

  const contentHtml = `
    <div style="text-align: center; margin-bottom: 20px;">
      <span style="display: inline-block; width: 50px; height: 50px; line-height: 50px; border-radius: 50%; background: rgba(0, 210, 106, 0.15); font-size: 24px;">
        🚀
      </span>
    </div>
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 14px; text-align: center;">
      You've reached your Starter limit!
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 20px; text-align: center;">
      Great job, ${escapeHtml(dealerName || 'Dealer')}! You have filled all <strong>${maxLimit} available active listing slots</strong> on the free Starter plan.
    </p>

    <div style="background: #080C0E; border: 1px solid #10B981; border-radius: 14px; padding: 22px; margin: 24px 0;">
      <h3 style="color: #10B981; font-size: 16px; margin-bottom: 10px;">Ready to expand your store?</h3>
      <p style="color: #CBD5E1; font-size: 14px; line-height: 1.7; margin-bottom: 12px;">
        For just <strong>₦9,900 per month</strong>, NaijaSwap Premium gives you:
      </p>
      <ul style="color: #94A3B8; font-size: 14px; padding-left: 20px; line-height: 1.8;">
        <li><strong>Unlimited active listings</strong> for your entire phone stock</li>
        <li>Priority placement across all swap searches</li>
        <li>Official Verified Dealer badge</li>
      </ul>
    </div>

    ${buttonHtml({ text: 'Upgrade to Premium for ₦9,900', url })}
  `;

  const text = `You've reached your 5 active listings limit on Starter.
Upgrade to Premium for ₦9,900/month to upload unlimited inventory: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml }),
    text
  };
}

/**
 * 31. Marketing Campaign Template
 */
/**
 * Customer & Subscriber Alert: New Verified Inventory Dropped
 */
function templateNewInventoryAlert({ recipientName = '', phoneTitle, dealerName = 'A verified dealer', price = null, swapValue = null, listingUrl, imageUrl = '' }) {
  const subject = `🔥 New Arrival: ${phoneTitle} just listed on NigerSwap!`;
  const previewText = `A verified ${phoneTitle} has just been added by ${dealerName}. Check it out now!`;
  const url = listingUrl || `${DEFAULT_BASE_URL}/store.html`;

  const priceBadge = price ? `<span style="background: rgba(16, 185, 129, 0.15); color: #10B981; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 14px; margin-right: 8px;">₦${Number(price).toLocaleString()}</span>` : '';
  const swapBadge = swapValue ? `<span style="background: rgba(245, 158, 11, 0.15); color: #F59E0B; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 14px;">Swap Value: ₦${Number(swapValue).toLocaleString()}</span>` : '';

  const contentHtml = `
    <div style="text-align: center; margin-bottom: 20px;">
      <span style="display: inline-block; width: 50px; height: 50px; line-height: 50px; border-radius: 50%; background: rgba(16, 185, 129, 0.15); font-size: 24px;">
        🔥
      </span>
    </div>
    <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin-bottom: 12px; text-align: center;">
      New Verified Phone Just Dropped!
    </h1>
    <p style="color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 20px; text-align: center;">
      Hello ${escapeHtml(recipientName || 'Swapper')}, a new high-demand phone was just listed and verified by <strong>${escapeHtml(dealerName)}</strong> on NigerSwap.
    </p>

    <div style="background: #080C0E; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 22px; text-align: center; margin: 24px 0;">
      <p style="color: #94A3B8; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Newly Available Device</p>
      <h2 style="color: #10B981; font-size: 22px; font-weight: 800; margin: 0 0 12px 0;">
        ${escapeHtml(phoneTitle)}
      </h2>
      <div style="margin-top: 10px;">
        ${priceBadge}
        ${swapBadge}
      </div>
    </div>

    ${buttonHtml({ text: 'Inspect & Propose Swap', url })}

    <p style="color: #94A3B8; font-size: 13px; text-align: center; line-height: 1.5; margin-top: 20px;">
      ⚡ High-demand listings get swap offers quickly. View the phone specs and start a swap inquiry before it is taken!
    </p>
  `;

  const text = `New Verified Phone Alert on NigerSwap!
Device: ${phoneTitle}
Dealer: ${dealerName}
${price ? `Price: ₦${Number(price).toLocaleString()}\n` : ''}Check out the listing and propose a swap: ${url}`;

  return {
    subject,
    html: renderBaseLayout({ title: subject, previewText, contentHtml, isMarketing: true }),
    text
  };
}

function templateMarketingCampaign({ title, previewText, contentHtml, unsubscribeUrl, preferencesUrl }) {
  const subject = title || 'NaijaSwap Announcement';

  return {
    subject,
    html: renderBaseLayout({
      title: subject,
      previewText: previewText || title,
      contentHtml,
      isMarketing: true,
      unsubscribeUrl
    }),
    text: `${title}\n\nTo view this announcement and update your preferences, visit: ${preferencesUrl || DEFAULT_BASE_URL}\n\nTo unsubscribe from marketing emails: ${unsubscribeUrl || DEFAULT_BASE_URL}/settings.html`
  };
}

module.exports = {
  templateVerifyEmail,
  templateWelcome,
  templatePasswordReset,
  templatePasswordChanged,
  templateEmailChangeVerification,
  templateEmailChanged,
  templateNewLoginAlert,
  templateSuspiciousActivityAlert,
  templateListingPublished,
  templateListingNeedsAttention,
  templateListingViewsMilestone,
  templateListingActivitySummary,
  templateSwapRequestReceived,
  templateSwapRequestConfirmation,
  templateSwapRequestAccepted,
  templateSwapRequestDeclined,
  templateCounterofferReceived,
  templateNewMessageReceived,
  templatePendingSwapReminder,
  templateOnboardingNudgeDay2,
  templateOnboardingGuideDay3,
  templateInactivityReminder,
  templateDealerPremiumActivated,
  templateDealerPaymentReceipt,
  templateDealerUpcomingRenewal,
  templateDealerPaymentFailed,
  templateDealerSubscriptionCancelled,
  templateDealerSubscriptionExpired,
  templateDealerStarterLimitWarning,
  templateDealerStarterLimitReached,
  templateNewInventoryAlert,
  templateMarketingCampaign
};
