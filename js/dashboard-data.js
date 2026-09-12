/**
 * NaijaSwap - Centralized Data & Marketplace Controller
 * Handles persistent state for Swapper browsing and Store/Dealer inventory management.
 */
import { db, collection, getDocs, query, where, orderBy, limit } from './firebase-config.js';

const STORAGE_KEYS = {
  LISTINGS: 'naijaswap_marketplace_listings',
  SWAP_REQUESTS: 'naijaswap_swap_requests',
  ACTIVITY_LOG: 'naijaswap_activity_log',
  NOTIFICATIONS: 'naijaswap_user_notifications',
  USER_DEVICES: 'naijaswap_user_devices',
  INITIALIZED: 'naijaswap_data_initialized_v3'
};

const SWAP_STATUS_ALIASES = {
  pending: 'pending',
  reviewed: 'reviewed',
  accepted: 'accepted',
  countered: 'countered',
  completed: 'completed',
  rejected: 'rejected',
  declined: 'rejected',
  cancelled: 'cancelled'
};

function normalizeSwapStatus(status) {
  const normalized = String(status || 'pending').trim().toLowerCase();
  return SWAP_STATUS_ALIASES[normalized] || 'pending';
}

function mapRemoteListing(snapshot) {
  return { id: snapshot.id, ...snapshot.data(), status: String(snapshot.data().status || 'active').toLowerCase() };
}

function mapRemoteRequest(snapshot) {
  const data = snapshot.data();
  const current = data.currentDevice || {};
  const target = data.targetDevice || {};
  return {
    id: snapshot.id,
    firestoreId: snapshot.id,
    customerUid: data.customerUid || '',
    dealerUid: data.dealerUid || '',
    storeId: data.dealerUid || '',
    storeName: data.storeName || '',
    customerName: data.customerName || 'Swapper',
    customerEmail: data.customerEmail || '',
    customerPhone: data.customerPhone || '',
    model: current.model || '',
    brand: current.brand || '',
    storageCapacity: current.storage || current.storageCapacity || '',
    imeiNumber: current.imeiNumber || '',
    swapperPhoneModel: current.model || 'Smartphone',
    swapperPhoneStorage: current.storage || current.storageCapacity || '',
    swapperPhoneCondition: current.condition || 'Inspection pending',
    swapperBattery: current.battery || '',
    conditionTriage: current.conditionTriage || {},
    deviceMedia: data.deviceMedia || [],
    targetModel: target.model || '',
    targetStorage: target.storage || target.storageCapacity || '',
    targetPhoneModel: target.model || 'Target phone',
    targetPhoneImage: target.image || '',
    targetBrand: target.brand || '',
    preferredColor: target.color || '',
    topupOffered: data.topupAmount || 0,
    tradeInCredit: data.offeredPrice || 0,
    notes: data.message || '',
    counterOffer: data.counterOffer || null,
    counterMessage: data.counterMessage || '',
    paymentStatus: data.paymentStatus || 'not_required',
    status: normalizeSwapStatus(data.status),
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || new Date().toISOString()
  };
}

