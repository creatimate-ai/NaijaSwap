import { 
  storeMedia, 
  resolveMedia, 
  displayMedia, 
  purgeLocalStorageImages, 
  saveMediaToIndexedDb, 
  getMediaFromIndexedDb, 
  removeMediaFromIndexedDb 
} from './media-storage.js';
import { db, doc, getDoc } from './firebase-config.js';

export { 
  storeMedia, 
  resolveMedia, 
  displayMedia, 
  purgeLocalStorageImages, 
  saveMediaToIndexedDb, 
  getMediaFromIndexedDb, 
  removeMediaFromIndexedDb 
};

const PROFILE_KEY_PREFIX = 'naijaswap_profile_';

export function getStoredProfile(uid) {
  if (!uid) return {};
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY_PREFIX + uid) || '{}');
  } catch (error) {
    console.warn('Unable to read stored profile:', error);
    return {};
  }
}

export function saveDocToIndexedDb(key, data) {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open('naijaswap_docs_db', 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('kyc_docs')) {
          db.createObjectStore('kyc_docs');
        }
      };
      request.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('kyc_docs', 'readwrite');
        const store = tx.objectStore('kyc_docs');
        store.put(data, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      };
      request.onerror = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}

export function compressImageFile(file, maxWidth = 800, maxHeight = 800, quality = 0.72) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    if (file.type && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => resolve(e.target.result);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    } else {
      // Non-image document (PDF, etc.)
      const token = `verified_doc:${encodeURIComponent(file.name)}:${file.size}`;
      resolve(token);
    }
  });
}

function pruneNonEssentialStorage() {
  try {
    sessionStorage.removeItem('naijaswap_session_logs');
    localStorage.removeItem('naijaswap_session_logs');
    localStorage.removeItem('naijaswap_auth_diagnostic');
  } catch (_) {}
}

export function saveStoredProfile(uid, profile) {
  if (!uid) throw new Error('A signed-in user is required to save profile details.');
  
  // Proactively prevent QuotaExceededError by offloading all base64 data to IndexedDB
  const cleanProfile = { ...profile };

  if (cleanProfile.avatar && cleanProfile.avatar.startsWith('data:')) {
    saveMediaToIndexedDb(`avatar_${uid}`, cleanProfile.avatar);
    cleanProfile.avatar = `idb:avatar_${uid}`;
  }
  if (cleanProfile.photoURL && cleanProfile.photoURL.startsWith('data:')) {
    saveMediaToIndexedDb(`avatar_${uid}`, cleanProfile.photoURL);
    cleanProfile.photoURL = `idb:avatar_${uid}`;
  }
  if (cleanProfile.governmentIdData && cleanProfile.governmentIdData.startsWith('data:')) {
    saveDocToIndexedDb(`${uid}_gov_id`, cleanProfile.governmentIdData);
    saveMediaToIndexedDb(`gov_id_${uid}`, cleanProfile.governmentIdData);
    cleanProfile.governmentIdData = `idb:gov_id_${uid}`;
  }
  if (cleanProfile.proofOfAddressData && cleanProfile.proofOfAddressData.startsWith('data:')) {
    saveDocToIndexedDb(`${uid}_proof_of_address`, cleanProfile.proofOfAddressData);
    saveMediaToIndexedDb(`proof_address_${uid}`, cleanProfile.proofOfAddressData);
    cleanProfile.proofOfAddressData = `idb:proof_address_${uid}`;
  }

  try {
    localStorage.setItem(PROFILE_KEY_PREFIX + uid, JSON.stringify(cleanProfile));
  } catch (err) {
    console.warn('[NaijaSwap] localStorage save warning:', err.message);
    
    // Check if QuotaExceededError
    const isQuota = err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);
    if (isQuota) {
      pruneNonEssentialStorage();
      try {
        localStorage.setItem(PROFILE_KEY_PREFIX + uid, JSON.stringify(cleanProfile));
        console.info('[NaijaSwap] Successfully stored lightweight profile after storage prune.');
      } catch (secondErr) {
        console.error('[NaijaSwap] Still exceeded quota after storage prune:', secondErr);
        // Save only essential text fields as last resort
        const essentialOnly = {
          nin: cleanProfile.nin,
          bvn: cleanProfile.bvn,
          businessName: cleanProfile.businessName,
          businessEmail: cleanProfile.businessEmail,
          shopAddress: cleanProfile.shopAddress,
          geoTag: cleanProfile.geoTag,
          bankName: cleanProfile.bankName,
          bankAccountNumber: cleanProfile.bankAccountNumber,
          cacNumber: cleanProfile.cacNumber,
          governmentIdData: cleanProfile.governmentIdData || 'verified_uploaded:government_id',
          proofOfAddressData: cleanProfile.proofOfAddressData || 'verified_uploaded:proof_of_address'
        };
        localStorage.setItem(PROFILE_KEY_PREFIX + uid, JSON.stringify(essentialOnly));
      }
    } else {
      throw err;
    }
  }
}

