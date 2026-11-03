/**
 * NaijaSwap User Autofill Utility
 * Centralises resolution of user identity fields (phone, address, name, etc.)
 * so every form can pre-populate them without repeating the same lookup logic.
 */

/**
 * Resolves the current user's phone / WhatsApp number from every known source
 * in descending priority order:
 *   1. Firebase Auth user.phoneNumber
 *   2. naijaswap_user_whatsapp_<uid>
 *   3. naijaswap_phone_<uid>
 *   4. naijaswap_user JSON blob .phoneNumber
 *   5. naijaswap_profile_<uid> .phone
 *
 * @param {import('firebase/auth').User|null} user  Firebase Auth user (may be null)
 * @returns {string}  Phone number string, or '' if not found
 */
export function getUserPhone(user) {
  // 1. Firebase Auth phone (set via phone-auth flow)
  if (user?.phoneNumber) return user.phoneNumber;

  const uid = user?.uid || _getLastUid();
  if (!uid) return _fallbackPhone();

  // 2 & 3. Per-uid localStorage keys
  const whatsapp = localStorage.getItem('naijaswap_user_whatsapp_' + uid);
  if (whatsapp) return whatsapp;
  const phone = localStorage.getItem('naijaswap_phone_' + uid);
  if (phone) return phone;

  // 4. naijaswap_user JSON blob
  try {
    const u = JSON.parse(localStorage.getItem('naijaswap_user') || '{}');
    if (u.phoneNumber) return u.phoneNumber;
  } catch (_) {}

  // 5. Stored profile
  try {
    const profile = JSON.parse(localStorage.getItem('naijaswap_profile_' + uid) || '{}');
    if (profile.phone) return profile.phone;
  } catch (_) {}

  return '';
}

/**
 * Resolves the current user's preferred location/address from every known source:
 *   1. naijaswap_default_location
 *   2. naijaswap_profile_<uid> .preferredHub
 *   3. naijaswap_dealer_address_<uid>  (dealers)
 *   4. naijaswap_profile_<uid> .shopAddress  (dealers)
 *
 * @param {import('firebase/auth').User|null} user
 * @returns {string}
 */
export function getUserLocation(user) {
  const uid = user?.uid || _getLastUid();

  // Generic swapper location set during onboarding
  const defaultLoc = localStorage.getItem('naijaswap_default_location');
  if (defaultLoc) return defaultLoc;

  if (!uid) return '';

  try {
    const profile = JSON.parse(localStorage.getItem('naijaswap_profile_' + uid) || '{}');
    if (profile.preferredHub) return profile.preferredHub;
    if (profile.shopAddress) return profile.shopAddress;
  } catch (_) {}

  const dealerAddress = localStorage.getItem('naijaswap_dealer_address_' + uid);
  if (dealerAddress) return dealerAddress;

  return '';
}

/**
 * Resolves the current user's display name from every known source.
 *
 * @param {import('firebase/auth').User|null} user
 * @returns {string}
 */
export function getUserDisplayName(user) {
  if (user?.displayName) return user.displayName;

  try {
    const u = JSON.parse(localStorage.getItem('naijaswap_user') || '{}');
    if (u.displayName) return u.displayName;
  } catch (_) {}

  const uid = user?.uid || _getLastUid();
  if (uid) {
    try {
      const profile = JSON.parse(localStorage.getItem('naijaswap_profile_' + uid) || '{}');
      if (profile.displayName) return profile.displayName;
      if (profile.contactPerson) return profile.contactPerson;
      if (profile.businessName) return profile.businessName;
    } catch (_) {}
  }

  return '';
}

/**
 * Resolves the current dealer's store/shop phone number, separate from their
 * personal phone.  Falls back to getUserPhone() if no dealer-specific number.
 *
 * @param {import('firebase/auth').User|null} user
 * @returns {string}
 */
export function getDealerPhone(user) {
  const uid = user?.uid || _getLastUid();
  if (uid) {
    const dealerPhone = localStorage.getItem('naijaswap_dealer_phone_' + uid);
    if (dealerPhone) return dealerPhone;
  }
  return getUserPhone(user);
}

/**
 * Resolves the current dealer's physical shop address.
 *
 * @param {import('firebase/auth').User|null} user
 * @returns {string}
 */
export function getDealerShopAddress(user) {
  const uid = user?.uid || _getLastUid();
  if (!uid) return '';

  const dealerAddr = localStorage.getItem('naijaswap_dealer_address_' + uid);
  if (dealerAddr) return dealerAddr;

  try {
    const profile = JSON.parse(localStorage.getItem('naijaswap_profile_' + uid) || '{}');
    if (profile.shopAddress) return profile.shopAddress;
  } catch (_) {}

  return '';
}

/**
 * Resolves the current dealer's store name.
 *
 * @param {import('firebase/auth').User|null} user
 * @returns {string}
 */
export function getDealerStoreName(user) {
  const uid = user?.uid || _getLastUid();
  if (uid) {
    const shopName = localStorage.getItem('naijaswap_shop_' + uid);
    if (shopName) return shopName;
  }
  if (user?.displayName) return user.displayName + "'s Store";
  try {
    const profile = JSON.parse(localStorage.getItem('naijaswap_profile_' + uid || '') || '{}');
    if (profile.businessName) return profile.businessName;
  } catch (_) {}
  return '';
}

/**
 * Autofills a single <input> or <select> element with `value` only when
 * the element currently has no user-entered value (i.e. it is blank / placeholder).
 * Passes silently if the element is null.
 *
 * @param {HTMLElement|null} el
 * @param {string} value
 */
export function autofillField(el, value) {
  if (!el || !value) return;
  if (el.value && el.value.trim() !== '') return; // don't overwrite existing input
  el.value = value;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _getLastUid() {
  return localStorage.getItem('naijaswap_last_uid') || '';
}

function _fallbackPhone() {
  try {
    const u = JSON.parse(localStorage.getItem('naijaswap_user') || '{}');
    return u.phoneNumber || '';
  } catch (_) {
    return '';
  }
}
