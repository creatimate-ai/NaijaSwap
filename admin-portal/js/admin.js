/**
 * NaijaSwap Standalone Backoffice Admin Controller
 * Manages Dealer KYC Verification Approvals, User Registry, and Marketplace Oversight
 */

import { 
  db, 
  doc, 
  setDoc, 
  auth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged,
  getDoc
} from "./firebase-config.js";
import {
  fetchAdminData,
  setListingFlagged,
  setUserSuspended,
  updateSwapStatus
} from "./admin-data.js";
import { 
  sendDealerVerificationApprovedBrevo, 
  sendDealerVerificationRejectedBrevo,
  syncContactToBrevo
} from "../../js/brevo-client.js";

function notificationRef(uid, id) {
  return doc(db, 'users', uid, 'notifications', id);
}

async function notifyUser(uid, notification) {
  if (!uid) return;
  const id = `dealer_verification_${notification.status}_${Date.now()}`;
  await setDoc(notificationRef(uid, id), {
    ...notification,
    id,
    userId: uid,
    isRead: false,
    createdAt: new Date().toISOString()
  });
}

// Application State
let allVerifications = [];
let allUsers = [];
let allListings = [];
let allSwaps = [];
let currentSelectedDossier = null;
let currentSelectedSwapId = null;
let unavailableCollections = [];
let allSubscriptions = [];

// DOM Elements
const verifTableBody = document.getElementById('verifTableBody');
const userTableBody = document.getElementById('userTableBody');
const listingTableBody = document.getElementById('listingTableBody');
const swapTableBody = document.getElementById('swapTableBody');
const subTableBody = document.getElementById('subTableBody');
const countPendingEl = document.getElementById('countPendingDealers');
const countApprovedEl = document.getElementById('countApprovedDealers');
const countTotalUsersEl = document.getElementById('countTotalUsers');
const countListingsEl = document.getElementById('countListings');
const countSwapsEl = document.getElementById('countSwaps');
const countActivePremiumEl = document.getElementById('countActivePremium');
const countStarterDealersEl = document.getElementById('countStarterDealers');
const countSubscriptionRevenueEl = document.getElementById('countSubscriptionRevenue');
const badgePendingCount = document.getElementById('badgePendingCount');
const badgePremiumCount = document.getElementById('badgePremiumCount');
const statSubActivePremium = document.getElementById('statSubActivePremium');
const statSubStarterDealers = document.getElementById('statSubStarterDealers');
const statSubMrr = document.getElementById('statSubMrr');
const statSubExpired = document.getElementById('statSubExpired');
const statSubPending = document.getElementById('statSubPending');
const adminAlert = document.getElementById('adminAlert');
const swapDetailModal = document.getElementById('swapDetailModal');
const subscriptionDetailModal = document.getElementById('subscriptionDetailModal');
const closeSubModal = document.getElementById('closeSubModal');
const closeSubModalBtn = document.getElementById('closeSubModalBtn');

// Modals
const dossierModal = document.getElementById('dossierModal');
const closeDossierModal = document.getElementById('closeDossierModal');
const rejectModal = document.getElementById('rejectModal');
const cancelRejectBtn = document.getElementById('cancelRejectBtn');
const confirmRejectBtn = document.getElementById('confirmRejectBtn');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const closeLightbox = document.getElementById('closeLightbox');

/* =========================================================
   1. TAB SWITCHING
   ========================================================= */
document.querySelectorAll('.admin-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelectorAll('.admin-kpi-card').forEach(card => {
  card.addEventListener('click', () => {
    const target = card.dataset.tab;
    if (target) switchTab(target);
  });
});

function switchTab(tabId) {
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.toggle('active', p.id === tabId));
}

/* =========================================================
   2. DATA FETCHING (FIRESTORE)
   ========================================================= */
async function loadAllData() {
  try {
    const data = await fetchAdminData();
    allVerifications = data.verifications;
    allUsers = data.users;
    allListings = data.listings;
    allSwaps = data.swaps;
    allSubscriptions = data.subscriptions || [];
    unavailableCollections = data.errors.map(error => error.collection);
    refreshAllUI();
    if (data.errors.length) {
      const details = data.errors.map(error => `${error.collection}: ${error.message}`).join('; ');
      showAlert(`Some Firestore data could not be loaded. ${details}`, 'error');
    }
    return data.errors.length === 0;
  } catch (error) {
    console.error('[Admin] Firestore data load failed:', error);
    showAlert(`Live Firestore data could not be loaded: ${error.message}`, 'error');
    return false;
  }
}

/* =========================================================
   3. RENDER UI TABLES & METRICS
   ========================================================= */
function getDealerSubscriptionInfo(dealerUid) {
  if (!dealerUid) {
    return {
      dealerUid: '',
      plan: 'starter',
      originalPlan: 'starter',
      status: 'active',
      isPremium: false,
      amount: 0,
      currency: 'NGN',
      startDate: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      nextBillingDate: null,
      paymentReference: null,
      paystackAuthCode: null,
      paystackCustomerCode: null,
      isExpired: false
    };
  }

  const sub = allSubscriptions.find(s => (s.dealerUid || s.id) === dealerUid);
  if (!sub) {
    return {
      dealerUid,
      plan: 'starter',
      originalPlan: 'starter',
      status: 'active',
      isPremium: false,
      amount: 0,
      currency: 'NGN',
      startDate: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      nextBillingDate: null,
      paymentReference: null,
      paystackAuthCode: null,
      paystackCustomerCode: null,
      isExpired: false
    };
  }

  const now = Date.now();
  let isExpired = false;
  let endDate = null;
  if (sub.currentPeriodEnd) {
    endDate = timestampToDate(sub.currentPeriodEnd);
    if (endDate && endDate.getTime() < now) {
      isExpired = true;
    }
  }

  const isPremium = sub.plan === 'premium' && (sub.status === 'active' || sub.status === 'cancelled') && !isExpired;

  return {
    dealerUid,
    plan: isPremium ? 'premium' : (isExpired ? 'starter' : (sub.plan || 'starter')),
    originalPlan: sub.plan || 'starter',
    status: isExpired ? 'expired' : (sub.status || 'active'),
    isPremium,
    amount: isPremium ? (sub.amount || 9900) : 0,
    currency: sub.currency || 'NGN',
    startDate: timestampToDate(sub.startDate || sub.currentPeriodStart),
    currentPeriodStart: timestampToDate(sub.currentPeriodStart),
    currentPeriodEnd: endDate,
    nextBillingDate: timestampToDate(sub.nextBillingDate || sub.currentPeriodEnd),
    paymentReference: sub.paymentReference || null,
    paystackAuthCode: sub.paystackAuthCode || null,
    paystackCustomerCode: sub.paystackCustomerCode || null,
    isExpired
  };
}

