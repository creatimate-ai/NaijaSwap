/**
 * NaijaSwap Standalone Backoffice Admin Controller
 * Manages Dealer KYC Verification Approvals, Trade Disputes Arbitration,
 * Stolen Devices Registry, User Management, Marketplace Moderation & Activity Audit
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
  setListingStatus,
  deleteListing,
  setUserSuspended,
  updateUserRole,
  sendPasswordReset,
  updateSwapStatus,
  resolveSwapDispute,
  fetchSwapMessages,
  sendAdminSwapMessage,
  addStolenDevice,
  removeStolenDevice,
  grantDealerSubscription,
  cancelDealerSubscription,
  deleteReview,
  recordAdminAuditLog
} from "./admin-data.js";

import { 
  sendDealerVerificationApprovedBrevo, 
  sendDealerVerificationRejectedBrevo,
  syncContactToBrevo
} from "./brevo-client.js";

const MASTER_ADMIN_SECRET = "NAIJASWAP_ADMIN_2026";

function notificationRef(uid, id) {
  return doc(db, 'users', uid, 'notifications', id);
}

async function notifyUser(uid, notification) {
  if (!uid) return;
  const id = `admin_notif_${notification.type || 'alert'}_${Date.now()}`;
  await setDoc(notificationRef(uid, id), {
    ...notification,
    id,
    userId: uid,
    isRead: false,
    createdAt: new Date().toISOString()
  });
}

// Global Application State
let allVerifications = [];
let allUsers = [];
let allListings = [];
let allSwaps = [];
let allSubscriptions = [];
let allStolenDevices = [];
let allReviews = [];
let allCertificates = [];
let allAuditLogs = [];
let currentActiveTab = 'tabVerifications';

let currentSelectedDossier = null;
let currentSelectedSwapId = null;
let currentSelectedListingId = null;
let currentSelectedUserUid = null;
let currentSelectedCertId = null;
let currentSelectedSubUid = null;
let unavailableCollections = [];

// DOM References
const verifTableBody = document.getElementById('verifTableBody');
const disputeTableBody = document.getElementById('disputeTableBody');
const userTableBody = document.getElementById('userTableBody');
const listingTableBody = document.getElementById('listingTableBody');
const swapTableBody = document.getElementById('swapTableBody');
const subTableBody = document.getElementById('subTableBody');
const stolenTableBody = document.getElementById('stolenTableBody');
const certTableBody = document.getElementById('certTableBody');
const reviewTableBody = document.getElementById('reviewTableBody');
const activityStreamContainer = document.getElementById('activityStreamContainer');

// KPI Counters
const countPendingEl = document.getElementById('countPendingDealers');
const countApprovedEl = document.getElementById('countApprovedDealers');
const countOpenDisputesEl = document.getElementById('countOpenDisputes');
const countTotalUsersEl = document.getElementById('countTotalUsers');
const countListingsEl = document.getElementById('countListings');
const countSwapsEl = document.getElementById('countSwaps');
const countBlacklistedEl = document.getElementById('countBlacklisted');
const countActivePremiumEl = document.getElementById('countActivePremium');
const countSubscriptionRevenueEl = document.getElementById('countSubscriptionRevenue');
const badgePendingCount = document.getElementById('badgePendingCount');
const badgeDisputesCount = document.getElementById('badgeDisputesCount');
const badgePremiumCount = document.getElementById('badgePremiumCount');

const analyticsTotalUsers = document.getElementById('analyticsTotalUsers');
const analyticsSwappers = document.getElementById('analyticsSwappers');
const analyticsDealers = document.getElementById('analyticsDealers');
const analyticsNewSignups = document.getElementById('analyticsNewSignups');
const analyticsOpenDisputes = document.getElementById('analyticsOpenDisputes');
const analyticsCertificates = document.getElementById('analyticsCertificates');

// Modals
const adminAlert = document.getElementById('adminAlert');
const swapDetailModal = document.getElementById('swapDetailModal');
const disputeModal = document.getElementById('disputeModal');
const dossierModal = document.getElementById('dossierModal');
const rejectModal = document.getElementById('rejectModal');
const listingDetailModal = document.getElementById('listingDetailModal');
const addStolenModal = document.getElementById('addStolenModal');
const certificateDetailModal = document.getElementById('certificateDetailModal');
const subscriptionDetailModal = document.getElementById('subscriptionDetailModal');
const userActionModal = document.getElementById('userActionModal');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');

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
  currentActiveTab = tabId;
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.toggle('active', p.id === tabId));
}

/* =========================================================
   2. DATA FETCHING (FIRESTORE)
   ========================================================= */
async function loadAllData() {
  try {
    const data = await fetchAdminData();
    allVerifications = data.verifications || [];
    allUsers = data.users || [];
    allListings = data.listings || [];
    allSwaps = data.swaps || [];
    allSubscriptions = data.subscriptions || [];
    allStolenDevices = data.stolenDevices || [];
    allReviews = data.reviews || [];
    allCertificates = data.certificates || [];
    allAuditLogs = data.auditLogs || [];
    unavailableCollections = data.errors ? data.errors.map(e => e.collection) : [];

    refreshAllUI();
    if (data.errors && data.errors.length) {
      console.warn('[Admin] Collection warnings:', data.errors);
    }
    return true;
  } catch (error) {
    console.error('[Admin] Firestore data load failed:', error);
    showAlert(`Live data could not be loaded: ${error.message}`, 'error');
    return false;
  }
}

/* =========================================================
   3. HELPERS & SUBSCRIPTIONS LOGIC
   ========================================================= */
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

