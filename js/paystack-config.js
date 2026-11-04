/**
 * NaijaSwap - Paystack Payment & Escrow Configuration
 * Test Mode Keys & Inline Checkout Helper
 */

export const PAYSTACK_CONFIG = {
  publicKey: 'pk_test_09a44772f93d8c3d8a74a5a42d32d436a63e6429',
  currency: 'NGN'
};

/**
 * Loads the Paystack Inline SDK script if it is not already loaded
 */
export function loadPaystackInlineScript() {
  return new Promise((resolve, reject) => {
    if (window.PaystackPop) {
      resolve(window.PaystackPop);
      return;
    }
    const existingScript = document.querySelector('script[src*="paystack.co"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.PaystackPop));
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Paystack SDK')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    script.onload = () => resolve(window.PaystackPop);
    script.onerror = () => reject(new Error('Failed to load Paystack payment script. Please check your internet connection.'));
    document.head.appendChild(script);
  });
}

/**
 * Opens Paystack Inline Popup for Escrow Top-Up Payments
 * 
 * @param {Object} options
 * @param {string} options.email - Customer email address
 * @param {number} options.amountInNaira - Amount to pay in Nigerian Naira (e.g. 50000)
 * @param {string} [options.reference] - Unique payment reference
 * @param {Object} [options.metadata] - Extra swap metadata (swapId, targetDevice, etc.)
 * @param {Function} options.onSuccess - Callback on successful transaction (response) => {}
 * @param {Function} [options.onCancel] - Callback on popup close without payment
 */
export async function payWithPaystack({ email, amountInNaira, reference, metadata = {}, onSuccess, onCancel }) {
  const amount = Number(amountInNaira);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invalid payment amount. Amount must be greater than ₦0.');
  }

  const customerEmail = String(email || '').trim() || 'customer@naijaswap.ng';
  const paystackRef = reference || (`NS-ESCROW-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`);

  // Ensure Paystack SDK is ready
  await loadPaystackInlineScript();

  if (!window.PaystackPop || typeof window.PaystackPop.setup !== 'function') {
    throw new Error('Paystack checkout could not be initialized.');
  }

  const handler = window.PaystackPop.setup({
    key: PAYSTACK_CONFIG.publicKey,
    email: customerEmail,
    amount: Math.round(amount * 100), // Paystack expects amount in KOBO (₦1 = 100 kobo)
    currency: PAYSTACK_CONFIG.currency,
    ref: paystackRef,
    metadata: {
      custom_fields: [
        {
          display_name: "Platform",
          variable_name: "platform",
          value: "NaijaSwap Escrow"
        },
        ...(metadata.swapRequestId ? [{
          display_name: "Swap Request ID",
          variable_name: "swap_request_id",
          value: metadata.swapRequestId
        }] : []),
        ...(metadata.targetDevice ? [{
          display_name: "Target Device",
          variable_name: "target_device",
          value: metadata.targetDevice
        }] : [])
      ],
      ...metadata
    },
    callback: function(response) {
      if (typeof onSuccess === 'function') {
        onSuccess({
          reference: response.reference || paystackRef,
          status: response.status || 'success',
          trans: response.trans || '',
          message: response.message || 'Approved',
          amountInNaira: amount
        });
      }
    },
    onClose: function() {
      if (typeof onCancel === 'function') {
        onCancel();
      }
    }
  });

  handler.openIframe();
  return paystackRef;
}

/**
 * Opens Paystack Inline Popup for Dealer Premium Subscription (₦9,900/month)
 * 
 * @param {Object} options
 * @param {string} options.email - Dealer email address
 * @param {Function} options.onSuccess - Callback on verified payment (response) => {}
 * @param {Function} [options.onCancel] - Callback on popup cancellation
 */
export async function payDealerSubscriptionPaystack({ email, onSuccess, onCancel }) {
  const amountInNaira = 9900;
  const paystackRef = `NS-PREMIUM-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  await loadPaystackInlineScript();

  if (!window.PaystackPop || typeof window.PaystackPop.setup !== 'function') {
    throw new Error('Paystack checkout could not be initialized.');
  }

  const handler = window.PaystackPop.setup({
    key: PAYSTACK_CONFIG.publicKey,
    email: String(email || '').trim() || 'dealer@naijaswap.ng',
    amount: Math.round(amountInNaira * 100), // 990,000 kobo (₦9,900)
    currency: PAYSTACK_CONFIG.currency,
    ref: paystackRef,
    metadata: {
      custom_fields: [
        {
          display_name: "Platform",
          variable_name: "platform",
          value: "NaijaSwap Dealer Premium Subscription"
        },
        {
          display_name: "Plan",
          variable_name: "plan",
          value: "Premium (₦9,900/mo)"
        }
      ],
      type: 'dealer_subscription',
      plan: 'premium',
      amountNaira: amountInNaira
    },
    callback: function(response) {
      if (typeof onSuccess === 'function') {
        onSuccess({
          reference: response.reference || paystackRef,
          status: response.status || 'success',
          trans: response.trans || '',
          amountInNaira
        });
      }
    },
    onClose: function() {
      if (typeof onCancel === 'function') {
        onCancel();
      }
    }
  });

  handler.openIframe();
  return paystackRef;
}