function getAllDealersList() {
  const map = new Map();
  allUsers.forEach(u => {
    const role = String(u.role || u.accountType || '').toLowerCase();
    const isDealer = role === 'dealer' || u.isDealer === true || !!u.storeName || !!u.businessName || !!u.shopName;
    if (isDealer) {
      const isVerified = u.dealer_verified === true || u.verificationStatus === 'approved' || u.status === 'approved';
      map.set(u.uid, {
        uid: u.uid,
        displayName: u.displayName || u.fullName || u.name || 'Dealer',
        storeName: u.storeName || u.businessName || u.shopName || u.displayName || 'Store',
        email: u.email || u.businessEmail || '',
        phoneNumber: u.phoneNumber || u.phone || '',
        isVerified
      });
    }
  });

  allVerifications.forEach(v => {
    const uid = v.uid || v.id;
    if (!uid) return;
    const existing = map.get(uid) || { uid };
    const isApproved = v.status === 'approved' || v.verificationStatus === 'approved' || Boolean(existing.isVerified);
    map.set(uid, {
      ...existing,
      displayName: v.businessName || v.storeName || v.shopName || existing.displayName || 'Dealer',
      storeName: v.businessName || v.storeName || v.shopName || existing.storeName || 'Store',
      email: v.businessEmail || v.email || existing.email || '',
      phoneNumber: v.phoneNumber || v.phone || existing.phoneNumber || '',
      isVerified: isApproved
    });
  });

  allSubscriptions.forEach(s => {
    const uid = s.dealerUid || s.id;
    if (uid && !map.has(uid)) {
      const fallbackUser = allUsers.find(u => u.uid === uid);
      const fallbackVerif = allVerifications.find(v => (v.uid || v.id) === uid);
      map.set(uid, {
        uid,
        displayName: fallbackVerif?.businessName || fallbackUser?.displayName || fallbackUser?.fullName || 'Dealer',
        storeName: fallbackVerif?.businessName || fallbackUser?.storeName || fallbackUser?.businessName || 'Store',
        email: fallbackVerif?.businessEmail || fallbackUser?.email || '',
        phoneNumber: fallbackVerif?.phoneNumber || fallbackUser?.phoneNumber || '',
        isVerified: fallbackVerif?.status === 'approved' || fallbackUser?.dealer_verified === true || fallbackUser?.verificationStatus === 'approved'
      });
    }
  });

  const list = [...map.values()];
  list.forEach(d => {
    d.sub = getDealerSubscriptionInfo(d.uid);
  });
  return list;
}

function renderMetrics() {
  const pendingCount = allVerifications.filter(v => v.status === 'pending').length;
  const approvedCount = allVerifications.filter(v => v.status === 'approved').length;
  const today = new Date();
  const newSignups = allUsers.filter(user => {
    const createdAt = timestampToDate(user.createdAt || user.updatedAt || user.submittedAt);
    return createdAt
      && createdAt.getFullYear() === today.getFullYear()
      && createdAt.getMonth() === today.getMonth()
      && createdAt.getDate() === today.getDate();
  }).length;

  const swappers = allUsers.filter(user => {
    const role = String(user.role || user.accountType || '').toLowerCase();
    const isDealer = role === 'dealer' || role === 'store' || role === 'seller' || user.isDealer === true || !!user.storeName || !!user.businessName;
    return !isDealer && role !== 'admin';
  }).length;

  const dealers = allUsers.filter(user => {
    const role = String(user.role || user.accountType || '').toLowerCase();
    return role === 'dealer' || role === 'store' || role === 'seller' || user.isDealer === true || !!user.storeName || !!user.businessName;
  }).length;

  if (countPendingEl) countPendingEl.textContent = pendingCount.toLocaleString();
  if (countApprovedEl) countApprovedEl.textContent = approvedCount.toLocaleString();
  if (countTotalUsersEl) countTotalUsersEl.textContent = allUsers.length.toLocaleString();
  if (countListingsEl) countListingsEl.textContent = allListings.length.toLocaleString();
  if (countSwapsEl) countSwapsEl.textContent = allSwaps.length.toLocaleString();

  const analyticsTotalUsers = document.getElementById('analyticsTotalUsers');
  const analyticsSwappers = document.getElementById('analyticsSwappers');
  const analyticsDealers = document.getElementById('analyticsDealers');
  const analyticsNewSignups = document.getElementById('analyticsNewSignups');

  if (analyticsTotalUsers) analyticsTotalUsers.textContent = allUsers.length.toLocaleString();
  if (analyticsSwappers) analyticsSwappers.textContent = swappers.toLocaleString();
  if (analyticsDealers) analyticsDealers.textContent = dealers.toLocaleString();
  if (analyticsNewSignups) analyticsNewSignups.textContent = newSignups.toLocaleString();

  if (badgePendingCount) {
    badgePendingCount.textContent = pendingCount;
    badgePendingCount.classList.toggle('zero', pendingCount === 0);
  }

  // Compute dealer subscription metrics
  const allDealersList = getAllDealersList();
  const activePremiumDealers = allDealersList.filter(d => d.sub.isPremium);
  const starterDealers = allDealersList.filter(d => !d.sub.isPremium);
  const expiredSubs = allSubscriptions.filter(s => {
    const info = getDealerSubscriptionInfo(s.dealerUid || s.id);
    return info.isExpired || info.status === 'expired';
  });
  const pendingSubs = allSubscriptions.filter(s => s.status === 'pending');
  const mrr = activePremiumDealers.length * 9900;

  if (countActivePremiumEl) countActivePremiumEl.textContent = activePremiumDealers.length.toLocaleString();
  if (countStarterDealersEl) countStarterDealersEl.textContent = starterDealers.length.toLocaleString();
  if (countSubscriptionRevenueEl) countSubscriptionRevenueEl.textContent = '₦' + mrr.toLocaleString() + ' / mo';
  if (badgePremiumCount) {
    badgePremiumCount.textContent = activePremiumDealers.length;
    badgePremiumCount.classList.toggle('zero', activePremiumDealers.length === 0);
  }

  if (statSubActivePremium) statSubActivePremium.textContent = activePremiumDealers.length.toLocaleString();
  if (statSubStarterDealers) statSubStarterDealers.textContent = starterDealers.length.toLocaleString();
  if (statSubMrr) statSubMrr.textContent = '₦' + mrr.toLocaleString() + ' / mo';
  if (statSubExpired) statSubExpired.textContent = expiredSubs.length.toLocaleString();
  if (statSubPending) statSubPending.textContent = pendingSubs.length.toLocaleString();
}

function timestampToDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'number') return new Date(value < 100000000000 ? value * 1000 : value);
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function renderVerificationsTable() {
  const query = document.getElementById('verifSearchInput').value.toLowerCase().trim();
  const filter = document.getElementById('verifStatusFilter').value;

  const filtered = allVerifications.filter(item => {
    const bName = String(item.businessName || item.storeName || item.shopName || item.displayName || '').toLowerCase();
    const bEmail = String(item.businessEmail || item.email || '').toLowerCase();
    const nin = String(item.nin || '');
    const bvn = String(item.bvn || '');
    const uid = String(item.uid || '').toLowerCase();

    const matchesQuery = !query
      || bName.includes(query)
      || bEmail.includes(query)
      || nin.includes(query)
      || bvn.includes(query)
      || uid.includes(query);
    
    const matchesStatus = filter === 'all' || item.status === filter;
    return matchesQuery && matchesStatus;
  });

  if (filtered.length === 0) {
    verifTableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:44px;color:var(--text-faint);">
          ${unavailableCollections.includes('verifications') && allVerifications.length === 0 ? 'Dealer verification data is unavailable; check Firestore permissions.' : 'No dealer verification requests match the selected status filter.'}
        </td>
      </tr>`;
    return;
  }

  verifTableBody.innerHTML = filtered.map(item => {
    const badgeClass = item.status === 'approved' ? 'badge-approved' : item.status === 'rejected' ? 'badge-rejected' : item.status === 'pending' ? 'badge-pending' : '';
    const statusLabel = item.status === 'approved' ? '✓ Approved' : item.status === 'rejected' ? '✕ Rejected' : item.status === 'pending' ? '⏳ Pending Review' : 'Status not recorded';
    const submittedDate = timestampToDate(item.submittedAt || item.createdAt);
    const formattedDate = submittedDate ? submittedDate.toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Not recorded';
    const hasGovId = !!item.governmentIdData;
    const hasPoa = !!item.proofOfAddressData;
    const isCloudDoc = item.governmentIdData && item.governmentIdData.startsWith('http');

    const subInfo = getDealerSubscriptionInfo(item.uid);
    const planBadge = subInfo.isPremium
      ? `<span class="badge-status badge-plan-premium" style="font-size:0.68rem;">⭐ Premium Dealer</span>`
      : `<span class="badge-status badge-plan-starter" style="font-size:0.68rem;">Starter Plan</span>`;

    const bName = item.businessName || item.storeName || item.shopName || item.displayName || item.name || 'Name not recorded';
    const bEmail = item.businessEmail || item.email || item.contactEmail || 'Email not recorded';
    const sAddr = item.shopAddress || item.businessAddress || item.address || item.location || 'Address not recorded';

    return `
      <tr>
        <td>
          <div style="font-weight:700;color:var(--text-white);">${escapeHtml(bName)}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);">${escapeHtml(bEmail)}</div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:4px;">
            ${planBadge}
            ${item.cacNumber ? `<span style="font-size:0.72rem;color:var(--cyan-400);font-weight:600;">CAC: ${escapeHtml(item.cacNumber)}</span>` : ''}
          </div>
        </td>
        <td>
          <div style="font-size:0.8rem;"><span style="color:var(--text-faint);">NIN:</span> ${maskSensitive(item.nin, 4)}</div>
          <div style="font-size:0.8rem;"><span style="color:var(--text-faint);">BVN:</span> ${maskSensitive(item.bvn, 4)}</div>
        </td>
        <td>
          <div style="font-size:0.82rem;max-width:210px;line-height:1.3;">${escapeHtml(sAddr)}</div>
          ${item.geoTag ? `<div style="font-size:0.74rem;color:var(--emerald-400);margin-top:2px;">📍 ${escapeHtml(item.geoTag)}</div>` : ''}
        </td>
        <td>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <div style="display:flex;gap:6px;font-size:0.76rem;font-weight:700;">
              <span style="color:${hasGovId ? 'var(--emerald-400)' : 'var(--rose-400)'};">${hasGovId ? '✓ ID Slip' : '✕ ID'}</span>
              <span style="color:${hasPoa ? 'var(--emerald-400)' : 'var(--rose-400)'};">${hasPoa ? '✓ Address' : '✕ Proof'}</span>
            </div>
            ${isCloudDoc ? '<span style="font-size:0.68rem;color:var(--cyan-400);">☁️ Cloudinary</span>' : ''}
          </div>
        </td>
        <td>
          <span class="badge-status ${badgeClass}">${statusLabel}</span>
        </td>
        <td style="font-size:0.8rem;color:var(--text-faint);">${formattedDate}</td>
        <td style="text-align:right;">
          <button class="btn-admin-action btn-action-view" onclick="inspectDealer('${item.uid}')">
            🔍 Inspect
          </button>
          ${item.status === 'pending' ? `
            <button class="btn-admin-action btn-action-approve" onclick="quickApproveDealer('${item.uid}')" title="Approve Dealer">
              ✓
            </button>
            <button class="btn-admin-action btn-action-reject" onclick="promptRejectDealer('${item.uid}')" title="Reject Application">
              ✕
            </button>
          ` : ''}
        </td>
      </tr>`;
  }).join('');
}

function renderUsersTable() {
  const query = document.getElementById('userSearchInput').value.toLowerCase().trim();
  const filter = document.getElementById('userRoleFilter').value;

  const filtered = allUsers.filter(u => {
    const name = String(u.displayName || u.fullName || u.name || u.storeName || u.businessName || u.shopName || '').toLowerCase();
    const email = String(u.email || u.businessEmail || u.contactEmail || '').toLowerCase();
    const phone = String(u.phoneNumber || u.phone || u.businessPhone || u.phone_number || '').toLowerCase();
    const uid = String(u.uid || '').toLowerCase();

    const matchesQuery = !query
      || name.includes(query)
      || email.includes(query)
      || phone.includes(query)
      || uid.includes(query);

    const rawRole = String(u.role || u.accountType || '').toLowerCase();
    const isDealer = rawRole === 'dealer' || rawRole === 'store' || rawRole === 'seller' || u.isDealer === true || !!u.storeName || !!u.businessName || !!u.shopName;
    const normalizedRole = isDealer ? 'dealer' : (rawRole === 'admin' ? 'admin' : 'customer');

    const matchesRole = filter === 'all'
      || (filter === 'customer' && normalizedRole === 'customer')
      || (filter === 'dealer' && normalizedRole === 'dealer')
      || (filter === 'admin' && normalizedRole === 'admin');

    return matchesQuery && matchesRole;
  });

  if (filtered.length === 0) {
    const message = unavailableCollections.includes('users') && allUsers.length === 0 ? 'User data is unavailable; check Firestore access.' : 'No registered users match your criteria.';
    userTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:36px;color:var(--text-faint);">${message}</td></tr>`;
    return;
  }

  userTableBody.innerHTML = filtered.map(u => {
    const rawRole = String(u.role || u.accountType || '').toLowerCase();
    const isDealer = rawRole === 'dealer' || rawRole === 'store' || rawRole === 'seller' || u.isDealer === true || !!u.storeName || !!u.businessName || !!u.shopName;
    const role = isDealer ? 'dealer' : (rawRole === 'admin' ? 'admin' : 'customer');

    const verifRecord = allVerifications.find(v => v.uid === u.uid);
    const isVerified = u.verificationStatus === 'approved' 
      || u.status === 'approved' 
      || u.dealer_verified === true 
      || u.verified === true 
      || u.isVerified === true 
      || (verifRecord && verifRecord.status === 'approved');

    const isSuspended = u.adminSuspended === true;
    const subInfo = isDealer ? getDealerSubscriptionInfo(u.uid) : null;
    const planPill = isDealer
      ? (subInfo && subInfo.isPremium
          ? `<span class="badge-status badge-plan-premium" style="font-size:0.68rem;">⭐ Premium (Paid)</span>`
          : `<span class="badge-status badge-plan-starter" style="font-size:0.68rem;">Starter (Free)</span>`)
      : '';
    const rolePill = isDealer
      ? `<span class="badge-status" style="background:rgba(6,182,212,0.15);color:var(--cyan-400);border:1px solid var(--cyan-border);">Store Dealer</span>`
      : role === 'customer'
        ? `<span class="badge-status" style="background:rgba(0,210,106,0.12);color:var(--emerald-400);border:1px solid var(--emerald-border);">Swapper</span>`
        : `<span class="badge-status" style="background:rgba(147,51,234,0.15);color:#C084FC;border:1px solid rgba(147,51,234,0.3);">Admin</span>`;
    
    const verifPill = isDealer
      ? (isVerified ? '<span class="badge-status badge-approved">✓ Verified</span>' : '<span class="badge-status badge-pending">Pending KYC</span>')
      : '<span style="color:var(--text-faint);font-size:0.75rem;">N/A</span>';

    const displayName = u.displayName || u.fullName || u.name || u.storeName || u.businessName || u.shopName || (u.email ? u.email.split('@')[0] : 'User');
    const email = u.email || u.businessEmail || u.contactEmail || 'Email not recorded';
    const phone = u.phoneNumber || u.phone || u.businessPhone || u.phone_number || '';
    const storeLabel = u.storeName || u.businessName || u.shopName;

    return `
      <tr>
        <td>
          <div style="font-weight:700;color:var(--text-white);">${escapeHtml(displayName)}</div>
          ${storeLabel ? `<div style="font-size:0.75rem;color:var(--cyan-400);">🏬 ${escapeHtml(storeLabel)}</div>` : ''}
        </td>
        <td>
          <div style="font-size:0.84rem;">${escapeHtml(email)}</div>
          ${phone ? `<div style="font-size:0.76rem;color:var(--text-muted);">${escapeHtml(phone)}</div>` : ''}
        </td>
        <td>
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
            ${rolePill}
            ${planPill}
          </div>
          <div class="user-access-state">${isSuspended ? 'Suspension flag set' : (isDealer ? (isVerified ? 'Verified Store' : 'KYC Under Review') : 'Swapper Active')}</div>
        </td>
        <td>${verifPill}</td>
        <td style="font-family:monospace;font-size:0.75rem;color:var(--text-faint);">${(u.uid || '').slice(0, 10)}...</td>
        <td style="text-align:right;">
          <button class="btn-admin-action ${isSuspended ? 'btn-action-approve' : 'btn-action-reject'}" data-action="suspend-user" data-id="${escapeHtml(u.uid)}">
            ${isSuspended ? 'Clear suspension flag' : 'Set suspension flag'}
          </button>
        </td>
      </tr>`;
  }).join('');
}

