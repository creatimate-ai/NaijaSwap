/**
 * NaijaSwap — Backend API Client
 * Calls the Render Express server REST API instead of Firebase Cloud Functions.
 * Firebase free tier does not include Cloud Functions.
 */
import { auth } from './firebase-config.js';

const API_BASE = '';

async function apiPost(path, body = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to perform this action.');
  const token = await user.getIdToken();
  const response = await fetch(API_BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function apiGet(path) {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to perform this action.');
  const token = await user.getIdToken();
  const response = await fetch(API_BASE + path, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
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
