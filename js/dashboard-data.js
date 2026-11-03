/**
 * NaijaSwap - Centralized Data & Marketplace Controller
 * Handles persistent state for Swapper browsing and Store/Dealer inventory management.
 */
import { db, collection, getDocs, query, where, orderBy, limit } from './firebase-config.js';
import { createReviewBackend } from './backend-api.js';

const STORAGE_KEYS = {
  LISTINGS: 'naijaswap_marketplace_listings',
  SWAP_REQUESTS: 'naijaswap_swap_requests',
  ACTIVITY_LOG: 'naijaswap_activity_log',
  NOTIFICATIONS: 'naijaswap_user_notifications',
  USER_DEVICES: 'naijaswap_user_devices',
  REVIEWS: 'naijaswap_reviews',
  INITIALIZED: 'naijaswap_data_initialized_v3'
};

const SWAP_STATUS_ALIASES = {
  pending: 'pending',
  reviewed: 'reviewed',
  accepted: 'accepted',
  countered: 'countered',
  hub_booked: 'hub_booked',
  under_inspection: 'under_inspection',
  inspection_passed: 'inspection_passed',
  completed: 'completed',
  rejected: 'rejected',
  declined: 'rejected',
  cancelled: 'cancelled'
};

function normalizeSwapStatus(status) {
  const normalized = String(status || 'pending').trim().toLowerCase();
  return SWAP_STATUS_ALIASES[normalized] || (normalized ? normalized : 'pending');
}

function safeSetItem(key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  try {
    localStorage.setItem(key, str);
  } catch (err) {
    if (err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014)) {
      console.warn(`[LocalStorage QuotaExceeded] Safe fallback active for key: ${key}`);
      try {
        if (Array.isArray(value)) {
          const trimmed = value.map(item => {
            if (typeof item === 'object' && item !== null) {
              const { deviceMedia, mediaFiles, backImage, accessoriesImage, damageDisclosure, ...rest } = item;
              return rest;
            }
            return item;
          }).slice(0, 30);
          localStorage.setItem(key, JSON.stringify(trimmed));
        } else {
          localStorage.removeItem(STORAGE_KEYS.ACTIVITY_LOG);
          localStorage.removeItem(STORAGE_KEYS.NOTIFICATIONS);
          localStorage.setItem(key, str);
        }
      } catch (_) {
        console.warn(`[LocalStorage QuotaExceeded] Could not write to local storage key: ${key}`);
      }
    }
  }
}

function mapRemoteListing(snapshot) {
  const data = snapshot.data() || {};
  const storeId = data.storeId || data.storeOwnerUid || data.dealerUid || '';
  const storeOwnerUid = data.storeOwnerUid || data.storeId || data.dealerUid || '';
  return {
    id: snapshot.id,
    ...data,
    storeId,
    storeOwnerUid,
    status: String(data.status || 'active').toLowerCase(),
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || new Date().toISOString()
  };
}

function mapRemoteRequest(snapshot) {
  const data = snapshot.data() || {};
  const current = data.currentDevice || {};
  const target = data.targetDevice || {};
  const dealerUid = data.dealerUid || data.storeOwnerUid || data.storeId || '';
  const topupNum = typeof data.topupAmount === 'number' ? data.topupAmount : (parseFloat(String(data.topupAmount || '').replace(/[^0-9.]/g, '')) || 0);
  const tradeInNum = typeof data.offeredPrice === 'number' ? data.offeredPrice : (parseFloat(String(data.offeredPrice || '').replace(/[^0-9.]/g, '')) || 0);

  // Derive stable 6-digit SafeSwap Passcode if missing
  const derivedSafeCode = data.safeSwapCode || data.passcode || ('NS-' + (snapshot.id ? snapshot.id.replace(/\D/g, '').slice(-6) : Math.floor(100000 + Math.random() * 900000)));

  return {
    id: snapshot.id,
    firestoreId: snapshot.id,
    safeSwapCode: derivedSafeCode,
    hubBooking: data.hubBooking || null,
    triageResults: data.triageResults || null,
    certificateId: data.certificateId || null,
    customerUid: data.customerUid || '',
    dealerUid,
    storeId: dealerUid,
    storeName: data.storeName || '',
    hubAddress: data.hubAddress || data.storeAddress || data.location || 'Otigba Street, Computer Village, Ikeja, Lagos',
    customerName: data.customerName || 'Swapper',
    customerEmail: data.customerEmail || '',
    customerPhone: data.customerPhone || '',
    targetListingId: target.listingId || data.targetListingId || '',
    targetPhoneId: target.listingId || data.targetListingId || '',
    model: current.model || data.model || '',
    brand: current.brand || data.brand || '',
    storageCapacity: current.storage || current.storageCapacity || data.storageCapacity || '',
    imeiNumber: current.imeiNumber || '',
    currentPhone: current.model || data.currentPhone || data.swapperPhoneModel || 'Smartphone',
    currentCondition: current.condition || data.currentCondition || data.swapperPhoneCondition || 'Inspection pending',
    swapperPhoneModel: current.model || data.currentPhone || 'Smartphone',
    swapperPhoneStorage: current.storage || current.storageCapacity || '',
    swapperPhoneCondition: current.condition || 'Inspection pending',
    swapperBattery: current.battery || (current.batteryHealth ? `${current.batteryHealth}%` : (data.swapperBattery || '')),
    conditionTriage: current.conditionTriage || {},
    deviceMedia: data.deviceMedia || [],
    targetPhone: target.model || data.targetPhone || data.targetPhoneModel || 'Target phone',
    targetModel: target.model || '',
    targetStorage: target.storage || target.storageCapacity || data.targetStorage || '',
    targetPhoneModel: target.model || 'Target phone',
    targetPhoneImage: target.image || '',
    targetBrand: target.brand || '',
    preferredColor: target.color || '',
    topupAmount: topupNum,
    topupOffered: topupNum > 0 ? ('₦' + topupNum.toLocaleString()) : (typeof data.topupOffered === 'string' && data.topupOffered ? data.topupOffered : '₦0'),
    tradeInCredit: tradeInNum > 0 ? ('₦' + tradeInNum.toLocaleString()) : (typeof data.tradeInCredit === 'string' && data.tradeInCredit ? data.tradeInCredit : '₦0'),
    location: data.location || data.storeLocation || 'Computer Village Hub',
    notes: data.message || data.notes || '',
    counterOffer: data.counterOffer || null,
    counterMessage: data.counterMessage || '',
    paymentStatus: data.paymentStatus || (topupNum > 0 ? 'pending_escrow' : 'not_required'),
    paymentReference: data.paymentReference || null,
    paymentAmount: typeof data.paymentAmount === 'number' ? data.paymentAmount : (topupNum > 0 ? topupNum : 0),
    paymentChannel: data.paymentChannel || 'paystack',
    paidAt: data.paidAt?.toDate ? data.paidAt.toDate().toISOString() : data.paidAt || null,
    status: normalizeSwapStatus(data.status),
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || new Date().toISOString()
  };
}