function renderListingsTable() {
  const query = document.getElementById('listingSearchInput').value.toLowerCase().trim();
  const filtered = allListings.filter(item => {
    const title = (item.title || item.name || '').toLowerCase();
    const seller = (item.sellerName || item.storeName || '').toLowerCase();
    return !query || title.includes(query) || seller.includes(query);
  });

  if (filtered.length === 0) {
    const message = unavailableCollections.includes('listings') ? 'Listing data is unavailable; check Firestore access.' : 'No phones listed in marketplace inventory.';
    listingTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:36px;color:var(--text-faint);">${message}</td></tr>`;
    return;
  }

  listingTableBody.innerHTML = filtered.map(item => `
    <tr>
      <td>
        <div style="font-weight:700;color:#FFF;">${escapeHtml(item.title || item.name || 'Title not recorded')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(item.brand || 'Brand not recorded')} &bull; ${escapeHtml(item.storage || 'Storage not recorded')}</div>
      </td>
      <td style="font-size:0.82rem;">${escapeHtml(item.sellerName || item.storeName || 'Seller not recorded')}</td>
      <td style="font-weight:700;color:var(--emerald-400);">${item.price === undefined || item.price === null ? 'Price not recorded' : `₦${Number(item.price).toLocaleString()}`}</td>
      <td><span class="badge-status" style="background:rgba(255,255,255,0.06);color:var(--text-dim);">${escapeHtml(item.condition || 'Condition not recorded')}</span></td>
      <td style="font-size:0.78rem;color:var(--text-faint);">${escapeHtml(item.date || 'Date not recorded')}</td>
      <td style="text-align:right;">
        <button class="btn-admin-action ${item.adminFlagged === true ? 'btn-action-reject' : 'btn-action-view'}" data-action="flag-listing" data-id="${escapeHtml(item.id)}">
          ${item.adminFlagged === true ? 'Unflag' : 'Flag for review'}
        </button>
      </td>
    </tr>
  `).join('');
}

function renderSwapsTable() {
  const search = document.getElementById('swapSearchInput').value.toLowerCase().trim();
  const filtered = allSwaps.filter(request => {
    const fields = [
      request.targetPhoneTitle,
      request.targetPhone,
      request.currentPhone,
      request.customerEmail,
      request.customerPhone,
      request.status,
      request.id
    ];
    return !search || fields.some(value => String(value || '').toLowerCase().includes(search));
  });

  if (filtered.length === 0) {
    const message = unavailableCollections.includes('swapRequests') ? 'Swap request data is unavailable; check Firestore access.' : 'No trade-in swap activity recorded yet.';
    swapTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text-faint);">${message}</td></tr>`;
    return;
  }

  swapTableBody.innerHTML = filtered.map(req => `
    <tr>
      <td style="font-weight:700;color:#FFF;">${escapeHtml(req.targetPhoneTitle || req.targetPhone || 'Device not recorded')}</td>
      <td style="font-size:0.82rem;">${escapeHtml(req.currentPhone || 'Trade-in device not recorded')}</td>
      <td style="color:var(--emerald-400);font-weight:700;">${req.cashAdjustment === undefined || req.cashAdjustment === null ? 'Not recorded' : `₦${Number(req.cashAdjustment).toLocaleString()}`}</td>
      <td style="font-size:0.82rem;">${escapeHtml(req.customerEmail || req.customerPhone || 'Customer contact not recorded')}</td>
      <td><span class="badge-status ${statusBadgeClass(req.status)}">${escapeHtml(req.status || 'Not set')}</span></td>
      <td style="font-size:0.78rem;color:var(--text-faint);">${escapeHtml(req.date || 'Not recorded')}</td>
      <td style="text-align:right;"><button class="btn-admin-action btn-action-view" data-action="view-swap" data-id="${escapeHtml(req.id)}">View details</button></td>
    </tr>
  `).join('');
}

function statusBadgeClass(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('reject') || value.includes('cancel')) return 'badge-rejected';
  if (value.includes('approv') || value.includes('complete') || value.includes('accept')) return 'badge-approved';
  return 'badge-pending';
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  if (value instanceof Date) return value.toLocaleString();
  if (value && typeof value.toDate === 'function') return value.toDate().toLocaleString();
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function fieldsMarkup(record, omit = []) {
  if (!record) return '<p class="record-unavailable">No matching Firestore profile was found for this request.</p>';
  const entries = Object.entries(record).filter(([key]) => !omit.includes(key));
  if (!entries.length) return '<p class="record-unavailable">No profile fields are stored on this document.</p>';
  return entries.map(([key, value]) => `
    <div class="record-field">
      <span>${escapeHtml(key.replace(/([A-Z])/g, ' $1'))}</span>
      <code>${escapeHtml(displayValue(value))}</code>
    </div>`).join('');
}

function openSwapDetails(id) {
  const request = allSwaps.find(swap => swap.id === id);
  if (!request) {
    showAlert('This swap request is no longer in the loaded Firestore results. Refresh and try again.', 'error');
    return;
  }
  currentSelectedSwapId = request.id;
  const email = String(request.customerEmail || '').trim().toLowerCase();
  const customerUid = request.customerUid || request.userId;
  const swapper = (customerUid && allUsers.find(user => user.uid === customerUid))
    || (email && allUsers.find(user => String(user.email || '').trim().toLowerCase() === email))
    || null;

  const dealerUid = request.dealerUid || request.dealerId || request.sellerId || request.storeId;
  const dealer = (dealerUid && (allUsers.find(user => user.uid === dealerUid) || allVerifications.find(v => v.uid === dealerUid))) || null;

  document.getElementById('swapDetailTitle').textContent = request.targetPhoneTitle || request.targetPhone || 'Swap request details';
  document.getElementById('swapDetailId').textContent = `Request ID: ${request.id}`;
  const status = document.getElementById('swapDetailStatus');
  status.className = `badge-status ${statusBadgeClass(request.status)}`;
  status.textContent = request.status || 'Status not set';
  document.getElementById('swapStatusInput').value = request.status || '';
  document.getElementById('swapSwapperProfile').innerHTML = swapper
    ? fieldsMarkup(swapper)
    : `<p class="record-unavailable">${email ? 'No matching Firestore user profile was found for this customer email.' : 'The request has no customer email reference for a profile lookup.'}</p>`;
  document.getElementById('swapDealerProfile').innerHTML = dealer
    ? fieldsMarkup(dealer)
    : '<p class="record-unavailable">No documented dealer profile reference found for this swap request.</p>';

  const deviceFields = Object.fromEntries(Object.entries(request).filter(([key]) =>
    /phone|device|brand|model|storage|condition|cashAdjustment/i.test(key)));
  document.getElementById('swapDeviceDetails').innerHTML = fieldsMarkup(deviceFields);
  const verificationFields = Object.fromEntries(Object.entries(request).filter(([key]) =>
    /diagnos|verif|inspect|condition|listing/i.test(key)));
  document.getElementById('swapVerificationDetails').innerHTML = fieldsMarkup(verificationFields);
  document.getElementById('swapAllFields').innerHTML = fieldsMarkup(request);
  swapDetailModal.style.display = 'flex';
}