function getDealerSubscriptionInfo(dealerUid) {
  if (!dealerUid) {
    return {
      dealerUid: '', plan: 'starter', originalPlan: 'starter', status: 'active',
      isPremium: false, amount: 0, currency: 'NGN', startDate: null, currentPeriodEnd: null,
      paymentReference: null, isExpired: false
    };
  }

  const sub = allSubscriptions.find(s => (s.dealerUid || s.id) === dealerUid);
  if (!sub) {
    return {
      dealerUid, plan: 'starter', originalPlan: 'starter', status: 'active',
      isPremium: false, amount: 0, currency: 'NGN', startDate: null, currentPeriodEnd: null,
      paymentReference: null, isExpired: false
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
    currentPeriodEnd: endDate,
    paymentReference: sub.paymentReference || null,
    paystackAuthCode: sub.paystackAuthCode || null,
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

  const list = [...map.values()];
  list.forEach(d => {
    d.sub = getDealerSubscriptionInfo(d.uid);
  });
  return list;
}

/* =========================================================
   4. METRICS COMPUTATION
   ========================================================= */
function renderMetrics() {
  const pendingCount = allVerifications.filter(v => v.status === 'pending').length;
  const approvedCount = allVerifications.filter(v => v.status === 'approved').length;
  const openDisputes = allSwaps.filter(s => s.disputeStatus === 'open').length;
  const blacklistedCount = allStolenDevices.filter(d => d.status !== 'cleared').length;

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
  if (countOpenDisputesEl) countOpenDisputesEl.textContent = openDisputes.toLocaleString();
  if (countTotalUsersEl) countTotalUsersEl.textContent = allUsers.length.toLocaleString();
  if (countListingsEl) countListingsEl.textContent = allListings.length.toLocaleString();
  if (countSwapsEl) countSwapsEl.textContent = allSwaps.length.toLocaleString();
  if (countBlacklistedEl) countBlacklistedEl.textContent = blacklistedCount.toLocaleString();

  if (analyticsTotalUsers) analyticsTotalUsers.textContent = allUsers.length.toLocaleString();
  if (analyticsSwappers) analyticsSwappers.textContent = swappers.toLocaleString();
  if (analyticsDealers) analyticsDealers.textContent = dealers.toLocaleString();
  if (analyticsNewSignups) analyticsNewSignups.textContent = newSignups.toLocaleString();
  if (analyticsOpenDisputes) analyticsOpenDisputes.textContent = openDisputes.toLocaleString();
  if (analyticsCertificates) analyticsCertificates.textContent = allCertificates.length.toLocaleString();

  if (badgePendingCount) {
    badgePendingCount.textContent = pendingCount;
    badgePendingCount.classList.toggle('zero', pendingCount === 0);
  }
  if (badgeDisputesCount) {
    badgeDisputesCount.textContent = openDisputes;
    badgeDisputesCount.classList.toggle('zero', openDisputes === 0);
  }

  const allDealersList = getAllDealersList();
  const activePremiumDealers = allDealersList.filter(d => d.sub.isPremium);
  const mrr = activePremiumDealers.length * 9900;

  if (countActivePremiumEl) countActivePremiumEl.textContent = activePremiumDealers.length.toLocaleString();
  if (countSubscriptionRevenueEl) countSubscriptionRevenueEl.textContent = '₦' + mrr.toLocaleString() + ' / mo';
  if (badgePremiumCount) {
    badgePremiumCount.textContent = activePremiumDealers.length;
    badgePremiumCount.classList.toggle('zero', activePremiumDealers.length === 0);
  }

  const statSubActivePremium = document.getElementById('statSubActivePremium');
  const statSubStarterDealers = document.getElementById('statSubStarterDealers');
  const statSubMrr = document.getElementById('statSubMrr');
  const statSubExpired = document.getElementById('statSubExpired');
  const statSubPending = document.getElementById('statSubPending');

  if (statSubActivePremium) statSubActivePremium.textContent = activePremiumDealers.length.toLocaleString();
  if (statSubStarterDealers) statSubStarterDealers.textContent = (allDealersList.length - activePremiumDealers.length).toLocaleString();
  if (statSubMrr) statSubMrr.textContent = '₦' + mrr.toLocaleString() + ' / mo';
  if (statSubExpired) statSubExpired.textContent = allSubscriptions.filter(s => getDealerSubscriptionInfo(s.dealerUid || s.id).isExpired).length.toLocaleString();
  if (statSubPending) statSubPending.textContent = allSubscriptions.filter(s => s.status === 'pending').length.toLocaleString();
}

/* =========================================================
   5. TAB TABLES RENDERING
   ========================================================= */

// TAB 1: DEALER VERIFICATIONS
function renderVerificationsTable() {
  if (!verifTableBody) return;
  const query = (document.getElementById('verifSearchInput')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('verifStatusFilter')?.value || 'all';

  const filtered = allVerifications.filter(item => {
    const bName = String(item.businessName || item.storeName || item.shopName || item.displayName || '').toLowerCase();
    const bEmail = String(item.businessEmail || item.email || '').toLowerCase();
    const nin = String(item.nin || '');
    const bvn = String(item.bvn || '');
    const uid = String(item.uid || '').toLowerCase();

    const matchesQuery = !query || bName.includes(query) || bEmail.includes(query) || nin.includes(query) || bvn.includes(query) || uid.includes(query);
    const matchesStatus = filter === 'all' || item.status === filter;
    return matchesQuery && matchesStatus;
  });

  if (filtered.length === 0) {
    verifTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text-faint);">No dealer verification records found.</td></tr>`;
    return;
  }

  verifTableBody.innerHTML = filtered.map(item => {
    const badgeClass = item.status === 'approved' ? 'badge-approved' : item.status === 'rejected' ? 'badge-rejected' : 'badge-pending';
    const statusLabel = item.status === 'approved' ? '✓ Approved' : item.status === 'rejected' ? '✕ Rejected' : '⏳ Pending Review';
    const submittedDate = timestampToDate(item.submittedAt || item.createdAt);
    const formattedDate = submittedDate ? submittedDate.toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Not recorded';
    const hasGovId = !!item.governmentIdData;
    const hasPoa = !!item.proofOfAddressData;

    const bName = item.businessName || item.storeName || item.shopName || item.displayName || 'Unnamed Store';
    const bEmail = item.businessEmail || item.email || 'Email not recorded';
    const sAddr = item.shopAddress || item.businessAddress || item.address || 'Address not recorded';

    return `
      <tr>
        <td>
          <div style="font-weight:700;color:var(--text-white);">${escapeHtml(bName)}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);">${escapeHtml(bEmail)}</div>
          ${item.cacNumber ? `<span style="font-size:0.72rem;color:var(--cyan-400);font-weight:600;">CAC: ${escapeHtml(item.cacNumber)}</span>` : ''}
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
          <div style="display:flex;gap:6px;font-size:0.76rem;font-weight:700;">
            <span style="color:${hasGovId ? 'var(--emerald-400)' : 'var(--rose-400)'};">${hasGovId ? '✓ ID Slip' : '✕ ID'}</span>
            <span style="color:${hasPoa ? 'var(--emerald-400)' : 'var(--rose-400)'};">${hasPoa ? '✓ Address' : '✕ Proof'}</span>
          </div>
        </td>
        <td><span class="badge-status ${badgeClass}">${statusLabel}</span></td>
        <td style="font-size:0.8rem;color:var(--text-faint);">${formattedDate}</td>
        <td style="text-align:right;">
          <button class="btn-admin-action btn-action-view" onclick="inspectDealer('${item.uid}')">🔍 Inspect</button>
          ${item.status === 'pending' ? `
            <button class="btn-admin-action btn-action-approve" onclick="quickApproveDealer('${item.uid}')" title="Approve Dealer">✓</button>
            <button class="btn-admin-action btn-action-reject" onclick="promptRejectDealer('${item.uid}')" title="Reject Application">✕</button>
          ` : ''}
        </td>
      </tr>`;
  }).join('');
}

// TAB 2: TRADE DISPUTES
function renderDisputesTable() {
  if (!disputeTableBody) return;
  const search = (document.getElementById('disputeSearchInput')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('disputeStatusFilter')?.value || 'open';

  const disputesList = allSwaps.filter(s => {
    const isDisputed = s.disputeStatus === 'open' || s.disputeStatus === 'resolved' || !!s.disputeReason;
    if (!isDisputed) return false;

    if (filter === 'open' && s.disputeStatus !== 'open') return false;
    if (filter === 'resolved' && s.disputeStatus !== 'resolved') return false;

    if (!search) return true;
    const str = `${s.id} ${s.targetPhoneTitle || s.targetPhone || ''} ${s.currentPhone || ''} ${s.customerEmail || ''} ${s.customerName || ''} ${s.storeName || ''} ${s.disputeReason || ''}`.toLowerCase();
    return str.includes(search);
  });

  if (disputesList.length === 0) {
    disputeTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text-faint);">No ${filter === 'open' ? 'open' : ''} trade-in disputes found. All swaps are operating smoothly!</td></tr>`;
    return;
  }

  disputeTableBody.innerHTML = disputesList.map(s => {
    const isDisputeOpen = s.disputeStatus === 'open';
    const statusPill = isDisputeOpen
      ? `<span class="badge-status badge-dispute-open">⚠️ Dispute Open</span>`
      : `<span class="badge-status badge-dispute-resolved">✓ Resolved</span>`;

    const disputeDate = timestampToDate(s.disputeOpenedAt || s.updatedAt);
    const dateStr = disputeDate ? disputeDate.toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Recently';

    return `
      <tr>
        <td>
          <div style="font-weight:700;color:#FFF;">${escapeHtml(s.targetPhoneTitle || s.targetPhone || 'Device')}</div>
          <div style="font-size:0.75rem;color:var(--cyan-400);">Trade-in: ${escapeHtml(s.currentPhone || 'Device')}</div>
        </td>
        <td>
          <div style="font-size:0.82rem;font-weight:600;">${s.disputeOpenedBy === s.customerUid ? 'Customer (Swapper)' : 'Store Owner'}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);font-family:monospace;">${escapeHtml(s.id.slice(0, 12))}...</div>
        </td>
        <td>
          <div style="font-size:0.82rem;max-width:240px;line-height:1.35;color:#FDA4AF;">
            ${escapeHtml(s.disputeReason ? (s.disputeReason.length > 70 ? s.disputeReason.slice(0, 67) + '...' : s.disputeReason) : 'Condition / Top-up Discrepancy')}
          </div>
        </td>
        <td>
          <div style="font-size:0.8rem;color:#FFF;">🏬 ${escapeHtml(s.storeName || 'Store')}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">👤 ${escapeHtml(s.customerEmail || s.customerPhone || 'Customer')}</div>
        </td>
        <td>${statusPill}</td>
        <td style="font-size:0.78rem;color:var(--text-faint);">${dateStr}</td>
        <td style="text-align:right;">
          <button class="btn-admin-action ${isDisputeOpen ? 'btn-action-reject' : 'btn-action-view'}" onclick="openSwapDetails('${s.id}')">
            ${isDisputeOpen ? '⚖️ Arbitrate' : '🔍 Review'}
          </button>
        </td>
      </tr>`;
  }).join('');
}

// TAB 3: MARKETPLACE INVENTORY
function renderListingsTable() {
  if (!listingTableBody) return;
  const query = (document.getElementById('listingSearchInput')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('listingStatusFilter')?.value || 'all';
  const brandFilter = document.getElementById('listingBrandFilter')?.value || 'all';

  const filtered = allListings.filter(item => {
    const title = (item.title || item.name || item.model || '').toLowerCase();
    const seller = (item.sellerName || item.storeName || '').toLowerCase();
    const id = String(item.id || '').toLowerCase();
    const matchesQuery = !query || title.includes(query) || seller.includes(query) || id.includes(query);

    let matchesStatus = true;
    if (statusFilter === 'active') matchesStatus = item.status === 'active' && item.adminFlagged !== true;
    else if (statusFilter === 'flagged') matchesStatus = item.adminFlagged === true;
    else if (statusFilter === 'archived') matchesStatus = item.status === 'archived';

    let matchesBrand = true;
    if (brandFilter !== 'all') matchesBrand = item.brand === brandFilter;

    return matchesQuery && matchesStatus && matchesBrand;
  });

  if (filtered.length === 0) {
    listingTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text-faint);">No phones match current inventory filters.</td></tr>`;
    return;
  }

  listingTableBody.innerHTML = filtered.map(item => {
    const isFlagged = item.adminFlagged === true;
    const isArchived = item.status === 'archived';
    const statusPill = isArchived
      ? `<span class="badge-status badge-rejected">Archived</span>`
      : (isFlagged
          ? `<span class="badge-status badge-pending" style="color:#FBBF24;">🚩 Flagged</span>`
          : `<span class="badge-status badge-approved">Active</span>`);

    return `
      <tr>
        <td>
          <div style="font-weight:700;color:#FFF;">${escapeHtml(item.title || item.model || 'Phone Model')}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(item.brand || 'Brand')} &bull; ${escapeHtml(item.storage || 'Storage')} &bull; ${item.battery ? escapeHtml(item.battery) + '% Batt' : 'Batt OK'}</div>
        </td>
        <td style="font-size:0.82rem;">${escapeHtml(item.storeName || item.sellerName || 'Verified Store')}</td>
        <td style="font-weight:700;color:var(--emerald-400);">${item.marketValue || item.price ? `₦${Number(item.marketValue || item.price).toLocaleString()}` : 'Price on request'}</td>
        <td><span class="badge-status" style="background:rgba(255,255,255,0.06);color:var(--text-dim);">${escapeHtml(item.conditionGrade || item.condition || 'Pre-owned')}</span></td>
        <td>${statusPill}</td>
        <td style="font-size:0.78rem;color:var(--text-faint);">${escapeHtml(item.createdAt ? timestampToDate(item.createdAt)?.toLocaleDateString() : 'Listed')}</td>
        <td style="text-align:right;">
          <button class="btn-admin-action btn-action-view" onclick="openListingDetails('${item.id}')">Inspect</button>
        </td>
      </tr>`;
  }).join('');
}

// TAB 4: SWAP TRANSACTIONS
function renderSwapsTable() {
  if (!swapTableBody) return;
  const search = (document.getElementById('swapSearchInput')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('swapStatusFilter')?.value || 'all';

  const filtered = allSwaps.filter(request => {
    const matchesSearch = !search || [
      request.targetPhoneTitle, request.targetPhone, request.currentPhone,
      request.customerEmail, request.customerPhone, request.status, request.id
    ].some(v => String(v || '').toLowerCase().includes(search));

    let matchesFilter = true;
    if (filter === 'disputed') matchesFilter = request.disputeStatus === 'open';
    else if (filter !== 'all') matchesFilter = String(request.status || '').toLowerCase() === filter.toLowerCase();

    return matchesSearch && matchesFilter;
  });

  if (filtered.length === 0) {
    swapTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text-faint);">No swap trade-ins found matching criteria.</td></tr>`;
    return;
  }

  swapTableBody.innerHTML = filtered.map(req => {
    const isDisputed = req.disputeStatus === 'open';
    const statusPill = isDisputed
      ? `<span class="badge-status badge-dispute-open">⚠️ Disputed</span>`
      : `<span class="badge-status ${statusBadgeClass(req.status)}">${escapeHtml(req.status || 'Pending')}</span>`;

    return `
      <tr>
        <td style="font-weight:700;color:#FFF;">${escapeHtml(req.targetPhoneTitle || req.targetPhone || 'Device')}</td>
        <td style="font-size:0.82rem;">${escapeHtml(req.currentPhone || 'Trade-in')}</td>
        <td style="color:var(--emerald-400);font-weight:700;">${req.topupAmount || req.cashAdjustment ? `₦${Number(req.topupAmount || req.cashAdjustment).toLocaleString()}` : '₦0'}</td>
        <td style="font-size:0.82rem;">${escapeHtml(req.customerEmail || req.customerPhone || req.customerName || 'Customer')}</td>
        <td>${statusPill}</td>
        <td style="font-size:0.78rem;color:var(--text-faint);">${escapeHtml(req.createdAt ? timestampToDate(req.createdAt)?.toLocaleDateString() : 'Recent')}</td>
        <td style="text-align:right;"><button class="btn-admin-action btn-action-view" onclick="openSwapDetails('${req.id}')">View Details</button></td>
      </tr>`;
  }).join('');
}

// TAB 5: SUBSCRIPTIONS & MRR
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
      || item.uid.toLowerCase().includes(search);

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
    subTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--text-faint);">No dealer subscriptions found.</td></tr>`;
    return;
  }

  subTableBody.innerHTML = filtered.map(item => {
    const sub = item.sub;
    const planPill = sub.isPremium
      ? `<span class="badge-status badge-plan-premium">⭐ Premium</span>`
      : `<span class="badge-status badge-plan-starter">Starter (Free)</span>`;

    const statusPill = sub.status === 'active'
      ? `<span class="badge-status badge-sub-active">✓ Active</span>`
      : (sub.status === 'expired' || sub.isExpired
          ? `<span class="badge-status badge-sub-expired">⌛ Expired</span>`
          : `<span class="badge-status badge-plan-starter">${escapeHtml(sub.status)}</span>`);

    const startDateStr = sub.startDate ? sub.startDate.toLocaleDateString() : 'Permanent';
    const endDateStr = sub.isPremium && sub.currentPeriodEnd ? sub.currentPeriodEnd.toLocaleDateString() : (sub.isPremium ? 'Active' : 'Permanent');

    return `
      <tr>
        <td>
          <div style="font-weight:700;color:var(--text-white);">${escapeHtml(item.storeName)}</div>
          <div style="font-size:0.76rem;color:var(--text-muted);">${escapeHtml(item.displayName)} &bull; ${escapeHtml(item.email || 'No email')}</div>
        </td>
        <td>${planPill}</td>
        <td>${statusPill}</td>
        <td style="font-size:0.8rem;color:var(--text-dim);">${startDateStr}</td>
        <td style="font-size:0.8rem;color:var(--text-dim);">${endDateStr}</td>
        <td><code style="font-size:0.75rem;color:var(--cyan-400);">${escapeHtml(sub.paymentReference ? sub.paymentReference.slice(0, 16) + '...' : 'Free Tier')}</code></td>
        <td><span style="color:${sub.isPremium ? 'var(--emerald-400)' : 'var(--text-faint)'};font-weight:700;">${sub.isPremium ? '₦9,900 / mo' : 'Free (₦0)'}</span></td>
        <td style="text-align:right;">
          <button class="btn-admin-action btn-action-view" onclick="openSubscriptionDetails('${item.uid}')">🔍 Manage</button>
        </td>
      </tr>`;
  }).join('');
}