// Default marketplace inventory array for Nigerian Smartphone Swappers
const DEFAULT_LISTINGS = [
  {
    id: 'listing_ns_15promax_256',
    brand: 'Apple',
    model: 'iPhone 15 Pro Max',
    storage: '256GB',
    ram: '8GB',
    color: 'Natural Titanium',
    condition: 'Clean UK Used',
    conditionGrade: 'Grade A - Pristine',
    battery: '96%',
    batteryHealth: 96,
    marketValue: 1250000,
    cashOutrightPrice: 1250000,
    quantityInStock: 2,
    isSwapAllowed: true,
    minAcceptableTradeInTier: 'iPhone 12 Pro & above',
    acceptedTradeIn: 'iPhone 12 Pro & above',
    inclusions: ['Original Box', 'Type-C Braided Cable', 'Screen Protector'],
    boxIncludes: 'Original Box, Type-C Braided Cable, Screen Protector',
    warranty: '30 Days Store Warranty',
    storeWarranty: '30 Days',
    screen: '6.7" Super Retina XDR OLED (120Hz ProMotion)',
    chipset: 'Apple A17 Pro (3nm)',
    camera: '48MP Triple Camera (5x Optical Telephoto)',
    sim: 'Nano-SIM + eSIM',
    description: 'Clean UK Used iPhone 15 Pro Max (256GB, Natural Titanium). Grade A pristine condition, 96% original battery health. True Tone and Face ID active. Checked & certified by hub technicians.',
    location: 'Computer Village, Ikeja, Lagos',
    hubAddress: 'Otigba Street, Computer Village, Ikeja, Lagos',
    whatsappNumber: '2348023456789',
    storeId: 'store_otigba_hub',
    storeName: 'Otigba Tech Prime Hub',
    storeVerified: true,
    tags: ['Verified Dealer', 'Recently Listed', 'Grade A - Pristine'],
    image: 'assets/iPhone 15 Pro Max (256GB).jpg',
    heroImage: 'assets/iPhone 15 Pro Max (256GB).jpg',
    status: 'active',
    createdAt: new Date().toISOString()
  },
  {
    id: 'listing_ns_s24ultra_256',
    brand: 'Samsung',
    model: 'Galaxy S24 Ultra',
    storage: '256GB',
    ram: '12GB',
    color: 'Titanium Gray',
    condition: 'Open Box / Like New',
    conditionGrade: 'Grade A - Pristine',
    battery: '100%',
    batteryHealth: 100,
    marketValue: 1280000,
    cashOutrightPrice: 1280000,
    quantityInStock: 1,
    isSwapAllowed: true,
    minAcceptableTradeInTier: 'Galaxy S22 / iPhone 13 & above',
    acceptedTradeIn: 'Galaxy S22 / iPhone 13 & above',
    inclusions: ['Original Box', 'S-Pen Stylus', 'Fast Charging Cable'],
    boxIncludes: 'Original Box, S-Pen Stylus, Fast Charging Cable',
    warranty: '60 Days Store Warranty',
    storeWarranty: '60 Days',
    screen: '6.8" Dynamic AMOLED 2X (120Hz, 2600 nits)',
    chipset: 'Snapdragon 8 Gen 3 for Galaxy',
    camera: '200MP Quad Camera (100x Space Zoom)',
    sim: 'Dual Nano-SIM + eSIM',
    description: 'Open Box Galaxy S24 Ultra in Titanium Gray. Flawless titanium frame, battery at 100%. Galaxy AI enabled and factory unlocked. Complete with S-Pen.',
    location: 'Banex Plaza, Wuse 2, Abuja',
    hubAddress: 'Suite B12, Banex Plaza, Aminu Kano Crescent, Wuse 2, Abuja',
    whatsappNumber: '2348039876543',
    storeId: 'store_banex_gadgets',
    storeName: 'Banex Apex Gadgets',
    storeVerified: true,
    tags: ['Verified Dealer', 'Flagship AI', 'Grade A - Pristine'],
    image: 'assets/Samsung Galaxy S24 Ultra (256GB).jpg',
    heroImage: 'assets/Samsung Galaxy S24 Ultra (256GB).jpg',
    status: 'active',
    createdAt: new Date().toISOString()
  },
  {
    id: 'listing_ns_14pro_128',
    brand: 'Apple',
    model: 'iPhone 14 Pro',
    storage: '128GB',
    ram: '6GB',
    color: 'Deep Purple',
    condition: 'Clean UK Used',
    conditionGrade: 'Grade A (Like New)',
    battery: '91%',
    batteryHealth: 91,
    marketValue: 790000,
    cashOutrightPrice: 790000,
    quantityInStock: 3,
    isSwapAllowed: true,
    minAcceptableTradeInTier: 'iPhone 11 & above',
    acceptedTradeIn: 'iPhone 11 & above',
    inclusions: ['Charging Cable', 'Clear Case'],
    boxIncludes: 'Charging Cable, Clear Case',
    warranty: '30 Days Store Warranty',
    storeWarranty: '30 Days',
    screen: '6.1" Super Retina XDR OLED (Dynamic Island)',
    chipset: 'Apple A16 Bionic',
    camera: '48MP Main + 12MP Ultra-Wide & Telephoto',
    sim: 'Physical SIM + eSIM',
    description: 'UK Used iPhone 14 Pro (128GB, Deep Purple). Grade A with 91% battery health. All cameras, Face ID and Dynamic Island working 100%.',
    location: 'Computer Village, Ikeja, Lagos',
    hubAddress: 'Pepple Street, Computer Village, Ikeja, Lagos',
    whatsappNumber: '2348021122334',
    storeId: 'store_pepple_swap',
    storeName: 'Ikeja Certified Exchange',
    storeVerified: true,
    tags: ['Verified Dealer', 'Best Value', 'Grade A (Like New)'],
    image: 'assets/iPhone 14 Pro (128GB).jpg',
    heroImage: 'assets/iPhone 14 Pro (128GB).jpg',
    status: 'active',
    createdAt: new Date().toISOString()
  },
  {
    id: 'listing_ns_13_128',
    brand: 'Apple',
    model: 'iPhone 13',
    storage: '128GB',
    ram: '4GB',
    color: 'Midnight Black',
    condition: 'Clean UK Used',
    conditionGrade: 'Grade A - Clean',
    battery: '88%',
    batteryHealth: 88,
    marketValue: 470000,
    cashOutrightPrice: 470000,
    quantityInStock: 2,
    isSwapAllowed: true,
    minAcceptableTradeInTier: 'iPhone XR / XS / 11 & above',
    acceptedTradeIn: 'iPhone XR / XS / 11 & above',
    inclusions: ['Fast Charging Cable'],
    boxIncludes: 'Fast Charging Cable',
    warranty: '30 Days Store Warranty',
    storeWarranty: '30 Days',
    screen: '6.1" Super Retina XDR OLED',
    chipset: 'Apple A15 Bionic',
    camera: '12MP Dual Diagonal Camera (Cinematic Mode)',
    sim: 'Nano-SIM + eSIM',
    description: 'Clean UK Used iPhone 13 (128GB, Midnight). Battery health 88%, True Tone active, clean IMEI. Perfect upgrade from XR or 11.',
    location: 'Garrison, Aba Road, Port Harcourt',
    hubAddress: 'Garrison Junction, Aba Road, Port Harcourt, Rivers',
    whatsappNumber: '2348055667788',
    storeId: 'store_ph_hub',
    storeName: 'Garrison Gadget Exchange',
    storeVerified: true,
    tags: ['Verified Dealer', 'Budget Upgrade', 'Grade A - Clean'],
    image: 'assets/iPhone 13 (128GB).jpg',
    heroImage: 'assets/iPhone 13 (128GB).jpg',
    status: 'active',
    createdAt: new Date().toISOString()
  },
  {
    id: 'listing_ns_15pro_128',
    brand: 'Apple',
    model: 'iPhone 15 Pro',
    storage: '128GB',
    ram: '8GB',
    color: 'Black Titanium',
    condition: 'Brand New Sealed',
    conditionGrade: 'Brand New (0 Cycle)',
    battery: '100%',
    batteryHealth: 100,
    marketValue: 1020000,
    cashOutrightPrice: 1020000,
    quantityInStock: 1,
    isSwapAllowed: true,
    minAcceptableTradeInTier: 'iPhone 13 Pro / 14 & above',
    acceptedTradeIn: 'iPhone 13 Pro / 14 & above',
    inclusions: ['Original Apple Box', 'USB-C Cable', 'Documentation'],
    boxIncludes: 'Original Apple Box, USB-C Cable, Documentation',
    warranty: '1 Year Apple Warranty + 30 Days Store Hub',
    storeWarranty: '1 Year Apple + 30 Days Store',
    screen: '6.1" Super Retina XDR OLED (120Hz ProMotion)',
    chipset: 'Apple A17 Pro (3nm)',
    camera: '48MP Triple Camera System',
    sim: 'Physical SIM + eSIM',
    description: 'Brand New Factory Sealed iPhone 15 Pro in Black Titanium. Active 1-year Apple international warranty. Eligible for high-tier phone swap.',
    location: 'Computer Village, Ikeja, Lagos',
    hubAddress: 'Medical Road, Computer Village, Ikeja, Lagos',
    whatsappNumber: '2348088990011',
    storeId: 'store_medical_rd',
    storeName: 'Crown Smartphone Hub',
    storeVerified: true,
    tags: ['Brand New Sealed', 'Verified Dealer', 'Apple Warranty'],
    image: 'assets/iPhone 15 Pro.jpg',
    heroImage: 'assets/iPhone 15 Pro.jpg',
    status: 'active',
    createdAt: new Date().toISOString()
  },
  {
    id: 'listing_ns_12pro_128',
    brand: 'Apple',
    model: 'iPhone 12 Pro',
    storage: '128GB',
    ram: '6GB',
    color: 'Pacific Blue',
    condition: 'Clean UK Used',
    conditionGrade: 'Grade A',
    battery: '87%',
    batteryHealth: 87,
    marketValue: 410000,
    cashOutrightPrice: 410000,
    quantityInStock: 2,
    isSwapAllowed: true,
    minAcceptableTradeInTier: 'iPhone X / XR / 11 & above',
    acceptedTradeIn: 'iPhone X / XR / 11 & above',
    inclusions: ['Charging Cable'],
    boxIncludes: 'Charging Cable',
    warranty: '30 Days Store Warranty',
    storeWarranty: '30 Days',
    screen: '6.1" Super Retina XDR OLED',
    chipset: 'Apple A14 Bionic',
    camera: '12MP Triple Camera with LiDAR Scanner',
    sim: 'Nano-SIM + eSIM',
    description: 'Affordable flagship iPhone 12 Pro Pacific Blue. Triple camera with LiDAR sensor, Face ID tested and fully functioning. Accepts trade-ins.',
    location: 'Banex Plaza, Wuse 2, Abuja',
    hubAddress: 'Old Banex, Suite C4, Wuse 2, Abuja',
    whatsappNumber: '2348099887766',
    storeId: 'store_abuja_prime',
    storeName: 'Capital Tech Hub',
    storeVerified: true,
    tags: ['Verified Dealer', 'Affordable Pro', 'Grade A'],
    image: 'assets/iPhone 12 Pro.jpg',
    heroImage: 'assets/iPhone 12 Pro.jpg',
    status: 'active',
    createdAt: new Date().toISOString()
  }
];

// Standardized Brand and Model Hierarchy for Nigerian Smartphone Marketplace
export const BRANDS_AND_MODELS = {
  'Apple': [
    'iPhone 15 Pro Max',
    'iPhone 15 Pro',
    'iPhone 15 Plus',
    'iPhone 15',
    'iPhone 14 Pro Max',
    'iPhone 14 Pro',
    'iPhone 14 Plus',
    'iPhone 14',
    'iPhone 13 Pro Max',
    'iPhone 13 Pro',
    'iPhone 13',
    'iPhone 13 mini',
    'iPhone 12 Pro Max',
    'iPhone 12 Pro',
    'iPhone 12',
    'iPhone 11 Pro Max',
    'iPhone 11 Pro',
    'iPhone 11',
    'iPhone XS Max',
    'iPhone XR'
  ],
  'Samsung': [
    'Galaxy S24 Ultra', 'Galaxy S24 Plus', 'Galaxy S24',
    'Galaxy S23 Ultra', 'Galaxy S23 Plus', 'Galaxy S23',
    'Galaxy S22 Ultra', 'Galaxy S22', 'Galaxy S21 Ultra', 'Galaxy S21',
    'Galaxy Z Fold 5', 'Galaxy Z Flip 5', 'Galaxy Note 20 Ultra'
  ]
};

// Baseline valuation matrix for trade-in estimations in Nigerian marketplace (in NGN)
const TRADE_IN_BASELINES = {
  // Apple iPhones
  'iphone 15 pro max': 1200000,
  'iphone 15 pro': 980000,
  'iphone 15 plus': 750000,
  'iphone 15': 680000,
  'iphone 14 pro max': 920000,
  'iphone 14 pro': 780000,
  'iphone 14 plus': 580000,
  'iphone 14': 520000,
  'iphone 13 pro max': 700000,
  'iphone 13 pro': 600000,
  'iphone 13': 460000,
  'iphone 13 mini': 380000,
  'iphone 12 pro max': 480000,
  'iphone 12 pro': 400000,
  'iphone 12': 330000,
  'iphone 11 pro max': 330000,
  'iphone 11 pro': 280000,
  'iphone 11': 230000,
  'iphone xs max': 200000,
  'iphone xr': 170000,
  'galaxy s24 ultra': 1150000,
  'galaxy s24 plus': 820000,
  'galaxy s24': 680000,
  'galaxy s23 ultra': 820000,
  'galaxy s23 plus': 580000,
  'galaxy s23': 480000,
  'galaxy s22 ultra': 560000,
  'galaxy s22': 360000,
  'galaxy s21 ultra': 380000,
  'galaxy z fold 5': 920000,
  'galaxy z flip 5': 540000
};

// Condition multiplier factors
const CONDITION_MULTIPLIERS = {
  'Brand New Sealed': 1.0,
  'Flawless (Like New)': 0.96,
  'Excellent': 0.90,
  'Very Good': 0.82,
  'Good': 0.72,
  'Fair': 0.58
};

