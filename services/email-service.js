/**
 * NaijaSwap - Central Email Service
 * Handles provider configuration, idempotency, retry mechanism, suppression checks,
 * asynchronous queuing, and Firestore audit logging.
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const templates = require('./email-templates');
const { brevoService } = require('./brevo-service');

// Auto-load .env if present
try {
  const envCandidates = [
    path.resolve(__dirname, '..', '.env'),
    path.resolve(__dirname, '.env'),
    path.resolve(process.cwd(), '.env')
  ];
  for (const envFile of envCandidates) {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf8');
      content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eq = trimmed.indexOf('=');
          if (eq > 0) {
            const k = trimmed.slice(0, eq).trim();
            const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
            if (!process.env[k]) process.env[k] = v;
          }
        }
      });
      break;
    }
  }
} catch (_) {}

// Configuration
const DEFAULT_FROM = process.env.EMAIL_FROM || 'NaijaSwap <noreply@naijaswap.ng>';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 2000;

class EmailService {
  constructor(options = {}) {
    this.db = options.db || null;
    this.isTesting = process.env.NODE_ENV === 'test' || options.isTesting === true;
    this.provider = process.env.EMAIL_PROVIDER || (process.env.SMTP_HOST ? 'smtp' : 'logger');
    this.transporter = null;
    this.queue = [];
    this.isProcessingQueue = false;

    this.initTransporter();
  }

  setFirestore(db) {
    this.db = db;
  }

  initTransporter() {
    if (this.isTesting) {
      // In-memory mock transporter during tests
      this.transporter = {
        sendMail: async (mailOptions) => ({
          messageId: `test-msg-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
          response: '250 OK: Message accepted by mock test transporter',
          envelope: { from: mailOptions.from, to: mailOptions.to }
        })
      };
      return;
    }

    if (process.env.BREVO_API_KEY && (!process.env.SMTP_HOST || process.env.EMAIL_PROVIDER === 'brevo')) {
      // Direct Brevo REST API v3 transport (zero SMTP port blocking)
      this.transporter = {
        sendMail: async (mailOptions) => {
          let sender = undefined;
          if (mailOptions.from) {
            const match = mailOptions.from.match(/(.*)<([^>]+)>/);
            if (match) {
              sender = { name: match[1].trim(), email: match[2].trim() };
            } else if (mailOptions.from.includes('@')) {
              sender = { name: 'NigerSwap', email: mailOptions.from.trim() };
            }
          }
          const res = await brevoService.sendEmail({
            to: mailOptions.to,
            subject: mailOptions.subject,
            htmlContent: mailOptions.html,
            textContent: mailOptions.text,
            sender
          });
          return {
            messageId: res.messageId,
            response: '250 OK: Sent via Brevo REST API v3',
            envelope: { from: mailOptions.from, to: mailOptions.to }
          };
        }
      };
      console.log('[EmailService] Initialized Brevo REST API v3 transporter');
      return;
    }

    if (process.env.SMTP_HOST) {
      // Real SMTP transport (e.g. Gmail SMTP, Brevo, SendGrid, Mailgun)
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
        auth: process.env.SMTP_USER ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        } : undefined,
        pool: true,
        maxConnections: 5,
        maxMessages: 100
      });
      console.log(`[EmailService] Initialized SMTP transporter (${process.env.SMTP_HOST})`);
    } else {
      // Development / Free Local Transporter: Logs to console & writes to Firestore / preview collection
      this.transporter = {
        sendMail: async (mailOptions) => {
          const fakeId = `dev-msg-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
          console.log(`\n======================================================`);
          console.log(`📧 [DEV EMAIL TRANSPORTER] Outgoing Email Generated`);
          console.log(`To:       ${mailOptions.to}`);
          console.log(`Subject:  ${mailOptions.subject}`);
          console.log(`ID:       ${fakeId}`);
          console.log(`======================================================\n`);
          return {
            messageId: fakeId,
            response: '250 OK: Logged to dev transporter (no external SMTP needed)',
            envelope: { from: mailOptions.from, to: mailOptions.to }
          };
        }
      };
      console.log(`[EmailService] Using built-in Dev/Logger transporter (zero sign-up required)`);
    }
  }

  /**
   * Check if an email address is suppressed (for marketing or non-essential emails)
   */
  async isSuppressed(email) {
    if (!this.db || !email) return false;
    try {
      const normalized = String(email).trim().toLowerCase();
      const docSnap = await this.db.collection('marketingSuppression').doc(normalized).get();
      return docSnap.exists;
    } catch (err) {
      console.warn('[EmailService] Could not check suppression status:', err.message);
      return false;
    }
  }

  /**
   * Add an email to the suppression list
   */
  async suppressEmail(email, reason = 'user_unsubscribe') {
    if (!this.db || !email) return;
    try {
      const normalized = String(email).trim().toLowerCase();
      await this.db.collection('marketingSuppression').doc(normalized).set({
        email: normalized,
        reason,
        suppressedAt: new Date(),
        updatedAt: new Date()
      }, { merge: true });
      console.log(`[EmailService] Suppressed marketing emails for ${normalized}`);
    } catch (err) {
      console.error('[EmailService] Failed to suppress email:', err.message);
    }
  }

  /**
   * Check idempotency: returns existing log if already processed
   */
  async checkIdempotency(idempotencyKey) {
    if (!this.db || !idempotencyKey) return null;
    try {
      const existing = await this.db.collection('emailLogs')
        .where('idempotencyKey', '==', idempotencyKey)
        .limit(1)
        .get();

      if (!existing.empty) {
        const data = existing.docs[0].data();
        if (data.status === 'delivered' || data.status === 'sent') {
          return data;
        }
      }
      return null;
    } catch (err) {
      console.warn('[EmailService] Idempotency check note:', err.message);
      return null;
    }
  }

  /**
   * Log email delivery attempt into Firestore
   */
  async logEmailEvent(eventData) {
    if (!this.db) return null;
    try {
      const logRef = this.db.collection('emailLogs').doc(eventData.eventId || crypto.randomUUID());
      const payload = {
        ...eventData,
        updatedAt: new Date()
      };
      await logRef.set(payload, { merge: true });
      return logRef.id;
    } catch (err) {
      console.warn('[EmailService] Could not persist email log:', err.message);
      return null;
    }
  }

  /**
   * Core send function with retries and exponential backoff
   */
  async sendMailDirect({ to, subject, html, text, from, isMarketing = false, idempotencyKey = null, templateName = 'generic', metadata = {} }) {
    if (!to) {
      throw new Error('Recipient email address (to) is required.');
    }

    const normalizedTo = String(to).trim().toLowerCase();
    const eventId = crypto.randomUUID();

    // 1. Idempotency Check
    if (idempotencyKey) {
      const existing = await this.checkIdempotency(idempotencyKey);
      if (existing) {
        console.log(`[EmailService] Duplicate email suppressed by idempotencyKey: ${idempotencyKey}`);
        return {
          ok: true,
          skipped: true,
          reason: 'duplicate_prevented',
          eventId: existing.eventId
        };
      }
    }

    // 2. Suppression Check (marketing only)
    if (isMarketing) {
      const suppressed = await this.isSuppressed(normalizedTo);
      if (suppressed) {
        console.log(`[EmailService] Marketing email skipped for suppressed address: ${normalizedTo}`);
        await this.logEmailEvent({
          eventId,
          to: normalizedTo,
          subject,
          templateName,
          status: 'suppressed',
          isMarketing: true,
          idempotencyKey,
          createdAt: new Date(),
          metadata
        });
        return { ok: true, skipped: true, reason: 'user_unsubscribed' };
      }
    }

    // Initial audit log
    await this.logEmailEvent({
      eventId,
      to: normalizedTo,
      subject,
      templateName,
      status: 'queued',
      isMarketing,
      idempotencyKey,
      attempts: 0,
      createdAt: new Date(),
      metadata
    });

    const mailOptions = {
      from: from || DEFAULT_FROM,
      to: normalizedTo,
      subject,
      html,
      text,
      headers: {
        'X-NaijaSwap-Event-ID': eventId,
        ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
        ...(isMarketing ? {
          'List-Unsubscribe': `<${process.env.APP_BASE_URL || 'https://naijaswap.web.app'}/api/marketing/unsubscribe?email=${encodeURIComponent(normalizedTo)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        } : {})
      }
    };

    let attempt = 0;
    let lastError = null;

    while (attempt < MAX_RETRIES) {
      attempt++;
      try {
        const info = await this.transporter.sendMail(mailOptions);
        
        // Log success
        await this.logEmailEvent({
          eventId,
          status: 'delivered',
          providerMessageId: info.messageId || null,
          attempts: attempt,
          sentAt: new Date()
        });

        return {
          ok: true,
          eventId,
          messageId: info.messageId,
          attempts: attempt
        };
      } catch (err) {
        lastError = err;
        console.warn(`[EmailService] Delivery attempt ${attempt} failed for ${normalizedTo}:`, err.message);

        // Check if hard bounce or fatal error
        const isFatal = /invalid recipient|user unknown|mailbox not found|550/i.test(err.message);
        if (isFatal) {
          console.error(`[EmailService] Hard bounce detected for ${normalizedTo}. Suppressing future sends.`);
          await this.suppressEmail(normalizedTo, 'hard_bounce');
          await this.logEmailEvent({
            eventId,
            status: 'failed',
            error: err.message,
            attempts: attempt,
            failedAt: new Date()
          });
          return { ok: false, error: err.message, fatal: true };
        }

        if (attempt < MAX_RETRIES) {
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          await new Promise(res => setTimeout(res, delay));
        }
      }
    }

    // Final failure after retries
    await this.logEmailEvent({
      eventId,
      status: 'failed',
      error: lastError ? lastError.message : 'Maximum retries exhausted',
      attempts: attempt,
      failedAt: new Date()
    });

    return {
      ok: false,
      error: lastError ? lastError.message : 'Delivery failed after retries'
    };
  }

  /**
   * Queue email asynchronously to prevent blocking API requests
   */
  queueEmail(emailData) {
    this.queue.push(emailData);
    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const emailData = this.queue.shift();
      try {
        await this.sendMailDirect(emailData);
      } catch (err) {
        console.error('[EmailService] Async queue delivery error:', err.message);
      }
    }

    this.isProcessingQueue = false;
  }

  // -----------------------------------------------------------
  // CONVENIENCE TEMPLATE SENDERS
  // -----------------------------------------------------------

  async sendVerificationCode(to, code, firstName = '') {
    const tpl = templates.templateVerifyEmail({ code, firstName, email: to });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'verify_email',
      isMarketing: false
    });
  }

  async sendWelcomeEmail(to, { firstName = '', role = 'customer', shopName = '' }) {
    const tpl = templates.templateWelcome({ firstName, role, shopName });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'welcome',
      isMarketing: false
    });
  }

  async sendPasswordReset(to, { resetLink, firstName = '', expiryMinutes = 60 }) {
    const tpl = templates.templatePasswordReset({ resetLink, firstName, expiryMinutes });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'password_reset',
      isMarketing: false
    });
  }

  async sendPasswordChanged(to, { firstName = '', timestamp = '', ipAddress = '', userAgent = '' }) {
    const tpl = templates.templatePasswordChanged({ firstName, timestamp, ipAddress, userAgent });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'password_changed',
      isMarketing: false
    });
  }

  async sendEmailChangeVerification(to, { newEmail, code, firstName = '' }) {
    const tpl = templates.templateEmailChangeVerification({ newEmail, code, firstName });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'email_change_verification',
      isMarketing: false
    });
  }

  async sendEmailChangedAlert(to, { oldEmail, newEmail, firstName = '' }) {
    const tpl = templates.templateEmailChanged({ oldEmail, newEmail, firstName });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'email_changed',
      isMarketing: false
    });
  }

  async sendNewLoginAlert(to, { firstName = '', ipAddress = '', userAgent = '', location = '', timestamp = '' }) {
    const tpl = templates.templateNewLoginAlert({ firstName, ipAddress, userAgent, location, timestamp });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'new_login_alert',
      isMarketing: false
    });
  }

  async sendSuspiciousActivityAlert(to, { firstName = '', reason = '', actionUrl = '' }) {
    const tpl = templates.templateSuspiciousActivityAlert({ firstName, reason, actionUrl });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'suspicious_activity',
      isMarketing: false
    });
  }

  async sendListingPublished(to, { dealerName = '', phoneTitle = '', listingId = '', listingUrl = '' }) {
    const tpl = templates.templateListingPublished({ dealerName, phoneTitle, listingId, listingUrl });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'listing_published',
      idempotencyKey: `listing_pub_${listingId}`,
      isMarketing: false
    });
  }

  async sendListingNeedsAttention(to, { dealerName = '', phoneTitle = '', reason = '', editUrl = '' }) {
    const tpl = templates.templateListingNeedsAttention({ dealerName, phoneTitle, reason, editUrl });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'listing_needs_attention',
      isMarketing: false
    });
  }

  async sendListingViewsMilestone(to, { dealerName = '', phoneTitle = '', viewCount = 25, listingUrl = '', listingId = '' }) {
    const tpl = templates.templateListingViewsMilestone({ dealerName, phoneTitle, viewCount, listingUrl });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'listing_views_milestone',
      idempotencyKey: `listing_views_${listingId}_${viewCount}`,
      isMarketing: false
    });
  }

  async sendListingActivitySummary(to, { dealerName = '', totalViews = 0, newRequests = 0, topListings = [], reportingPeriod = 'this week' }) {
    const tpl = templates.templateListingActivitySummary({ dealerName, totalViews, newRequests, topListings, reportingPeriod });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'listing_activity_summary',
      isMarketing: false
    });
  }

  async sendSwapRequestReceived(to, { recipientName = '', requesterName = '', targetPhone = '', offeredPhone = '', cashDifference = 0, swapUrl = '', requestId = '' }) {
    const tpl = templates.templateSwapRequestReceived({ recipientName, requesterName, targetPhone, offeredPhone, cashDifference, swapUrl, requestId });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'swap_request_received',
      idempotencyKey: `swap_rec_${requestId}`,
      isMarketing: false
    });
  }

  async sendSwapRequestConfirmation(to, { requesterName = '', targetPhone = '', dealerName = '', swapUrl = '', requestId = '' }) {
    const tpl = templates.templateSwapRequestConfirmation({ requesterName, targetPhone, dealerName, swapUrl, requestId });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'swap_request_confirmation',
      idempotencyKey: `swap_conf_${requestId}`,
      isMarketing: false
    });
  }

  async sendSwapRequestAccepted(to, { requesterName = '', targetPhone = '', dealerName = '', swapUrl = '', requestId = '' }) {
    const tpl = templates.templateSwapRequestAccepted({ requesterName, targetPhone, dealerName, swapUrl, requestId });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'swap_request_accepted',
      idempotencyKey: `swap_acc_${requestId}`,
      isMarketing: false
    });
  }

  async sendSwapRequestDeclined(to, { requesterName = '', targetPhone = '', dealerName = '', browseUrl = '', requestId = '' }) {
    const tpl = templates.templateSwapRequestDeclined({ requesterName, targetPhone, dealerName, browseUrl });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'swap_request_declined',
      idempotencyKey: `swap_dec_${requestId}`,
      isMarketing: false
    });
  }

  async sendCounterofferReceived(to, { recipientName = '', senderName = '', targetPhone = '', offeredPhone = '', cashDifference = 0, swapUrl = '', requestId = '', counterCount = 1 }) {
    const tpl = templates.templateCounterofferReceived({ recipientName, senderName, targetPhone, offeredPhone, cashDifference, swapUrl, requestId });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'swap_counteroffer_received',
      idempotencyKey: `swap_counter_${requestId}_${counterCount}`,
      isMarketing: false
    });
  }

  async sendNewMessageAlert(to, { recipientName = '', senderName = '', targetPhone = '', chatUrl = '', requestId = '', messageId = '' }) {
    const tpl = templates.templateNewMessageReceived({ recipientName, senderName, targetPhone, chatUrl, requestId });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'swap_new_message',
      idempotencyKey: messageId ? `msg_${messageId}` : null,
      isMarketing: false
    });
  }

  async sendPendingSwapReminder(to, { recipientName = '', requesterName = '', targetPhone = '', swapUrl = '', requestId = '' }) {
    const tpl = templates.templatePendingSwapReminder({ recipientName, requesterName, targetPhone, swapUrl, requestId });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'swap_pending_reminder',
      idempotencyKey: `swap_remind_${requestId}`,
      isMarketing: false
    });
  }

  async sendDealerPremiumActivated(to, { dealerName = '', renewalDate = '', dashboardUrl = '', transactionRef = '' }) {
    const tpl = templates.templateDealerPremiumActivated({ dealerName, renewalDate, dashboardUrl });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'dealer_premium_activated',
      idempotencyKey: transactionRef ? `sub_act_${transactionRef}` : null,
      isMarketing: false
    });
  }

  async sendDealerPaymentReceipt(to, { dealerName = '', amount = 9900, currency = 'NGN', paymentDate = '', billingPeriod = '', reference = '', renewalDate = '' }) {
    const tpl = templates.templateDealerPaymentReceipt({ dealerName, amount, currency, paymentDate, billingPeriod, reference, renewalDate });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'dealer_payment_receipt',
      idempotencyKey: reference ? `receipt_${reference}` : null,
      isMarketing: false
    });
  }

  async sendDealerUpcomingRenewal(to, { dealerName = '', amount = 9900, currency = 'NGN', renewalDate = '' }) {
    const tpl = templates.templateDealerUpcomingRenewal({ dealerName, amount, currency, renewalDate });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'dealer_upcoming_renewal',
      idempotencyKey: `renewal_${to}_${renewalDate}`,
      isMarketing: false
    });
  }

  async sendDealerPaymentFailed(to, { dealerName = '', amount = 9900, retryUrl = '' }) {
    const tpl = templates.templateDealerPaymentFailed({ dealerName, amount, retryUrl });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'dealer_payment_failed',
      isMarketing: false
    });
  }

  async sendDealerSubscriptionCancelled(to, { dealerName = '', periodEndDate = '' }) {
    const tpl = templates.templateDealerSubscriptionCancelled({ dealerName, periodEndDate });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'dealer_subscription_cancelled',
      isMarketing: false
    });
  }

  async sendDealerSubscriptionExpired(to, { dealerName = '', starterLimit = 5 }) {
    const tpl = templates.templateDealerSubscriptionExpired({ dealerName, starterLimit });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'dealer_subscription_expired',
      isMarketing: false
    });
  }

  async sendDealerStarterLimitWarning(to, { dealerName = '', currentCount = 4, maxLimit = 5, upgradeUrl = '' }) {
    const tpl = templates.templateDealerStarterLimitWarning({ dealerName, currentCount, maxLimit, upgradeUrl });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'dealer_starter_limit_warning',
      idempotencyKey: `dealer_limit_warn_${to}_4`,
      isMarketing: false
    });
  }

  async sendDealerStarterLimitReached(to, { dealerName = '', currentCount = 5, maxLimit = 5, upgradeUrl = '' }) {
    const tpl = templates.templateDealerStarterLimitReached({ dealerName, currentCount, maxLimit, upgradeUrl });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'dealer_starter_limit_reached',
      idempotencyKey: `dealer_limit_reach_${to}_5`,
      isMarketing: false
    });
  }

  async sendNewInventoryAlert(to, { recipientName = '', phoneTitle = '', dealerName = '', price = null, swapValue = null, listingUrl = '', listingId = '' }) {
    const tpl = templates.templateNewInventoryAlert({ recipientName, phoneTitle, dealerName, price, swapValue, listingUrl });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'new_inventory_alert',
      idempotencyKey: listingId ? `inv_${listingId}_${to}` : null,
      isMarketing: true
    });
  }

  async sendMarketingCampaign(to, { title, previewText, contentHtml, unsubscribeUrl, preferencesUrl, campaignId = '' }) {
    const tpl = templates.templateMarketingCampaign({ title, previewText, contentHtml, unsubscribeUrl, preferencesUrl });
    return this.sendMailDirect({
      to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      templateName: 'marketing_campaign',
      idempotencyKey: campaignId ? `campaign_${campaignId}_${to}` : null,
      isMarketing: true
    });
  }
}

// Singleton instance
const emailService = new EmailService();

module.exports = {
  EmailService,
  emailService
};
