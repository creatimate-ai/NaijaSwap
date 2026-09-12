import { auth } from './firebase-config.js';

const API_BASE_URL = window.NAIJASWAP_API_URL || 'https://naijaswap.onrender.com';

async function callRenderApi(path, payload = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in before continuing.');
  // Refresh the token so Render never receives an expired Firebase credential.
  const token = await user.getIdToken(true);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The server could not complete this request.');
  return result;
}

export function signCloudinaryUpload(payload = {}) {
  return callRenderApi('/api/cloudinary/sign-upload', payload);
}

export function submitDealerVerificationRender(payload = {}) {
  return callRenderApi('/api/dealer-verification', payload);
}

export function initializePaystackPaymentRender(payload = {}) {
  return callRenderApi('/api/payments/initialize', payload);
}

export function verifyPaystackPaymentRender(payload = {}) {
  return callRenderApi('/api/payments/verify', payload);
}
