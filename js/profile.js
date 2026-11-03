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
      listings = rawListings.filter(item => !storeId || item.storeId === storeId).length;
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Resolves the effective photo token or URL for a user from all available sources:
 * 1. localStorage ('naijaswap_photo_' + uid)
 * 2. user object (user.photoURL)
 * 3. localStorage naijaswap_user
 * 4. Stored profile (IndexedDB/localStorage)
 * 5. Firestore users/{uid}
 * 6. Firestore dealerVerification/{uid} or dealers/{uid}
 */
export async function getEffectiveUserPhoto(uid, userObj = null) {
  if (!uid && userObj?.uid) uid = userObj.uid;
  if (!uid) {
    try {
      uid = localStorage.getItem('naijaswap_last_uid') || JSON.parse(localStorage.getItem('naijaswap_user') || '{}')?.uid || '';
    } catch (_) {}
  }
  if (!uid) return userObj?.photoURL || '';

  // 1. Direct localStorage photo key
  let photo = localStorage.getItem('naijaswap_photo_' + uid);
  if (photo) return photo;

  // 2. User object photoURL
  if (userObj?.photoURL) {
    localStorage.setItem('naijaswap_photo_' + uid, userObj.photoURL);
    return userObj.photoURL;
  }

  // 3. Local cached naijaswap_user object
  try {
    const cachedUser = JSON.parse(localStorage.getItem('naijaswap_user') || '{}');
    if (cachedUser.uid === uid && cachedUser.photoURL) {
      localStorage.setItem('naijaswap_photo_' + uid, cachedUser.photoURL);
      return cachedUser.photoURL;
    }
  } catch (_) {}

  // 4. Stored profile in localStorage
  try {
    const profile = getStoredProfile(uid);
    if (profile.avatar || profile.photoURL || profile.storeLogo) {
      const p = profile.avatar || profile.photoURL || profile.storeLogo;
      localStorage.setItem('naijaswap_photo_' + uid, p);
      return p;
    }
  } catch (_) {}

  // 5. Remote Firestore lookup: users/{uid}
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) {
      const uData = userSnap.data();
      const remotePhoto = uData.photoURL || uData.avatar || uData.storeLogo || uData.logo || uData.profilePicture;
      if (remotePhoto) {
        localStorage.setItem('naijaswap_photo_' + uid, remotePhoto);
        return remotePhoto;
      }
    }
  } catch (_) {}

  // 6. Remote Firestore lookup: dealerVerification/{uid} & dealers/{uid}
  try {
    const verSnap = await getDoc(doc(db, 'dealerVerification', uid));
    if (verSnap.exists()) {
      const vData = verSnap.data();
      const remotePhoto = vData.storeLogo || vData.photoURL || vData.avatar;
      if (remotePhoto) {
        localStorage.setItem('naijaswap_photo_' + uid, remotePhoto);
        return remotePhoto;
      }
    }
  } catch (_) {}

  try {
    const dealerSnap = await getDoc(doc(db, 'dealers', uid));
    if (dealerSnap.exists()) {
      const dData = dealerSnap.data();
      const remotePhoto = dData.storeLogo || dData.photoURL || dData.avatar;
      if (remotePhoto) {
        localStorage.setItem('naijaswap_photo_' + uid, remotePhoto);
        return remotePhoto;
      }
    }
  } catch (_) {}

  return '';
}

/**
 * Renders an avatar into a container element (e.g., #storeAvatarFallback, #headerAvatarFallback, #moreAvatarNode)
 * Resolves IndexedDB tokens, Cloudinary URLs, data URIs, and sets <img> with error fallback to initial.
 */
export async function renderAvatarElement(containerEl, uid, fallbackName = 'User', userObj = null) {
  if (!containerEl) return;
  const initial = (fallbackName || 'U').trim().charAt(0).toUpperCase() || 'U';

  const photoToken = await getEffectiveUserPhoto(uid, userObj);
  if (photoToken) {
    try {
      const src = await resolveMedia(photoToken);
      if (src && containerEl) {
        const isSafeProtocol = typeof src === 'string' && (src.startsWith('https://') || src.startsWith('data:image/') || src.startsWith('blob:') || src.startsWith('assets/'));
        if (isSafeProtocol) {
          const img = document.createElement('img');
          img.src = src;
          img.alt = fallbackName || 'User';
          img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block;';
          img.onerror = () => { containerEl.textContent = initial; };
          containerEl.innerHTML = '';
          containerEl.appendChild(img);
          return;
        }
        return;
      }
    } catch (err) {
      console.warn('[Avatar] Error resolving media:', err);
    }
  }

  if (containerEl) {
    containerEl.textContent = initial;
  }
}