// TAB 6: USERS DIRECTORY
function renderUsersTable() {
  if (!userTableBody) return;
  const query = (document.getElementById('userSearchInput')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('userRoleFilter')?.value || 'all';

  const filtered = allUsers.filter(u => {
    const name = String(u.displayName || u.fullName || u.name || u.storeName || '').toLowerCase();
    const email = String(u.email || '').toLowerCase();
    const phone = String(u.phoneNumber || u.phone || '').toLowerCase();
    const uid = String(u.uid || '').toLowerCase();

    const matchesQuery = !query || name.includes(query) || email.includes(query) || phone.includes(query) || uid.includes(query);

    const rawRole = String(u.role || u.accountType || '').toLowerCase();
    const isDealer = rawRole === 'dealer' || rawRole === 'store' || u.isDealer === true || !!u.storeName || !!u.businessName;
    const normalizedRole = isDealer ? 'dealer' : (rawRole === 'admin' ? 'admin' : 'customer');

    const matchesRole = filter === 'all' || normalizedRole === filter;
    return matchesQuery && matchesRole;
  });

  if (filtered.length === 0) {
    userTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:36px;color:var(--text-faint);">No users match your criteria.</td></tr>`;
    return;
  }

  userTableBody.innerHTML = filtered.map(u => {
    const rawRole = String(u.role || u.accountType || '').toLowerCase();
    const isDealer = rawRole === 'dealer' || rawRole === 'store' || u.isDealer === true || !!u.storeName || !!u.businessName;
    const isSuspended = u.adminSuspended === true;
    const isVerified = u.verificationStatus === 'approved' || u.dealer_verified === true || u.verified === true;

    const rolePill = isDealer
      ? `<span class="badge-status" style="background:rgba(6,182,212,0.15);color:var(--cyan-400);border:1px solid var(--cyan-border);">Dealer</span>`
      : (rawRole === 'admin'
          ? `<span class="badge-status" style="background:rgba(147,51,234,0.15);color:#C084FC;border:1px solid rgba(147,51,234,0.3);">Admin</span>`
          : `<span class="badge-status" style="background:rgba(0,210,106,0.12);color:var(--emerald-400);border:1px solid var(--emerald-border);">Swapper</span>`);

    return `
      <tr>
        <td>
          <div style="font-weight:700;color:var(--text-white);">${escapeHtml(u.displayName || u.fullName || u.email?.split('@')[0] || 'User')}</div>
          ${u.storeName ? `<div style="font-size:0.75rem;color:var(--cyan-400);">🏬 ${escapeHtml(u.storeName)}</div>` : ''}
        </td>
        <td>
          <div style="font-size:0.84rem;">${escapeHtml(u.email || 'No email')}</div>
          ${u.phoneNumber ? `<div style="font-size:0.76rem;color:var(--text-muted);">${escapeHtml(u.phoneNumber)}</div>` : ''}
        </td>
        <td>
          <div style="display:flex;gap:4px;align-items:center;">
            ${rolePill}
            ${isSuspended ? '<span class="badge-status badge-rejected">Suspended</span>' : ''}
          </div>
        </td>
        <td>${isDealer ? (isVerified ? '<span class="badge-status badge-approved">✓ Verified</span>' : '<span class="badge-status badge-pending">Pending KYC</span>') : '<span style="color:var(--text-faint);font-size:0.75rem;">N/A</span>'}</td>
        <td style="font-family:monospace;font-size:0.75rem;color:var(--text-faint);">${escapeHtml((u.uid || '').slice(0, 10))}...</td>
        <td style="text-align:right;">
          <button class="btn-admin-action btn-action-view" onclick="openUserActionModal('${u.uid}')">Manage</button>
        </td>
      </tr>`;
  }).join('');
}

// TAB 7: STOLEN DEVICES & IMEI BLACKLIST
function renderStolenDevicesTable() {
  if (!stolenTableBody) return;
  const search = (document.getElementById('stolenSearchInput')?.value || '').toLowerCase().trim();

  const filtered = allStolenDevices.filter(d => {
    if (!search) return true;
    const str = `${d.imei} ${d.brand || ''} ${d.model || ''} ${d.policeReportNumber || ''} ${d.description || ''}`.toLowerCase();
    return str.includes(search);
  });

  if (filtered.length === 0) {
    stolenTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text-faint);">No devices currently blacklisted. Nigerian marketplace registry is clear!</td></tr>`;
    return;
  }

  stolenTableBody.innerHTML = filtered.map(d => {
    const isBlacklisted = d.status !== 'cleared';
    const statusPill = isBlacklisted
      ? `<span class="badge-status badge-blacklisted">🚨 Blacklisted</span>`
      : `<span class="badge-status badge-approved">✓ Cleared</span>`;

    const dateStr = d.reportedAt ? timestampToDate(d.reportedAt)?.toLocaleDateString() : 'Recent';

    return `
      <tr>
        <td><code style="font-family:monospace;font-weight:700;color:#FCA5A5;font-size:0.86rem;">${escapeHtml(d.imei)}</code></td>
        <td style="font-weight:600;color:#FFF;">${escapeHtml(d.brand || '')} ${escapeHtml(d.model || '')}</td>
        <td style="font-size:0.82rem;">${escapeHtml(d.reportedBy || 'Police Report')}</td>
        <td style="font-size:0.8rem;color:var(--cyan-400);">${escapeHtml(d.policeReportNumber || 'Direct Incident')}</td>
        <td>${statusPill}</td>
        <td style="font-size:0.78rem;color:var(--text-faint);">${dateStr}</td>
        <td style="text-align:right;">
          ${isBlacklisted ? `
            <button class="btn-admin-action btn-action-approve" onclick="handleClearStolenDevice('${d.imei}')" title="Clear Flag">
              Clear Flag
            </button>
          ` : '<span style="font-size:0.75rem;color:var(--text-faint);">Resolved</span>'}
        </td>
      </tr>`;
  }).join('');
}

