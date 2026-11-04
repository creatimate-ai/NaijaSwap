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
 * Opens Paystack Inline Popup for Dealer Subscription
 * 
 * @param {Object} options
 * @param {string} options.email - Dealer email address
 * @param {number} [options.amountInNaira=9900] - Amount in Naira (e.g. 9900 for monthly, 99000 for annual)
 * @param {string} [options.plan='premium'] - Subscription plan name ('premium' | 'leader')
 * @param {string} [options.billingCycle='monthly'] - Billing cycle ('monthly' | 'annual')
 * @param {Function} options.onSuccess - Callback on verified payment (response) => {}
 * @param {Function} [options.onCancel] - Callback on popup cancellation
 */
export async function payDealerSubscriptionPaystack({ email, amountInNaira = 9900, plan = 'premium', billingCycle = 'monthly', dealerUid = null, onSuccess, onCancel }) {
  const amount = Number(amountInNaira) || 9900;
  const planLabel = plan === 'leader' ? 'Market Leader' : 'Premium';
  const paystackRef = `NS-${plan.toUpperCase()}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Store pending reference in localStorage for instant recovery
  try {
    localStorage.setItem('naijaswap_pending_sub_ref', paystackRef);
    localStorage.setItem('naijaswap_pending_sub_plan', plan);
    localStorage.setItem('naijaswap_pending_sub_amount', String(amount));
    localStorage.setItem('naijaswap_pending_sub_cycle', billingCycle);
  } catch (_) {}

  await loadPaystackInlineScript();

  if (!window.PaystackPop || typeof window.PaystackPop.setup !== 'function') {
    throw new Error('Paystack checkout could not be initialized.');
  }

  const handler = window.PaystackPop.setup({
    key: PAYSTACK_CONFIG.publicKey,
    email: String(email || '').trim() || 'dealer@naijaswap.ng',
    amount: Math.round(amount * 100), // in kobo
    currency: PAYSTACK_CONFIG.currency,
    ref: paystackRef,
    metadata: {
      custom_fields: [
        {
          display_name: "Platform",
          variable_name: "platform",
          value: "NaijaSwap Dealer Subscription"
        },
        {
          display_name: "Plan",
          variable_name: "plan",
          value: `${planLabel} (₦${amount.toLocaleString()}/${billingCycle === 'annual' ? 'yr' : 'mo'})`
        }
      ],
      type: 'dealer_subscription',
      dealerUid: dealerUid || '',
      uid: dealerUid || '',
      plan: plan,
      billingCycle: billingCycle,
      amountNaira: amount
    },
    callback: function(response) {
      if (typeof onSuccess === 'function') {
        onSuccess({
          reference: response.reference || paystackRef,
          status: response.status || 'success',
          trans: response.trans || '',
          amountInNaira: amount,
          plan: plan,
          billingCycle: billingCycle
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