// Storage multiplier factors (base is 128GB)
const STORAGE_MULTIPLIERS = {
  '64GB': 0.90,
  '128GB': 1.0,
  '256GB': 1.10,
  '512GB': 1.20,
  '1TB': 1.30
};

function isTestListing(item) {
  if (!item) return true;
  const id = String(item.id || '');
  const testIds = ['phone_101', 'phone_102', 'phone_103', 'phone_104', 'phone_105', 'phone_106',
                   '1To9pQ5sPNDjXSzR9V0W', 'iNEyHXMdonH5FoqPZqVY', 'wvsvo88NH4Y20lVaGd7m', 'l9lrdRtCiIWuuHhRXBBI'];
  return testIds.includes(id);
}

function initDatabase() {
  if (typeof localStorage !== 'undefined') {
    // Purge legacy mock listings
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.LISTINGS) || '[]');
      if (Array.isArray(stored)) {
        const cleaned = stored.filter(item => !isTestListing(item));
        localStorage.setItem(STORAGE_KEYS.LISTINGS, JSON.stringify(cleaned));
      }
    } catch (_) {}

    const initialized = localStorage.getItem(STORAGE_KEYS.INITIALIZED);
    if (!initialized) {
      if (!localStorage.getItem(STORAGE_KEYS.LISTINGS)) {
        localStorage.setItem(STORAGE_KEYS.LISTINGS, JSON.stringify([]));
      }
      if (!localStorage.getItem(STORAGE_KEYS.SWAP_REQUESTS)) {
        localStorage.setItem(STORAGE_KEYS.SWAP_REQUESTS, JSON.stringify([]));
      }
      if (!localStorage.getItem(STORAGE_KEYS.ACTIVITY_LOG)) {
        localStorage.setItem(STORAGE_KEYS.ACTIVITY_LOG, JSON.stringify([]));
      }
      localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
    }
  }
}

if (typeof window !== 'undefined') {
  initDatabase();
}