// TAB 8: HUB DIAGNOSTIC CERTIFICATES
function renderCertificatesTable() {
  if (!certTableBody) return;
  const search = (document.getElementById('certSearchInput')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('certResultFilter')?.value || 'all';

  const filtered = allCertificates.filter(c => {
    if (filter !== 'all' && c.inspectionStatus !== filter) return false;
    if (!search) return true;
    const str = `${c.reportId || ''} ${c.requestId || ''} ${c.device?.model || ''} ${c.technicianName || ''} ${c.hubLocation || ''}`.toLowerCase();
    return str.includes(search);
  });

  if (filtered.length === 0) {
    certTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--text-faint);">No hub inspection certificates found.</td></tr>`;
    return;
  }

  certTableBody.innerHTML = filtered.map(c => {
    const passed = c.inspectionStatus === 'passed';
    const statusPill = passed
      ? `<span class="badge-status badge-cert-passed">✓ Certified</span>`
      : `<span class="badge-status badge-cert-failed">✕ Failed</span>`;

    const diag = c.diagnosticDetails || {};
    const diagSummary = `Batt: ${diag.batteryHealth || 90}% • Screen: ${diag.screenPassed !== false ? 'OK' : 'Fault'} • iCloud: ${diag.icloudSignedOut !== false ? 'Clean' : 'Locked'}`;
    const dateStr = c.inspectedAt ? timestampToDate(c.inspectedAt)?.toLocaleDateString() : 'Recent';

    return `
      <tr>
        <td><code style="font-family:monospace;color:var(--cyan-400);font-weight:700;">${escapeHtml(c.reportId || 'NS-CERT')}</code></td>
        <td style="font-weight:600;color:#FFF;">${escapeHtml(c.device?.model || c.targetDevice?.model || 'Device')}</td>
        <td style="font-size:0.8rem;">${escapeHtml(c.hubLocation || 'Computer Village Hub')}</td>
        <td style="font-size:0.8rem;">${escapeHtml(c.technicianName || 'Hub Technician')}</td>
        <td style="font-size:0.76rem;color:var(--text-dim);">${escapeHtml(diagSummary)}</td>
        <td>${statusPill}</td>
        <td style="font-size:0.78rem;color:var(--text-faint);">${dateStr}</td>
        <td style="text-align:right;">
          <button class="btn-admin-action btn-action-view" onclick="openCertificateDetails('${c.reportId || c.id}')">Inspect</button>
        </td>
      </tr>`;
  }).join('');
}

// TAB 9: REVIEWS MODERATION
function renderReviewsTable() {
  if (!reviewTableBody) return;
  const search = (document.getElementById('reviewSearchInput')?.value || '').toLowerCase().trim();
  const ratingFilter = document.getElementById('reviewRatingFilter')?.value || 'all';

  const filtered = allReviews.filter(r => {
    if (ratingFilter !== 'all' && Number(r.rating) !== Number(ratingFilter)) return false;
    if (!search) return true;
    const str = `${r.comment || ''} ${r.authorName || ''} ${r.storeId || ''} ${r.targetDeviceModel || ''}`.toLowerCase();
    return str.includes(search);
  });

  if (filtered.length === 0) {
    reviewTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text-faint);">No reviews match the selected filter.</td></tr>`;
    return;
  }

  reviewTableBody.innerHTML = filtered.map(r => {
    const stars = '★'.repeat(Math.max(1, Math.min(5, Number(r.rating) || 5))) + '☆'.repeat(Math.max(0, 5 - (Number(r.rating) || 5)));
    const dateStr = r.createdAt ? timestampToDate(r.createdAt)?.toLocaleDateString() : 'Recent';

    return `
      <tr>
        <td style="font-weight:600;color:var(--cyan-400);">Store #${escapeHtml((r.storeId || '').slice(0, 10))}</td>
        <td style="font-size:0.82rem;color:#FFF;">${escapeHtml(r.authorName || 'Swapper')}</td>
        <td><span class="star-rating">${stars}</span></td>
        <td style="font-size:0.82rem;max-width:260px;line-height:1.4;">${escapeHtml(r.comment || 'No comment text')}</td>
        <td style="font-size:0.78rem;color:var(--text-muted);">${escapeHtml(r.targetDeviceModel || 'Phone')}</td>
        <td style="font-size:0.78rem;color:var(--text-faint);">${dateStr}</td>
        <td style="text-align:right;">
          <button class="btn-admin-action btn-action-reject" onclick="handleDeleteReview('${r.id}')" title="Delete Review">Delete</button>
        </td>
      </tr>`;
  }).join('');
}

// TAB 10: ALL USERS ACTIVITY & AUDIT TRAIL
function renderActivityStream() {
  if (!activityStreamContainer) return;
  const search = (document.getElementById('activitySearchInput')?.value || '').toLowerCase().trim();
  const category = document.getElementById('activityCategoryFilter')?.value || 'all';

  // Build composite activity items from auditLogs, swaps, verifications, reviews & listings
  const items = [];

  allAuditLogs.forEach(log => {
    items.push({
      id: log.id,
      category: log.action?.includes('dispute') ? 'dispute' : (log.action?.includes('kyc') ? 'kyc' : 'admin'),
      icon: log.action?.includes('dispute') ? '⚖️' : (log.action?.includes('kyc') ? '🪪' : '🛡️'),
      iconBg: 'rgba(168,85,247,0.15)',
      title: log.action ? log.action.replace(/_/g, ' ').toUpperCase() : 'ADMIN AUDIT EVENT',
      details: typeof log.details === 'object' ? JSON.stringify(log.details) : (log.details || log.target || 'Audit action logged'),
      actor: log.adminEmail || log.uid || 'Admin Operator',
      timestamp: timestampToDate(log.createdAt)
    });
  });

  allSwaps.forEach(swap => {
    if (swap.disputeStatus === 'open') {
      items.push({
        id: `disp_${swap.id}`,
        category: 'dispute',
        icon: '⚠️',
        iconBg: 'rgba(244,63,94,0.15)',
        title: 'TRADE DISPUTE FIRED',
        details: `Dispute opened on swap for ${swap.targetPhoneTitle || swap.targetPhone}. Reason: ${swap.disputeReason || 'Unspecified'}`,
        actor: swap.customerEmail || swap.customerName || 'Swapper',
        timestamp: timestampToDate(swap.disputeOpenedAt || swap.updatedAt)
      });
    }
    items.push({
      id: `swap_${swap.id}`,
      category: 'swap',
      icon: '🔄',
      iconBg: 'rgba(0,210,106,0.15)',
      title: `SWAP STATUS: ${(swap.status || 'CREATED').toUpperCase()}`,
      details: `Swap trade-in: ${swap.currentPhone || 'Device'} for ${swap.targetPhoneTitle || swap.targetPhone || 'Device'}. Top-up: ₦${Number(swap.topupAmount || swap.cashAdjustment || 0).toLocaleString()}`,
      actor: swap.customerEmail || swap.customerName || 'Customer',
      timestamp: timestampToDate(swap.createdAt || swap.date)
    });
  });

  allVerifications.forEach(verif => {
    items.push({
      id: `verif_${verif.uid}`,
      category: 'kyc',
      icon: '🪪',
      iconBg: 'rgba(6,182,212,0.15)',
      title: `DEALER KYC: ${(verif.status || 'SUBMITTED').toUpperCase()}`,
      details: `Store "${verif.businessName || verif.storeName}" submitted documentation (NIN: ${maskSensitive(verif.nin, 4)}).`,
      actor: verif.businessEmail || verif.email || 'Dealer Partner',
      timestamp: timestampToDate(verif.submittedAt || verif.createdAt)
    });
  });

  allListings.forEach(l => {
    items.push({
      id: `list_${l.id}`,
      category: 'listing',
      icon: '📱',
      iconBg: 'rgba(245,158,11,0.15)',
      title: `NEW INVENTORY LISTED`,
      details: `${l.brand || ''} ${l.title || l.model || 'Phone'} listed for ₦${Number(l.marketValue || l.price || 0).toLocaleString()} by ${l.storeName || 'Dealer Store'}.`,
      actor: l.storeName || 'Verified Store',
      timestamp: timestampToDate(l.createdAt)
    });
  });

  // Sort descending by timestamp
  items.sort((a, b) => {
    const tA = a.timestamp ? a.timestamp.getTime() : 0;
    const tB = b.timestamp ? b.timestamp.getTime() : 0;
    return tB - tA;
  });

  const filtered = items.filter(item => {
    if (category !== 'all' && item.category !== category) return false;
    if (!search) return true;
    const str = `${item.title} ${item.details} ${item.actor}`.toLowerCase();
    return str.includes(search);
  });

  if (filtered.length === 0) {
    activityStreamContainer.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text-faint);">No platform user activity matches the selected category filter.</div>`;
    return;
  }

  activityStreamContainer.innerHTML = filtered.slice(0, 80).map(item => {
    const timeStr = item.timestamp ? item.timestamp.toLocaleString() : 'Recent Activity';
    return `
      <div class="activity-stream-item">
        <div class="act-stream-icon" style="background:${item.iconBg};">${item.icon}</div>
        <div class="act-stream-content">
          <div class="act-stream-header">
            <span class="act-stream-title">${escapeHtml(item.title)}</span>
            <span class="act-stream-time">${escapeHtml(timeStr)}</span>
          </div>
          <div class="act-stream-detail">${escapeHtml(item.details)}</div>
          <div class="act-stream-actor">👤 ${escapeHtml(item.actor)}</div>
        </div>
      </div>`;
  }).join('');
}

function refreshAllUI() {
  renderMetrics();
  renderVerificationsTable();
  renderDisputesTable();
  renderListingsTable();
  renderSwapsTable();
  renderSubscriptionsTable();
  renderUsersTable();
  renderStolenDevicesTable();
  renderCertificatesTable();
  renderReviewsTable();
  renderActivityStream();
}

/* =========================================================
   6. MODAL INSPECTORS & ACTIONS
   ========================================================= */

