/**
 * NaijaSwap — Backend API Client
 * Calls the Render Express server REST API instead of Firebase Cloud Functions.
 * Firebase free tier does not include Cloud Functions.
 */
import { auth } from './firebase-config.js';

const API_BASE = globalThis.NAIJASWAP_API_BASE
  || (typeof window !== 'undefined'
    && (window.location.hostname.endsWith('.web.app') || window.location.hostname.endsWith('.firebaseapp.com'))
    ? 'https://naijaswap.onrender.com'
    : '');

async function apiRequest(path, options = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to perform this action.');
  let token = await user.getIdToken();
  const requestOptions = {
    method: options.method || 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  };
  if (options.body !== undefined) {
    requestOptions.headers['Content-Type'] = 'application/json';
    requestOptions.body = JSON.stringify(options.body);
  }

  let response = await fetch(API_BASE + path, requestOptions);
  let data = await response.json();
  if (response.status === 401 && data.error === 'Invalid authentication token.') {
    token = await user.getIdToken(true);
    requestOptions.headers['Authorization'] = `Bearer ${token}`;
    response = await fetch(API_BASE + path, requestOptions);
    data = await response.json();
  }
  if (!response.ok) {
    if (response.status === 401 && data.error === 'Invalid authentication token.') {
      throw new Error('Your sign-in could not be verified. Refresh the page; if it still fails, sign out and back in.');
    }
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function apiPost(path, body = {}) {
  return apiRequest(path, { method: 'POST', body });
}

async function apiGet(path) {
  return apiRequest(path);
}

export function syncUserProfileBackend(payload = {}) {
  // Profile sync is done directly via Firestore client SDK in auth.js
  return Promise.resolve({ ok: true });
}

export function submitDealerVerificationBackend(payload = {}) {
  return apiPost('/api/dealer-verification', payload);
}

export function createSwapRequestBackend(payload = {}) {
  return apiPost('/api/swap/create', payload);
}

export function createListingBackend(payload = {}) {
  return apiPost('/api/listing/create', payload);
}

export function createSwapperListingBackend(payload = {}) {
  return apiPost('/api/swapper/listing/create', payload);
}

export function updateSwapRequestStatusBackend(payload = {}) {
  return apiPost('/api/swap/status', payload);
}

export function confirmSwapHandoverBackend(payload = {}) {
  return apiPost('/api/swap/confirm-handover', { ...payload, confirmed: true });
}

export function recordSwapInspectionBackend(payload = {}) {
  return apiPost('/api/swap/inspection', payload);
}

export function openSwapDisputeBackend(payload = {}) {
  return apiPost('/api/swap/dispute', payload);
}

export function initializePaystackPayment(payload = {}) {
  return apiPost('/api/payments/initialize', payload);
}

export function verifyPaystackPayment(payload = {}) {
  return apiPost('/api/payments/verify', payload);
}

export function adminGetVerifications(status = 'pending') {
  return apiGet(`/api/admin/verifications?status=${encodeURIComponent(status)}`);
}

export function adminGetSwaps(status = 'all') {
  return apiGet(`/api/admin/swaps?status=${encodeURIComponent(status)}`);
}

export function adminUpdateVerificationStatus(payload = {}) {
  return apiPost('/api/admin/verification-status', payload);
}

export function verifyDeviceIMEIBackend(imei) {
  return apiPost('/api/device/verify-imei', { imei });
}

export async function getPublicCertificate(id) {
  const response = await fetch(`/api/certificate?id=${encodeURIComponent(id)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Certificate not found.');
  return data;
}