export function getDealerVerificationStatus(uid) {
  if (!uid) return 'unverified';
  const status = localStorage.getItem('naijaswap_dealer_status_' + uid);
  if (status) return status;
  if (localStorage.getItem('naijaswap_dealer_verified_' + uid) === 'true') return 'approved';
  return 'unverified';
}

export async function syncDealerVerificationStatus(uid) {
  if (!uid) return 'unverified';
  let status = getDealerVerificationStatus(uid);
  try {
    const snapshot = await getDoc(doc(db, 'dealers', uid));
    if (snapshot.exists() && snapshot.data().status) {
      status = snapshot.data().status;
      localStorage.setItem('naijaswap_dealer_status_' + uid, status);
      localStorage.setItem('naijaswap_dealer_verified_' + uid, status === 'approved' ? 'true' : status);
      if (snapshot.data().rejectionReason) {
        localStorage.setItem('naijaswap_dealer_reject_reason_' + uid, snapshot.data().rejectionReason);
      }
    }
  } catch (error) {
    console.warn('[NaijaSwap] Could not sync dealer verification status:', error.message);
  }
  return status;
}

export function isProfileComplete(user, role = 'customer') {
  let uid = user?.uid || (typeof user === 'string' ? user : null);
  if (!uid) {
    try {
      uid = localStorage.getItem('naijaswap_last_uid')
        || JSON.parse(localStorage.getItem('naijaswap_user') || '{}')?.uid
        || JSON.parse(localStorage.getItem('naijaswap_user') || '{}')?.uid
        || '';
    } catch (_) {}
  }

  // Check if dealer verification is approved by admin
  if (role === 'dealer') {
    if (uid) {
      const status = localStorage.getItem('naijaswap_dealer_status_' + uid);
      if (status === 'approved' || localStorage.getItem('naijaswap_dealer_verified_' + uid) === 'true') {
        return true;
      }
      if (status === 'pending' || status === 'rejected') {
        return false;
      }
    }

    const lastRole = localStorage.getItem('naijaswap_last_role');
    if (lastRole === 'dealer') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('naijaswap_dealer_verified_') && localStorage.getItem(key) === 'true') {
          return true;
        }
      }
    }
    return false;
  }

  const email = user?.email || profile.email;
  const name = user?.displayName || profile.businessName || profile.name || profile.displayName;
  return Boolean(email && name);
}

export function requireCompleteProfile(user, role, action, options = {}) {
  if (isProfileComplete(user, role)) return true;
  sessionStorage.setItem('naijaswap_profile_required_action', action || 'continue');

  if (typeof options === 'function') {
    options();
    return false;
  }
  if (options && typeof options.onIncomplete === 'function') {
    options.onIncomplete();
    return false;
  }

  // If a verification prompt modal exists in the document, show it instead of redirecting immediately
  const modal = document.getElementById('dealerVerificationModal') || document.getElementById('verificationPromptModal');
  if (modal && role === 'dealer') {
    modal.classList.add('active');
    return false;
  }

  window.location.href = role === 'dealer'
    ? 'dealer-verification.html?required=' + encodeURIComponent(action || 'continue')
    : 'account.html?required=' + encodeURIComponent(action || 'continue');
  return false;
}

export function showDealerVerificationPrompt(action = 'create a listing') {
  sessionStorage.setItem('naijaswap_profile_required_action', action);
  const modal = document.getElementById('dealerVerificationModal') || document.getElementById('verificationPromptModal');
  if (modal) {
    modal.classList.add('active');
    return true;
  }
  window.location.href = 'dealer-verification.html?required=' + encodeURIComponent(action);
  return false;
}

export function getStoredRole(uid) {
  if (uid) {
    const directRole = localStorage.getItem('naijaswap_role_' + uid);
    if (directRole) return directRole.toLowerCase();
    if (localStorage.getItem('naijaswap_shop_' + uid)) return 'dealer';
  }
  const lastRole = localStorage.getItem('naijaswap_last_role');
  if (lastRole) return lastRole.toLowerCase();

  return 'customer';
}

export function maskSensitive(str, visibleEnd = 4) {
  if (!str) return 'Not Provided';
  const clean = String(str).trim();
  if (clean.length <= visibleEnd) return clean;
  return '*'.repeat(Math.max(3, clean.length - visibleEnd)) + clean.slice(-visibleEnd);
}

export function getStoreMetrics(storeId) {
  let listings = 0;
  let requests = 0;
  let completed = 0;
  try {
    const rawListings = JSON.parse(localStorage.getItem('naijaswap_marketplace_listings') || '[]');
    if (Array.isArray(rawListings)) {
      listings = rawListings.filter(item => !storeId || item.storeId === storeId || item.storeId === 'store_prime').length;
    }
  } catch (_) {}
  try {
    const rawRequests = JSON.parse(localStorage.getItem('naijaswap_swap_requests') || '[]');
    if (Array.isArray(rawRequests)) {
      requests = rawRequests.length;
      completed = rawRequests.filter(r => r.status === 'completed' || r.status === 'accepted').length;
    }
  } catch (_) {}
  return { listings, requests, completed };
}
