import {
  collection,
  db,
  doc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  auth,
  sendPasswordResetEmail
} from "./firebase-config.js";

async function readCollection(name, idField = "id") {
  try {
    const snapshot = await getDocs(collection(db, name));
    return snapshot.docs.map(document => ({
      ...document.data(),
      [idField]: document.id,
      id: document.id
    }));
  } catch (error) {
    console.warn(`[Admin Data] Could not read collection "${name}":`, error.message);
    return [];
  }
}

export async function fetchAdminData() {
  const collectionNames = [
    ["users", "uid"],
    ["dealers", "uid"],
    ["dealerProfiles", "uid"],
    ["dealerVerification", "uid"],
    ["dealerSubscriptions", "uid"],
    ["listings", "id"],
    ["marketplace_listings", "id"],
    ["swapperListings", "id"],
    ["swapRequests", "id"],
    ["stolenDevices", "imei"],
    ["reviews", "id"],
    ["inspectionCertificates", "reportId"],
    ["auditLogs", "id"]
  ];

  const results = await Promise.allSettled(
    collectionNames.map(([name, idField]) => readCollection(name, idField))
  );

  const raw = {};
  const errors = [];

  collectionNames.forEach(([name], idx) => {
    const res = results[idx];
    if (res.status === "fulfilled") {
      raw[name] = res.value || [];
    } else {
      raw[name] = [];
      errors.push({ collection: name, message: String(res.reason?.message || res.reason) });
    }
  });

  // 1. Build Unified Users Directory (merge from all collections so no user is missed)
  const usersMap = new Map();

  // Primary: from users collection
  (raw.users || []).forEach(u => {
    const uid = u.uid || u.id;
    if (!uid) return;
    usersMap.set(uid, {
      ...u,
      uid
    });
  });

  // Secondary: enrich & add from dealers collection
  (raw.dealers || []).forEach(d => {
    const uid = d.uid || d.id;
    if (!uid) return;
    const existing = usersMap.get(uid) || { uid };
    usersMap.set(uid, {
      ...existing,
      ...d,
      uid,
      storeName: d.storeName || d.shopName || d.businessName || existing.storeName,
      shopName: d.shopName || d.storeName || d.businessName || existing.shopName,
      businessName: d.businessName || d.storeName || d.shopName || existing.businessName,
      displayName: existing.displayName || d.displayName || d.name || d.storeName || d.businessName,
      email: existing.email || d.email || d.businessEmail,
      phoneNumber: existing.phoneNumber || d.phoneNumber || d.phone,
      role: existing.role === 'admin' ? 'admin' : 'dealer',
      accountType: existing.accountType === 'admin' ? 'admin' : 'dealer',
      isDealer: true,
      verified: d.verified === true || d.status === 'approved' || existing.verified,
      dealer_verified: d.verified === true || d.status === 'approved' || existing.dealer_verified,
      verificationStatus: d.status || existing.verificationStatus
    });
  });

  // Tertiary: enrich & add from dealerProfiles collection
  (raw.dealerProfiles || []).forEach(dp => {
    const uid = dp.uid || dp.id;
    if (!uid) return;
    const existing = usersMap.get(uid) || { uid };
    usersMap.set(uid, {
      ...existing,
      ...dp,
      uid,
      storeName: dp.storeName || dp.shopName || dp.businessName || existing.storeName,
      shopAddress: dp.shopAddress || dp.businessAddress || dp.address || existing.shopAddress,
      businessName: dp.businessName || dp.storeName || dp.shopName || existing.businessName,
      displayName: existing.displayName || dp.displayName || dp.storeName || dp.businessName,
      phoneNumber: existing.phoneNumber || dp.phoneNumber || dp.phone,
      role: existing.role === 'admin' ? 'admin' : 'dealer',
      accountType: existing.accountType === 'admin' ? 'admin' : 'dealer',
      isDealer: true
    });
  });

  // Quaternary: enrich & add from dealerVerification collection
  (raw.dealerVerification || []).forEach(dv => {
    const uid = dv.uid || dv.id;
    if (!uid) return;
    const existing = usersMap.get(uid) || { uid };
    const isApproved = dv.status === 'approved';
    usersMap.set(uid, {
      ...existing,
      ...dv,
      uid,
      businessName: dv.businessName || dv.storeName || dv.shopName || existing.businessName,
      shopName: dv.shopName || dv.businessName || dv.storeName || existing.shopName,
      storeName: dv.storeName || dv.businessName || dv.shopName || existing.storeName,
      displayName: existing.displayName || dv.businessName || dv.storeName || dv.displayName,
      email: existing.email || dv.businessEmail || dv.email,
      businessEmail: dv.businessEmail || existing.businessEmail || existing.email,
      phoneNumber: existing.phoneNumber || dv.phoneNumber || dv.phone,
      nin: dv.nin || existing.nin,
      bvn: dv.bvn || existing.bvn,
      cacNumber: dv.cacNumber || existing.cacNumber,
      shopAddress: dv.shopAddress || dv.address || existing.shopAddress,
      role: existing.role === 'admin' ? 'admin' : 'dealer',
      accountType: existing.accountType === 'admin' ? 'admin' : 'dealer',
      isDealer: true,
      verificationStatus: dv.status || existing.verificationStatus,
      status: dv.status || existing.status,
      verified: isApproved || existing.verified,
      dealer_verified: isApproved || existing.dealer_verified,
      submittedAt: dv.submittedAt || existing.submittedAt
    });
  });

  // From dealerSubscriptions
  (raw.dealerSubscriptions || []).forEach(sub => {
    const uid = sub.dealerUid || sub.uid || sub.id;
    if (!uid) return;
    const existing = usersMap.get(uid) || { uid };
    usersMap.set(uid, {
      ...existing,
      uid,
      role: existing.role === 'admin' ? 'admin' : 'dealer',
      accountType: existing.accountType === 'admin' ? 'admin' : 'dealer',
      isDealer: true,
      hasSubscription: true,
      subscriptionPlan: sub.plan || 'starter'
    });
  });

  // From swapRequests (find any customers or dealers referenced in requests)
  (raw.swapRequests || []).forEach(req => {
    if (req.customerUid) {
      const existing = usersMap.get(req.customerUid) || { uid: req.customerUid };
      usersMap.set(req.customerUid, {
        ...existing,
        email: existing.email || req.customerEmail,
        phoneNumber: existing.phoneNumber || req.customerPhone,
        role: existing.role || 'customer',
        accountType: existing.accountType || 'customer'
      });
    }
    if (req.dealerUid) {
      const existing = usersMap.get(req.dealerUid) || { uid: req.dealerUid };
      usersMap.set(req.dealerUid, {
        ...existing,
        role: existing.role || 'dealer',
        accountType: existing.accountType || 'dealer',
        isDealer: true
      });
    }
  });

  // From listings (find any sellers / dealers referenced in listings)
  [...(raw.listings || []), ...(raw.marketplace_listings || []), ...(raw.swapperListings || [])].forEach(l => {
    const sellerUid = l.sellerId || l.dealerUid || l.storeOwnerUid || l.storeId || l.userId;
    if (sellerUid) {
      const existing = usersMap.get(sellerUid) || { uid: sellerUid };
      usersMap.set(sellerUid, {
        ...existing,
        storeName: l.storeName || l.sellerName || existing.storeName,
        displayName: existing.displayName || l.sellerName || l.storeName,
        role: existing.role || (l.sellerType === 'dealer' ? 'dealer' : 'customer')
      });
    }
  });

  // 2. Build Unified Verifications Map
  const verificationsMap = new Map();

  (raw.dealerVerification || []).forEach(record => {
    const uid = record.uid || record.userId || record.id;
    if (uid) verificationsMap.set(uid, { ...record, uid });
  });

  (raw.dealers || []).forEach(record => {
    const uid = record.uid || record.dealerId || record.id;
    if (!uid) return;
    const existing = verificationsMap.get(uid) || { uid };
    verificationsMap.set(uid, {
      ...existing,
      ...record,
      uid,
      businessName: record.storeName || record.businessName || record.shopName || existing.businessName,
      status: record.status || (record.verified ? 'approved' : existing.status || 'pending')
    });
  });

  (raw.dealerProfiles || []).forEach(record => {
    const uid = record.uid || record.id;
    if (!uid) return;
    const existing = verificationsMap.get(uid) || { uid };
    verificationsMap.set(uid, {
      ...existing,
      ...record,
      uid,
      businessName: record.storeName || record.businessName || existing.businessName,
      shopAddress: record.shopAddress || record.businessAddress || existing.shopAddress
    });
  });

  // Check users directory for dealers who submitted verification data
  usersMap.forEach(u => {
    if (u.role === 'dealer' || u.isDealer || u.verificationStatus || u.nin || u.bvn) {
      const existing = verificationsMap.get(u.uid);
      if (existing) {
        verificationsMap.set(u.uid, {
          businessEmail: u.email || existing.businessEmail,
          phoneNumber: u.phoneNumber || existing.phoneNumber,
          ...existing,
          businessName: existing.businessName || u.shopName || u.businessName || u.storeName || u.displayName,
          status: existing.status || u.verificationStatus || (u.dealer_verified ? 'approved' : 'pending')
        });
      } else if (u.verificationStatus || u.nin || u.bvn || u.shopAddress) {
        verificationsMap.set(u.uid, {
          uid: u.uid,
          businessName: u.shopName || u.businessName || u.storeName || u.displayName || 'Store Dealer',
          businessEmail: u.email || '',
          phoneNumber: u.phoneNumber || '',
          nin: u.nin || '',
          bvn: u.bvn || '',
          shopAddress: u.shopAddress || u.address || '',
          status: u.verificationStatus || (u.dealer_verified ? 'approved' : 'pending'),
          submittedAt: u.verificationSubmittedAt || u.updatedAt || u.createdAt || new Date().toISOString()
        });
      }
    }
  });

  // 3. Build Unified Listings Map
  const listingsMap = new Map();
  [...(raw.listings || []), ...(raw.marketplace_listings || []), ...(raw.swapperListings || [])].forEach(l => {
    const id = l.id || l.listingId;
    if (id && !listingsMap.has(id)) {
      listingsMap.set(id, { ...l, id });
    }
  });

  // 4. Stolen Devices List
  const stolenDevices = (raw.stolenDevices || []).map(d => ({
    imei: d.imei || d.id,
    ...d
  }));

  // 5. Reviews List
  const reviews = raw.reviews || [];

  // 6. Inspection Certificates List
  const certificates = raw.inspectionCertificates || [];

  // 7. Audit Logs List
  const auditLogs = raw.auditLogs || [];

  return {
    users: [...usersMap.values()],
    listings: [...listingsMap.values()],
    swaps: raw.swapRequests || [],
    verifications: [...verificationsMap.values()],
    subscriptions: raw.dealerSubscriptions || [],
    stolenDevices,
    reviews,
    certificates,
    auditLogs,
    errors
  };
}