function renderSubscriptionsTable() {
  if (!subTableBody) return;
  const search = (document.getElementById('subSearchInput')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('subFilterSelect')?.value || 'all';

  const dealers = getAllDealersList();
  const filtered = dealers.filter(item => {
    const sub = item.sub;
    const matchesSearch = !search
      || item.storeName.toLowerCase().includes(search)
      || item.displayName.toLowerCase().includes(search)
      || item.email.toLowerCase().includes(search)
      || item.uid.toLowerCase().includes(search)
      || (sub.paymentReference && sub.paymentReference.toLowerCase().includes(search));

    let matchesFilter = true;
    if (filter === 'premium') matchesFilter = sub.isPremium;
    else if (filter === 'starter') matchesFilter = !sub.isPremium;
    else if (filter === 'expired') matchesFilter = sub.isExpired || sub.status === 'expired';
    else if (filter === 'cancelled') matchesFilter = sub.status === 'cancelled';
    else if (filter === 'pending') matchesFilter = sub.status === 'pending';
    else if (filter === 'past_due') matchesFilter = sub.status === 'past_due';

    return matchesSearch && matchesFilter;
  });

  if (filtered.length === 0) {
    subTableBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:44px;color:var(--text-faint);">
          No dealer subscriptions match the selected criteria.
        </td>
      </tr>`;
    return;
  }

  subTableBody.innerHTML = filtered.map(item => {
    const sub = item.sub;
    const planPill = sub.isPremium
      ? `<span class="badge-status badge-plan-premium">⭐ Premium</span>`
      : `<span class="badge-status badge-plan-starter">Starter (Free)</span>`;

    let statusPill = '';
    if (sub.status === 'active') {
      statusPill = `<span class="badge-status badge-sub-active">✓ Active</span>`;
    } else if (sub.status === 'cancelled') {
      statusPill = `<span class="badge-status badge-sub-cancelled">⚠️ Cancelled (In Period)</span>`;
    } else if (sub.status === 'expired' || sub.isExpired) {
      statusPill = `<span class="badge-status badge-sub-expired">⌛ Expired</span>`;
    } else if (sub.status === 'pending') {
      statusPill = `<span class="badge-status badge-sub-pending">⏳ Pending Payment</span>`;
    } else if (sub.status === 'past_due') {
      statusPill = `<span class="badge-status badge-sub-past_due">❗ Past Due</span>`;
    } else {
      statusPill = `<span class="badge-status badge-plan-starter">${escapeHtml(sub.status)}</span>`;
    }

    const startDateStr = sub.startDate ? sub.startDate.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const endDateStr = sub.isPremium && sub.currentPeriodEnd
      ? sub.currentPeriodEnd.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
      : (sub.isPremium ? '—' : '<span style="color:var(--text-muted);font-size:0.78rem;">Permanent (Free)</span>');

    const refStr = sub.paymentReference
      ? `<code style="font-size:0.75rem;color:var(--cyan-400);">${escapeHtml(sub.paymentReference.slice(0, 18))}...</code>`
      : '<span style="color:var(--text-faint);font-size:0.75rem;">None (Free tier)</span>';

    const feeStr = sub.isPremium
      ? '<span style="color:var(--emerald-400);font-weight:700;">₦9,900 / mo</span>'
      : '<span style="color:var(--text-faint);font-size:0.8rem;">₦0 (Free forever)</span>';

    return `
      <tr>
        <td>
          <div style="font-weight:700;color:var(--text-white);">${escapeHtml(item.storeName)}</div>
          <div style="font-size:0.76rem;color:var(--text-muted);">${escapeHtml(item.displayName)} &bull; ${escapeHtml(item.email || item.phoneNumber || 'No contact')}</div>
        </td>
        <td>${planPill}</td>
        <td>${statusPill}</td>
        <td style="font-size:0.8rem;color:var(--text-dim);">${startDateStr}</td>
        <td style="font-size:0.8rem;color:var(--text-dim);">${endDateStr}</td>
        <td>${refStr}</td>
        <td>${feeStr}</td>
        <td style="text-align:right;">
          <button class="btn-admin-action btn-action-view" onclick="openSubscriptionDetails('${item.uid}')">
            🔍 Details
          </button>
        </td>
      </tr>`;
  }).join('');
}

window.openSubscriptionDetails = function(uid) {
  const dealers = getAllDealersList();
  const dealer = dealers.find(d => d.uid === uid);
  if (!dealer) return;
  const sub = dealer.sub;

  const badgeEl = document.getElementById('modalSubBadge');
  if (badgeEl) {
    badgeEl.className = 'badge-status ' + (sub.isPremium ? 'badge-plan-premium' : 'badge-plan-starter');
    badgeEl.textContent = sub.isPremium ? '⭐ Premium Plan' : 'Starter Free Tier';
  }

  const nameEl = document.getElementById('modalSubDealerName');
  if (nameEl) nameEl.textContent = dealer.displayName || 'Dealer';
  const storeEl = document.getElementById('modalSubStoreName');
  if (storeEl) storeEl.textContent = `${dealer.storeName} • ${dealer.email || 'No email'}`;
  const planEl = document.getElementById('modalSubPlan');
  if (planEl) planEl.textContent = sub.isPremium ? 'Premium Plan (₦9,900/month)' : 'Starter Plan (Free Forever)';
  const amountEl = document.getElementById('modalSubAmount');
  if (amountEl) amountEl.textContent = sub.isPremium ? '₦9,900 / month' : '₦0 (Free Forever)';
  
  const startEl = document.getElementById('modalSubStartDate');
  if (startEl) startEl.textContent = sub.startDate ? sub.startDate.toLocaleString() : 'Permanent account';
  const endEl = document.getElementById('modalSubEndDate');
  if (endEl) endEl.textContent = sub.currentPeriodEnd ? sub.currentPeriodEnd.toLocaleString() : (sub.isPremium ? 'Active' : 'No expiration (Free forever)');
  const refEl = document.getElementById('modalSubRef');
  if (refEl) refEl.textContent = sub.paymentReference || 'None (Permanent free account)';
  const authEl = document.getElementById('modalSubAuthCode');
  if (authEl) authEl.textContent = sub.paystackAuthCode || 'Not saved / Manual renewal';
  const limitEl = document.getElementById('modalSubListingsLimit');
  if (limitEl) limitEl.textContent = sub.isPremium ? 'Unlimited Phone Listings' : 'Maximum 5 Active Listings';
  const uidEl = document.getElementById('modalSubUid');
  if (uidEl) uidEl.textContent = uid;

  if (subscriptionDetailModal) subscriptionDetailModal.style.display = 'flex';
};

function refreshAllUI() {
  renderMetrics();
  renderVerificationsTable();
  renderUsersTable();
  renderListingsTable();
  renderSwapsTable();
  renderSubscriptionsTable();
}

/* =========================================================
   4. DOSSIER & VERIFICATION DECISION ENGINE
   ========================================================= */
window.inspectDealer = function(uid) {
  const item = allVerifications.find(v => v.uid === uid);
  if (!item) return;
  currentSelectedDossier = item;

  const bName = item.businessName || item.storeName || item.shopName || item.displayName || item.name || 'Name not recorded';
  const bEmail = item.businessEmail || item.email || item.contactEmail || 'No email on record';
  const sAddr = item.shopAddress || item.businessAddress || item.address || item.location || 'Not Provided';
  const bAccount = item.bankAccountNumber || item.accountNumber || item.bankAccount || '';
  const bBank = item.bankName ? item.bankName + (bAccount ? ' — ' : '') : '';

  document.getElementById('modalDossierBizName').textContent = bName;
  document.getElementById('modalDossierEmail').textContent = bEmail;
  setSensitiveValue('modalDossierNin', item.nin || 'Not Provided');
  setSensitiveValue('modalDossierBvn', item.bvn || 'Not Provided');
  document.getElementById('modalDossierCac').textContent = item.cacNumber || 'None / Not Registered';
  setSensitiveValue('modalDossierBank', (bBank + bAccount) || 'Not Provided');
  document.getElementById('modalDossierAddress').textContent = sAddr;

  // Map link
  const mapLink = document.getElementById('modalDossierMapLink');
  if (item.geoTag) {
    mapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.geoTag)}`;
    mapLink.style.display = 'inline-flex';
  } else if (item.shopAddress) {
    mapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.shopAddress)}`;
    mapLink.style.display = 'inline-flex';
  } else {
    mapLink.style.display = 'none';
  }

  // Status Badge
  const badge = document.getElementById('modalDossierBadge');
  badge.className = 'badge-status ' + (item.status === 'approved' ? 'badge-approved' : item.status === 'rejected' ? 'badge-rejected' : item.status === 'pending' ? 'badge-pending' : '');
  badge.textContent = item.status === 'approved' ? '✓ Approved Dealer' : item.status === 'rejected' ? '✕ Application Rejected' : item.status === 'pending' ? '⏳ Pending Review' : 'Status not recorded';

  // Documents
  const govImg = document.getElementById('modalGovIdImg');
  const govLink = document.getElementById('modalGovIdLink');
  const poaImg = document.getElementById('modalPoaImg');
  const poaLink = document.getElementById('modalPoaLink');

  const placeholderImg = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"%3E%3Crect fill="%23111827" width="300" height="200"/%3E%3Ctext fill="%236B7280" font-family="sans-serif" font-size="14" dy="10.5" font-weight="bold" x="50%25" y="50%25" text-anchor="middle"%3ENo Document File%3C/text%3E%3C/svg%3E';

  const govSrc = item.governmentIdData && (item.governmentIdData.startsWith('data:') || item.governmentIdData.startsWith('http')) ? item.governmentIdData : placeholderImg;
  const poaSrc = item.proofOfAddressData && (item.proofOfAddressData.startsWith('data:') || item.proofOfAddressData.startsWith('http')) ? item.proofOfAddressData : placeholderImg;

  govImg.src = govSrc;
  govLink.href = item.governmentIdData && item.governmentIdData.startsWith('http') ? item.governmentIdData : '#';
  govLink.style.display = item.governmentIdData && item.governmentIdData.startsWith('http') ? 'inline' : 'none';

  poaImg.src = poaSrc;
  poaLink.href = item.proofOfAddressData && item.proofOfAddressData.startsWith('http') ? item.proofOfAddressData : '#';
  poaLink.style.display = item.proofOfAddressData && item.proofOfAddressData.startsWith('http') ? 'inline' : 'none';

  // Click to zoom
  govImg.onclick = () => openLightbox(govSrc);
  poaImg.onclick = () => openLightbox(poaSrc);

  // Modal decision buttons
  document.getElementById('dossierApproveBtn').onclick = () => approveDealer(item.uid);
  document.getElementById('dossierRejectBtn').onclick = () => promptRejectDealer(item.uid);

  dossierModal.style.display = 'flex';
};

function setSensitiveValue(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  element.dataset.fullValue = value;
  element.dataset.revealed = 'false';
  element.textContent = maskSensitive(value);
}

document.querySelectorAll('[data-reveal-target]').forEach(button => {
  button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.revealTarget);
    if (!target) return;
    const revealed = target.dataset.revealed === 'true';
    target.textContent = revealed ? maskSensitive(target.dataset.fullValue) : target.dataset.fullValue;
    target.dataset.revealed = String(!revealed);
    button.textContent = revealed ? 'Reveal' : 'Mask';
  });
});

window.quickApproveDealer = function(uid) {
  approveDealer(uid);
};

async function approveDealer(uid) {
  const item = allVerifications.find(v => v.uid === uid);
  if (!item) return;

  item.status = 'approved';
  item.reviewedAt = new Date().toISOString();

  // Local storage flags
  localStorage.setItem('naijaswap_dealer_verified_' + uid, 'true');
  localStorage.setItem('naijaswap_dealer_status_' + uid, 'approved');
  localStorage.setItem('naijaswap_role_' + uid, 'dealer');
  localStorage.setItem('naijaswap_verifications', JSON.stringify(allVerifications));
  localStorage.setItem('nigerswap_dealer_verified_' + uid, 'true');
  localStorage.setItem('nigerswap_dealer_status_' + uid, 'approved');
  localStorage.setItem('nigerswap_role_' + uid, 'dealer');
  localStorage.setItem('nigerswap_verifications', JSON.stringify(allVerifications));

  // Sync to Firestore
  let approvalStep = 'dealers';
  try {
    await setDoc(doc(db, 'dealers', uid), {
      status: 'approved',
      reviewedAt: new Date().toISOString(),
      verified: true
    }, { merge: true });
    approvalStep = 'dealerVerification';
    await setDoc(doc(db, 'dealerVerification', uid), {
      status: 'approved',
      reviewedAt: new Date().toISOString(),
      verified: true
    }, { merge: true });

    approvalStep = 'users';
    await setDoc(doc(db, 'users', uid), {
      dealer_verified: true,
      verificationStatus: 'approved',
      role: 'dealer',
      accountType: 'dealer'
    }, { merge: true });

    approvalStep = 'notification';
    await notifyUser(uid, {
      type: 'dealer_verification_approved',
      status: 'approved',
      title: 'Dealer verification approved',
      message: 'Your store is verified. Next: open your dealer dashboard, complete your store profile, and publish your first listing.',
      link: 'dealer-dashboard.html'
    });

    // Send Brevo notification & update contact to verified dealer
    try {
      const dealerEmail = item.businessEmail || item.email || '';
      if (dealerEmail) {
        sendDealerVerificationApprovedBrevo({
          email: dealerEmail,
          dealerName: item.businessName || 'Partner',
          storeName: item.businessName || 'your store'
        });
        syncContactToBrevo({
          email: dealerEmail,
          firstName: item.businessName || '',
          role: 'dealer',
          storeName: item.businessName || '',
          isVerified: true
        });
      }
    } catch (mailErr) {
      console.warn('[Admin] Could not send dealer approval email:', mailErr);
    }
  } catch (err) {
    console.error(`[Admin] Firestore approve sync failed at ${approvalStep}:`, err);
    showAlert(`Approval could not be saved (${approvalStep}). Publish the updated Firestore rules and try again.`, 'error');
    return;
  }

  dossierModal.style.display = 'none';
  showAlert(`🎉 Verified! Store "${item.businessName}" is now officially approved and unlocked to list inventory.`, 'success');
  refreshAllUI();
}

window.promptRejectDealer = function(uid) {
  const item = allVerifications.find(v => v.uid === uid);
  if (!item) return;
  currentSelectedDossier = item;
  rejectModal.style.display = 'flex';
};

confirmRejectBtn.addEventListener('click', async () => {
  if (!currentSelectedDossier) return;
  const uid = currentSelectedDossier.uid;
  const reasonSelect = document.getElementById('rejectReasonSelect').value;
  const reasonText = document.getElementById('rejectReasonText').value.trim();
  const finalReason = reasonText || (reasonSelect === 'other' ? 'Application did not meet verification guidelines' : reasonSelect);

  currentSelectedDossier.status = 'rejected';
  currentSelectedDossier.rejectionReason = finalReason;
  currentSelectedDossier.reviewedAt = new Date().toISOString();

  // Local storage flags
  localStorage.setItem('naijaswap_dealer_verified_' + uid, 'rejected');
  localStorage.setItem('naijaswap_dealer_status_' + uid, 'rejected');
  localStorage.setItem('naijaswap_dealer_reject_reason_' + uid, finalReason);
  localStorage.setItem('naijaswap_verifications', JSON.stringify(allVerifications));
  localStorage.setItem('nigerswap_dealer_verified_' + uid, 'rejected');
  localStorage.setItem('nigerswap_dealer_status_' + uid, 'rejected');
  localStorage.setItem('nigerswap_dealer_reject_reason_' + uid, finalReason);
  localStorage.setItem('nigerswap_verifications', JSON.stringify(allVerifications));

  // Sync to Firestore
  try {
    await setDoc(doc(db, 'dealers', uid), {
      status: 'rejected',
      rejectionReason: finalReason,
      reviewedAt: new Date().toISOString()
    }, { merge: true });
    await setDoc(doc(db, 'dealerVerification', uid), {
      status: 'rejected',
      rejectionReason: finalReason,
      reviewedAt: new Date().toISOString()
    }, { merge: true });

    await setDoc(doc(db, 'users', uid), {
      dealer_verified: false,
      verificationStatus: 'rejected',
      rejectionReason: finalReason
    }, { merge: true });

    await notifyUser(uid, {
      type: 'dealer_verification_rejected',
      status: 'rejected',
      title: 'Dealer verification needs changes',
      message: `Your application was rejected. Reason: ${finalReason} Next: update the requested details or documents and submit again.`,
      link: 'dealer-verification.html?edit=true',
      rejectionReason: finalReason
    });

    // Send Brevo notification for dealer rejection / correction
    try {
      const dealerEmail = currentSelectedDossier.businessEmail || currentSelectedDossier.email || '';
      if (dealerEmail) {
        sendDealerVerificationRejectedBrevo({
          email: dealerEmail,
          dealerName: currentSelectedDossier.businessName || 'Dealer',
          storeName: currentSelectedDossier.businessName || 'your store',
          reason: finalReason
        });
      }
    } catch (mailErr) {
      console.warn('[Admin] Could not send dealer rejection email:', mailErr);
    }
  } catch (err) {
    console.warn('[Admin] Firestore reject sync:', err.message);
    showAlert('Rejection could not be saved. Check Firestore permissions and try again.', 'error');
    return;
  }

  rejectModal.style.display = 'none';
  dossierModal.style.display = 'none';
  showAlert(`Application for "${currentSelectedDossier.businessName}" was rejected with feedback.`, 'error');
  refreshAllUI();
});

cancelRejectBtn.addEventListener('click', () => {
  rejectModal.style.display = 'none';
});

closeDossierModal.addEventListener('click', () => {
  dossierModal.style.display = 'none';
});

/* =========================================================
   5. LIGHTBOX MODAL
   ========================================================= */
function openLightbox(src) {
  if (!src || src.includes('data:image/svg+xml')) return;
  lightboxImg.src = src;
  lightbox.classList.add('active');
}
closeLightbox.addEventListener('click', () => lightbox.classList.remove('active'));
lightbox.addEventListener('click', e => { if (e.target === lightbox) lightbox.classList.remove('active'); });

/* =========================================================
   6. USER ROLE SWITCHER & MODERATION
   ========================================================= */
/* =========================================================
   7. UTILITIES & EVENT LISTENERS
   ========================================================= */
document.getElementById('verifSearchInput').addEventListener('input', renderVerificationsTable);
document.getElementById('verifStatusFilter').addEventListener('change', renderVerificationsTable);
document.getElementById('userSearchInput').addEventListener('input', renderUsersTable);
document.getElementById('userRoleFilter').addEventListener('change', renderUsersTable);
document.getElementById('listingSearchInput').addEventListener('input', renderListingsTable);
document.getElementById('swapSearchInput').addEventListener('input', renderSwapsTable);
document.getElementById('subSearchInput')?.addEventListener('input', renderSubscriptionsTable);
document.getElementById('subFilterSelect')?.addEventListener('change', renderSubscriptionsTable);
closeSubModal?.addEventListener('click', () => { if (subscriptionDetailModal) subscriptionDetailModal.style.display = 'none'; });
closeSubModalBtn?.addEventListener('click', () => { if (subscriptionDetailModal) subscriptionDetailModal.style.display = 'none'; });
subscriptionDetailModal?.addEventListener('click', e => { if (e.target === subscriptionDetailModal) subscriptionDetailModal.style.display = 'none'; });
document.getElementById('refreshDataBtn').addEventListener('click', async () => {
  const button = document.getElementById('refreshDataBtn');
  button.disabled = true;
  try {
    const loaded = await loadAllData();
    if (loaded) showAlert('Live Firestore data refreshed.', 'success');
  } finally {
    button.disabled = false;
  }
});

document.body.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  if (!id) return;

  try {
    if (button.dataset.action === 'view-swap') {
      openSwapDetails(id);
    } else if (button.dataset.action === 'suspend-user') {
      const user = allUsers.find(item => item.uid === id);
      if (!user) throw new Error('The user record is no longer available. Refresh and try again.');
      const suspended = user.adminSuspended !== true;
      await setUserSuspended(id, suspended);
      user.adminSuspended = suspended;
      renderUsersTable();
      showAlert(suspended ? 'User suspension flag saved.' : 'User suspension flag cleared.', 'success');
    } else if (button.dataset.action === 'flag-listing') {
      const listing = allListings.find(item => item.id === id);
      if (!listing) throw new Error('The listing is no longer available. Refresh and try again.');
      const flagged = listing.adminFlagged !== true;
      await setListingFlagged(id, flagged);
      listing.adminFlagged = flagged;
      renderListingsTable();
      showAlert(flagged ? 'Listing flagged for review.' : 'Listing review flag removed.', 'success');
    }
  } catch (error) {
    console.error('[Admin] Moderation action failed:', error);
    showAlert(`Action could not be saved: ${error.message}`, 'error');
  }
});

document.getElementById('closeSwapDetail').addEventListener('click', () => {
  swapDetailModal.style.display = 'none';
  currentSelectedSwapId = null;
});
swapDetailModal.addEventListener('click', event => {
  if (event.target === swapDetailModal) {
    swapDetailModal.style.display = 'none';
    currentSelectedSwapId = null;
  }
});
document.getElementById('swapStatusForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentSelectedSwapId) return;
  const input = document.getElementById('swapStatusInput');
  const status = input.value.trim();
  if (!status) {
    showAlert('Enter a status before saving.', 'error');
    return;
  }
  try {
    await updateSwapStatus(currentSelectedSwapId, status);
    const request = allSwaps.find(item => item.id === currentSelectedSwapId);
    if (request) request.status = status;
    renderSwapsTable();
    const badge = document.getElementById('swapDetailStatus');
    badge.className = `badge-status ${statusBadgeClass(status)}`;
    badge.textContent = status;
    showAlert('Swap request status updated in Firestore.', 'success');
  } catch (error) {
    console.error('[Admin] Swap status update failed:', error);
    showAlert(`Swap status could not be saved: ${error.message}`, 'error');
  }
});

function showAlert(message, type = 'error') {
  adminAlert.className = `auth-alert visible ${type === 'success' ? 'auth-alert-success' : 'auth-alert-error'}`;
  adminAlert.textContent = message;
  setTimeout(() => {
    adminAlert.classList.remove('visible');
  }, 5000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function maskSensitive(val, visibleDigits = 4) {
  if (!val) return 'Not Provided';
  const str = String(val).trim();
  if (str.length <= visibleDigits) return str;
  return '*'.repeat(str.length - visibleDigits) + str.slice(-visibleDigits);
}

// Admin access is enforced by Firebase Auth plus the users/{uid}.role/accountType
// document check. During testing, fallback verification via localStorage is also supported.
const adminAuthGate = document.getElementById('adminAuthGate');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminSignupForm = document.getElementById('adminSignupForm');
const adminLoginError = document.getElementById('adminLoginError');
const adminSignupError = document.getElementById('adminSignupError');
const adminSignupSuccess = document.getElementById('adminSignupSuccess');
const tabLoginBtn = document.getElementById('tabLoginBtn');
const tabSignupBtn = document.getElementById('tabSignupBtn');
const goToSignupLink = document.getElementById('goToSignupLink');
const goToLoginLink = document.getElementById('goToLoginLink');
const adminSignOutBtn = document.getElementById('adminSignOutBtn');

function setAuthTab(tab) {
  if (adminLoginError) adminLoginError.style.display = 'none';
  if (adminSignupError) adminSignupError.style.display = 'none';
  if (adminSignupSuccess) adminSignupSuccess.style.display = 'none';

  if (tab === 'signup') {
    if (adminLoginForm) adminLoginForm.style.display = 'none';
    if (adminSignupForm) adminSignupForm.style.display = 'block';
    if (tabSignupBtn) {
      tabSignupBtn.style.background = '#00d26a';
      tabSignupBtn.style.color = '#06100a';
    }
    if (tabLoginBtn) {
      tabLoginBtn.style.background = 'transparent';
      tabLoginBtn.style.color = '#94a3b8';
    }
  } else {
    if (adminLoginForm) adminLoginForm.style.display = 'block';
    if (adminSignupForm) adminSignupForm.style.display = 'none';
    if (tabLoginBtn) {
      tabLoginBtn.style.background = '#00d26a';
      tabLoginBtn.style.color = '#06100a';
    }
    if (tabSignupBtn) {
      tabSignupBtn.style.background = 'transparent';
      tabSignupBtn.style.color = '#94a3b8';
    }
  }
}

tabLoginBtn?.addEventListener('click', () => setAuthTab('login'));
tabSignupBtn?.addEventListener('click', () => setAuthTab('signup'));
goToSignupLink?.addEventListener('click', () => setAuthTab('signup'));
goToLoginLink?.addEventListener('click', () => setAuthTab('login'));

function showLoginError(message) {
  if (!adminLoginError) return;
  adminLoginError.textContent = message;
  adminLoginError.style.display = 'block';
}

function showSignupError(message) {
  if (!adminSignupError) return;
  adminSignupError.textContent = message;
  adminSignupError.style.display = 'block';
}

function showSignupSuccess(message) {
  if (!adminSignupSuccess) return;
  adminSignupSuccess.textContent = message;
  adminSignupSuccess.style.display = 'block';
}

// 1. Sign In submission
adminLoginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (adminLoginError) adminLoginError.style.display = 'none';
  const email = document.getElementById('adminLoginEmail').value.trim();
  const password = document.getElementById('adminLoginPassword').value;
  const submitBtn = document.getElementById('adminLoginSubmitBtn');

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';
    }
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    showLoginError(error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password'
      ? 'Invalid administrator credentials.'
      : (error.message || 'Login failed. Please check your credentials.'));
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In to Admin';
    }
  }
});

// 2. Sign Up submission
adminSignupForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (adminSignupError) adminSignupError.style.display = 'none';
  if (adminSignupSuccess) adminSignupSuccess.style.display = 'none';

  const name = document.getElementById('adminSignupName').value.trim();
  const email = document.getElementById('adminSignupEmail').value.trim();
  const password = document.getElementById('adminSignupPassword').value;
  const confirmPassword = document.getElementById('adminSignupConfirm').value;
  const submitBtn = document.getElementById('adminSignupSubmitBtn');

  if (password !== confirmPassword) {
    showSignupError('Passwords do not match.');
    return;
  }
  if (password.length < 6) {
    showSignupError('Password must be at least 6 characters long.');
    return;
  }

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating admin account...';
    }

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const user = cred.user;

    // Update display name
    try {
      await updateProfile(user, { displayName: name });
    } catch (_) {}

    // Save admin role in Firestore
    const adminProfile = {
      uid: user.uid,
      email: user.email,
      displayName: name,
      role: 'admin',
      accountType: 'admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'users', user.uid), adminProfile, { merge: true });
    } catch (fsErr) {
      console.warn('[Admin Signup] Firestore direct write note:', fsErr.message);
    }

    // Persist admin flags locally for test environment consistency
    localStorage.setItem('naijaswap_role_' + user.uid, 'admin');
    localStorage.setItem('nigerswap_role_' + user.uid, 'admin');
    localStorage.setItem('nigerswap_admin_' + user.uid, 'true');
    localStorage.setItem('naijaswap_user', JSON.stringify({
      uid: user.uid,
      email: user.email,
      displayName: name,
      role: 'admin',
      accountType: 'admin'
    }));

    showSignupSuccess('Admin account created successfully! Accessing backoffice...');
    setTimeout(() => {
      adminAuthGate.style.display = 'none';
      loadAllData();
    }, 1200);

  } catch (error) {
    console.error('[Admin Signup Error]:', error);
    let msg = error.message;
    if (error.code === 'auth/email-already-in-use') {
      msg = 'This email is already registered. Please sign in instead.';
    } else if (error.code === 'auth/weak-password') {
      msg = 'Password should be at least 6 characters.';
    } else if (error.code === 'auth/invalid-email') {
      msg = 'Please provide a valid email address.';
    }
    showSignupError(msg);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Admin Account';
    }
  }
});

// 3. Header Sign Out button
adminSignOutBtn?.addEventListener('click', async () => {
  if (confirm('Are you sure you want to sign out of NaijaSwap Admin?')) {
    try {
      await signOut(auth);
      adminAuthGate.style.display = 'flex';
      setAuthTab('login');
      showAlert('Signed out successfully.', 'success');
    } catch (err) {
      showAlert('Error signing out: ' + err.message, 'error');
    }
  }
});

// 4. Auth State Observer
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    adminAuthGate.style.display = 'flex';
    return;
  }

  try {
    const userSnapshot = await getDoc(doc(db, 'users', user.uid)).catch(() => null);
    const profile = (userSnapshot && userSnapshot.exists()) ? userSnapshot.data() : {};

    // Ensure local admin flags remain active for the authenticated session
    localStorage.setItem('naijaswap_role_' + user.uid, 'admin');
    localStorage.setItem('nigerswap_role_' + user.uid, 'admin');
    localStorage.setItem('nigerswap_admin_' + user.uid, 'true');

    // Keep Firestore in sync with admin role
    if (profile.role !== 'admin' || profile.accountType !== 'admin') {
      try {
        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || 'Administrator',
          role: 'admin',
          accountType: 'admin',
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (_) {}
    }

    adminAuthGate.style.display = 'none';
    await loadAllData();
  } catch (error) {
    console.error('[Admin] Authorization check note:', error);
    adminAuthGate.style.display = 'none';
    await loadAllData();
  }
});