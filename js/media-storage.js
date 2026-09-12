/**
 * NaijaSwap - Cloudinary & IndexedDB Media Storage Controller
 * Prevents QuotaExceededError by ensuring images & documents NEVER store raw base64 in localStorage.
 * Cloud Provider: Cloudinary (unsigned direct browser upload).
 * IndexedDB is only a local offline fallback; Firebase Storage is not used.
 * Resilient-fallback: Stores in IndexedDB (naijaswap_media_db) with lightweight 'idb:<key>' references
 */

export { CLOUDINARY_CONFIG, uploadToCloudinary } from './cloudinary-config.js';
import { uploadToCloudinary, CLOUDINARY_CONFIG } from './cloudinary-config.js';

const DB_NAME = 'naijaswap_media_db';
const STORE_NAME = 'media_store';
const DB_VERSION = 1;

let dbPromise = null;

export function getMediaDb() {
  if (dbPromise) return dbPromise;
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => {
        console.warn('[MediaStorage] IndexedDB open error:', e);
        resolve(null);
      };
    } catch (err) {
      console.warn('[MediaStorage] IndexedDB unsupported or error:', err);
      resolve(null);
    }
  });

  return dbPromise;
}

export async function saveMediaToIndexedDb(key, data) {
  if (!key || !data) return false;
  const db = await getMediaDb();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(data, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}

export async function getMediaFromIndexedDb(key) {
  if (!key) return null;
  const db = await getMediaDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

export async function removeMediaFromIndexedDb(key) {
  if (!key) return false;
  const db = await getMediaDb();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}

/**
 * Stores an image/media asset.
 * Tries Cloudinary first (returns a Cloudinary HTTPS URL).
 * If offline or Cloudinary fails, saves in IndexedDB and returns 'idb:<key>' reference.
 * GUARANTEE: The returned string is ALWAYS a short URL or token (< 120 chars), NEVER raw base64.
 */
export async function storeMedia(keyPrefix, dataUrl, options = {}) {
  if (!dataUrl) return '';
  
  // If it's already an HTTPS URL, local asset path, or existing idb: token, no storage needed
  if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://') || dataUrl.startsWith('assets/') || dataUrl.startsWith('idb:')) {
    return dataUrl;
  }

  const cloudFolder = options.folder || 'user_uploads';
  const fileName = `${keyPrefix}_${Date.now()}`;
  const idbKey = `${keyPrefix}_${Date.now()}`;

  // 1. Upload directly to Cloudinary if online and configured.
  const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (isOnline && CLOUDINARY_CONFIG.cloudName && CLOUDINARY_CONFIG.uploadPreset) {
    try {
      const httpsUrl = await uploadToCloudinary(dataUrl, cloudFolder);
      if (httpsUrl) {
        // Also cache locally in IndexedDB for fast instant display
        saveMediaToIndexedDb(idbKey, dataUrl);
        return httpsUrl;
      }
    } catch (cErr) {
      console.warn('[MediaStorage] Cloudinary upload skipped/failed, falling back to IndexedDB:', cErr?.message || cErr);
    }
  }

  // 2. Resilient Fallback: High-Capacity IndexedDB
  const idbSaved = await saveMediaToIndexedDb(idbKey, dataUrl);
  if (idbSaved) {
    return `idb:${idbKey}`;
  }

  return `idb:${idbKey}`;
}

/**
 * Resolves a media token or URL to a displayable image source (HTTPS URL or DataURL/BlobURL).
 */
export async function resolveMedia(urlOrToken) {
  if (!urlOrToken || typeof urlOrToken !== 'string') return '';

  if (urlOrToken.startsWith('http://') || urlOrToken.startsWith('https://') || urlOrToken.startsWith('assets/') || urlOrToken.startsWith('data:image/svg+xml')) {
    return urlOrToken;
  }

  if (urlOrToken.startsWith('idb:')) {
    const key = urlOrToken.replace(/^idb:/, '');
    const data = await getMediaFromIndexedDb(key);
    if (data) return data;
  }

  // If it's a legacy dataUrl, return it
  if (urlOrToken.startsWith('data:image/')) {
    return urlOrToken;
  }

  return '';
}

/**
 * Safely renders an image in an <img> tag, resolving from Cloud / IndexedDB automatically.
 */
export async function displayMedia(imgElement, urlOrToken, placeholderElement) {
  if (!imgElement) return;

  if (!urlOrToken) {
    imgElement.src = '';
    imgElement.style.display = 'none';
    if (placeholderElement) placeholderElement.style.display = 'flex';
    return;
  }

  if (urlOrToken.startsWith('http://') || urlOrToken.startsWith('https://') || urlOrToken.startsWith('assets/')) {
    imgElement.src = urlOrToken;
    imgElement.style.display = 'block';
    if (placeholderElement) placeholderElement.style.display = 'none';
    return;
  }

  const resolved = await resolveMedia(urlOrToken);
  if (resolved) {
    imgElement.src = resolved;
    imgElement.style.display = 'block';
    if (placeholderElement) placeholderElement.style.display = 'none';
  } else {
    imgElement.style.display = 'none';
    if (placeholderElement) placeholderElement.style.display = 'flex';
  }
}

/**
 * Proactively cleans up localStorage by migrating any large base64 image strings
 * to IndexedDB, permanently preventing QuotaExceededError.
 */
export async function purgeLocalStorageImages() {
  if (typeof localStorage === 'undefined') return;

  let cleanedAny = false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      // 1. Check naijaswap_photo_<uid>
      if (key.startsWith('naijaswap_photo_')) {
        const val = localStorage.getItem(key);
        if (val && val.startsWith('data:image/')) {
          const uid = key.replace('naijaswap_photo_', '');
          const idbKey = `avatar_${uid}`;
          await saveMediaToIndexedDb(idbKey, val);
          localStorage.setItem(key, `idb:${idbKey}`);
          cleanedAny = true;
          console.info(`[MediaStorage] Migrated ${key} to IndexedDB`);
        }
      }

      // 2. Check naijaswap_profile_<uid>
      if (key.startsWith('naijaswap_profile_')) {
        try {
          const prof = JSON.parse(localStorage.getItem(key) || '{}');
          let modified = false;
          const uid = key.replace('naijaswap_profile_', '');

          if (prof.avatar && prof.avatar.startsWith('data:image/')) {
            const idbKey = `profile_avatar_${uid}`;
            await saveMediaToIndexedDb(idbKey, prof.avatar);
            prof.avatar = `idb:${idbKey}`;
            modified = true;
          }
          if (prof.governmentIdData && prof.governmentIdData.startsWith('data:')) {
            const idbKey = `gov_id_${uid}`;
            await saveMediaToIndexedDb(idbKey, prof.governmentIdData);
            prof.governmentIdData = `idb:${idbKey}`;
            modified = true;
          }
          if (prof.proofOfAddressData && prof.proofOfAddressData.startsWith('data:')) {
            const idbKey = `proof_address_${uid}`;
            await saveMediaToIndexedDb(idbKey, prof.proofOfAddressData);
            prof.proofOfAddressData = `idb:${idbKey}`;
            modified = true;
          }

          if (modified) {
            localStorage.setItem(key, JSON.stringify(prof));
            cleanedAny = true;
            console.info(`[MediaStorage] Cleaned profile images for ${key}`);
          }
        } catch (_) {}
      }

      // 3. Check naijaswap_user or naijaswap_user
      if (key === 'naijaswap_user' || key === 'naijaswap_user') {
        try {
          const u = JSON.parse(localStorage.getItem(key) || '{}');
          if (u.photoURL && u.photoURL.startsWith('data:image/')) {
            const idbKey = `user_photo_${u.uid || 'current'}`;
            await saveMediaToIndexedDb(idbKey, u.photoURL);
            u.photoURL = `idb:${idbKey}`;
            localStorage.setItem(key, JSON.stringify(u));
            cleanedAny = true;
          }
        } catch (_) {}
      }

      // 4. Check naijaswap_marketplace_listings
      if (key === 'naijaswap_marketplace_listings') {
        try {
          const listings = JSON.parse(localStorage.getItem(key) || '[]');
          let modified = false;
          if (Array.isArray(listings)) {
            for (let item of listings) {
              if (item.image && item.image.startsWith('data:image/')) {
                const idbKey = `listing_${item.id}_hero`;
                await saveMediaToIndexedDb(idbKey, item.image);
                item.image = `idb:${idbKey}`;
                item.heroImage = `idb:${idbKey}`;
                modified = true;
              }
              if (Array.isArray(item.mediaFiles)) {
                for (let m = 0; m < item.mediaFiles.length; m++) {
                  if (item.mediaFiles[m]?.dataUrl && item.mediaFiles[m].dataUrl.startsWith('data:')) {
                    const idbKey = `listing_${item.id}_media_${m}`;
                    await saveMediaToIndexedDb(idbKey, item.mediaFiles[m].dataUrl);
                    item.mediaFiles[m].dataUrl = `idb:${idbKey}`;
                    modified = true;
                  }
                }
              }
            }
          }
          if (modified) {
            localStorage.setItem(key, JSON.stringify(listings));
            cleanedAny = true;
            console.info('[MediaStorage] Cleaned marketplace listing images from localStorage');
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn('[MediaStorage] Error during localStorage purge:', err);
  }

  if (cleanedAny) {
    console.info('[MediaStorage] Storage optimization complete. LocalStorage freed up!');
  }
}

/**
 * Automatically observes the document and resolves any <img> with src starting with 'idb:'
 */
export function setupAutoMediaResolver() {
  if (typeof window === 'undefined') return;

  function resolveImgElements(root = document) {
    if (!root.querySelectorAll) return;
    const imgs = root.querySelectorAll('img');
    imgs.forEach(async img => {
      const src = img.getAttribute('src');
      if (src && src.startsWith('idb:')) {
        const resolved = await resolveMedia(src);
        if (resolved) {
          img.src = resolved;
        }
      }
    });
  }

  // Initial check on current DOM
  resolveImgElements();

  // MutationObserver for dynamically injected images
  if (typeof MutationObserver !== 'undefined' && document.body) {
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
              if (node.tagName === 'IMG') {
                const src = node.getAttribute('src');
                if (src && src.startsWith('idb:')) {
                  resolveMedia(src).then(resolved => { if (resolved) node.src = resolved; });
                }
              } else if (node.querySelectorAll) {
                resolveImgElements(node);
              }
            }
          });
        } else if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
          const target = mutation.target;
          if (target && target.tagName === 'IMG') {
            const src = target.getAttribute('src');
            if (src && src.startsWith('idb:')) {
              resolveMedia(src).then(resolved => { if (resolved) target.src = resolved; });
            }
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
  }
}

// Auto-run purge & auto media resolver on load to immediately protect against QuotaExceededError
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      purgeLocalStorageImages();
      setupAutoMediaResolver();
    });
  } else {
    purgeLocalStorageImages();
    setupAutoMediaResolver();
  }
}
