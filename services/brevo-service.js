/**
 * NigerSwap - Brevo (Sendinblue) API & Marketing Integration Engine
 * Provides complete programmatic control over Brevo:
 * - Account health & connection verification
 * - Contact & audience management (sync users, assign to lists, track custom attributes)
 * - Brevo email template creation & synchronization
 * - Transactional email delivery via Brevo REST API v3
 * - Marketing campaign creation and broadcasting (e.g. New Inventory Drops)
 */

const fs = require('fs');
const path = require('path');

// Auto-load .env file if available
function loadEnv() {
  const candidates = [
    path.resolve(__dirname, '..', '.env'),
    path.resolve(__dirname, '.env'),
    path.resolve(process.cwd(), '.env')
  ];
  for (const envFile of candidates) {
    if (fs.existsSync(envFile)) {
      try {
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
      } catch (_) {}
    }
  }
}
loadEnv();

const BREVO_API_BASE = 'https://api.brevo.com/v3';

class BrevoService {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.BREVO_API_KEY || null;
    this.defaultSenderEmail = options.senderEmail || process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_FROM_ADDRESS || 'noreply@naijaswap.ng';
    this.defaultSenderName = options.senderName || process.env.BREVO_SENDER_NAME || 'NigerSwap';
  }

  getApiKey() {
    return this.apiKey || process.env.BREVO_API_KEY;
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  isConfigured() {
    return Boolean(this.getApiKey());
  }

  /**
   * Helper for authorized Brevo API requests
   */
  async request(endpoint, { method = 'GET', body = null } = {}) {
    const key = this.getApiKey();
    if (!key) {
      throw new Error('BREVO_API_KEY is not configured in environment variables or .env file.');
    }

    const headers = {
      'api-key': key,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    const config = {
      method,
      headers
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      config.body = JSON.stringify(body);
    }

    const response = await fetch(`${BREVO_API_BASE}${endpoint}`, config);
    const contentType = response.headers.get('content-type') || '';
    let data = null;

    if (contentType.includes('application/json')) {
      data = await response.json().catch(() => null);
    } else {
      data = await response.text().catch(() => null);
    }

    if (!response.ok) {
      const errorMsg = data && data.message ? data.message : `Brevo API HTTP ${response.status}: ${response.statusText}`;
      const error = new Error(errorMsg);
      error.status = response.status;
      error.details = data;
      throw error;
    }

    return data;
  }

  // ==========================================================
  // 1. ACCOUNT & CONNECTION TEST
  // ==========================================================

  /**
   * Test the connection to Brevo by querying account info
   */
  async testConnection() {
    try {
      const account = await this.request('/account');
      const senders = await this.getSenders().catch(() => []);
      return {
        ok: true,
        connected: true,
        email: account.email,
        companyName: account.companyName,
        plan: account.plan || [],
        senders: Array.isArray(senders.senders) ? senders.senders.map(s => ({ email: s.email, name: s.name, active: s.active })) : []
      };
    } catch (err) {
      return {
        ok: false,
        connected: false,
        error: err.message,
        details: err.details || null
      };
    }
  }

  /**
   * List verified senders registered in Brevo
   */
  async getSenders() {
    return this.request('/senders');
  }

  // ==========================================================
  // 2. CONTACT & AUDIENCE MANAGEMENT (Marketing Sync)
  // ==========================================================

  /**
   * Create or update a contact in Brevo
   * Call this on User Sign-Up or Profile Update to sync them to Brevo marketing lists!
   */
  async syncContact({ email, firstName = '', lastName = '', role = 'customer', phone = '', listIds = [], customAttributes = {} }) {
    if (!email) throw new Error('Email is required to sync contact to Brevo.');

    const normalizedEmail = email.trim().toLowerCase();
    const attributes = {
      FIRSTNAME: firstName || undefined,
      LASTNAME: lastName || undefined,
      ROLE: role || 'customer',
      PHONE: phone || undefined,
      ...customAttributes
    };

    // Remove undefined attributes
    Object.keys(attributes).forEach((k) => attributes[k] === undefined && delete attributes[k]);

    const payload = {
      email: normalizedEmail,
      attributes,
      updateEnabled: true
    };

    if (Array.isArray(listIds) && listIds.length > 0) {
      payload.listIds = listIds;
    }

    try {
      // POST /contacts with updateEnabled=true creates if new, updates if exists
      const res = await this.request('/contacts', {
        method: 'POST',
        body: payload
      });
      return { ok: true, contactId: res?.id || null, email: normalizedEmail };
    } catch (err) {
      // If contact already exists (HTTP 400 with duplicate_parameter), update directly
      if (err.status === 400 && (err.message.includes('Contact already exist') || err.message.includes('duplicate_parameter'))) {
        await this.request(`/contacts/${encodeURIComponent(normalizedEmail)}`, {
          method: 'PUT',
          body: { attributes, listIds }
        });
        return { ok: true, updated: true, email: normalizedEmail };
      }
      throw err;
    }
  }

  /**
   * Get all contact lists in Brevo
   */
  async getContactLists() {
    return this.request('/contacts/lists?limit=50&offset=0');
  }

  /**
   * Create a new contact list (e.g. "NigerSwap Swappers", "Verified Dealers")
   */
  async createContactList(name, folderId = 1) {
    return this.request('/contacts/lists', {
      method: 'POST',
      body: { name, folderId }
    });
  }

  // ==========================================================
  // 3. TRANSACTIONAL EMAIL (REST API)
  // ==========================================================

  /**
   * Send a transactional email via Brevo REST API v3
   */
  async sendEmail({ to, subject, htmlContent, textContent = '', sender = null, tags = [], params = {} }) {
    if (!to) throw new Error('Recipient (to) is required.');

    const recipients = Array.isArray(to)
      ? to.map(r => (typeof r === 'string' ? { email: r } : r))
      : [{ email: typeof to === 'string' ? to : to.email, name: to.name || undefined }];

    const payload = {
      sender: sender || {
        name: this.defaultSenderName,
        email: this.defaultSenderEmail
      },
      to: recipients,
      subject,
      htmlContent,
      ...(textContent ? { textContent } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(Object.keys(params).length > 0 ? { params } : {})
    };

    const res = await this.request('/smtp/email', {
      method: 'POST',
      body: payload
    });

    return {
      ok: true,
      messageId: res.messageId
    };
  }

  // ==========================================================
  // 4. TEMPLATE MANAGEMENT (Operate in Brevo directly)
  // ==========================================================

  /**
   * List all templates currently saved in Brevo
   */
  async getTemplates() {
    return this.request('/smtp/templates?templateStatus=true&limit=50');
  }

  /**
   * Programmatically push an HTML email template into Brevo
   */
  async createTemplate({ templateName, subject, htmlContent, sender = null, isActive = true }) {
    const payload = {
      sender: sender || {
        name: this.defaultSenderName,
        email: this.defaultSenderEmail
      },
      templateName,
      subject,
      htmlContent,
      isActive
    };

    return this.request('/smtp/templates', {
      method: 'POST',
      body: payload
    });
  }

  /**
   * Update an existing Brevo template by ID
   */
  async updateTemplate(templateId, { templateName, subject, htmlContent, isActive = true }) {
    const payload = {
      templateName,
      subject,
      htmlContent,
      isActive
    };

    return this.request(`/smtp/templates/${templateId}`, {
      method: 'PUT',
      body: payload
    });
  }

  // ==========================================================
  // 5. MARKETING CAMPAIGNS (New Inventory Drops)
  // ==========================================================

  /**
   * Create an email marketing campaign in Brevo (e.g. for new inventory drops)
   */
  async createCampaign({ name, subject, htmlContent, listIds = [], sender = null, scheduledAt = null }) {
    const payload = {
      tag: 'inventory_drop',
      sender: sender || {
        name: this.defaultSenderName,
        email: this.defaultSenderEmail
      },
      name,
      subject,
      htmlContent,
      recipients: {
        listIds
      },
      ...(scheduledAt ? { scheduledAt } : {})
    };

    return this.request('/emailCampaigns', {
      method: 'POST',
      body: payload
    });
  }

  /**
   * Send or trigger a campaign immediately
   */
  async sendCampaignNow(campaignId) {
    return this.request(`/emailCampaigns/${campaignId}/sendNow`, {
      method: 'POST'
    });
  }
}

const brevoService = new BrevoService();

module.exports = {
  BrevoService,
  brevoService
};