// SWAP DETAILS & LIVE CHAT INSPECTION
window.openSwapDetails = async function(id) {
  const request = allSwaps.find(swap => swap.id === id);
  if (!request) {
    showAlert('This swap request is no longer available.', 'error');
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

  document.getElementById('swapDetailTitle').textContent = request.targetPhoneTitle || request.targetPhone || 'Swap Request Details';
  document.getElementById('swapDetailId').textContent = `Request ID: ${request.id}`;
  
  const statusEl = document.getElementById('swapDetailStatus');
  statusEl.className = `badge-status ${statusBadgeClass(request.status)}`;
  statusEl.textContent = request.status || 'Pending';
  document.getElementById('swapStatusInput').value = request.status || '';

  // Dispute Callout
  const disputeBanner = document.getElementById('swapDisputeBanner');
  if (request.disputeStatus === 'open') {
    disputeBanner.style.display = 'block';
    document.getElementById('swapDisputeReasonText').textContent = request.disputeReason || 'Customer reported a condition or top-up discrepancy during trade-in.';
  } else {
    disputeBanner.style.display = 'none';
  }

  document.getElementById('swapSwapperProfile').innerHTML = swapper ? fieldsMarkup(swapper) : '<p class="record-unavailable">No matching user profile found.</p>';
  document.getElementById('swapDealerProfile').innerHTML = dealer ? fieldsMarkup(dealer) : '<p class="record-unavailable">No matching dealer profile found.</p>';

  const deviceFields = Object.fromEntries(Object.entries(request).filter(([key]) => /phone|device|brand|model|storage|condition|topup|cash/i.test(key)));
  document.getElementById('swapDeviceDetails').innerHTML = fieldsMarkup(deviceFields);

  const verificationFields = Object.fromEntries(Object.entries(request).filter(([key]) => /diagnos|verif|inspect|report|cert/i.test(key)));
  document.getElementById('swapVerificationDetails').innerHTML = fieldsMarkup(verificationFields);
  document.getElementById('swapAllFields').innerHTML = fieldsMarkup(request);

  // Load and render chat messages
  renderSwapChat(request.id);

  swapDetailModal.style.display = 'flex';
};

async function renderSwapChat(swapId) {
  const feed = document.getElementById('swapChatFeed');
  if (!feed) return;
  feed.innerHTML = '<p style="color:var(--text-faint);text-align:center;padding:12px;">Loading live conversation...</p>';

  const messages = await fetchSwapMessages(swapId);
  if (!messages || messages.length === 0) {
    feed.innerHTML = '<p style="color:var(--text-faint);text-align:center;padding:16px;">No messages sent yet between swapper and store.</p>';
    return;
  }

  feed.innerHTML = messages.map(m => {
    const role = (m.senderRole || '').toLowerCase();
    const isCustomer = role === 'customer';
    const isAdmin = role === 'admin';
    const bubbleClass = isAdmin ? 'chat-bubble-admin' : (isCustomer ? 'chat-bubble-customer' : 'chat-bubble-dealer');
    const roleBadge = isAdmin ? '🛡️ Admin Desk' : (isCustomer ? '👤 Customer' : '🏪 Dealer');
    const timeStr = m.createdAt ? timestampToDate(m.createdAt)?.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '';

    return `
      <div class="chat-bubble ${bubbleClass}">
        <div class="chat-bubble-header">
          <span class="chat-bubble-role">${roleBadge} &bull; ${escapeHtml(m.senderName || 'Participant')}</span>
          <span class="chat-bubble-time">${escapeHtml(timeStr)}</span>
        </div>
        <div>${escapeHtml(m.text || '')}</div>
      </div>`;
  }).join('');

  feed.scrollTop = feed.scrollHeight;
}

// Chat input form
document.getElementById('swapAdminChatForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentSelectedSwapId) return;
  const input = document.getElementById('swapAdminChatInput');
  const text = input.value.trim();
  if (!text) return;

  try {
    await sendAdminSwapMessage(currentSelectedSwapId, text, 'NaijaSwap Desk', auth.currentUser?.uid);
    input.value = '';
    renderSwapChat(currentSelectedSwapId);
    showAlert('Official administrative message posted into swap chat.', 'success');
  } catch (err) {
    showAlert(`Could not post message: ${err.message}`, 'error');
  }
});

// DISPUTE RESOLUTION TRIGGERS
document.getElementById('resolveForCustomerBtn')?.addEventListener('click', () => openDisputeModal('resolved_for_customer'));
document.getElementById('resolveForDealerBtn')?.addEventListener('click', () => openDisputeModal('resolved_for_dealer'));
document.getElementById('dismissDisputeBtn')?.addEventListener('click', () => openDisputeModal('dismissed'));

function openDisputeModal(defaultOutcome = 'resolved_for_customer') {
  const outcomeSelect = document.getElementById('disputeOutcomeSelect');
  if (outcomeSelect) outcomeSelect.value = defaultOutcome;
  if (disputeModal) disputeModal.style.display = 'flex';
}

document.getElementById('cancelDisputeModalBtn')?.addEventListener('click', () => {
  if (disputeModal) disputeModal.style.display = 'none';
});

document.getElementById('confirmDisputeResolutionBtn')?.addEventListener('click', async () => {
  if (!currentSelectedSwapId) return;
  const outcome = document.getElementById('disputeOutcomeSelect').value;
  const notes = document.getElementById('disputeOutcomeNotes').value.trim();

  let newSwapStatus = null;
  if (outcome === 'resolved_for_customer' || outcome === 'cancelled_mutual') {
    newSwapStatus = 'cancelled';
  } else if (outcome === 'resolved_for_dealer') {
    newSwapStatus = 'accepted';
  }

  try {
    await resolveSwapDispute(currentSelectedSwapId, outcome, newSwapStatus, notes, auth.currentUser);
    await recordAdminAuditLog('swap_dispute_resolved', currentSelectedSwapId, { outcome, notes });

    // Update local state
    const req = allSwaps.find(s => s.id === currentSelectedSwapId);
    if (req) {
      req.disputeStatus = 'resolved';
      if (newSwapStatus) req.status = newSwapStatus;
    }

    if (disputeModal) disputeModal.style.display = 'none';
    if (swapDetailModal) swapDetailModal.style.display = 'none';
    showAlert('Trade dispute successfully arbitrated and updated.', 'success');
    refreshAllUI();
  } catch (err) {
    showAlert(`Could not resolve dispute: ${err.message}`, 'error');
  }
});

// LISTING INSPECTION & ACTIONS
window.openListingDetails = function(id) {
  const listing = allListings.find(l => l.id === id);
  if (!listing) return;
  currentSelectedListingId = listing.id;

  document.getElementById('modalListingTitle').textContent = listing.title || listing.model || 'Phone Model';
  document.getElementById('modalListingSeller').textContent = `Seller: ${listing.storeName || listing.sellerName || 'Verified Store'}`;
  
  const statusEl = document.getElementById('modalListingStatus');
  statusEl.className = `badge-status ${listing.status === 'archived' ? 'badge-rejected' : (listing.adminFlagged ? 'badge-pending' : 'badge-approved')}`;
  statusEl.textContent = listing.status === 'archived' ? 'Archived' : (listing.adminFlagged ? 'Flagged for Review' : 'Active');

  document.getElementById('modalListingPrice').textContent = listing.marketValue || listing.price ? `₦${Number(listing.marketValue || listing.price).toLocaleString()}` : 'Price not set';
  document.getElementById('modalListingCondition').textContent = listing.conditionGrade || listing.condition || 'Pre-owned';
  document.getElementById('modalListingBattery').textContent = listing.battery ? `${listing.battery}% Health` : 'Not specified';
  document.getElementById('modalListingStorageColor').textContent = `${listing.storage || 'Storage'} • ${listing.color || 'Color'}`;
  document.getElementById('modalListingDescription').textContent = listing.description || 'No description provided by seller.';

  // Links
  document.getElementById('modalListingPublicLink').href = `phone-details.html?id=${encodeURIComponent(listing.id)}`;
  document.getElementById('modalListingActivityLink').href = `listing-activity.html?id=${encodeURIComponent(listing.id)}`;

  // Photo Gallery
  const gallery = document.getElementById('modalListingGallery');
  const photos = listing.mediaFiles || (listing.image ? [listing.image] : []);
  if (photos.length > 0) {
    gallery.innerHTML = photos.map(src => `
      <div class="listing-thumb-card" onclick="openLightbox('${escapeHtml(src)}')">
        <img src="${escapeHtml(src)}" alt="Phone Photo">
      </div>`).join('');
  } else {
    gallery.innerHTML = '<p style="color:var(--text-faint);font-size:0.8rem;padding:8px;">No photos uploaded for this listing.</p>';
  }

  // Update Flag button text
  const flagBtn = document.getElementById('modalListingFlagBtn');
  flagBtn.textContent = listing.adminFlagged ? 'Remove Review Flag' : 'Flag for Review';

  if (listingDetailModal) listingDetailModal.style.display = 'flex';
};

document.getElementById('closeListingModal')?.addEventListener('click', () => {
  if (listingDetailModal) listingDetailModal.style.display = 'none';
});

// Listing action buttons
document.getElementById('modalListingFlagBtn')?.addEventListener('click', async () => {
  if (!currentSelectedListingId) return;
  const listing = allListings.find(l => l.id === currentSelectedListingId);
  if (!listing) return;
  const newFlag = !listing.adminFlagged;
  try {
    await setListingFlagged(currentSelectedListingId, newFlag);
    listing.adminFlagged = newFlag;
    showAlert(newFlag ? 'Listing flagged for moderation review.' : 'Flag cleared.', 'success');
    if (listingDetailModal) listingDetailModal.style.display = 'none';
    refreshAllUI();
  } catch (err) { showAlert(err.message, 'error'); }
});

document.getElementById('modalListingArchiveBtn')?.addEventListener('click', async () => {
  if (!currentSelectedListingId) return;
  if (!confirm('Are you sure you want to take down and archive this marketplace listing?')) return;
  try {
    await setListingStatus(currentSelectedListingId, 'archived');
    const listing = allListings.find(l => l.id === currentSelectedListingId);
    if (listing) listing.status = 'archived';
    showAlert('Listing archived and taken down from marketplace.', 'success');
    if (listingDetailModal) listingDetailModal.style.display = 'none';
    refreshAllUI();
  } catch (err) { showAlert(err.message, 'error'); }
});

document.getElementById('modalListingActivateBtn')?.addEventListener('click', async () => {
  if (!currentSelectedListingId) return;
  try {
    await setListingStatus(currentSelectedListingId, 'active');
    const listing = allListings.find(l => l.id === currentSelectedListingId);
    if (listing) {
      listing.status = 'active';
      listing.adminFlagged = false;
    }
    showAlert('Listing re-activated on marketplace.', 'success');
    if (listingDetailModal) listingDetailModal.style.display = 'none';
    refreshAllUI();
  } catch (err) { showAlert(err.message, 'error'); }
});

document.getElementById('modalListingDeleteBtn')?.addEventListener('click', async () => {
  if (!currentSelectedListingId) return;
  if (!confirm('Permanently delete this phone listing from the database? This cannot be undone.')) return;
  try {
    await deleteListing(currentSelectedListingId);
    allListings = allListings.filter(l => l.id !== currentSelectedListingId);
    showAlert('Listing permanently deleted.', 'success');
    if (listingDetailModal) listingDetailModal.style.display = 'none';
    refreshAllUI();
  } catch (err) { showAlert(err.message, 'error'); }
});