// Initial verified marketplace inventory using real assets and rich Nigerian marketplace details
const DEFAULT_LISTINGS = [
  {
    id: 'phone_101',
    brand: 'Apple',
    model: 'iPhone 15 Pro Max',
    storage: '256GB',
    condition: 'Brand New Sealed',
    color: 'Natural Titanium',
    battery: '100%',
    marketValue: 1450000,
    screen: '6.7-inch Super Retina XDR OLED, 120Hz ProMotion',
    chipset: 'Apple A17 Pro (3nm)',
    camera: '48MP Main + 12MP Ultra-wide + 12MP 5x Telephoto',
    sim: 'Nano-SIM + eSIM (Global Unlocked)',
    boxIncludes: 'Original Apple Sealed Box, USB-C Woven Cable (1m), Hub Verification Certificate',
    warranty: '1 Year Apple International Warranty + 30-Day Hub Replacement Guarantee',
    description: 'Pristine, factory-sealed iPhone 15 Pro Max in high-demand Natural Titanium finish. Tested & authenticated at Computer Village Verification Hub. Clean IMEI, unassigned iCloud, ready for immediate activation on MTN, Airtel, Glo & 9mobile.',
    location: 'Ikeja, Lagos',
    hubAddress: 'Shop B14, Digital Complex, Otigba Street, Computer Village, Ikeja, Lagos',
    whatsappNumber: '2348023456789',
    acceptedTradeIn: 'iPhone 13 Pro Max / 14 Pro / 14 Pro Max',
    storeId: 'store_prime',
    storeName: 'Computer Village Hub',
    storeVerified: true,
    tags: ['Recently Listed', 'Verified Store', 'Hub Inspected'],
    image: 'assets/iPhone 15 Pro Max (256GB).jpg',
    status: 'Active',
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString()
  },
  {
    id: 'phone_102',
    brand: 'Apple',
    model: 'iPhone 15 Pro',
    storage: '128GB',
    condition: 'Excellent',
    color: 'Blue Titanium',
    battery: '99%',
    marketValue: 1150000,
    screen: '6.1-inch Super Retina XDR OLED, 120Hz ProMotion',
    chipset: 'Apple A17 Pro (3nm)',
    camera: '48MP Main + 12MP Ultra-wide + 12MP 3x Telephoto',
    sim: 'Nano-SIM + eSIM (Factory Unlocked)',
    boxIncludes: 'Original Box, USB-C Cable, Transparent MagSafe Case',
    warranty: '7-Day Full Return Guarantee + 30-Day Hub Hardware Warranty',
    description: 'Mint condition iPhone 15 Pro in elegant Blue Titanium. Screen is completely scratch-free with tempered glass pre-installed. TrueTone, FaceID, Action Button, and all cameras verified 100% operational by senior hub technicians.',
    location: 'Ikeja, Lagos',
    hubAddress: 'Shop B14, Digital Complex, Otigba Street, Computer Village, Ikeja, Lagos',
    whatsappNumber: '2348023456789',
    acceptedTradeIn: 'iPhone 12 Pro / 13 Pro / 14',
    storeId: 'store_prime',
    storeName: 'Computer Village Hub',
    storeVerified: true,
    tags: ['Recently Listed', 'Verified Store'],
    image: 'assets/iPhone 15 Pro.jpg',
    status: 'Active',
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString()
  },
  {
    id: 'phone_103',
    brand: 'Samsung',
    model: 'Galaxy S24 Ultra',
    storage: '256GB',
    condition: 'Brand New Sealed',
    color: 'Titanium Gray',
    battery: '100%',
    marketValue: 1380000,
    screen: '6.8-inch Dynamic AMOLED 2X, 120Hz',
    chipset: 'Qualcomm Snapdragon 8 Gen 3 for Galaxy',
    camera: '200MP Main + 50MP Periscope + 10MP Telephoto + 12MP Ultrawide',
    sim: 'Dual Nano-SIM + eSIM',
    boxIncludes: 'Original Samsung Sealed Box, S-Pen, USB-C Cable',
    warranty: '24 Months Samsung Warranty + Hub Replacement Guarantee',
    description: 'Brand new Samsung Galaxy S24 Ultra, factory unlocked and verified at the partner hub.',
    location: 'Wuse 2, Abuja',
    hubAddress: 'Suite 204, Banex Plaza, Aminu Kano Crescent, Wuse 2, Abuja',
    whatsappNumber: '2348034567890',
    acceptedTradeIn: 'Galaxy S22 Ultra / S23 Ultra / iPhone 14 Pro',
    storeId: 'store_abuja',
    storeName: 'Banex Exchange Hub',
    storeVerified: true,
    tags: ['Recently Listed', 'Verified Store'],
    image: 'assets/Samsung Galaxy S24 Ultra (256GB).jpg',
    status: 'Active',
    createdAt: new Date(Date.now() - 3600000 * 8).toISOString()
  },
  {
    id: 'phone_104',
    brand: 'Apple',
    model: 'iPhone 14 Pro',
    storage: '128GB',
    condition: 'Excellent',
    color: 'Deep Purple',
    battery: '94%',
    marketValue: 850000,
    screen: '6.1-inch Super Retina XDR OLED with Dynamic Island, 120Hz',
    chipset: 'Apple A16 Bionic (4nm)',
    camera: '48MP Main + 12MP Ultra-wide + 12MP 3x Telephoto',
    sim: 'Nano-SIM + eSIM',
    boxIncludes: 'Original Apple Box, USB-C to Lightning Braided Cable, Hub Purchase Receipt',
    warranty: '14-Day Hub Exchange Guarantee + 30-Day Technical Support',
    description: 'Sought-after Deep Purple iPhone 14 Pro. Flawless ceramic shield front glass, 94% original battery health with all-day endurance. Dynamic Island, 48MP ProRAW photos, and Always-on display fully verified.',
    location: 'Ikeja, Lagos',
    hubAddress: 'Shop B14, Digital Complex, Otigba Street, Computer Village, Ikeja, Lagos',
    whatsappNumber: '2348023456789',
    acceptedTradeIn: 'iPhone 11 Pro Max / 12 Pro / 13',
    storeId: 'store_prime',
    storeName: 'Computer Village Hub',
    storeVerified: true,
    tags: ['Verified Store'],
    image: 'assets/iPhone 14 Pro (128GB).jpg',
    status: 'Active',
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString()
  },
  {
    id: 'phone_105',
    brand: 'Apple',
    model: 'iPhone 13',
    storage: '128GB',
    condition: 'Very Good',
    color: 'Starlight White',
    battery: '91%',
    marketValue: 540000,
    screen: '6.1-inch Super Retina XDR OLED, HDR10, TrueTone',
    chipset: 'Apple A15 Bionic (5nm)',
    camera: 'Dual 12MP Main + 12MP Ultra-Wide with Sensor-shift OIS',
    sim: 'Physical Nano-SIM + eSIM',
    boxIncludes: 'Charging Cable, 20W Fast Charging Adapter, Hub Receipt',
    warranty: '7-Day Return Guarantee + 30-Day Hardware Support',
    description: 'Clean Apple iPhone 13 in clean Starlight White. Excellent body condition with minimal micro-signs of gentle use. FaceID, cinematic mode video, stereo speakers, and 5G connectivity running flawlessly.',
    location: 'Garrison, Port Harcourt',
    hubAddress: 'Plot 18, Aba Road by Garrison Roundabout, Port Harcourt, Rivers State',
    whatsappNumber: '2348045678901',
    acceptedTradeIn: 'iPhone 11 / XR',
    storeId: 'store_ph',
    storeName: 'Garrison Tech Hub',
    storeVerified: true,
    tags: ['Verified Store'],
    image: 'assets/iPhone 13 (128GB).jpg',
    status: 'Active',
    createdAt: new Date(Date.now() - 3600000 * 36).toISOString()
  },
  {
    id: 'phone_106',
    brand: 'Apple',
    model: 'iPhone 12 Pro',
    storage: '128GB',
    condition: 'Good',
    color: 'Pacific Blue',
    battery: '88%',
    marketValue: 450000,
    screen: '6.1-inch Super Retina XDR OLED, Ceramic Shield front',
    chipset: 'Apple A14 Bionic (5nm)',
    camera: 'Triple 12MP (Wide, Ultrawide, Telephoto) with LiDAR Scanner',
    sim: 'Nano-SIM + eSIM (Global)',
    boxIncludes: 'Lightning Cable, Silicon Bumper Case, Hub Receipt',
    warranty: '7-Day Hub Exchange Guarantee',
    description: 'Classic Pacific Blue iPhone 12 Pro stainless steel design. 88% original battery, LiDAR scanner for night portrait photography, 4K Dolby Vision HDR video recording. Tested and verified 100% functional.',
    location: 'Ikeja, Lagos',
    hubAddress: 'Shop B14, Digital Complex, Otigba Street, Computer Village, Ikeja, Lagos',
    whatsappNumber: '2348023456789',
    acceptedTradeIn: 'iPhone XS Max / iPhone 11',
    storeId: 'store_prime',
    storeName: 'Computer Village Hub',
    storeVerified: true,
    tags: ['Verified Store'],
    image: 'assets/iPhone 12 Pro.jpg',
    status: 'Active',
    createdAt: new Date(Date.now() - 3600000 * 48).toISOString()
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

function initDatabase() {
  if (typeof localStorage !== 'undefined') {
    const initialized = localStorage.getItem(STORAGE_KEYS.INITIALIZED);
    if (!initialized) {
      localStorage.setItem(STORAGE_KEYS.LISTINGS, JSON.stringify(DEFAULT_LISTINGS));
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
    const snapshot = await getDocs(query(
      collection(db, 'listings'),
      where('status', 'in', ['active', 'Active']),
      orderBy('createdAt', 'desc'),
      limit(100)
    ));
    const remoteListings = snapshot.docs.map(mapRemoteListing);
    if (remoteListings.length) {
      localStorage.setItem(STORAGE_KEYS.LISTINGS, JSON.stringify(remoteListings));
    }
    return this.filterListings(remoteListings, filters);
  },

  filterListings(items, filters = {}) {
    const { brand, storage, condition, location, query: searchQuery } = filters;
    return items.filter(item => {
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
      items = DEFAULT_LISTINGS;
    }
    if (!items || items.length === 0) {
      items = DEFAULT_LISTINGS;
      try { localStorage.setItem(STORAGE_KEYS.LISTINGS, JSON.stringify(items)); } catch(e){}
    }

    const { brand, storage, condition, location, query } = filters;

    return items.filter(item => {
      const itemBrand = String(item.brand || '').toLowerCase();
      const itemModel = String(item.model || '').toLowerCase();
      const isApple = itemBrand.includes('apple') || itemModel.includes('iphone');
      const isSamsung = itemBrand.includes('samsung') || itemModel.includes('galaxy');
      if (!isApple && !isSamsung) return false;
      if (item.status && !['active', 'Active'].includes(item.status)) return false;

      if (brand && brand !== 'All') {
        const b = brand.toLowerCase();
        if (b === 'other') {
          const major = ['apple', 'iphone', 'samsung', 'galaxy'];
          if (major.some(m => item.brand.toLowerCase().includes(m) || item.model.toLowerCase().includes(m))) {
            return false;
          }
        } else if (b === 'iphone' || b === 'apple') {
          if (!isApple) {
            return false;
          }
        } else if (b === 'samsung') {
          if (!isSamsung) return false;
        } else {
          if (!item.brand.toLowerCase().includes(b) && !item.model.toLowerCase().includes(b)) {
            return false;
          }
        }
      }

      if (storage && storage !== 'All' && !item.storage.toLowerCase().includes(storage.toLowerCase())) {
        return false;
      }

      if (condition && condition !== 'All') {
        const c1 = item.condition.toLowerCase();
        const c2 = condition.toLowerCase();
        if (!c1.includes(c2) && !c2.includes(c1)) return false;
      }

      if (location && location !== 'All' && !item.location.toLowerCase().includes(location.toLowerCase())) {
        return false;
      }

      if (query && query.trim() !== '') {
        const q = query.toLowerCase().trim();
        const matchTitle = (item.model || '').toLowerCase().includes(q);
        const matchBrand = (item.brand || '').toLowerCase().includes(q);
        const matchLoc = (item.location || '').toLowerCase().includes(q);
        const matchStorage = (item.storage || '').toLowerCase().includes(q);
        const matchColor = (item.color || '').toLowerCase().includes(q);
        if (!matchTitle && !matchBrand && !matchLoc && !matchStorage && !matchColor) {
          return false;
        }
      }

      return true;
    });
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
    const { brand = '', model = '', storage = '128GB', condition = 'Excellent', customValue } = swapperPhoneData;

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

    const userValuation = Math.round(baseCredit * condFactor * storFactor);
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
      storageApplied: storage
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
      items = DEFAULT_LISTINGS;
    }
    if (!items || items.length === 0) items = DEFAULT_LISTINGS;
    items = items.filter(x => {
      const brand = String(x.brand || '').toLowerCase();
      const model = String(x.model || '').toLowerCase();
      return brand.includes('apple') || model.includes('iphone') ||
        brand.includes('samsung') || model.includes('galaxy');
    });
    if (!storeId) return items;
    return items.filter(x => x.storeId === storeId || x.storeId === 'store_prime');
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
              const req = indexedDB.open('nigerswap_media_db', 1);
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
          const req = indexedDB.open('nigerswap_media_db', 1);
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

    const newRequest = {
      id: 'req_' + Date.now(),
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
      createdAt: new Date().toISOString()
    };

    newRequest.status = normalizeSwapStatus(newRequest.status);
    requests.unshift(newRequest);
    localStorage.setItem(STORAGE_KEYS.SWAP_REQUESTS, JSON.stringify(requests));

    this.logActivity(newRequest.storeId, {
      type: 'swap_received',
      title: 'Swap Request: ' + newRequest.targetPhoneModel,
      description: `From ${newRequest.customerName}: ${newRequest.swapperPhoneModel} for ${newRequest.targetPhoneModel}`
    });

    this.createNotification(newRequest.customerUid, {
      type: 'swap_submitted',
      title: 'Swap Request Submitted',
      message: `Your trade-in proposal for ${newRequest.targetPhoneModel} has been submitted to ${newRequest.storeName}.`,
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
    return requests.filter(r => r.storeId === storeId || r.storeId === 'store_prime');
  },

  async getStoreSwapRequestsRemote(storeId) {
    if (!storeId) return [];
    const snapshot = await getDocs(query(
      collection(db, 'swapRequests'),
      where('dealerUid', '==', storeId),
      orderBy('createdAt', 'desc'),
      limit(100)
    ));
    const requests = snapshot.docs.map(mapRemoteRequest);
    if (requests.length) localStorage.setItem(STORAGE_KEYS.SWAP_REQUESTS, JSON.stringify(requests));
    return requests;
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
    if (requests.length) localStorage.setItem(STORAGE_KEYS.SWAP_REQUESTS, JSON.stringify(requests));
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

  attachFirestoreRequestId(requestId, firestoreId) {
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
      localStorage.setItem(STORAGE_KEYS.SWAP_REQUESTS, JSON.stringify(requests));
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
    localStorage.setItem(STORAGE_KEYS.SWAP_REQUESTS, JSON.stringify(remaining));
    return remaining.length !== requests.length;
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

    localStorage.setItem(STORAGE_KEYS.SWAP_REQUESTS, JSON.stringify(requests));

    if (updated) {
      this.logActivity(storeId || updated.storeId, {
        type: normalizedStatus === 'accepted' ? 'swap_accepted' : normalizedStatus === 'rejected' ? 'swap_rejected' : 'swap_updated',
        title: 'Swap ' + normalizedStatus,
        description: 'Swap ' + normalizedStatus + ': ' + updated.targetPhoneModel + ' (' + updated.customerName + ')'
      });

      this.createNotification(updated.customerUid, {
        type: normalizedStatus === 'accepted' ? 'swap_accepted' : normalizedStatus === 'rejected' ? 'swap_rejected' : 'swap_updated',
        title: 'Swap ' + normalizedStatus,
        message: normalizedStatus === 'accepted' 
          ? `Great news! ${updated.storeName} accepted your swap request for ${updated.targetPhoneModel}. Tap to chat the technician and visit the hub.`
          : `${updated.storeName} has updated your swap request for ${updated.targetPhoneModel} to ${normalizedStatus}.`,
        link: 'my-swaps.html'
      });
    }

    return updated;
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
      existing.batteryHealth = deviceData.batteryHealth || existing.batteryHealth;
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
      ram: deviceData.ram || '',
      condition: deviceData.condition || 'Excellent',
      batteryHealth: deviceData.batteryHealth || (deviceData.conditionTriage?.batteryHealth ? `${deviceData.conditionTriage.batteryHealth}%` : '90%'),
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
      condition: userDevice.condition || 'Excellent'
    });
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
    return logs.filter(l => l.storeId === storeId || l.storeId === 'store_prime');
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

    const activeListings = listings.filter(l => l.status === 'Active').length;
    const totalRequests = requests.length;
    const pendingRequests = requests.filter(r => normalizeSwapStatus(r.status) === 'pending').length;
    const completedSwaps = requests.filter(r => normalizeSwapStatus(r.status) === 'completed').length;

    return {
      activeListings,
      totalRequests,
      pendingRequests,
      completedSwaps
    };
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
  }
};

if (typeof module !== 'undefined') {
  module.exports = { NaijaSwapData };
}