export const NaijaSwapData = {
  // --- MARKETPLACE LISTINGS ---
  async getListingsRemote(filters = {}) {
    try {
      const snapshot = await getDocs(query(
        collection(db, 'listings'),
        where('status', 'in', ['active', 'Active']),
        orderBy('createdAt', 'desc'),
        limit(100)
      ));
      const remoteListings = snapshot.docs.map(mapRemoteListing).filter(item => !isTestListing(item));
      if (remoteListings && remoteListings.length > 0) {
        localStorage.setItem(STORAGE_KEYS.LISTINGS, JSON.stringify(remoteListings));
        return this.filterListings(remoteListings, filters);
      }
      return this.getListings(filters);
    } catch (e) {
      console.warn('[NaijaSwapData] getListingsRemote error:', e);
      return this.getListings(filters);
    }
  },

  filterListings(items, filters = {}) {
    const { brand, storage, condition, location, query: searchQuery } = filters;
    return items.filter(item => {
      if (isTestListing(item)) return false;
      const itemBrand = String(item.brand || '').toLowerCase();
      const itemModel = String(item.model || '').toLowerCase();
      const isApple = itemBrand.includes('apple') || itemModel.includes('iphone');
      const isSamsung = itemBrand.includes('samsung') || itemModel.includes('galaxy');
      if (!isApple && !isSamsung) return false;
      if (String(item.status || '').toLowerCase() !== 'active') return false;
      if (brand && brand !== 'All') {
        const normalizedBrand = brand.toLowerCase();
        if ((normalizedBrand === 'iphone' || normalizedBrand === 'apple') && !isApple) return false;
        if (normalizedBrand === 'samsung' && !isSamsung) return false;
      }
      if (storage && storage !== 'All' && !String(item.storage || '').toLowerCase().includes(storage.toLowerCase())) return false;
      if (condition && condition !== 'All' && !String(item.condition || '').toLowerCase().includes(condition.toLowerCase())) return false;
      if (location && location !== 'All' && !String(item.location || '').toLowerCase().includes(location.toLowerCase())) return false;
      if (searchQuery && ![item.model, item.brand, item.location, item.storage, item.color]
        .some(value => String(value || '').toLowerCase().includes(searchQuery.toLowerCase().trim()))) return false;
      return true;
    });
  },

  getListings(filters = {}) {
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem(STORAGE_KEYS.LISTINGS)) || [];
    } catch {
      items = [];
    }
    // Clean legacy test listings
    items = items.filter(item => !isTestListing(item));
    if (!items || items.length === 0) {
      items = [...DEFAULT_LISTINGS];
    }
    return this.filterListings(items, filters);
  },

  getListingById(id) {
    const listings = this.getListings();
    return listings.find(x => String(x.id) === String(id)) || null;
  },

  // --- DYNAMIC TOP-UP CALCULATION ENGINE ---
  calculateTopUp(targetListingId, swapperPhoneData = {}) {
    const target = this.getListingById(targetListingId);
    if (!target) {
      return {
        isValid: false,
        error: 'Target listing not found'
      };
    }

    const targetVal = target.marketValue || 1200000;
    const { 
      brand = '', 
      model = '', 
      storage = '128GB', 
      condition = 'Excellent', 
      customValue,
      batteryHealth,
      conditionTriage = {}
    } = swapperPhoneData;

    let baseCredit = 0;
    const key = (model || '').toLowerCase().trim();

    // Check baseline dictionary
    if (TRADE_IN_BASELINES[key]) {
      baseCredit = TRADE_IN_BASELINES[key];
    } else {
      // Fuzzy lookup
      const foundKey = Object.keys(TRADE_IN_BASELINES).find(k => key.includes(k) || k.includes(key));
      if (foundKey) {
        baseCredit = TRADE_IN_BASELINES[foundKey];
      } else if (customValue && Number(customValue) > 0) {
        baseCredit = Number(customValue);
      } else {
        // Fallback sensible Nigerian baseline
        if (key.includes('iphone 15')) baseCredit = 850000;
        else if (key.includes('iphone 14')) baseCredit = 650000;
        else if (key.includes('iphone 13')) baseCredit = 480000;
        else if (key.includes('iphone 12')) baseCredit = 360000;
        else if (key.includes('iphone 11')) baseCredit = 260000;
        else if (key.includes('s24')) baseCredit = 800000;
        else if (key.includes('s23')) baseCredit = 600000;
        else if (key.includes('s22')) baseCredit = 450000;
        else if (key.includes('ultra')) baseCredit = 500000;
        else if (key.includes('pro')) baseCredit = 350000;
        else baseCredit = 200000; // General clean smartphone baseline
      }
    }

    // Apply storage and condition factors
    const condFactor = CONDITION_MULTIPLIERS[condition] || 0.88;
    const storFactor = STORAGE_MULTIPLIERS[storage] || 1.0;

    let userValuation = Math.round(baseCredit * condFactor * storFactor);

    // Dynamic Defect & Battery Deductions
    const deductions = [];
    
    // Battery health deduction (if <80%)
    if (batteryHealth) {
      const batVal = parseInt(String(batteryHealth).replace(/\D/g, ''), 10);
      if (!isNaN(batVal) && batVal < 80) {
        const batDeduction = 35000;
        userValuation = Math.max(20000, userValuation - batDeduction);
        deductions.push(`Low Battery Health (${batVal}%): -₦${batDeduction.toLocaleString()}`);
      }
    }

    // Screen Glass or Display Damage
    if (conditionTriage.screenGlass || conditionTriage.powerAndScreen === false) {
      const screenDeduction = Math.round(userValuation * 0.18);
      userValuation = Math.max(20000, userValuation - screenDeduction);
      deductions.push(`Screen Glass Damage: -₦${screenDeduction.toLocaleString()}`);
    }

    // Heavy Body / Housing Scratches & Dents
    if (conditionTriage.bodyAndHousing) {
      const bodyDeduction = Math.round(userValuation * 0.08);
      userValuation = Math.max(20000, userValuation - bodyDeduction);
      deductions.push(`Body / Housing Wear: -₦${bodyDeduction.toLocaleString()}`);
    }

    // Biometrics / FaceID / TouchID issue
    if (conditionTriage.biometrics === false || conditionTriage.faceIdFault) {
      const bioDeduction = 30000;
      userValuation = Math.max(20000, userValuation - bioDeduction);
      deductions.push(`Biometric / FaceID Fault: -₦${bioDeduction.toLocaleString()}`);
    }

    const diff = targetVal - userValuation;

    let estTopUp = 0;
    let isStraightSwapOrPayout = false;

    if (diff <= 0) {
      estTopUp = 0;
      isStraightSwapOrPayout = true;
    } else {
      // Round to nearest 5,000 NGN
      estTopUp = Math.ceil(diff / 5000) * 5000;
    }

    const minRange = Math.max(0, Math.round((estTopUp * 0.95) / 5000) * 5000);
    const maxRange = Math.round((estTopUp * 1.08) / 5000) * 5000;

    return {
      isValid: true,
      targetListing: target,
      targetValue: targetVal,
      targetValueFormatted: '₦' + targetVal.toLocaleString(),
      userTradeInCredit: userValuation,
      userTradeInCreditFormatted: '₦' + userValuation.toLocaleString(),
      estTopUp,
      estTopUpFormatted: estTopUp === 0 ? '₦0 (Direct Swap)' : '₦' + estTopUp.toLocaleString(),
      estRangeFormatted: estTopUp === 0 ? 'Direct Swap' : '₦' + minRange.toLocaleString() + ' - ₦' + maxRange.toLocaleString(),
      isStraightSwapOrPayout,
      conditionApplied: condition,
      storageApplied: storage,
      deductionsApplied: deductions
    };
  },

  getPopularTradeInModels() {
    return [
      { group: 'Apple iPhones', models: [
        'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14', 'iPhone 13 Pro Max',
        'iPhone 13 Pro', 'iPhone 13', 'iPhone 12 Pro Max', 'iPhone 12 Pro',
        'iPhone 12', 'iPhone 11 Pro Max', 'iPhone 11 Pro', 'iPhone 11', 'iPhone XR'
      ]},
      { group: 'Samsung Galaxy', models: [
        'Galaxy S24 Ultra', 'Galaxy S24', 'Galaxy S23 Ultra', 'Galaxy S23',
        'Galaxy S22 Ultra', 'Galaxy S22', 'Galaxy S21 Ultra'
      ]}
    ];
  },

  getBrands() {
    return Object.keys(BRANDS_AND_MODELS);
  },

  getModelsForBrand(brand) {
    if (!brand) return [];
    const normalized = Object.keys(BRANDS_AND_MODELS).find(b => b.toLowerCase() === brand.toLowerCase());
    return normalized ? BRANDS_AND_MODELS[normalized] : [];
  },

  isAndroid(brand) {
    return String(brand || '').toLowerCase() === 'samsung';
  },

  // Algorithmic valuation engine for marketplace listings based on specs and condition
  calculateMarketPrice(brand = 'Apple', model = 'iPhone 13', storage = '128GB', conditionGrade = 'Grade A - Pristine', deviceStatus = 'Brand New Sealed') {
    const key = (model || '').toLowerCase().trim();
    let basePrice = 500000;

    if (TRADE_IN_BASELINES[key]) {
      basePrice = TRADE_IN_BASELINES[key];
    } else {
      const matchedKey = Object.keys(TRADE_IN_BASELINES).find(k => key.includes(k) || k.includes(key));
      if (matchedKey) {
        basePrice = TRADE_IN_BASELINES[matchedKey];
      } else {
        const b = (brand || '').toLowerCase();
        if (b.includes('apple') || key.includes('iphone')) {
          if (key.includes('15')) basePrice = 850000;
          else if (key.includes('14')) basePrice = 650000;
          else if (key.includes('13')) basePrice = 500000;
          else if (key.includes('12')) basePrice = 380000;
          else if (key.includes('11')) basePrice = 270000;
          else basePrice = 220000;
        } else if (b.includes('samsung') || key.includes('galaxy') || key.includes('ultra')) {
          if (key.includes('s24')) basePrice = 850000;
          else if (key.includes('s23')) basePrice = 600000;
          else if (key.includes('s22')) basePrice = 450000;
          else if (key.includes('s21')) basePrice = 340000;
          else if (key.includes('fold') || key.includes('flip')) basePrice = 650000;
          else basePrice = 250000;
        } else if (b.includes('google') || key.includes('pixel')) {
          if (key.includes('8')) basePrice = 550000;
          else if (key.includes('7')) basePrice = 380000;
          else basePrice = 260000;
        } else if (b.includes('tecno') || key.includes('camon') || key.includes('phantom')) {
          if (key.includes('phantom')) basePrice = 520000;
          else if (key.includes('camon 30')) basePrice = 280000;
          else basePrice = 180000;
        } else if (b.includes('infinix') || key.includes('zero') || key.includes('note')) {
          if (key.includes('zero')) basePrice = 250000;
          else if (key.includes('note 40')) basePrice = 220000;
          else basePrice = 160000;
        } else if (b.includes('xiaomi') || key.includes('redmi')) {
          if (key.includes('14') || key.includes('13')) basePrice = 450000;
          else basePrice = 220000;
        } else {
          basePrice = 350000;
        }
      }
    }

    const stKey = (storage || '128GB').toUpperCase();
    let storageFactor = 1.0;
    if (stKey.includes('64GB')) storageFactor = 0.90;
    else if (stKey.includes('128GB')) storageFactor = 1.0;
    else if (stKey.includes('256GB')) storageFactor = 1.15;
    else if (stKey.includes('512GB')) storageFactor = 1.30;
    else if (stKey.includes('1TB')) storageFactor = 1.45;

    let statusFactor = 1.0;
    const statusStr = (deviceStatus || '').toLowerCase();
    const gradeStr = (conditionGrade || '').toLowerCase();

    if (statusStr.includes('brand new')) {
      statusFactor = 1.25;
    } else if (statusStr.includes('open box') || statusStr.includes('like new')) {
      statusFactor = 1.10;
    } else {
      if (gradeStr.includes('grade a') || gradeStr.includes('pristine')) {
        statusFactor = 1.0;
      } else if (gradeStr.includes('grade b') || gradeStr.includes('good')) {
        statusFactor = 0.88;
      } else if (gradeStr.includes('grade c') || gradeStr.includes('fair')) {
        statusFactor = 0.75;
      }
    }

    let finalPrice = basePrice * storageFactor * statusFactor;
    return Math.round(finalPrice / 5000) * 5000;
  },

  // --- STORE LISTINGS MANAGEMENT ---
  getStoreListings(storeId) {
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem(STORAGE_KEYS.LISTINGS)) || [];
    } catch {
      items = [];
    }
    items = items.filter(x => !isTestListing(x));
    if (!storeId) return items;
    return items.filter(x => x.storeId === storeId || x.storeOwnerUid === storeId || x.dealerUid === storeId);
  },

  async getStoreListingsRemote(storeId) {
    if (!storeId) return [];
    try {
      let listings = [];
      try {
        const q = query(
          collection(db, 'listings'),
          where('storeOwnerUid', '==', storeId),
          orderBy('createdAt', 'desc'),
          limit(100)
        );
        const snapshot = await getDocs(q);
        listings = snapshot.docs.map(mapRemoteListing).filter(item => !isTestListing(item));
      } catch (err) {
        try {
          const qFallback = query(
            collection(db, 'listings'),
            where('storeOwnerUid', '==', storeId),
            limit(100)
          );
          const snapFallback = await getDocs(qFallback);
          listings = snapFallback.docs.map(mapRemoteListing).filter(item => !isTestListing(item));
        } catch (_) {}
      }

      if (listings.length === 0) {
        try {
          const qStore = query(
            collection(db, 'listings'),
            where('storeId', '==', storeId),
            limit(100)
          );
          const snapStore = await getDocs(qStore);
          listings = snapStore.docs.map(mapRemoteListing).filter(item => !isTestListing(item));
        } catch (_) {}
      }

      let cached = [];
      try {
        cached = JSON.parse(localStorage.getItem(STORAGE_KEYS.LISTINGS)) || [];
      } catch (_) {
        cached = [];
      }
      const others = cached.filter(item => item.storeId !== storeId && item.storeOwnerUid !== storeId && item.dealerUid !== storeId);
      const combined = [...listings, ...others];
      safeSetItem(STORAGE_KEYS.LISTINGS, combined);

      return listings;
    } catch (e) {
      console.warn('[NaijaSwapData] getStoreListingsRemote error:', e);
      return this.getStoreListings(storeId);
    }
  },

  addListing(storeId, storeName, phoneData) {
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem(STORAGE_KEYS.LISTINGS)) || [];
    } catch {
      items = DEFAULT_LISTINGS;
    }

    const newId = 'phone_' + Date.now();
    const requestedBrand = String(phoneData.deviceBrand || phoneData.brand || 'Apple').trim();
    const brand = requestedBrand.toLowerCase().includes('samsung') || requestedBrand.toLowerCase().includes('galaxy')
      ? 'Samsung'
      : requestedBrand.toLowerCase().includes('apple') || requestedBrand.toLowerCase().includes('iphone')
        ? 'Apple'
        : null;
    if (!brand) {
      throw new Error('Only Apple and Samsung devices are supported.');
    }
    const model = phoneData.deviceModel || phoneData.model || 'Smartphone';
    const storage = phoneData.storage || phoneData.storageCapacity || '128GB';
    const ram = phoneData.ram || (this.isAndroid(brand) ? '8GB' : '');
    const color = phoneData.color || 'Standard';
    const deviceStatus = phoneData.deviceStatus || phoneData.condition || 'Brand New Sealed';
    const quantityInStock = Number(phoneData.quantityInStock || phoneData.quantity) || 1;

    // Grading & Inclusions
    const conditionGrade = phoneData.conditionGrade || 'Grade A - Pristine';
    let battery = '100%';
    if (phoneData.batteryHealth !== undefined && phoneData.batteryHealth !== '') {
      battery = `${phoneData.batteryHealth}%`;
    } else if (phoneData.battery) {
      battery = String(phoneData.battery).includes('%') ? phoneData.battery : `${phoneData.battery}%`;
    }

    const inclusions = Array.isArray(phoneData.inclusions) 
      ? phoneData.inclusions 
      : (typeof phoneData.inclusions === 'string' ? phoneData.inclusions.split(', ') : ['Original Box', 'Charging Cable']);
    const storeWarranty = phoneData.storeWarranty || '30 Days';

    // Pricing & Swaps (Automated market price calculated through phone specs and condition)
    const automatedPrice = this.calculateMarketPrice(brand, model, storage, conditionGrade, deviceStatus);
    const cashOutrightPrice = Number(phoneData.cashOutrightPrice) || automatedPrice;
    const isSwapAllowed = phoneData.isSwapAllowed !== undefined ? Boolean(phoneData.isSwapAllowed) : true;
    const minAcceptableTradeInTier = phoneData.minAcceptableTradeInTier || 'iPhone 11 and above';

    // Unified Media Uploads (up to 5 images and videos)
    const rawMedia = Array.isArray(phoneData.mediaFiles) 
      ? phoneData.mediaFiles 
      : (Array.isArray(phoneData.allMedia) 
        ? phoneData.allMedia 
        : (phoneData.photos ? Object.values(phoneData.photos).filter(Boolean).map(url => ({ dataUrl: url, isVideo: false })) : []));
    const mediaFiles = rawMedia.slice(0, 5);

    // Hero image fallback
    const firstImg = phoneData.uploadedImage || phoneData.image || mediaFiles.find(m => !m.isVideo && m.dataUrl)?.dataUrl;
    const heroImage = firstImg || phoneData.image || (this.isAndroid(brand) ? 'assets/Samsung Galaxy S24 Ultra (256GB).jpg' : 'assets/iPhone 15 Pro.jpg');
    const backImage = mediaFiles[1]?.dataUrl || '';
    const accessoriesImage = mediaFiles[2]?.dataUrl || '';
    const damageDisclosure = mediaFiles[3]?.dataUrl || '';

    const newListing = {
      id: newId,
      brand,
      model,
      storage,
      ram,
      condition: deviceStatus,
      conditionGrade,
      color,
      battery,
      marketValue: cashOutrightPrice,
      cashOutrightPrice,
      quantityInStock,
      isSwapAllowed,
      minAcceptableTradeInTier: isSwapAllowed ? minAcceptableTradeInTier : 'Swaps not accepted',
      inclusions,
      boxIncludes: inclusions.join(', '),
      warranty: storeWarranty + ' Store Warranty',
      storeWarranty,
      screen: phoneData.screen || (this.isAndroid(brand) ? 'Dynamic AMOLED 2X Display' : 'Super Retina XDR OLED'),
      chipset: phoneData.chipset || (this.isAndroid(brand) ? 'Snapdragon / Exynos Processor' : 'Apple Bionic / Pro Chip'),
      camera: phoneData.camera || 'High Definition Triple Camera',
      sim: phoneData.sim || 'Nano-SIM + eSIM',
      description: phoneData.description || (`${conditionGrade} ${model} (${storage}, ${color}). ${deviceStatus}. Checked by certified hub technicians.`),
      location: phoneData.location || 'Ikeja, Lagos',
      hubAddress: phoneData.hubAddress || 'Computer Village Hub, Ikeja, Lagos',
      whatsappNumber: phoneData.whatsappNumber || '2348023456789',
      acceptedTradeIn: isSwapAllowed ? minAcceptableTradeInTier : 'Cash Outright Only',
      storeId: storeId || 'store_prime',
      storeName: storeName || 'Computer Village Hub',
      storeVerified: true,
      tags: isSwapAllowed ? ['Recently Listed', 'Verified Store', conditionGrade] : ['Recently Listed', 'Verified Store', 'Cash Only'],
      image: heroImage,
      heroImage,
      backImage,
      accessoriesImage,
      damageDisclosure,
      mediaFiles,
      status: 'Active',
      createdAt: new Date().toISOString()
    };

    // Safety check: ensure no heavy raw base64 data URLs are written into localStorage
    if (newListing.mediaFiles && Array.isArray(newListing.mediaFiles)) {
      newListing.mediaFiles = newListing.mediaFiles.map((m, idx) => {
        if (m?.dataUrl && m.dataUrl.startsWith('data:')) {
          const idbKey = `listing_${newId}_m_${idx}`;
          if (typeof window !== 'undefined' && window.indexedDB) {
            try {
              const req = indexedDB.open('naijaswap_media_db', 1);
              req.onsuccess = (e) => {
                const tx = e.target.result.transaction('media_store', 'readwrite');
                tx.objectStore('media_store').put(m.dataUrl, idbKey);
              };
            } catch (_) {}
          }
          return { ...m, dataUrl: `idb:${idbKey}` };
        }
        return m;
      });
    }
    if (newListing.image && newListing.image.startsWith('data:')) {
      const heroKey = `listing_${newId}_hero`;
      if (typeof window !== 'undefined' && window.indexedDB) {
        try {
          const req = indexedDB.open('naijaswap_media_db', 1);
          req.onsuccess = (e) => {
            const tx = e.target.result.transaction('media_store', 'readwrite');
            tx.objectStore('media_store').put(newListing.image, heroKey);
          };
        } catch (_) {}
      }
      newListing.image = `idb:${heroKey}`;
      newListing.heroImage = `idb:${heroKey}`;
    }

    items.unshift(newListing);
    try {
      localStorage.setItem(STORAGE_KEYS.LISTINGS, JSON.stringify(items));
    } catch (err) {
      if (err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014)) {
        const trimmed = items.map((it, idx) => {
          if (idx > 0) {
            const { mediaFiles, backImage, accessoriesImage, damageDisclosure, ...rest } = it;
            return rest;
          }
          return it;
        });
        try {
          localStorage.setItem(STORAGE_KEYS.LISTINGS, JSON.stringify(trimmed));
        } catch (_) {}
      }
    }

    this.logActivity(storeId, {
      type: 'listing_added',
      title: 'Stock Added: ' + newListing.model,
      description: `${newListing.model} (${newListing.storage}, ${newListing.conditionGrade}) - ₦${cashOutrightPrice.toLocaleString()}`
    });

    return newListing;
  },

  deleteListing(listingId, storeId) {
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem(STORAGE_KEYS.LISTINGS)) || [];
    } catch {
      items = DEFAULT_LISTINGS;
    }

    const target = items.find(x => x.id === listingId);
    items = items.filter(x => x.id !== listingId);
    localStorage.setItem(STORAGE_KEYS.LISTINGS, JSON.stringify(items));

    if (target) {
      this.logActivity(storeId, {
        type: 'listing_deleted',
        title: 'Listing Removed',
        description: `Removed listing: ${target.model} (${target.storage})`
      });
    }
    return true;
  },

  attachFirestoreListingId(localId, firestoreId) {
    const items = JSON.parse(localStorage.getItem(STORAGE_KEYS.LISTINGS) || '[]');
    const listing = items.find(item => item.id === localId);
    if (!listing) return;
    listing.firestoreId = firestoreId;
    localStorage.setItem(STORAGE_KEYS.LISTINGS, JSON.stringify(items));
  },

  restockListing(listingId, addQty = 1, storeId = null) {
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem(STORAGE_KEYS.LISTINGS)) || [];
    } catch {
      items = DEFAULT_LISTINGS;
    }

    let target = null;
    items = items.map(x => {
      if (x.id === listingId) {
        const cur = typeof x.quantityInStock === 'number' ? x.quantityInStock : 0;
        x.quantityInStock = cur + addQty;
        x.status = 'Active';
        target = x;
      }
      return x;
    });

    localStorage.setItem(STORAGE_KEYS.LISTINGS, JSON.stringify(items));

    if (target && storeId) {
      this.logActivity(storeId, {
        type: 'inventory_restocked',
        title: 'Inventory Restocked',
        description: `Restocked ${target.model} (${target.storage}) +${addQty} unit(s)`
      });
    }
    return target;
  },

  // --- SWAP REQUESTS MANAGEMENT (CONSUMER FORM) ---
  createSwapRequest(requestData) {
    let requests = [];
    try {
      requests = JSON.parse(localStorage.getItem(STORAGE_KEYS.SWAP_REQUESTS)) || [];
    } catch {
      requests = [];
    }

    const targetListing = requestData.targetListingId 
      ? this.getListingById(requestData.targetListingId) 
      : null;

    const targetBrand = requestData.targetBrand || (targetListing ? targetListing.brand : 'Apple');
    const targetModel = requestData.targetModel || (targetListing ? targetListing.model : 'iPhone 15 Pro Max');
    const targetStorage = requestData.targetStorage || (targetListing ? targetListing.storage : '256GB');
    const preferredColor = requestData.preferredColor || (targetListing ? targetListing.color : 'Natural Titanium');

    const brand = requestData.brand || requestData.swapperPhoneBrand || 'Apple';
    const model = requestData.model || requestData.swapperPhoneModel || 'Smartphone';
    const storageCapacity = requestData.storageCapacity || requestData.swapperPhoneStorage || '128GB';
    const ram = requestData.ram || '';
    const imeiNumber = requestData.imeiNumber || '';

    // Condition Triage
    const conditionTriage = requestData.conditionTriage || {
      powerAndScreen: true,
      screenGlass: false,
      bodyAndHousing: false,
      hardwareFunctionality: true,
      batteryHealth: requestData.swapperBattery ? parseInt(requestData.swapperBattery) : 90,
      carrierLock: 'Factory Unlocked'
    };

    // Media (Up to 5 images and short videos)
    const deviceMedia = (Array.isArray(requestData.deviceMedia) ? requestData.deviceMedia : []).slice(0, 5);

    // Calculate approximate trade-in value based on brand/model/storage
    const calc = targetListing 
      ? this.calculateTopUp(targetListing.id, { model, storage: storageCapacity, condition: 'Excellent' })
      : null;

    const topupOffered = requestData.topupOffered || (calc ? calc.estTopUpFormatted : '₦0');
    const tradeInCredit = requestData.tradeInCredit || (calc ? calc.userTradeInCreditFormatted : '₦0');

    const safeSwapCode = requestData.safeSwapCode || ('NS-' + Math.floor(100000 + Math.random() * 900000));

    const newRequest = {
      id: 'req_' + Date.now(),
      safeSwapCode,
      targetPhoneId: requestData.targetPhoneId || '',
      targetPhoneModel: `${targetModel} (${targetStorage})`,
      targetPhoneImage: requestData.targetPhoneImage || (targetListing ? targetListing.image : 'assets/iPhone 15 Pro.jpg'),
      targetBrand,
      targetModel,
      targetStorage,
      preferredColor,
      storeId: requestData.storeId || (targetListing ? targetListing.storeId : 'store_prime'),
      storeName: requestData.storeName || (targetListing ? targetListing.storeName : 'Computer Village Hub'),
      customerUid: requestData.customerUid || 'user_guest',
      customerName: requestData.customerName || 'Swapper',
      customerEmail: requestData.customerEmail || '',
      customerPhone: requestData.customerPhone || '',
      // Device Basics
      brand,
      model,
      storageCapacity,
      ram,
      imeiNumber,
      swapperPhoneBrand: brand,
      swapperPhoneModel: `${model} (${storageCapacity}${ram ? ', ' + ram + ' RAM' : ''})`,
      swapperPhoneStorage: storageCapacity,
      swapperPhoneCondition: (conditionTriage.screenGlass || conditionTriage.bodyAndHousing) ? 'Good / Fair' : 'Pristine / Excellent',
      swapperBattery: conditionTriage.batteryHealth ? `${conditionTriage.batteryHealth}%` : '100%',
      conditionTriage,
      deviceMedia,
      topupOffered,
      tradeInCredit,
      notes: requestData.notes || '',
      status: 'pending',
      stage: 1,
      counterOffer: null,
      counterMessage: '',
      hubBooking: null,
      triageResults: null,
      certificateId: 'CERT-' + Date.now(),
      createdAt: new Date().toISOString()
    };

    newRequest.status = normalizeSwapStatus(newRequest.status);
    requests.unshift(newRequest);
    safeSetItem(STORAGE_KEYS.SWAP_REQUESTS, requests);

    this.logActivity(newRequest.storeId, {
      type: 'swap_received',
      title: 'Swap Request: ' + newRequest.targetPhoneModel,
      description: `From ${newRequest.customerName}: ${newRequest.swapperPhoneModel} for ${newRequest.targetPhoneModel}`
    });

    this.createNotification(newRequest.customerUid, {
      type: 'swap_submitted',
      title: 'Swap Request Submitted',
      message: `Your trade-in proposal for ${newRequest.targetPhoneModel} has been submitted to ${newRequest.storeName}. SafeSwap Code: ${safeSwapCode}`,
      link: 'my-swaps.html'
    });

    // Automatically register device in user's listed trade-in phones
    this.addUserDevice(newRequest.customerUid, {
      brand: newRequest.brand,
      model: newRequest.model,
      storageCapacity: newRequest.storageCapacity,
      ram: newRequest.ram,
      imeiNumber: newRequest.imeiNumber,
      conditionTriage: newRequest.conditionTriage,
      deviceMedia: newRequest.deviceMedia,
      contactPhone: newRequest.customerPhone,
      batteryHealth: newRequest.swapperBattery,
      condition: newRequest.swapperPhoneCondition
    });

    return newRequest;
  },

  getStoreSwapRequests(storeId) {
    let requests = [];
    try {
      requests = JSON.parse(localStorage.getItem(STORAGE_KEYS.SWAP_REQUESTS)) || [];
    } catch {
      requests = [];
    }
    if (!storeId) return requests;
    return requests.filter(r => r.storeId === storeId || r.dealerUid === storeId);
  },

  async getStoreSwapRequestsRemote(storeId) {
    if (!storeId) return [];
    try {
      let requests = [];
      try {
        const snapshot = await getDocs(query(
          collection(db, 'swapRequests'),
          where('dealerUid', '==', storeId),
          orderBy('createdAt', 'desc'),
          limit(100)
        ));
        requests = snapshot.docs.map(mapRemoteRequest);
      } catch (err) {
        try {
          const snapFallback = await getDocs(query(
            collection(db, 'swapRequests'),
            where('dealerUid', '==', storeId),
            limit(100)
          ));
          requests = snapFallback.docs.map(mapRemoteRequest);
        } catch (_) {}
      }

      if (requests.length === 0) {
        try {
          const snapStore = await getDocs(query(
            collection(db, 'swapRequests'),
            where('storeId', '==', storeId),
            limit(100)
          ));
          requests = snapStore.docs.map(mapRemoteRequest);
        } catch (_) {}
      }

      let cached = [];
      try {
        cached = JSON.parse(localStorage.getItem(STORAGE_KEYS.SWAP_REQUESTS)) || [];
      } catch (_) {
        cached = [];
      }
      const others = cached.filter(r => r.dealerUid !== storeId && r.storeId !== storeId);
      const combined = [...requests, ...others];
      safeSetItem(STORAGE_KEYS.SWAP_REQUESTS, combined);

      return requests;
    } catch (e) {
      console.warn('[NaijaSwapData] getStoreSwapRequestsRemote error:', e);
      return this.getStoreSwapRequests(storeId);
    }
  },

  getUserSwapRequests(customerUid) {
    let requests = [];
    try {
      requests = JSON.parse(localStorage.getItem(STORAGE_KEYS.SWAP_REQUESTS)) || [];
    } catch {
      requests = [];
    }
    if (!customerUid) return requests;
    return requests.filter(r => r.customerUid === customerUid || customerUid === 'user_guest');
  },

  async getUserSwapRequestsRemote(customerUid) {
    if (!customerUid || customerUid === 'user_guest') return [];
    const snapshot = await getDocs(query(
      collection(db, 'swapRequests'),
      where('customerUid', '==', customerUid),
      orderBy('createdAt', 'desc'),
      limit(100)
    ));
    const requests = snapshot.docs.map(mapRemoteRequest);
    if (requests.length) safeSetItem(STORAGE_KEYS.SWAP_REQUESTS, requests);
    return requests;
  },

  async getUserNotificationsRemote(userId) {
    if (!userId || userId === 'user_guest') return [];
    const snapshot = await getDocs(query(
      collection(db, 'users', userId, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(100)
    ));
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  },

  attachFirestoreRequestId(requestId, firestoreId, safeSwapCode = null) {
    if (!requestId || !firestoreId) return;
    let requests = [];
    try {
      requests = JSON.parse(localStorage.getItem(STORAGE_KEYS.SWAP_REQUESTS)) || [];
    } catch {
      requests = [];
    }
    const request = requests.find(item => item.id === requestId);
    if (request) {
      request.firestoreId = firestoreId;
      if (safeSwapCode) request.safeSwapCode = safeSwapCode;
      safeSetItem(STORAGE_KEYS.SWAP_REQUESTS, requests);
    }
  },

  removeSwapRequest(requestId) {
    let requests = [];
    try {
      requests = JSON.parse(localStorage.getItem(STORAGE_KEYS.SWAP_REQUESTS)) || [];
    } catch {
      requests = [];
    }
    const remaining = requests.filter(request => request.id !== requestId);
    safeSetItem(STORAGE_KEYS.SWAP_REQUESTS, remaining);
    return remaining.length !== requests.length;
  },

  getSafeSwapStage(req) {
    if (!req) return 1;
    const status = String(req.status || '').toLowerCase();
    if (status === 'completed') return 5;
    if (status === 'inspection_passed' || req.triageResults) return 4;
    if (req.hubBooking && req.hubBooking.booked) return 3;
    if (status === 'accepted' || status === 'countered') return 2;
    if (status === 'rejected' || status === 'cancelled') return 0;
    return 1;
  },

  proposeCounterOffer(requestId, counterData = {}, storeId) {
    let requests = [];
    try {
      requests = JSON.parse(localStorage.getItem(STORAGE_KEYS.SWAP_REQUESTS)) || [];
    } catch {
      requests = [];
    }

    let updated = null;
    requests = requests.map(r => {
      if (r.id === requestId) {
        r.status = 'countered';
        r.counterOffer = counterData.counterOffer || r.topupOffered;
        r.counterMessage = counterData.counterMessage || '';
        r.counterReason = counterData.counterReason || 'Valuation revised based on device condition';
        r.counterAt = new Date().toISOString();
        updated = r;
      }
      return r;
    });

    safeSetItem(STORAGE_KEYS.SWAP_REQUESTS, requests);

    if (updated) {
      this.logActivity(storeId || updated.storeId, {
        type: 'swap_countered',
        title: 'Counter-Offer Sent',
        description: `Sent counter-offer of ${updated.counterOffer} for ${updated.targetPhoneModel}`
      });

      this.createNotification(updated.customerUid, {
        type: 'swap_countered',
        title: 'Dealer Sent a Counter-Offer',
        message: `${updated.storeName} proposed a revised top-up of ${updated.counterOffer} (${updated.counterReason || 'Revised offer'}). Tap to review.`,
        link: 'my-swaps.html'
      });
    }
    return updated;
  },

  acceptCounterOffer(requestId, customerUid) {
    let requests = [];
    try {
      requests = JSON.parse(localStorage.getItem(STORAGE_KEYS.SWAP_REQUESTS)) || [];
    } catch {
      requests = [];
    }

    let updated = null;
    requests = requests.map(r => {
      if (r.id === requestId) {
        r.status = 'accepted';
        if (r.counterOffer) {
          r.topupOffered = r.counterOffer;
        }
        r.counterAcceptedAt = new Date().toISOString();
        updated = r;
      }
      return r;
    });

    safeSetItem(STORAGE_KEYS.SWAP_REQUESTS, requests);

    if (updated) {
      this.logActivity(updated.storeId, {
        type: 'swap_accepted',
        title: 'Counter-Offer Accepted',
        description: `${updated.customerName} accepted the counter-offer of ${updated.topupOffered} for ${updated.targetPhoneModel}`
      });

      this.createNotification(updated.customerUid, {
        type: 'swap_accepted',
        title: 'Counter-Offer Accepted!',
        message: `Deal locked in at ${updated.topupOffered}! Book your physical hub inspection visit to finalize.`,
        link: 'my-swaps.html'
      });
    }
    return updated;
  },

  bookHubAppointment(requestId, bookingData = {}) {
    let requests = [];
    try {
      requests = JSON.parse(localStorage.getItem(STORAGE_KEYS.SWAP_REQUESTS)) || [];
    } catch {
      requests = [];
    }

    let updated = null;
    requests = requests.map(r => {
      if (r.id === requestId) {
        r.hubBooking = {
          booked: true,
          hubName: bookingData.hubName || r.storeName || 'Computer Village Hub',
          hubAddress: bookingData.hubAddress || 'Otigba Street, Computer Village, Ikeja, Lagos',
          appointmentDate: bookingData.appointmentDate || new Date().toISOString().split('T')[0],
          appointmentTimeSlot: bookingData.appointmentTimeSlot || 'Morning (10:00 AM - 1:00 PM)',
          bookedAt: new Date().toISOString()
        };
        if (r.status === 'accepted' || r.status === 'pending') {
          r.status = 'accepted';
        }
        updated = r;
      }
      return r;
    });

    safeSetItem(STORAGE_KEYS.SWAP_REQUESTS, requests);

    if (updated) {
      this.logActivity(updated.storeId, {
        type: 'hub_booked',
        title: 'Hub Visit Booked',
        description: `${updated.customerName} booked inspection for ${updated.hubBooking.appointmentDate} (${updated.hubBooking.appointmentTimeSlot})`
      });

      this.createNotification(updated.customerUid, {
        type: 'hub_booked',
        title: 'Hub Appointment Confirmed',
        message: `Your inspection is scheduled for ${updated.hubBooking.appointmentDate} at ${updated.hubBooking.hubName}. SafeSwap Code: ${updated.safeSwapCode || 'NS-948201'}`,
        link: 'my-swaps.html'
      });
    }
    return updated;
  },

  completeHubTriage(requestId, triageData = {}, storeId) {
    let requests = [];
    try {
      requests = JSON.parse(localStorage.getItem(STORAGE_KEYS.SWAP_REQUESTS)) || [];
    } catch {
      requests = [];
    }

    let updated = null;
    requests = requests.map(r => {
      if (r.id === requestId) {
        r.status = 'completed';
        r.triageResults = {
          passedPoints: triageData.passedPoints || 10,
          totalPoints: 10,
          checklist: triageData.checklist || {},
          technicianNotes: triageData.technicianNotes || 'All 10 hardware and security checkpoints passed 100%.',
          inspectedBy: triageData.inspectedBy || 'Certified Hub Tech #402',
          verifiedImei: triageData.verifiedImei || r.imeiNumber || '358920194829103',
          completedAt: new Date().toISOString()
        };
        r.completedAt = new Date().toISOString();
        r.certificateId = r.certificateId || ('CERT-' + Date.now());
        updated = r;
      }
      return r;
    });

    safeSetItem(STORAGE_KEYS.SWAP_REQUESTS, requests);

    if (updated) {
      this.decrementListingStock(updated.listingId || updated.targetPhoneId, updated);

      this.logActivity(storeId || updated.storeId, {
        type: 'swap_completed',
        title: 'Swap Certified & Completed!',
        description: `Inspected & Completed: ${updated.targetPhoneModel} for ${updated.customerName}. Certificate #${updated.certificateId}`
      });

      this.createNotification(updated.customerUid, {
        type: 'swap_completed',
        title: '🎉 Swap Completed & Warranty Active!',
        message: `Congratulations! Your swap for ${updated.targetPhoneModel} is complete. Your 30-Day Testing Warranty Certificate is now active.`,
        link: `certificate.html?id=${updated.id}`
      });
    }
    return updated;
  },

  updateSwapRequestStatus(requestId, status, storeId) {
    let requests = [];
    try {
      requests = JSON.parse(localStorage.getItem(STORAGE_KEYS.SWAP_REQUESTS)) || [];
    } catch {
      requests = [];
    }

    let updated = null;
    const normalizedStatus = normalizeSwapStatus(status);
    requests = requests.map(r => {
      if (r.id === requestId) {
        r.status = normalizedStatus;
        updated = r;
      }
      return r;
    });

    safeSetItem(STORAGE_KEYS.SWAP_REQUESTS, requests);

    if (updated) {
      if (normalizedStatus === 'completed') {
        this.decrementListingStock(updated.listingId || updated.targetPhoneId, updated);
      }

      this.logActivity(storeId || updated.storeId, {
        type: normalizedStatus === 'accepted' ? 'swap_accepted' : normalizedStatus === 'rejected' ? 'swap_rejected' : 'swap_updated',
        title: 'Swap ' + normalizedStatus,
        description: 'Swap ' + normalizedStatus + ': ' + updated.targetPhoneModel + ' (' + updated.customerName + ')'
      });

      this.createNotification(updated.customerUid, {
        type: normalizedStatus === 'accepted' ? 'swap_accepted' : normalizedStatus === 'rejected' ? 'swap_rejected' : 'swap_updated',
        title: 'Swap ' + normalizedStatus,
        message: normalizedStatus === 'accepted' 
          ? `Great news! ${updated.storeName} accepted your swap request for ${updated.targetPhoneModel}. SafeSwap Code: ${updated.safeSwapCode || 'NS-849201'}. Tap to book your hub inspection.`
          : `${updated.storeName} has updated your swap request for ${updated.targetPhoneModel} to ${normalizedStatus}.`,
        link: 'my-swaps.html'
      });
    }

    return updated;
  },

  recordSwapPayment(requestId, paymentDetails = {}) {
    let requests = [];
    try {
      requests = JSON.parse(localStorage.getItem(STORAGE_KEYS.SWAP_REQUESTS)) || [];
    } catch {
      requests = [];
    }

    let updated = null;
    requests = requests.map(r => {
      if (r.id === requestId || r.firestoreId === requestId) {
        r.paymentStatus = 'escrow_secured';
        r.paymentReference = paymentDetails.reference || r.paymentReference;
        r.paymentAmount = paymentDetails.amountInNaira || paymentDetails.amount || r.topupAmount;
        r.paymentChannel = paymentDetails.channel || 'paystack';
        r.paidAt = new Date().toISOString();
        updated = r;
      }
      return r;
    });

    safeSetItem(STORAGE_KEYS.SWAP_REQUESTS, requests);

    if (updated) {
      this.logActivity(updated.storeId, {
        type: 'escrow_secured',
        title: 'Escrow Payment Secured',
        description: `Customer paid ₦${Number(updated.paymentAmount || updated.topupAmount || 0).toLocaleString()} top-up into escrow for ${updated.targetPhoneModel}`
      });

      this.createNotification(updated.customerUid, {
        type: 'payment_success',
        title: 'Escrow Secured',
        message: `Your top-up of ₦${Number(updated.paymentAmount || updated.topupAmount || 0).toLocaleString()} has been safely locked in Paystack Escrow. Reference: ${updated.paymentReference}.`,
        link: 'my-swaps.html'
      });
    }

    return updated;
  },

  decrementListingStock(listingId, swapRequest = {}) {
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem(STORAGE_KEYS.LISTINGS)) || [];
    } catch {
      items = DEFAULT_LISTINGS;
    }

    let found = false;
    items = items.map(item => {
      const matchById = listingId && item.id === listingId;
      const matchByModel = swapRequest && (
        (item.model && swapRequest.targetPhoneModel && item.model.toLowerCase() === swapRequest.targetPhoneModel.toLowerCase()) ||
        (item.model && swapRequest.targetModel && item.model.toLowerCase() === swapRequest.targetModel.toLowerCase())
      ) && (!swapRequest.storeId || item.storeId === swapRequest.storeId);

      if (!found && (matchById || matchByModel)) {
        found = true;
        const currentQty = typeof item.quantityInStock === 'number' ? item.quantityInStock : 1;
        const newQty = Math.max(0, currentQty - 1);
        item.quantityInStock = newQty;
        if (newQty <= 0) {
          item.status = 'out_of_stock';
        }
      }
      return item;
    });

    localStorage.setItem(STORAGE_KEYS.LISTINGS, JSON.stringify(items));
    return found;
  },

  cancelSwapRequest(requestId) {
    let requests = [];
    try {
      requests = JSON.parse(localStorage.getItem(STORAGE_KEYS.SWAP_REQUESTS)) || [];
    } catch {
      requests = [];
    }

    const target = requests.find(r => r.id === requestId);
    requests = requests.filter(r => r.id !== requestId);
    localStorage.setItem(STORAGE_KEYS.SWAP_REQUESTS, JSON.stringify(requests));

    if (target) {
      this.logActivity(target.storeId, {
        type: 'swap_cancelled',
        title: 'Swap Cancelled by Swapper',
        description: `Cancelled swap: ${target.swapperPhoneModel} for ${target.targetPhoneModel}`
      });

      this.createNotification(target.customerUid, {
        type: 'swap_cancelled',
        title: 'Swap Request Cancelled',
        message: `You cancelled your proposal to swap ${target.swapperPhoneModel} for ${target.targetPhoneModel}.`,
        link: 'my-swaps.html'
      });
    }

    return true;
  },

  // --- USER LISTED DEVICES (PHONES USER HAS LISTED TO SWAP) ---
  getUserDevices(userId = 'user_guest') {
    let devices = [];
    try {
      devices = JSON.parse(localStorage.getItem(STORAGE_KEYS.USER_DEVICES)) || [];
    } catch {
      devices = [];
    }
    let userDevs = devices.filter(d => !d.userId || d.userId === userId || userId === 'user_guest');

    // If user has no explicit devices in USER_DEVICES, also check previously logged swap requests
    if (userDevs.length === 0) {
      const requests = this.getUserSwapRequests(userId);
      const seen = new Set();
      requests.forEach(r => {
        const devModel = r.model || (r.swapperPhoneModel ? r.swapperPhoneModel.split(' (')[0] : '');
        const devStorage = r.storageCapacity || r.swapperPhoneStorage || '128GB';
        const key = `${r.brand || r.swapperPhoneBrand || ''}_${devModel}_${devStorage}`;
        if (!seen.has(key) && devModel) {
          seen.add(key);
          const dev = {
            id: 'dev_legacy_' + r.id,
            userId: r.customerUid || userId,
            brand: r.brand || r.swapperPhoneBrand || 'Apple',
            model: devModel,
            storageCapacity: devStorage,
            ram: r.ram || '',
            condition: r.swapperPhoneCondition || 'Excellent',
            batteryHealth: r.swapperBattery || '90%',
            imeiNumber: r.imeiNumber || '',
            conditionTriage: r.conditionTriage || null,
            deviceMedia: r.deviceMedia || [],
            contactPhone: r.customerPhone || '',
            createdAt: r.createdAt || new Date().toISOString()
          };
          userDevs.push(dev);
        }
      });
    }

    // If still no devices found, also check onboarding device cache for this user
    if (userDevs.length === 0) {
      try {
        const obDevRaw = localStorage.getItem('naijaswap_user_device_' + userId) || localStorage.getItem('naijaswap_user_device');
        if (obDevRaw) {
          const obDev = JSON.parse(obDevRaw);
          if (obDev && obDev.model) {
            userDevs.push({
              id: 'dev_onboard_' + (userId || 'user'),
              userId: userId,
              brand: obDev.brand || 'Apple',
              model: obDev.model,
              storageCapacity: obDev.storage || '128GB',
              condition: 'Grade A - Pristine',
              batteryHealth: '88%+',
              estimatedValue: obDev.estimatedValue || 0,
              contactPhone: localStorage.getItem('naijaswap_user_whatsapp_' + userId) || '',
              createdAt: new Date().toISOString()
            });
          }
        }
      } catch (_) {}
    }

    return userDevs;
  },

  addUserDevice(userId = 'user_guest', deviceData = {}) {
    let devices = [];
    try {
      devices = JSON.parse(localStorage.getItem(STORAGE_KEYS.USER_DEVICES)) || [];
    } catch {
      devices = [];
    }

    const model = deviceData.model || 'Smartphone';
    const storageCapacity = deviceData.storageCapacity || deviceData.storage || '128GB';
    const imei = deviceData.imeiNumber || '';

    // Check if duplicate already exists for this user
    const existing = devices.find(d => 
      (d.userId === userId || !d.userId) && 
      d.model.toLowerCase() === model.toLowerCase() && 
      d.storageCapacity.toLowerCase() === storageCapacity.toLowerCase() &&
      (!imei || !d.imeiNumber || d.imeiNumber === imei)
    );

    if (existing) {
      // Update existing device
      existing.condition = deviceData.condition || existing.condition;
      existing.color = deviceData.color || existing.color;
      existing.batteryHealth = deviceData.batteryHealth || existing.batteryHealth;
      existing.carrierLock = deviceData.carrierLock || existing.carrierLock;
      existing.repairHistory = deviceData.repairHistory || existing.repairHistory;
      existing.inclusions = deviceData.inclusions || existing.inclusions;
      existing.accountCleanCheck = deviceData.accountCleanCheck !== undefined ? deviceData.accountCleanCheck : existing.accountCleanCheck;
      if (deviceData.deviceMedia && deviceData.deviceMedia.length > 0) {
        existing.deviceMedia = deviceData.deviceMedia.slice(0, 5);
      }
      localStorage.setItem(STORAGE_KEYS.USER_DEVICES, JSON.stringify(devices));
      return existing;
    }

    const newDevice = {
      id: 'dev_' + Date.now(),
      userId: userId || 'user_guest',
      brand: deviceData.brand || 'Apple',
      model,
      storageCapacity,
      color: deviceData.color || 'Standard',
      ram: deviceData.ram || '',
      condition: deviceData.condition || 'Excellent',
      batteryHealth: deviceData.batteryHealth || (deviceData.conditionTriage?.batteryHealth ? `${deviceData.conditionTriage.batteryHealth}%` : '90%'),
      carrierLock: deviceData.carrierLock || 'Factory Unlocked',
      repairHistory: deviceData.repairHistory || 'All Original (Never Repaired)',
      inclusions: deviceData.inclusions || 'Device Only',
      accountCleanCheck: deviceData.accountCleanCheck !== undefined ? deviceData.accountCleanCheck : true,
      imeiNumber: imei,
      conditionTriage: deviceData.conditionTriage || null,
      deviceMedia: (Array.isArray(deviceData.deviceMedia) ? deviceData.deviceMedia : []).slice(0, 5),
      contactPhone: deviceData.contactPhone || '',
      createdAt: new Date().toISOString()
    };

    devices.unshift(newDevice);
    localStorage.setItem(STORAGE_KEYS.USER_DEVICES, JSON.stringify(devices));
    return newDevice;
  },

  deleteUserDevice(deviceId) {
    let devices = [];
    try {
      devices = JSON.parse(localStorage.getItem(STORAGE_KEYS.USER_DEVICES)) || [];
    } catch {
      devices = [];
    }
    devices = devices.filter(d => d.id !== deviceId);
    localStorage.setItem(STORAGE_KEYS.USER_DEVICES, JSON.stringify(devices));
    return true;
  },

  calculateTopUpForDevice(targetListingId, userDevice) {
    if (!userDevice) return { isValid: false, error: 'No device provided' };
    return this.calculateTopUp(targetListingId, {
      brand: userDevice.brand,
      model: userDevice.model,
      storage: userDevice.storageCapacity || userDevice.storage || '128GB',
      condition: userDevice.condition || 'Excellent',
      batteryHealth: userDevice.batteryHealth,
      conditionTriage: userDevice.conditionTriage || {}
    });
  },

  verifyDealerPrice(brand, model, storage, conditionGrade, deviceStatus, proposedPrice) {
    const marketPrice = this.calculateMarketPrice(brand, model, storage, conditionGrade, deviceStatus);
    const priceNum = Number(proposedPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      return { valid: false, reason: 'Price must be a positive number.' };
    }
    const ratio = priceNum / marketPrice;
    if (ratio < 0.65) {
      return { 
        valid: false, 
        isWarning: true, 
        marketPrice,
        marketPriceFormatted: '₦' + marketPrice.toLocaleString(),
        reason: `Price (₦${priceNum.toLocaleString()}) is unusually low (>35% below estimated market value of ₦${marketPrice.toLocaleString()}). Please double-check.` 
      };
    }
    if (ratio > 1.45) {
      return { 
        valid: false, 
        isWarning: true, 
        marketPrice,
        marketPriceFormatted: '₦' + marketPrice.toLocaleString(),
        reason: `Price (₦${priceNum.toLocaleString()}) is unusually high (>45% above estimated market value of ₦${marketPrice.toLocaleString()}).` 
      };
    }
    return { valid: true, marketPrice, marketPriceFormatted: '₦' + marketPrice.toLocaleString() };
  },

  // --- ACTIVITY AUDIT LOG ---
  logActivity(storeId, activityData) {
    let logs = [];
    try {
      logs = JSON.parse(localStorage.getItem(STORAGE_KEYS.ACTIVITY_LOG)) || [];
    } catch {
      logs = [];
    }

    const newLog = {
      id: 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      storeId: storeId || 'store_prime',
      type: activityData.type || 'general',
      category: activityData.category || (activityData.type?.includes('swap') ? 'swap' : activityData.type?.includes('listing') || activityData.type?.includes('price') || activityData.type?.includes('stock') ? 'inventory' : activityData.type?.includes('inspection') ? 'inspection' : activityData.type?.includes('kyc') || activityData.type?.includes('auth') ? 'security' : 'general'),
      title: activityData.title || 'Store Activity',
      description: activityData.description || '',
      customerName: activityData.customerName || '',
      customerLocation: activityData.customerLocation || '',
      relatedId: activityData.relatedId || '',
      amount: activityData.amount || '',
      deviceModel: activityData.deviceModel || '',
      createdAt: new Date().toISOString()
    };

    logs.unshift(newLog);
    if (logs.length > 100) logs = logs.slice(0, 100);
    localStorage.setItem(STORAGE_KEYS.ACTIVITY_LOG, JSON.stringify(logs));
    return newLog;
  },

  getStoreActivity(storeId) {
    let logs = [];
    try {
      logs = JSON.parse(localStorage.getItem(STORAGE_KEYS.ACTIVITY_LOG)) || [];
    } catch {
      logs = [];
    }
    if (!Array.isArray(logs)) logs = [];
    if (!storeId) return logs;
    return logs.filter(l => l.storeId === storeId);
  },

  clearStoreActivity(storeId) {
    let logs = [];
    try {
      logs = JSON.parse(localStorage.getItem(STORAGE_KEYS.ACTIVITY_LOG)) || [];
    } catch {
      logs = [];
    }
    if (!storeId || storeId === 'store_prime') {
      logs = [];
    } else {
      logs = logs.filter(l => l.storeId !== storeId && l.storeId !== 'store_prime');
    }
    localStorage.setItem(STORAGE_KEYS.ACTIVITY_LOG, JSON.stringify(logs));
    return true;
  },

  // --- OVERVIEW METRICS FOR STORE DASHBOARD ---
  getStoreStats(storeId) {
    const listings = this.getStoreListings(storeId);
    const requests = this.getStoreSwapRequests(storeId);

    const activeListings = listings.filter(l => {
      const st = String(l.status || 'active').toLowerCase();
      const inStock = l.quantityInStock === undefined || Number(l.quantityInStock) > 0;
      return (st === 'active' || st === 'published') && st !== 'out_of_stock' && st !== 'archived' && st !== 'deleted' && inStock;
    }).length;

    const totalRequests = requests.length;
    const pendingRequests = requests.filter(r => {
      const st = normalizeSwapStatus(r.status);
      return st === 'pending' || st === 'reviewed';
    }).length;
    const completedSwaps = requests.filter(r => {
      const st = normalizeSwapStatus(r.status);
      return st === 'completed' || st === 'accepted' || st === 'inspection_passed';
    }).length;

    return {
      activeListings,
      totalRequests,
      pendingRequests,
      completedSwaps
    };
  },

  async getStoreStatsRemote(storeId) {
    if (!storeId) return this.getStoreStats(storeId);
    try {
      const [listings, requests] = await Promise.all([
        this.getStoreListingsRemote(storeId),
        this.getStoreSwapRequestsRemote(storeId)
      ]);

      const activeListings = listings.filter(l => {
        const st = String(l.status || 'active').toLowerCase();
        const inStock = l.quantityInStock === undefined || Number(l.quantityInStock) > 0;
        return (st === 'active' || st === 'published') && st !== 'out_of_stock' && st !== 'archived' && st !== 'deleted' && inStock;
      }).length;

      const totalRequests = requests.length;
      const pendingRequests = requests.filter(r => {
        const st = normalizeSwapStatus(r.status);
        return st === 'pending' || st === 'reviewed';
      }).length;
      const completedSwaps = requests.filter(r => {
        const st = normalizeSwapStatus(r.status);
        return st === 'completed' || st === 'accepted' || st === 'inspection_passed';
      }).length;

      return {
        activeListings,
        totalRequests,
        pendingRequests,
        completedSwaps
      };
    } catch (e) {
      console.warn('[NaijaSwapData] getStoreStatsRemote error:', e);
      return this.getStoreStats(storeId);
    }
  },

  // --- RELATIVE TIME FORMATTER ---
  formatRelativeTime(isoString) {
    if (!isoString) return 'Just now';
    const date = new Date(isoString);
    const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (diffSeconds < 60) return 'Just now';
    if (diffSeconds < 3600) return Math.floor(diffSeconds / 60) + 'm ago';
    if (diffSeconds < 86400) return Math.floor(diffSeconds / 3600) + 'h ago';
    if (diffSeconds < 604800) return Math.floor(diffSeconds / 86400) + 'd ago';
    return date.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' });
  },

  // --- NOTIFICATIONS & ALERTS SYSTEM ---
  getUserNotifications(userId) {
    let notifs = [];
    try {
      notifs = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS)) || [];
    } catch {
      notifs = [];
    }
    if (!userId || userId === 'all') return notifs;
    return notifs.filter(n => !n.userId || n.userId === userId || n.userId === 'user_guest' || userId === 'user_guest');
  },

  createNotification(userId, notifData) {
    let notifs = [];
    try {
      notifs = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS)) || [];
    } catch {
      notifs = [];
    }

    const newNotif = {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      userId: userId || 'user_guest',
      type: notifData.type || 'general', // 'swap_submitted', 'swap_accepted', 'swap_declined', 'swap_cancelled', 'system'
      title: notifData.title || 'Notification',
      message: notifData.message || '',
      link: notifData.link || 'alerts.html',
      isRead: false,
      createdAt: new Date().toISOString()
    };

    notifs.unshift(newNotif);
    if (notifs.length > 50) notifs = notifs.slice(0, 50);
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifs));
    return newNotif;
  },

  markNotificationRead(notifId) {
    let notifs = [];
    try {
      notifs = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS)) || [];
    } catch {
      notifs = [];
    }

    notifs = notifs.map(n => {
      if (n.id === notifId) n.isRead = true;
      return n;
    });

    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifs));
    return true;
  },

  markAllNotificationsRead(userId) {
    let notifs = [];
    try {
      notifs = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS)) || [];
    } catch {
      notifs = [];
    }

    notifs = notifs.map(n => {
      if (!userId || n.userId === userId || n.userId === 'user_guest' || userId === 'user_guest') {
        n.isRead = true;
      }
      return n;
    });

    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifs));
    return true;
  },

  clearAllNotifications(userId) {
    let notifs = [];
    try {
      notifs = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS)) || [];
    } catch {
      notifs = [];
    }

    if (!userId || userId === 'all') {
      notifs = [];
    } else {
      notifs = notifs.filter(n => n.userId && n.userId !== userId && n.userId !== 'user_guest');
    }

    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifs));
    return true;
  },

  deleteNotification(notifId) {
    let notifs = [];
    try {
      notifs = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS)) || [];
    } catch {
      notifs = [];
    }

    notifs = notifs.filter(n => n.id !== notifId);
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifs));
    return true;
  },

  getUnreadNotificationsCount(userId) {
    const list = this.getUserNotifications(userId);
    return list.filter(n => !n.isRead).length;
  },

  async getStoreReviews(storeId) {
    if (!storeId) return [];
    try {
      if (db) {
        const q = query(
          collection(db, 'reviews'),
          where('storeId', '==', storeId),
          orderBy('createdAt', 'desc'),
          limit(20)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
      }
    } catch (e) {
      console.warn('Firestore reviews fetch failed, using saved local reviews', e);
    }

    try {
      const local = JSON.parse(localStorage.getItem(STORAGE_KEYS.REVIEWS) || '[]');
      return local.filter(r => r.storeId === storeId);
    } catch {
      return [];
    }
  },

  async addStoreReview(reviewData) {
    return createReviewBackend(reviewData);
  },

  getStoreRatingSummary(reviews = []) {
    if (!reviews || reviews.length === 0) {
      return { averageRating: 5.0, count: 0, formatted: '5.0 ★ (New Verified Hub)' };
    }
    const sum = reviews.reduce((acc, r) => acc + (Number(r.rating) || 5), 0);
    const avg = (sum / reviews.length).toFixed(1);
    return {
      averageRating: parseFloat(avg),
      count: reviews.length,
      formatted: `${avg} ★ (${reviews.length} ${reviews.length === 1 ? 'review' : 'reviews'})`
    };
  }
};

if (typeof module !== 'undefined') {
  module.exports = { NaijaSwapData };
}