export function updateSwapStatus(id, status) {
  return updateDoc(doc(db, "swapRequests", id), {
    status,
    updatedAt: new Date().toISOString()
  });
}

export async function resolveSwapDispute(id, resolution, status, notes = "", adminUser = null) {
  const updateData = {
    disputeStatus: "resolved",
    disputeResolution: resolution,
    disputeResolutionNotes: notes,
    disputeResolvedAt: new Date().toISOString(),
    disputeResolvedBy: adminUser?.email || adminUser?.uid || "admin",
    updatedAt: new Date().toISOString()
  };
  if (status) {
    updateData.status = status;
  }
  await setDoc(doc(db, "swapRequests", id), updateData, { merge: true });
}

export async function fetchSwapMessages(swapId) {
  try {
    const q = query(collection(db, "swapRequests", swapId, "messages"), orderBy("createdAt", "asc"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.warn(`[Admin Data] Could not read swap messages for "${swapId}":`, error.message);
    return [];
  }
}

export async function sendAdminSwapMessage(swapId, text, adminName = "NaijaSwap Desk", adminUid = "admin") {
  const messageData = {
    requestId: swapId,
    senderUid: adminUid,
    senderRole: "admin",
    senderName: adminName,
    text: String(text).trim(),
    type: "admin_notice",
    createdAt: new Date().toISOString()
  };
  return addDoc(collection(db, "swapRequests", swapId, "messages"), messageData);
}

export function setUserSuspended(uid, suspended) {
  return setDoc(doc(db, "users", uid), {
    adminSuspended: suspended,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

export function updateUserRole(uid, role, accountType = null) {
  const data = {
    role,
    accountType: accountType || role,
    updatedAt: new Date().toISOString()
  };
  return setDoc(doc(db, "users", uid), data, { merge: true });
}

export function sendPasswordReset(email) {
  return sendPasswordResetEmail(auth, email);
}

export function setListingFlagged(id, flagged) {
  return setDoc(doc(db, "listings", id), {
    adminFlagged: flagged,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

export function setListingStatus(id, status) {
  return setDoc(doc(db, "listings", id), {
    status,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

export function deleteListing(id) {
  return deleteDoc(doc(db, "listings", id));
}

export async function addStolenDevice(imei, data = {}) {
  const cleanImei = String(imei).trim().replace(/\s+/g, '');
  const record = {
    imei: cleanImei,
    brand: data.brand || "Unknown",
    model: data.model || "Unknown",
    description: data.description || "",
    reportedBy: data.reportedBy || "Law Enforcement / Police Report",
    policeReportNumber: data.policeReportNumber || "",
    status: "blacklisted",
    createdAt: new Date().toISOString(),
    reportedAt: data.reportedAt || new Date().toISOString()
  };
  await setDoc(doc(db, "stolenDevices", cleanImei), record);
  return record;
}

export async function removeStolenDevice(imei) {
  const cleanImei = String(imei).trim().replace(/\s+/g, '');
  await setDoc(doc(db, "stolenDevices", cleanImei), {
    status: "cleared",
    clearedAt: new Date().toISOString()
  }, { merge: true });
}

export async function grantDealerSubscription(dealerUid, durationMonths = 1, notes = "") {
  const now = new Date();
  const endDate = new Date(now.getTime() + durationMonths * 30 * 24 * 60 * 60 * 1000);
  const subData = {
    dealerUid,
    plan: "premium",
    status: "active",
    amount: 9900,
    currency: "NGN",
    startDate: now.toISOString(),
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: endDate.toISOString(),
    nextBillingDate: endDate.toISOString(),
    isManualGrant: true,
    adminNotes: notes || `Granted ${durationMonths} month(s) by administrator`,
    updatedAt: now.toISOString()
  };
  await setDoc(doc(db, "dealerSubscriptions", dealerUid), subData, { merge: true });
  await setDoc(doc(db, "users", dealerUid), {
    dealerPlan: "premium",
    isPremiumDealer: true,
    updatedAt: now.toISOString()
  }, { merge: true });
  return subData;
}

export async function cancelDealerSubscription(dealerUid) {
  const now = new Date().toISOString();
  await setDoc(doc(db, "dealerSubscriptions", dealerUid), {
    plan: "starter",
    status: "cancelled",
    cancelledAt: now,
    updatedAt: now
  }, { merge: true });
  await setDoc(doc(db, "users", dealerUid), {
    dealerPlan: "starter",
    isPremiumDealer: false,
    updatedAt: now
  }, { merge: true });
}

export function deleteReview(reviewId) {
  return deleteDoc(doc(db, "reviews", reviewId));
}

export async function recordAdminAuditLog(action, target, details = {}, adminEmail = "") {
  try {
    await addDoc(collection(db, "auditLogs"), {
      action,
      target,
      details,
      adminEmail: adminEmail || auth.currentUser?.email || "admin",
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    console.warn("[Admin Data] Could not record audit log:", err.message);
  }
}