// STOLEN DEVICES MODAL
document.getElementById('openAddStolenModalBtn')?.addEventListener('click', () => {
  if (addStolenModal) addStolenModal.style.display = 'flex';
});

document.getElementById('cancelAddStolenBtn')?.addEventListener('click', () => {
  if (addStolenModal) addStolenModal.style.display = 'none';
});

document.getElementById('addStolenForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const imei = document.getElementById('inputStolenImei').value.trim();
  const brand = document.getElementById('inputStolenBrand').value;
  const model = document.getElementById('inputStolenModel').value.trim();
  const policeReportNumber = document.getElementById('inputStolenPoliceReport').value.trim();
  const description = document.getElementById('inputStolenNotes').value.trim();

  try {
    const record = await addStolenDevice(imei, { brand, model, policeReportNumber, description });
    allStolenDevices.push(record);
    await recordAdminAuditLog('imei_blacklisted', imei, { brand, model, policeReportNumber });
    showAlert(`🚨 Device ${imei} (${brand} ${model}) blacklisted! Swaps involving this device will be blocked.`, 'success');
    if (addStolenModal) addStolenModal.style.display = 'none';
    document.getElementById('addStolenForm').reset();
    refreshAllUI();
  } catch (err) {
    showAlert(`Could not blacklist device: ${err.message}`, 'error');
  }
});

