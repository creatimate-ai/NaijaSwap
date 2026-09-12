import { functions, httpsCallable } from './firebase-config.js';

export function callFirebaseFunction(name, payload = {}) {
  const callable = httpsCallable(functions, name);
  return callable(payload);
}

export function syncUserProfileBackend(payload = {}) {
  return callFirebaseFunction('syncUserProfile', payload);
}

export function submitDealerVerificationBackend(payload = {}) {
  return callFirebaseFunction('submitDealerVerification', payload);
}

export function createSwapRequestBackend(payload = {}) {
  return callFirebaseFunction('createSwapRequest', payload);
}

export function createListingBackend(payload = {}) {
  return callFirebaseFunction('createListing', payload);
}

export function updateSwapRequestStatusBackend(payload = {}) {
  return callFirebaseFunction('updateSwapRequestStatus', payload);
}

export function confirmSwapHandoverBackend(payload = {}) {
  return callFirebaseFunction('confirmSwapHandover', payload);
}

export function recordSwapInspectionBackend(payload = {}) {
  return callFirebaseFunction('recordSwapInspection', payload);
}

export function openSwapDisputeBackend(payload = {}) {
  return callFirebaseFunction('openSwapDispute', payload);
}

export function initializePaystackPayment(payload = {}) {
  return callFirebaseFunction('initializePaystackPayment', payload);
}

export function verifyPaystackPayment(payload = {}) {
  return callFirebaseFunction('verifyPaystackPayment', payload);
}