window.handleClearStolenDevice = async function(imei) {
  if (!confirm(`Are you sure you want to clear the blacklist flag for IMEI ${imei}?`)) return;
  try {
    await removeStolenDevice(imei);
    const item = allStolenDevices.find(d => d.imei === imei);
    if (item) item.status = 'cleared';
    await recordAdminAuditLog('imei_blacklist_cleared', imei);
    showAlert(`IMEI ${imei} cleared from blacklist.`, 'success');
    refreshAllUI();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

// CERTIFICATES INSPECTOR
window.openCertificateDetails = function(reportId) {
  const cert = allCertificates.find(c => (c.reportId || c.id) === reportId);
  if (!cert) return;
  currentSelectedCertId = reportId;

  document.getElementById('modalCertId').textContent = cert.reportId || 'NS-CERT';
  document.getElementById('modalCertHub').textContent = cert.hubLocation || 'Computer Village Hub, Ikeja';
  document.getElementById('modalCertDevice').textContent = cert.device?.model || cert.targetDevice?.model || 'Device Tested';
  document.getElementById('modalCertTech').textContent = cert.technicianName || 'Hub Technician';
  document.getElementById('modalCertGrade').textContent = cert.diagnosticDetails?.physicalGrade || 'Grade A';
  document.getElementById('modalCertDate').textContent = cert.inspectedAt ? timestampToDate(cert.inspectedAt)?.toLocaleString() : 'Recently';
  document.getElementById('modalCertNotes').textContent = cert.notes || cert.inspectionNotes || 'All primary hardware diagnostic tests passed without anomaly.';

  const diag = cert.diagnosticDetails || {};
  document.getElementById('modalCertDiagnosticsGrid').innerHTML = `
    <div class="record-field"><span>Screen &amp; Digitizer:</span><code>${diag.screenPassed !== false ? '✓ Passed (No Dead Pixels)' : '✕ Screen Defect'}</code></div>
    <div class="record-field"><span>Battery Health:</span><code>${diag.batteryHealth || 92}% Capacity</code></div>
    <div class="record-field"><span>iCloud / Google Lock:</span><code>${diag.icloudSignedOut !== false ? '✓ Signed Out (Clean)' : '✕ Account Locked'}</code></div>
    <div class="record-field"><span>Cameras &amp; Flash:</span><code>${diag.camerasPassed !== false ? '✓ Passed' : '✕ Camera Fault'}</code></div>
    <div class="record-field"><span>Biometrics (FaceID/Fingerprint):</span><code>${diag.biometricsPassed !== false ? '✓ Verified Working' : '✕ Fault'}</code></div>
    <div class="record-field"><span>IMEI Status:</span><code>${diag.imeiClean !== false ? '✓ Clean / Unlocked' : '✕ Blacklisted'}</code></div>
  `;

  document.getElementById('modalCertPublicLink').href = `certificate.html?id=${encodeURIComponent(cert.reportId || cert.id)}`;
  if (certificateDetailModal) certificateDetailModal.style.display = 'flex';
};

document.getElementById('closeCertModal')?.addEventListener('click', () => {
  if (certificateDetailModal) certificateDetailModal.style.display = 'none';
});
document.getElementById('closeCertModalBtn')?.addEventListener('click', () => {
  if (certificateDetailModal) certificateDetailModal.style.display = 'none';
});

// REVIEWS MODERATION
window.handleDeleteReview = async function(reviewId) {
  if (!confirm('Are you sure you want to delete this store review? This action cannot be undone.')) return;
  try {
    await deleteReview(reviewId);
    allReviews = allReviews.filter(r => r.id !== reviewId);
    showAlert('Review deleted.', 'success');
    refreshAllUI();
  } catch (err) { showAlert(err.message, 'error'); }
};

// USER ACCOUNT ACTIONS MODAL
window.openUserActionModal = function(uid) {
  const user = allUsers.find(u => u.uid === uid);
  if (!user) return;
  currentSelectedUserUid = uid;

  document.getElementById('userActionModalSubtitle').textContent = `${user.displayName || user.name || 'User'} (${user.email || 'No email'}) • UID: ${uid.slice(0, 10)}...`;
  
  const roleSelect = document.getElementById('userActionRoleSelect');
  if (roleSelect) {
    const rawRole = String(user.role || user.accountType || '').toLowerCase();
    const isDealer = rawRole === 'dealer' || user.isDealer === true;
    roleSelect.value = isDealer ? 'dealer' : (rawRole === 'admin' ? 'admin' : (rawRole === 'technician' ? 'technician' : 'customer'));
  }

  const suspBtn = document.getElementById('userToggleSuspensionBtn');
  if (suspBtn) {
    suspBtn.textContent = user.adminSuspended ? '✓ Clear Suspension (Unblock)' : '🚫 Suspend Account (Block)';
  }

  if (userActionModal) userActionModal.style.display = 'flex';
};

document.getElementById('cancelUserActionBtn')?.addEventListener('click', () => {
  if (userActionModal) userActionModal.style.display = 'none';
});

document.getElementById('saveUserRoleBtn')?.addEventListener('click', async () => {
  if (!currentSelectedUserUid) return;
  const newRole = document.getElementById('userActionRoleSelect').value;
  try {
    await updateUserRole(currentSelectedUserUid, newRole);
    const user = allUsers.find(u => u.uid === currentSelectedUserUid);
    if (user) {
      user.role = newRole;
      user.accountType = newRole;
    }
    await recordAdminAuditLog('user_role_changed', currentSelectedUserUid, { newRole });
    showAlert(`User role updated to "${newRole}".`, 'success');
    if (userActionModal) userActionModal.style.display = 'none';
    refreshAllUI();
  } catch (err) { showAlert(err.message, 'error'); }
});

document.getElementById('userSendPasswordResetBtn')?.addEventListener('click', async () => {
  if (!currentSelectedUserUid) return;
  const user = allUsers.find(u => u.uid === currentSelectedUserUid);
  if (!user?.email) {
    showAlert('This user account has no associated email address for password reset.', 'error');
    return;
  }
  try {
    await sendPasswordReset(user.email);
    showAlert(`Password reset email sent to ${user.email}.`, 'success');
  } catch (err) { showAlert(err.message, 'error'); }
});

document.getElementById('userToggleSuspensionBtn')?.addEventListener('click', async () => {
  if (!currentSelectedUserUid) return;
  const user = allUsers.find(u => u.uid === currentSelectedUserUid);
  if (!user) return;
  const newSuspended = !user.adminSuspended;
  try {
    await setUserSuspended(currentSelectedUserUid, newSuspended);
    user.adminSuspended = newSuspended;
    showAlert(newSuspended ? 'User account suspended.' : 'User suspension cleared.', 'success');
    if (userActionModal) userActionModal.style.display = 'none';
    refreshAllUI();
  } catch (err) { showAlert(err.message, 'error'); }
});

// SUBSCRIPTION DETAILS & CONTROLS
window.openSubscriptionDetails = function(uid) {
  const dealers = getAllDealersList();
  const dealer = dealers.find(d => d.uid === uid);
  if (!dealer) return;
  currentSelectedSubUid = uid;
  const sub = dealer.sub;

  const badgeEl = document.getElementById('modalSubBadge');
  if (badgeEl) {
    badgeEl.className = 'badge-status ' + (sub.isPremium ? 'badge-plan-premium' : 'badge-plan-starter');
    badgeEl.textContent = sub.isPremium ? '⭐ Premium Plan' : 'Starter Free Tier';
  }

  document.getElementById('modalSubDealerName').textContent = dealer.displayName || 'Dealer';
  document.getElementById('modalSubStoreName').textContent = `${dealer.storeName} • ${dealer.email || 'No email'}`;
  document.getElementById('modalSubPlan').textContent = sub.isPremium ? 'Premium Plan (₦9,900/month)' : 'Starter Plan (Free Forever)';
  document.getElementById('modalSubAmount').textContent = sub.isPremium ? '₦9,900 / month' : '₦0 (Free Forever)';
  document.getElementById('modalSubStartDate').textContent = sub.startDate ? sub.startDate.toLocaleString() : 'Permanent account';
  document.getElementById('modalSubEndDate').textContent = sub.currentPeriodEnd ? sub.currentPeriodEnd.toLocaleString() : (sub.isPremium ? 'Active' : 'No expiration (Free forever)');
  document.getElementById('modalSubRef').textContent = sub.paymentReference || 'None (Free account)';
  document.getElementById('modalSubAuthCode').textContent = sub.paystackAuthCode || 'Not saved / Offline';
  document.getElementById('modalSubListingsLimit').textContent = sub.isPremium ? 'Unlimited Phone Listings' : 'Maximum 5 Active Listings';
  document.getElementById('modalSubUid').textContent = uid;

  if (subscriptionDetailModal) subscriptionDetailModal.style.display = 'flex';
};

document.getElementById('closeSubModal')?.addEventListener('click', () => { if (subscriptionDetailModal) subscriptionDetailModal.style.display = 'none'; });
document.getElementById('closeSubModalBtn')?.addEventListener('click', () => { if (subscriptionDetailModal) subscriptionDetailModal.style.display = 'none'; });

document.getElementById('subGrantPremiumBtn')?.addEventListener('click', async () => {
  if (!currentSelectedSubUid) return;
  try {
    await grantDealerSubscription(currentSelectedSubUid, 1, 'Granted 30-day Premium by Administrator');
    await recordAdminAuditLog('dealer_premium_granted', currentSelectedSubUid, { plan: 'premium', durationMonths: 1 });
    showAlert('⭐ 30-Day Premium plan successfully granted to dealer!', 'success');
    if (subscriptionDetailModal) subscriptionDetailModal.style.display = 'none';
    await loadAllData();
  } catch (err) { showAlert(err.message, 'error'); }
});

document.getElementById('subCancelBtn')?.addEventListener('click', async () => {
  if (!currentSelectedSubUid) return;
  if (!confirm('Downgrade this store to the Starter (free 5-listing) tier?')) return;
  try {
    await cancelDealerSubscription(currentSelectedSubUid);
    showAlert('Dealer subscription downgraded to Starter.', 'success');
    if (subscriptionDetailModal) subscriptionDetailModal.style.display = 'none';
    await loadAllData();
  } catch (err) { showAlert(err.message, 'error'); }
});

// CSV EXPORT ENGINE
document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
  let filename = `naijaswap_${currentActiveTab}_${new Date().toISOString().slice(0, 10)}.csv`;
  let csvContent = '';

  if (currentActiveTab === 'tabVerifications') {
    csvContent = 'Store Name,Email,NIN,BVN,CAC,Address,Status,Submitted At\n';
    allVerifications.forEach(v => {
      csvContent += `"${v.businessName || v.storeName || ''}","${v.businessEmail || v.email || ''}","${v.nin || ''}","${v.bvn || ''}","${v.cacNumber || ''}","${v.shopAddress || ''}","${v.status || ''}","${v.submittedAt || ''}"\n`;
    });
  } else if (currentActiveTab === 'tabDisputes') {
    csvContent = 'Swap ID,Target Phone,Trade-In Phone,Customer,Store,Dispute Status,Dispute Reason,Opened At\n';
    allSwaps.filter(s => s.disputeStatus === 'open' || s.disputeStatus === 'resolved').forEach(s => {
      csvContent += `"${s.id}","${s.targetPhoneTitle || s.targetPhone || ''}","${s.currentPhone || ''}","${s.customerEmail || ''}","${s.storeName || ''}","${s.disputeStatus || ''}","${(s.disputeReason || '').replace(/"/g, '""')}","${s.disputeOpenedAt || ''}"\n`;
    });
  } else if (currentActiveTab === 'tabSubscriptions') {
    csvContent = 'Store,Dealer Name,Email,Plan,Status,Fee,Start Date,End Date,Reference\n';
    getAllDealersList().forEach(d => {
      const s = d.sub;
      csvContent += `"${d.storeName}","${d.displayName}","${d.email}","${s.plan}","${s.status}","${s.amount}","${s.startDate ? s.startDate.toISOString() : ''}","${s.currentPeriodEnd ? s.currentPeriodEnd.toISOString() : ''}","${s.paymentReference || ''}"\n`;
    });
  } else if (currentActiveTab === 'tabStolenDevices') {
    csvContent = 'IMEI,Brand,Model,Police Report Number,Status,Reported At,Description\n';
    allStolenDevices.forEach(d => {
      csvContent += `"${d.imei}","${d.brand || ''}","${d.model || ''}","${d.policeReportNumber || ''}","${d.status || ''}","${d.reportedAt || ''}","${(d.description || '').replace(/"/g, '""')}"\n`;
    });
  } else if (currentActiveTab === 'tabUsers') {
    csvContent = 'UID,Name,Email,Phone,Role,Verified,Suspended,Created At\n';
    allUsers.forEach(u => {
      csvContent += `"${u.uid}","${u.displayName || u.fullName || ''}","${u.email || ''}","${u.phoneNumber || ''}","${u.role || ''}","${u.dealer_verified ? 'YES' : 'NO'}","${u.adminSuspended ? 'YES' : 'NO'}","${u.createdAt || ''}"\n`;
    });
  } else {
    // Default: Swaps
    csvContent = 'Swap ID,Target Phone,Trade-in Phone,Customer,Dealer,Top-up,Status,Date\n';
    allSwaps.forEach(s => {
      csvContent += `"${s.id}","${s.targetPhoneTitle || s.targetPhone || ''}","${s.currentPhone || ''}","${s.customerEmail || ''}","${s.storeName || ''}","${s.topupAmount || s.cashAdjustment || 0}","${s.status || ''}","${s.createdAt || ''}"\n`;
    });
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showAlert(`Exported ${filename} successfully.`, 'success');
});

/* =========================================================
   7. DOSSIER & VERIFICATION DECISION ENGINE
   ========================================================= */
window.inspectDealer = function(uid) {
  const item = allVerifications.find(v => v.uid === uid);
  if (!item) return;
  currentSelectedDossier = item;

  const bName = item.businessName || item.storeName || item.shopName || item.displayName || 'Store';
  const bEmail = item.businessEmail || item.email || 'No email';
  const sAddr = item.shopAddress || item.businessAddress || item.address || 'Not Provided';
  const bAccount = item.bankAccountNumber || item.accountNumber || '';
  const bBank = item.bankName ? item.bankName + (bAccount ? ' — ' : '') : '';

  document.getElementById('modalDossierBizName').textContent = bName;
  document.getElementById('modalDossierEmail').textContent = bEmail;
  setSensitiveValue('modalDossierNin', item.nin || 'Not Provided');
  setSensitiveValue('modalDossierBvn', item.bvn || 'Not Provided');
  document.getElementById('modalDossierCac').textContent = item.cacNumber || 'None / Not Registered';
  setSensitiveValue('modalDossierBank', (bBank + bAccount) || 'Not Provided');
  document.getElementById('modalDossierAddress').textContent = sAddr;

  const mapLink = document.getElementById('modalDossierMapLink');
  if (item.geoTag || item.shopAddress) {
    mapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.geoTag || item.shopAddress)}`;
    mapLink.style.display = 'inline-flex';
  } else {
    mapLink.style.display = 'none';
  }

  const badge = document.getElementById('modalDossierBadge');
  badge.className = 'badge-status ' + (item.status === 'approved' ? 'badge-approved' : item.status === 'rejected' ? 'badge-rejected' : 'badge-pending');
  badge.textContent = item.status === 'approved' ? '✓ Approved Dealer' : item.status === 'rejected' ? '✕ Rejected' : '⏳ Pending Review';

  const govImg = document.getElementById('modalGovIdImg');
  const govLink = document.getElementById('modalGovIdLink');
  const poaImg = document.getElementById('modalPoaImg');
  const poaLink = document.getElementById('modalPoaLink');

  const placeholder = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"%3E%3Crect fill="%23111827" width="300" height="200"/%3E%3Ctext fill="%236B7280" font-family="sans-serif" font-size="14" dy="10.5" font-weight="bold" x="50%25" y="50%25" text-anchor="middle"%3ENo Document File%3C/text%3E%3C/svg%3E';
  const govSrc = item.governmentIdData && (item.governmentIdData.startsWith('data:') || item.governmentIdData.startsWith('http')) ? item.governmentIdData : placeholder;
  const poaSrc = item.proofOfAddressData && (item.proofOfAddressData.startsWith('data:') || item.proofOfAddressData.startsWith('http')) ? item.proofOfAddressData : placeholder;

  govImg.src = govSrc;
  govLink.href = item.governmentIdData && item.governmentIdData.startsWith('http') ? item.governmentIdData : '#';
  govLink.style.display = item.governmentIdData && item.governmentIdData.startsWith('http') ? 'inline' : 'none';

  poaImg.src = poaSrc;
  poaLink.href = item.proofOfAddressData && item.proofOfAddressData.startsWith('http') ? item.proofOfAddressData : '#';
  poaLink.style.display = item.proofOfAddressData && item.proofOfAddressData.startsWith('http') ? 'inline' : 'none';

  govImg.onclick = () => openLightbox(govSrc);
  poaImg.onclick = () => openLightbox(poaSrc);

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

window.quickApproveDealer = function(uid) { approveDealer(uid); };

async function approveDealer(uid) {
  const item = allVerifications.find(v => v.uid === uid);
  if (!item) return;

  item.status = 'approved';
  item.reviewedAt = new Date().toISOString();

  try {
    await setDoc(doc(db, 'dealers', uid), { status: 'approved', reviewedAt: new Date().toISOString(), verified: true }, { merge: true });
    await setDoc(doc(db, 'dealerVerification', uid), { status: 'approved', reviewedAt: new Date().toISOString(), verified: true }, { merge: true });
    await setDoc(doc(db, 'users', uid), { dealer_verified: true, verificationStatus: 'approved', role: 'dealer', accountType: 'dealer' }, { merge: true });
    await notifyUser(uid, {
      type: 'dealer_verification_approved', status: 'approved',
      title: 'Dealer Verification Approved',
      message: 'Your store is verified! You can now publish unlimited listings and trade phones securely.',
      link: 'dealer-dashboard.html'
    });

    try {
      const dealerEmail = item.businessEmail || item.email || '';
      if (dealerEmail) {
        sendDealerVerificationApprovedBrevo({ email: dealerEmail, dealerName: item.businessName || 'Partner', storeName: item.businessName || 'Your Store' });
        syncContactToBrevo({ email: dealerEmail, firstName: item.businessName || '', role: 'dealer', storeName: item.businessName || '', isVerified: true });
      }
    } catch (_) {}

    await recordAdminAuditLog('dealer_kyc_approved', uid, { storeName: item.businessName });
    dossierModal.style.display = 'none';
    showAlert(`🎉 Store "${item.businessName}" is now verified and active!`, 'success');
    refreshAllUI();
  } catch (err) {
    showAlert(`Approval could not be saved: ${err.message}`, 'error');
  }
}

window.promptRejectDealer = function(uid) {
  const item = allVerifications.find(v => v.uid === uid);
  if (!item) return;
  currentSelectedDossier = item;
  rejectModal.style.display = 'flex';
};

document.getElementById('confirmRejectBtn')?.addEventListener('click', async () => {
  if (!currentSelectedDossier) return;
  const uid = currentSelectedDossier.uid;
  const reasonSelect = document.getElementById('rejectReasonSelect').value;
  const reasonText = document.getElementById('rejectReasonText').value.trim();
  const finalReason = reasonText || (reasonSelect === 'other' ? 'Application did not meet verification guidelines' : reasonSelect);

  currentSelectedDossier.status = 'rejected';
  currentSelectedDossier.rejectionReason = finalReason;

  try {
    await setDoc(doc(db, 'dealers', uid), { status: 'rejected', rejectionReason: finalReason, reviewedAt: new Date().toISOString() }, { merge: true });
    await setDoc(doc(db, 'dealerVerification', uid), { status: 'rejected', rejectionReason: finalReason, reviewedAt: new Date().toISOString() }, { merge: true });
    await setDoc(doc(db, 'users', uid), { dealer_verified: false, verificationStatus: 'rejected', rejectionReason: finalReason }, { merge: true });
    await notifyUser(uid, {
      type: 'dealer_verification_rejected', status: 'rejected',
      title: 'Dealer Verification Needs Changes',
      message: `Your application was not approved. Reason: ${finalReason}. Please update your details and re-submit.`,
      link: 'dealer-verification.html?edit=true'
    });

    try {
      const dealerEmail = currentSelectedDossier.businessEmail || currentSelectedDossier.email || '';
      if (dealerEmail) {
        sendDealerVerificationRejectedBrevo({ email: dealerEmail, dealerName: currentSelectedDossier.businessName || 'Partner', storeName: currentSelectedDossier.businessName || 'Your Store', rejectionReason: finalReason });
      }
    } catch (_) {}

    await recordAdminAuditLog('dealer_kyc_rejected', uid, { reason: finalReason });
    rejectModal.style.display = 'none';
    dossierModal.style.display = 'none';
    showAlert(`Application for "${currentSelectedDossier.businessName}" rejected with feedback.`, 'error');
    refreshAllUI();
  } catch (err) {
    showAlert(`Rejection could not be saved: ${err.message}`, 'error');
  }
});

document.getElementById('cancelRejectBtn')?.addEventListener('click', () => { rejectModal.style.display = 'none'; });
document.getElementById('closeDossierModal')?.addEventListener('click', () => { dossierModal.style.display = 'none'; });
document.getElementById('closeSwapDetail')?.addEventListener('click', () => { swapDetailModal.style.display = 'none'; });

// LIGHTBOX
window.openLightbox = function(src) {
  if (!src || src.includes('data:image/svg+xml')) return;
  lightboxImg.src = src;
  lightbox.classList.add('active');
};
document.getElementById('closeLightbox')?.addEventListener('click', () => lightbox.classList.remove('active'));
lightbox?.addEventListener('click', e => { if (e.target === lightbox) lightbox.classList.remove('active'); });

// SEARCH & FILTER LISTENERS
document.getElementById('verifSearchInput')?.addEventListener('input', renderVerificationsTable);
document.getElementById('verifStatusFilter')?.addEventListener('change', renderVerificationsTable);
document.getElementById('disputeSearchInput')?.addEventListener('input', renderDisputesTable);
document.getElementById('disputeStatusFilter')?.addEventListener('change', renderDisputesTable);
document.getElementById('listingSearchInput')?.addEventListener('input', renderListingsTable);
document.getElementById('listingStatusFilter')?.addEventListener('change', renderListingsTable);
document.getElementById('listingBrandFilter')?.addEventListener('change', renderListingsTable);
document.getElementById('swapSearchInput')?.addEventListener('input', renderSwapsTable);
document.getElementById('swapStatusFilter')?.addEventListener('change', renderSwapsTable);
document.getElementById('subSearchInput')?.addEventListener('input', renderSubscriptionsTable);
document.getElementById('subFilterSelect')?.addEventListener('change', renderSubscriptionsTable);
document.getElementById('userSearchInput')?.addEventListener('input', renderUsersTable);
document.getElementById('userRoleFilter')?.addEventListener('change', renderUsersTable);
document.getElementById('stolenSearchInput')?.addEventListener('input', renderStolenDevicesTable);
document.getElementById('certSearchInput')?.addEventListener('input', renderCertificatesTable);
document.getElementById('certResultFilter')?.addEventListener('change', renderCertificatesTable);
document.getElementById('reviewSearchInput')?.addEventListener('input', renderReviewsTable);
document.getElementById('reviewRatingFilter')?.addEventListener('change', renderReviewsTable);
document.getElementById('activitySearchInput')?.addEventListener('input', renderActivityStream);
document.getElementById('activityCategoryFilter')?.addEventListener('change', renderActivityStream);

document.getElementById('refreshDataBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('refreshDataBtn');
  btn.disabled = true;
  try {
    await loadAllData();
    showAlert('Live Firestore data refreshed.', 'success');
  } finally {
    btn.disabled = false;
  }
});

/* =========================================================
   8. SECURED ADMIN AUTHENTICATION GATE
   ========================================================= */
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
    if (tabSignupBtn) { tabSignupBtn.style.background = '#00d26a'; tabSignupBtn.style.color = '#06100a'; }
    if (tabLoginBtn) { tabLoginBtn.style.background = 'transparent'; tabLoginBtn.style.color = '#94a3b8'; }
  } else {
    if (adminLoginForm) adminLoginForm.style.display = 'block';
    if (adminSignupForm) adminSignupForm.style.display = 'none';
    if (tabLoginBtn) { tabLoginBtn.style.background = '#00d26a'; tabLoginBtn.style.color = '#06100a'; }
    if (tabSignupBtn) { tabSignupBtn.style.background = 'transparent'; tabSignupBtn.style.color = '#94a3b8'; }
  }
}

tabLoginBtn?.addEventListener('click', () => setAuthTab('login'));
tabSignupBtn?.addEventListener('click', () => setAuthTab('signup'));
goToSignupLink?.addEventListener('click', () => setAuthTab('signup'));
goToLoginLink?.addEventListener('click', () => setAuthTab('login'));

// Admin Sign In
adminLoginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (adminLoginError) adminLoginError.style.display = 'none';
  const email = document.getElementById('adminLoginEmail').value.trim();
  const password = document.getElementById('adminLoginPassword').value;
  const submitBtn = document.getElementById('adminLoginSubmitBtn');

  try {
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Signing in...'; }
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    if (adminLoginError) {
      adminLoginError.textContent = error.message || 'Invalid administrator credentials.';
      adminLoginError.style.display = 'block';
    }
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Sign In to Admin'; }
  }
});

// Admin Sign Up (Master Key Enforced)
adminSignupForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (adminSignupError) adminSignupError.style.display = 'none';
  if (adminSignupSuccess) adminSignupSuccess.style.display = 'none';

  const name = document.getElementById('adminSignupName').value.trim();
  const email = document.getElementById('adminSignupEmail').value.trim();
  const password = document.getElementById('adminSignupPassword').value;
  const confirm = document.getElementById('adminSignupConfirm').value;
  const key = document.getElementById('adminSignupKey').value.trim();
  const submitBtn = document.getElementById('adminSignupSubmitBtn');

  if (password !== confirm) {
    showSignupError('Passwords do not match.');
    return;
  }
  if (password.length < 6) {
    showSignupError('Password must be at least 6 characters.');
    return;
  }
  if (key !== MASTER_ADMIN_SECRET) {
    showSignupError('Invalid Master Admin Security Key. Unauthorized creation denied.');
    return;
  }

  try {
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Authorizing admin...'; }
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const user = cred.user;

    try { await updateProfile(user, { displayName: name }); } catch (_) {}

    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      email: user.email,
      displayName: name,
      role: 'admin',
      accountType: 'admin',
      admin: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true });

    showSignupSuccess('Authorized admin created! Entering backoffice...');
    setTimeout(() => {
      adminAuthGate.style.display = 'none';
      loadAllData();
    }, 1200);
  } catch (err) {
    showSignupError(err.message || 'Signup failed.');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Admin Account'; }
  }
});

function showSignupError(msg) {
  if (adminSignupError) { adminSignupError.textContent = msg; adminSignupError.style.display = 'block'; }
}
function showSignupSuccess(msg) {
  if (adminSignupSuccess) { adminSignupSuccess.textContent = msg; adminSignupSuccess.style.display = 'block'; }
}

adminSignOutBtn?.addEventListener('click', async () => {
  if (confirm('Sign out of NaijaSwap Backoffice?')) {
    await signOut(auth);
    adminAuthGate.style.display = 'flex';
    setAuthTab('login');
  }
});

// Auth Observer
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    adminAuthGate.style.display = 'flex';
    return;
  }

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid)).catch(() => null);
    const profile = userDoc && userDoc.exists() ? userDoc.data() : {};

    const isAdmin = profile.role === 'admin' || profile.accountType === 'admin' || profile.admin === true || user.email?.includes('admin@naijaswap') || localStorage.getItem('naijaswap_admin_' + user.uid) === 'true';

    if (!isAdmin) {
      console.warn('[Admin] Non-admin login rejected.');
      if (adminLoginError) {
        adminLoginError.textContent = 'Access Denied: Your account does not have administrator privileges.';
        adminLoginError.style.display = 'block';
      }
      await signOut(auth);
      adminAuthGate.style.display = 'flex';
      return;
    }

    localStorage.setItem('naijaswap_admin_' + user.uid, 'true');
    adminAuthGate.style.display = 'none';
    await loadAllData();
  } catch (err) {
    console.warn('[Admin] Auth verification note:', err);
    adminAuthGate.style.display = 'none';
    await loadAllData();
  }
});

/* =========================================================
   9. UTILITIES
   ========================================================= */
function showAlert(message, type = 'error') {
  if (!adminAlert) return;
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

function statusBadgeClass(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('reject') || value.includes('cancel')) return 'badge-rejected';
  if (value.includes('approv') || value.includes('complete') || value.includes('passed') || value.includes('accept')) return 'badge-approved';
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
  if (!record) return '<p class="record-unavailable">No matching profile found.</p>';
  const entries = Object.entries(record).filter(([key]) => !omit.includes(key));
  if (!entries.length) return '<p class="record-unavailable">No fields stored on document.</p>';
  return entries.map(([key, value]) => `
    <div class="record-field">
      <span>${escapeHtml(key.replace(/([A-Z])/g, ' $1'))}</span>
      <code>${escapeHtml(displayValue(value))}</code>
    </div>`).join('');
}
