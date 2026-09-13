/**
 * NaijaSwap - Client-Side Authentication Controller
 * Connects directly to Firebase Authentication modular SDK v12.18.0
 */

import {
  auth,
  googleProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged
} from './firebase-config.js';
import { db, doc, getDoc, setDoc } from './firebase-config.js';

export { auth };

const DEFAULT_ROLE = "customer";
const ROLE_LOOKUP_TIMEOUT_MS = 5000;
const MAX_SESSION_LOGS = 60;

/* ==========================================================================
   PERSISTENT CONSOLE & DIAGNOSTIC LOGGER
   ========================================================================== */
export function logNaijaSwap(level, category, message, data = null) {
  const timestamp = new Date().toLocaleTimeString();
  const fullTimestamp = new Date().toISOString();
  const entry = {
    timestamp: fullTimestamp,
    time: timestamp,
    level,
    category,
    message,
    data,
    path: window.location.pathname
  };

  // Console styles based on category/level
  const categoryBadge = `[NaijaSwap ${category}]`;
  const isError = level === "error";
  const isWarn = level === "warn";
  const color = isError ? "#ef4444" : isWarn ? "#f59e0b" : category === "Dealer" ? "#06b6d4" : "#10b981";

  if (data !== null && data !== undefined) {
    console[level](`%c${categoryBadge}%c [${timestamp}] ${message}`, `color: ${color}; font-weight: bold;`, "color: inherit;", data);
  } else {
    console[level](`%c${categoryBadge}%c [${timestamp}] ${message}`, `color: ${color}; font-weight: bold;`, "color: inherit;");
  }

  // Persist to session storage so logs survive page redirects and reloads
  try {
    const raw = sessionStorage.getItem("naijaswap_session_logs");
    const logs = raw ? JSON.parse(raw) : [];
    logs.push(entry);
    if (logs.length > MAX_SESSION_LOGS) logs.shift();
    sessionStorage.setItem("naijaswap_session_logs", JSON.stringify(logs));
  } catch (_) {}
}

// Print prior session logs across redirects
export function printPriorSessionLogs() {
  try {
    const raw = sessionStorage.getItem("naijaswap_session_logs");
    if (!raw) return;
    const logs = JSON.parse(raw);
    if (logs.length === 0) return;
    
    // Check if there are logs from a previous navigation
    const currentPath = window.location.pathname;
    const previousLogs = logs.filter(l => l.path !== currentPath);
    if (previousLogs.length > 0) {
      console.groupCollapsed(`%c📜 [NaijaSwap] Recent Cross-Page Navigation Logs (${previousLogs.length} events)`, "color: #06b6d4; font-weight: bold;");
      previousLogs.forEach(l => {
        const color = l.level === "error" ? "#ef4444" : l.level === "warn" ? "#f59e0b" : "#94a3b8";
        console.log(`%c[${l.time}] [${l.category}] (${l.path}) ${l.message}`, `color: ${color};`, l.data || "");
      });
      console.groupEnd();
    }
  } catch (_) {}
}

// Expose helpful debugging methods in browser console
if (typeof window !== "undefined") {
  window.__naijaswap_logs = () => {
    try {
      return JSON.parse(sessionStorage.getItem("naijaswap_session_logs") || "[]");
    } catch (_) {
      return [];
    }
  };
}

function recordAuthDiagnostic(event, details = {}) {
  const diagnostic = {
    event,
    path: window.location.pathname,
    timestamp: new Date().toISOString(),
    ...details
  };
  logNaijaSwap("warn", "Auth", `Auth Event: ${event}`, details);
  try {
    localStorage.setItem("naijaswap_auth_diagnostic", JSON.stringify(diagnostic));
  } catch (storageError) {
    logNaijaSwap("error", "Auth", "Could not persist diagnostic.", storageError);
  }
}

function showDealerAuthDiagnostic(message, options = {}) {
  const diagnostic = document.getElementById("dealerAuthDiagnostic");
  if (diagnostic) {
    diagnostic.hidden = false;
    diagnostic.style.display = "block";
    if (typeof options.html === "string") {
      diagnostic.innerHTML = options.html;
    } else {
      diagnostic.textContent = message;
    }
  }
}

function normalizeRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized === "dealer" || normalized === "store" || normalized === "seller" || normalized === "partner"
    ? "dealer"
    : DEFAULT_ROLE;
}

export function isCurrentRoute(...routeNames) {
  if (typeof window === "undefined" || !window.location) return false;
  const currentPath = (window.location.pathname || "").toLowerCase().replace(/\/$/, "");
  const segments = currentPath.split("/");
  const lastSegment = segments[segments.length - 1] || "";
  const baseName = lastSegment.replace(/\.html$/, "");

  return routeNames.some(name => {
    const targetBase = name.toLowerCase().replace(/\.html$/, "");
    return baseName === targetBase;
  });
}

export async function saveUserRole(user, role, shopName = "") {
  if (!user || !user.uid) return;
  const requestedRole = normalizeRole(role);

  // Guard: Once a user has signed up, their role is PERMANENT and IMMUTABLE.
  // Check if this user already has an existing role in local storage or Firestore.
  let establishedRole = null;
  const cachedRole = localStorage.getItem("naijaswap_role_" + user.uid);
  if (cachedRole) {
    establishedRole = normalizeRole(cachedRole);
  }

  try {
    const userDocRef = doc(db, "users", user.uid);
    const snap = await getDoc(userDocRef);
    if (snap && snap.exists()) {
      const data = snap.data();
      const firestoreRole = normalizeRole(data.accountType || data.role);
      if (firestoreRole) {
        establishedRole = firestoreRole;
      }
    }
  } catch (_) {}

  // If a role is already established for this user, do not allow switching!
  const finalRole = establishedRole || requestedRole;

  localStorage.setItem("naijaswap_role_" + user.uid, finalRole);
  localStorage.setItem("naijaswap_last_role", finalRole);
  if (finalRole === "dealer" && shopName) {
    localStorage.setItem("naijaswap_shop_" + user.uid, shopName);
  }

  logNaijaSwap("info", "Auth", `User ${user.uid} locked to permanent role "${finalRole}".`);

  // Persist to Firestore asynchronously
  try {
    const userDocRef = doc(db, "users", user.uid);
    await setDoc(userDocRef, {
      uid: user.uid,
      accountType: finalRole,
      role: finalRole,
      email: user.email || "",
      displayName: user.displayName || "",
      phoneNumber: user.phoneNumber || "",
      ...(shopName && finalRole === "dealer" ? { shopName } : {})
    }, { merge: true });
  } catch (err) {
    logNaijaSwap("warn", "Auth", `Firestore role sync note: ${err.message}`);
  }
}

export async function getUserRole(user) {
  if (!user || !user.uid) return DEFAULT_ROLE;

  // 1. Primary Source of Truth: Check Firestore user document
  try {
    const userRef = doc(db, "users", user.uid);
    const snapshot = await Promise.race([
      getDoc(userRef),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Lookup timeout")), ROLE_LOOKUP_TIMEOUT_MS))
    ]);
    if (snapshot && snapshot.exists()) {
      const data = snapshot.data();
      const storedRole = normalizeRole(data.accountType || data.role);
      if (data.shopName) localStorage.setItem("naijaswap_shop_" + user.uid, data.shopName);
      localStorage.setItem("naijaswap_role_" + user.uid, storedRole);
      localStorage.setItem("naijaswap_last_role", storedRole);
      logNaijaSwap("info", "Auth", `Resolved permanent role from Firestore: "${storedRole}"`);
      return storedRole;
    }
  } catch (err) {
    logNaijaSwap("info", "Auth", `Firestore role lookup note: ${err.message}`);
  }

  // 2. Direct local role cache for this specific UID
  const cachedRole = localStorage.getItem("naijaswap_role_" + user.uid);
  if (cachedRole) {
    const norm = normalizeRole(cachedRole);
    logNaijaSwap("info", "Auth", `Resolved permanent role from local cache: "${norm}"`);
    return norm;
  }

  // 3. Check pending role from initial signup
  const pendingRole = localStorage.getItem("naijaswap_role_pending") || sessionStorage.getItem("pending_signup_role");
  if (pendingRole) {
    const norm = normalizeRole(pendingRole);
    localStorage.setItem("naijaswap_role_" + user.uid, norm);
    localStorage.setItem("naijaswap_last_role", norm);
    localStorage.removeItem("naijaswap_role_pending");
    sessionStorage.removeItem("pending_signup_role");
    logNaijaSwap("info", "Auth", `Resolved role from pending signup: "${norm}"`);
    return norm;
  }

  // 4. Fallback default
  return DEFAULT_ROLE;
}

export function isValidRedirectTarget(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const targetUrl = new URL(url, window.location.origin);
    const path = targetUrl.pathname.toLowerCase().replace(/\/$/, "");
    const lastSeg = path.split("/").pop() || "";
    const base = lastSeg.replace(/\.html$/, "");
    if (!base || ["login", "signup", "phone-auth"].includes(base)) {
      return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

export async function redirectUserAfterAuth(user) {
  if (!user || !user.uid) return;
  try {
    const userRole = await getUserRole(user);
    const redirect = sessionStorage.getItem("post_login_redirect");
    sessionStorage.removeItem("post_login_redirect");

    if (isValidRedirectTarget(redirect)) {
      logNaijaSwap("info", "Auth", `Redirecting authenticated user to saved destination: ${redirect}`);
      window.location.assign(redirect);
      return;
    }

    const target = userRole === "dealer" ? "/dealer-dashboard.html" : "/dashboard.html";
    logNaijaSwap("info", "Auth", `Redirecting authenticated ${userRole} to ${target}`);
    console.log(`[NaijaSwap Auth] Redirecting ${user.uid} (${userRole}) to ${target}`);
    window.location.assign(target);
  } catch (err) {
    console.error("[NaijaSwap Auth] Error during post-auth redirection:", err);
    window.location.assign("/dashboard.html");
  }
}

/* ==========================================================================
   1. USER-FRIENDLY ERROR TRANSLATOR
   ========================================================================== */
export function mapAuthError(error) {
  if (!error) return "An unexpected error occurred. Please try again.";
  const code = error.code || "";

  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "Incorrect email or password. Please verify your credentials.";
    case "auth/user-not-found":
      return "No account found with this email. Please check your spelling or sign up.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Please log in instead.";
    case "auth/weak-password":
      return "Password is too weak. Please use at least 6 characters.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/missing-password":
      return "Please enter your password.";
    case "auth/invalid-phone-number":
      return "Invalid phone number format. Please ensure the country code and digits are correct.";
    case "auth/missing-verification-code":
      return "Please enter the 6-digit SMS verification code.";
    case "auth/invalid-verification-code":
      return "Incorrect verification code. Please check your SMS and try again.";
    case "auth/code-expired":
      return "This verification code has expired. Please request a new code.";
    case "auth/too-many-requests":
      return "Too many attempts. Access is temporarily disabled to protect your account. Please wait a few minutes.";
    case "auth/popup-closed-by-user":
      return "Google sign-in was closed before completing.";
    case "auth/cancelled-popup-request":
      return "Only one sign-in window can be open at a time.";
    case "auth/popup-blocked":
      return "Google sign-in popup was blocked by your browser. Please allow popups for this site.";
    case "auth/network-request-failed":
      return "Network error. Please check your internet connection.";
    case "auth/configuration-not-found":
      return "Firebase Authentication is not activated yet in this project. In Firebase Console, go to Build > Authentication, click 'Get started', and enable Email/Password, Google, and Phone under Sign-in method.";
    case "auth/operation-not-allowed":
      if (error.message && (error.message.includes("region") || error.message.includes("SMS unable to be sent"))) {
        return "SMS delivery to this country is restricted by your Firebase SMS Region Policy. In Firebase Console > Authentication > Settings > SMS region policy, enable Nigeria (+234), or add a test phone number under Authentication > Sign-in method > Phone.";
      }
      return "Phone authentication is not enabled in your Firebase Console. Please go to Authentication > Sign-in method in Firebase Console and enable Phone.";
    case "auth/invalid-app-credential":
    case "auth/app-not-authorized":
    case "auth/unauthorized-domain": {
      const isLoopbackIp = typeof window !== "undefined" && window.location && window.location.hostname === "127.0.0.1";
      if (isLoopbackIp) {
        const switchUrl = window.location.href.replace("//127.0.0.1", "//localhost");
        return `Domain <code>127.0.0.1</code> is not authorized by Firebase Auth.<br><a href="${switchUrl}" style="display:inline-block;margin-top:8px;padding:6px 14px;background:#38bdf8;color:#05080a;border-radius:6px;font-weight:700;text-decoration:none;">Switch to localhost:5500 &rarr;</a><br><small style="opacity:0.8;display:block;margin-top:6px;">Or add '127.0.0.1' in Firebase Console &gt; Authentication &gt; Settings &gt; Authorized domains.</small>`;
      }
      return `Domain (${window.location.hostname}) is not authorized in Firebase Console. Please add '${window.location.hostname}' to Firebase Console &gt; Authentication &gt; Settings &gt; Authorized domains.`;
    }
    case "auth/billing-not-enabled":
      return "SMS quota exceeded or billing required for real numbers. Please use a test phone number configured in Firebase Console.";
    case "auth/quota-exceeded":
      return "SMS quota reached. Please use Email or Google authentication, or test with a phone number configured under Phone numbers for testing in Firebase Console.";
    case "permission-denied":
    case "firestore/permission-denied":
      return "Firebase Firestore denied access. Create/enable Firestore Database and allow the signed-in user to access users/{userId}.";
    case "unavailable":
    case "firestore/timeout":
      return "Firebase Firestore is unavailable. Check your connection and make sure Firestore Database is enabled.";
    default:
      if (error.message && !error.message.includes("Firebase:")) {
        return error.message;
      }
      return "Authentication failed. Please verify your details and try again.";
  }
}

/* ==========================================================================
   2. UI HELPERS: BUTTON SPINNER & ALERTS
   ========================================================================== */
export function setButtonLoading(button, isLoading, loadingText = "Processing...") {
  if (!button) return;
  if (isLoading) {
    button.disabled = true;
    button.dataset.originalHtml = button.innerHTML;
    button.classList.add("is-loading");
    button.innerHTML = `
      <span class="btn-spinner" aria-hidden="true"></span>
      <span>${loadingText}</span>
    `;
  } else {
    button.disabled = false;
    button.classList.remove("is-loading");
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
    }
  }
}

export function showAuthAlert(containerId, message, type = "error") {
  const container = document.getElementById(containerId);
  if (!container) return;

  const iconSvg = type === "success"
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

  container.className = `auth-alert auth-alert-${type} visible`;
  container.innerHTML = `
    <div class="alert-icon">${iconSvg}</div>
    <div class="alert-message">${message}</div>
  `;
}

export function clearAuthAlert(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.className = "auth-alert";
  container.innerHTML = "";
}

/* ==========================================================================
   3. PASSWORD SHOW/HIDE TOGGLE
   ========================================================================== */
export function setupPasswordToggles() {
  const toggleBtns = document.querySelectorAll(".password-toggle-btn");
  toggleBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const input = btn.previousElementSibling;
      if (!input) return;

      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      btn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");

      const eyeIcon = btn.querySelector(".eye-icon");
      const eyeOffIcon = btn.querySelector(".eye-off-icon");
      if (eyeIcon && eyeOffIcon) {
        eyeIcon.style.display = isPassword ? "none" : "block";
        eyeOffIcon.style.display = isPassword ? "block" : "none";
      }
    });
  });
}

/* ==========================================================================
   4. LOGIN PAGE CONTROLLER
   ========================================================================== */
export function initLoginForm() {
  const form = document.getElementById("loginForm");
  const googleBtn = document.getElementById("googleSignInBtn");
  const forgotPwLink = document.getElementById("forgotPasswordLink");
  const forgotPwModal = document.getElementById("forgotPasswordModal");
  const forgotPwForm = document.getElementById("forgotPasswordForm");
  const closeForgotModalBtn = document.getElementById("closeForgotModalBtn");

  // Email/Password Login
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAuthAlert("loginAlert");

      const email = document.getElementById("loginEmail")?.value.trim();
      const password = document.getElementById("loginPassword")?.value;
      const submitBtn = document.getElementById("loginSubmitBtn");

      if (!email || !password) {
        showAuthAlert("loginAlert", "Please enter both email and password.");
        return;
      }

      try {
        setButtonLoading(submitBtn, true, "Signing in...");
        const userCred = await signInWithEmailAndPassword(auth, email, password);
        await redirectUserAfterAuth(userCred.user);
      } catch (err) {
        setButtonLoading(submitBtn, false);
        showAuthAlert("loginAlert", mapAuthError(err));
      }
    });
  }

  // Google Sign-In
  if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
      clearAuthAlert("loginAlert");
      if (typeof window !== "undefined" && window.location && window.location.hostname === "127.0.0.1") {
        const localUrl = new URL(window.location.href);
        localUrl.hostname = "localhost";
        window.location.replace(localUrl.href);
        return;
      }
      try {
        setButtonLoading(googleBtn, true, "Connecting to Google...");
        console.log("[NaijaSwap Auth] Triggering signInWithPopup...");
        const result = await signInWithPopup(auth, googleProvider);
        console.log("[NaijaSwap Auth] Google sign-in success, UID:", result.user?.uid);
        await redirectUserAfterAuth(result.user);
      } catch (err) {
        console.error("[NaijaSwap Auth] Google sign-in failed:", err.code, err.message);
        setButtonLoading(googleBtn, false);
        showAuthAlert("loginAlert", mapAuthError(err));
      }
    });
  }

  // Forgot Password Modal
  if (forgotPwLink && forgotPwModal) {
    forgotPwLink.addEventListener("click", (e) => {
      e.preventDefault();
      clearAuthAlert("forgotPasswordAlert");
      const currentEmail = document.getElementById("loginEmail")?.value.trim();
      const forgotEmailInput = document.getElementById("forgotPasswordEmail");
      if (currentEmail && forgotEmailInput) {
        forgotEmailInput.value = currentEmail;
      }
      forgotPwModal.classList.add("active");
    });
  }

  if (closeForgotModalBtn && forgotPwModal) {
    closeForgotModalBtn.addEventListener("click", () => {
      forgotPwModal.classList.remove("active");
    });
  }

  if (forgotPwModal) {
    forgotPwModal.addEventListener("click", (e) => {
      if (e.target === forgotPwModal) {
        forgotPwModal.classList.remove("active");
      }
    });
  }

  if (forgotPwForm) {
    forgotPwForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAuthAlert("forgotPasswordAlert");
      const email = document.getElementById("forgotPasswordEmail")?.value.trim();
      const submitBtn = document.getElementById("sendResetLinkBtn");

      if (!email) {
        showAuthAlert("forgotPasswordAlert", "Please enter your email address.");
        return;
      }

      try {
        setButtonLoading(submitBtn, true, "Sending reset email...");
        await sendPasswordResetEmail(auth, email);
        setButtonLoading(submitBtn, false);
        showAuthAlert("forgotPasswordAlert", "Password reset email sent! Check your inbox and spam folder.", "success");
        setTimeout(() => {
          forgotPwModal.classList.remove("active");
        }, 3500);
      } catch (err) {
        setButtonLoading(submitBtn, false);
        showAuthAlert("forgotPasswordAlert", mapAuthError(err));
      }
    });
  }
}

/* ==========================================================================
   5. SIGNUP PAGE CONTROLLER (WITH ROLE SELECTION)
   ========================================================================== */
export function initSignupForm() {
  const form = document.getElementById("signupForm");
  const googleBtn = document.getElementById("googleSignUpBtn");
  const roleBtnCustomer = document.getElementById("roleBtnCustomer");
  const roleBtnDealer = document.getElementById("roleBtnDealer");
  const roleInput = document.getElementById("selectedRoleInput");
  const dealerShopField = document.getElementById("dealerShopField");
  const authRoleBadge = document.getElementById("authRoleBadge");
  const authSubtitle = document.getElementById("authSubtitle");
  const googleBtnText = document.getElementById("googleBtnText");

  // Role switching function
  function setSignupRole(role) {
    const isDealer = role === "dealer";
    if (roleInput) roleInput.value = isDealer ? "dealer" : "customer";
    sessionStorage.setItem("pending_signup_role", isDealer ? "dealer" : "customer");

    if (roleBtnCustomer) {
      roleBtnCustomer.classList.toggle("active", !isDealer);
      roleBtnCustomer.setAttribute("aria-selected", (!isDealer).toString());
    }
    if (roleBtnDealer) {
      roleBtnDealer.classList.toggle("active", isDealer);
      roleBtnDealer.setAttribute("aria-selected", isDealer.toString());
    }

    if (dealerShopField) {
      dealerShopField.style.display = isDealer ? "block" : "none";
    }

    if (authRoleBadge) {
      authRoleBadge.textContent = isDealer ? "Verified Store / Dealer Account" : "Swapper Account";
    }

    if (authSubtitle) {
      authSubtitle.textContent = isDealer
        ? "List phone stock & connect with active phone swappers across Nigeria"
        : "Join thousands of Nigerians exchanging phones safely";
    }

    if (googleBtnText) {
      googleBtnText.textContent = isDealer
        ? "Continue with Google as Store / Dealer"
        : "Continue with Google as Swapper";
    }
  }

  // Pre-select role from URL query param (?role=dealer or ?role=customer)
  if (roleBtnCustomer || roleBtnDealer) {
    const urlParams = new URLSearchParams(window.location.search);
    const initialRole = urlParams.get("role") === "dealer" ? "dealer" : "customer";
    setSignupRole(initialRole);

    if (roleBtnCustomer) {
      roleBtnCustomer.addEventListener("click", () => setSignupRole("customer"));
    }
    if (roleBtnDealer) {
      roleBtnDealer.addEventListener("click", () => setSignupRole("dealer"));
    }
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAuthAlert("signupAlert");

      const email = document.getElementById("signupEmail")?.value.trim();
      const password = document.getElementById("signupPassword")?.value;
      const confirmPassword = document.getElementById("signupConfirmPassword")?.value;
      const shopName = document.getElementById("signupShopName")?.value.trim();
      const selectedRole = roleInput?.value || "customer";
      const submitBtn = document.getElementById("signupSubmitBtn");

      // Validation
      if (!email || !password || !confirmPassword) {
        showAuthAlert("signupAlert", "Please fill in all fields.");
        return;
      }

      if (selectedRole === "dealer" && !shopName) {
        showAuthAlert("signupAlert", "Please enter your shop or business name.");
        return;
      }

      if (password.length < 6) {
        showAuthAlert("signupAlert", "Password must be at least 6 characters long.");
        return;
      }

      if (password !== confirmPassword) {
        showAuthAlert("signupAlert", "Passwords do not match. Please re-enter your password.");
        return;
      }

      try {
        setButtonLoading(submitBtn, true, "Creating account...");
        // Set this before Firebase emits auth state so the observer cannot default a dealer to customer.
        localStorage.setItem("naijaswap_role_pending", selectedRole);
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCred.user;

        // Persist user role
        await saveUserRole(user, selectedRole, shopName);
        localStorage.removeItem("naijaswap_role_pending");

        // Redirect based on role
        if (selectedRole === "dealer") {
          window.location.href = "dealer-dashboard.html";
        } else {
          window.location.href = "dashboard.html";
        }
      } catch (err) {
        setButtonLoading(submitBtn, false);
        showAuthAlert("signupAlert", err?.code?.startsWith("firestore/")
          ? "Account created, but the account type could not be saved. Enable Firestore Database and check its rules before signing in again."
          : mapAuthError(err));
      }
    });
  }

  // Google Sign-Up
  if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
      clearAuthAlert("signupAlert");
      if (typeof window !== "undefined" && window.location && window.location.hostname === "127.0.0.1") {
        const localUrl = new URL(window.location.href);
        localUrl.hostname = "localhost";
        window.location.replace(localUrl.href);
        return;
      }
      const selectedRole = roleInput?.value || sessionStorage.getItem("pending_signup_role") || "customer";
      const shopName = document.getElementById("signupShopName")?.value.trim();

      try {
        setButtonLoading(googleBtn, true, "Connecting to Google...");
        // Set this before Firebase emits auth state so the observer cannot default a dealer to customer.
        localStorage.setItem("naijaswap_role_pending", selectedRole);
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;

        // Persist role
        await saveUserRole(user, selectedRole, shopName);
        localStorage.removeItem("naijaswap_role_pending");

        // Redirect based on role
        if (selectedRole === "dealer") {
          window.location.href = "dealer-dashboard.html";
        } else {
          window.location.href = "dashboard.html";
        }
      } catch (err) {
        setButtonLoading(googleBtn, false);
        showAuthAlert("signupAlert", err?.code?.startsWith("firestore/")
          ? "Account created, but the account type could not be saved. Enable Firestore Database and check its rules before signing in again."
          : mapAuthError(err));
      }
    });
  }
}

/* ==========================================================================
   6. PHONE AUTHENTICATION CONTROLLER (SMS OTP)
   ========================================================================== */
let confirmationResult = null;
let recaptchaVerifier = null;
let resendTimerInterval = null;

export function initPhoneAuth() {
  const sendCodeForm = document.getElementById("sendCodeForm");
  const verifyCodeForm = document.getElementById("verifyCodeForm");
  const sendCodeBtn = document.getElementById("sendCodeBtn");
  const verifyCodeBtn = document.getElementById("verifyCodeBtn");
  const resendCodeBtn = document.getElementById("resendCodeBtn");
  const changeNumberBtn = document.getElementById("changeNumberBtn");
  const phase1 = document.getElementById("phonePhase1");
  const phase2 = document.getElementById("phonePhase2");

  // Initialize reCAPTCHA
  function getRecaptchaVerifier() {
    if (!recaptchaVerifier) {
      recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
        size: "invisible",
        callback: () => {
          // reCAPTCHA solved
        },
        "expired-callback": () => {
          showAuthAlert("phoneAlert", "reCAPTCHA expired. Please try submitting again.");
        }
      });
    }
    return recaptchaVerifier;
  }

  // Format full E.164 phone number
  function getFullPhoneNumber() {
    const countryCode = document.getElementById("countryCodeSelect")?.value || "+234";
    let rawNumber = document.getElementById("phoneNumberInput")?.value.trim() || "";

    // If user already typed a full international number with '+'
    if (rawNumber.startsWith("+")) {
      return rawNumber.replace(/[\s\-\(\)]/g, "");
    }

    // Strip any non-digit characters (spaces, dashes, parentheses)
    const digitsOnly = rawNumber.replace(/\D/g, "");
    if (!digitsOnly) return "";

    // If digits already start with the country code digits without the '+' (e.g. 2348012345678)
    const ccDigits = countryCode.replace(/\D/g, "");
    if (digitsOnly.startsWith(ccDigits)) {
      return `+${digitsOnly}`;
    }

    // Remove leading zeros (e.g. 08012345678 -> 8012345678)
    const cleanNumber = digitsOnly.replace(/^0+/, "");
    return `${countryCode}${cleanNumber}`;
  }

  // Start 60s resend cooldown countdown
  function startResendCooldown() {
    let secondsLeft = 60;
    if (resendCodeBtn) {
      resendCodeBtn.disabled = true;
      resendCodeBtn.innerHTML = `<span>Resend code in ${secondsLeft}s</span>`;
    }

    if (resendTimerInterval) clearInterval(resendTimerInterval);

    resendTimerInterval = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        clearInterval(resendTimerInterval);
        if (resendCodeBtn) {
          resendCodeBtn.disabled = false;
          resendCodeBtn.innerHTML = `<span>Resend verification code</span>`;
        }
      } else {
        if (resendCodeBtn) {
          resendCodeBtn.innerHTML = `<span>Resend code in ${secondsLeft}s</span>`;
        }
      }
    }, 1000);
  }

  // Phase 1: Send SMS Code
  if (sendCodeForm) {
    sendCodeForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAuthAlert("phoneAlert");

      const phoneNumber = getFullPhoneNumber();
      console.log("Submitting phone number for verification:", phoneNumber);

      if (!phoneNumber || phoneNumber.length < 8) {
        showAuthAlert("phoneAlert", "Please enter a valid phone number.");
        return;
      }

      try {
        setButtonLoading(sendCodeBtn, true, "Sending SMS code...");
        const verifier = getRecaptchaVerifier();
        confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, verifier);

        // Transition to Phase 2
        setButtonLoading(sendCodeBtn, false);
        if (phase1) phase1.style.display = "none";
        if (phase2) phase2.style.display = "block";

        const targetDisplay = document.getElementById("targetPhoneDisplay");
        if (targetDisplay) targetDisplay.textContent = phoneNumber;

        // Focus OTP input
        const otpInput = document.getElementById("verificationCodeInput");
        if (otpInput) {
          otpInput.value = "";
          otpInput.focus();
        }

        startResendCooldown();
      } catch (err) {
        console.error("Firebase Phone Auth error:", err);
        setButtonLoading(sendCodeBtn, false);
        // Reset reCAPTCHA on failure
        if (recaptchaVerifier) {
          try {
            recaptchaVerifier.clear();
          } catch (_) {}
          recaptchaVerifier = null;
        }
        showAuthAlert("phoneAlert", mapAuthError(err));
      }
    });
  }

  // Phase 2: Verify Code
  if (verifyCodeForm) {
    verifyCodeForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAuthAlert("phoneAlert");

      const code = document.getElementById("verificationCodeInput")?.value.trim();
      if (!code || code.length < 6) {
        showAuthAlert("phoneAlert", "Please enter the complete 6-digit verification code.");
        return;
      }

      if (!confirmationResult) {
        showAuthAlert("phoneAlert", "Verification session expired. Please request a new code.");
        return;
      }

      try {
        setButtonLoading(verifyCodeBtn, true, "Verifying code...");
        const result = await confirmationResult.confirm(code);
        await redirectUserAfterAuth(result.user);
      } catch (err) {
        console.error("Firebase verifyCode error:", err);
        setButtonLoading(verifyCodeBtn, false);
        showAuthAlert("phoneAlert", mapAuthError(err));
      }
    });
  }

  // Change Phone Number Action
  if (changeNumberBtn) {
    changeNumberBtn.addEventListener("click", () => {
      clearAuthAlert("phoneAlert");
      if (resendTimerInterval) clearInterval(resendTimerInterval);
      if (phase2) phase2.style.display = "none";
      if (phase1) phase1.style.display = "block";
      const phoneInput = document.getElementById("phoneNumberInput");
      if (phoneInput) phoneInput.focus();
    });
  }

  // Resend Code Action
  if (resendCodeBtn) {
    resendCodeBtn.addEventListener("click", async () => {
      clearAuthAlert("phoneAlert");
      const phoneNumber = getFullPhoneNumber();

      try {
        setButtonLoading(resendCodeBtn, true, "Resending code...");
        const verifier = getRecaptchaVerifier();
        confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, verifier);
        setButtonLoading(resendCodeBtn, false);
        showAuthAlert("phoneAlert", "A new verification code has been sent to your phone.", "success");
        startResendCooldown();
      } catch (err) {
        console.error("Firebase resendCode error:", err);
        setButtonLoading(resendCodeBtn, false);
        showAuthAlert("phoneAlert", mapAuthError(err));
      }
    });
  }
}

/* ==========================================================================
   7. DASHBOARD & AUTH STATE CONTROLLER
   ========================================================================== */
export function initDashboard() {
  document.querySelectorAll(".btn-dash-logout").forEach(logoutBtn => {
    logoutBtn.addEventListener("click", async () => {
      try {
        setButtonLoading(logoutBtn, true, "Signing out...");
        await signOut(auth);
        window.location.href = "login.html";
      } catch (err) {
        setButtonLoading(logoutBtn, false);
        alert("Error signing out: " + err.message);
      }
    });
  });
}

/* ==========================================================================
   8. ROUTE PROTECTION & STATE OBSERVER
   ========================================================================== */
export function initRouteProtection() {
  printPriorSessionLogs();

  const isLoginPage = isCurrentRoute("login") || !!document.getElementById("loginForm");
  const isSignupPage = isCurrentRoute("signup") || !!document.getElementById("signupForm");
  const isPhoneAuthPage = isCurrentRoute("phone-auth") || !!document.getElementById("sendCodeForm");
  const isAuthPage = isLoginPage || isSignupPage || isPhoneAuthPage;

  const isCustomerDash = isCurrentRoute("dashboard") || (!!document.getElementById("dashUserName") && !document.getElementById("dealerAuthDiagnostic"));
  const isDealerDash = isCurrentRoute(
    "dealer-dashboard",
    "dealer-listings",
    "dealer-listing",
    "dealer-requests",
    "dealer-request",
    "dealer-verification",
    "dealer-activities",
    "dealer-activity"
  ) || !!document.getElementById("dealerAuthDiagnostic");
  const isAccountPage = isCurrentRoute("account");
  const isCustomerProtectedPage = isCurrentRoute("my-swaps", "alerts");
  const isAnyDash = isCustomerDash || isDealerDash || isAccountPage || isCustomerProtectedPage;

  logNaijaSwap("info", "Auth", `Route initialized: ${window.location.pathname}`);

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      localStorage.setItem("naijaswap_last_uid", user.uid);
      const userRole = await getUserRole(user);
      logNaijaSwap("info", "Auth", `Authenticated route state: UID=${user.uid}, Role="${userRole}", Path=${window.location.pathname}`);

      // Cache user profile for instant synchronous rendering across all pages
      const displayName = user.displayName || (user.email ? user.email.split("@")[0] : "User");
      const storedPhoto = localStorage.getItem("naijaswap_photo_" + user.uid);
      const photo = storedPhoto || (user.photoURL && user.photoURL.startsWith("http") ? user.photoURL : null);

      try {
        localStorage.setItem("naijaswap_user", JSON.stringify({
          uid: user.uid,
          displayName: displayName,
          email: user.email || "",
          phoneNumber: user.phoneNumber || "",
          photoURL: photo || null
        }));
      } catch (e) {}

      // Automatically update global header user pill
      const globalHeaderName = document.getElementById("headerUserName");
      const globalHeaderAvatar = document.getElementById("headerAvatarFallback");
      if (globalHeaderName) globalHeaderName.textContent = displayName;
      if (globalHeaderAvatar) {
        if (photo) {
          globalHeaderAvatar.innerHTML = `<img src="${photo}" alt="${displayName}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
        } else {
          globalHeaderAvatar.textContent = displayName.charAt(0).toUpperCase();
        }
      }

      if (isAuthPage) {
        await redirectUserAfterAuth(user);
        return;
      }

      // STRICT ROLE ROUTE PROTECTION:
      // Swappers cannot access dealer portal pages; dealers cannot access customer dashboard/swap flows
      if (userRole === "customer" && isDealerDash) {
        logNaijaSwap("warn", "Auth", `Access denied: Swapper account (${user.uid}) cannot access dealer portal (${window.location.pathname}). Redirecting to swapper dashboard.`);
        window.location.replace("dashboard.html");
        return;
      }

      if (userRole === "dealer" && (isCustomerDash || isCurrentRoute("my-swaps"))) {
        logNaijaSwap("info", "Auth", `Dealer account (${user.uid}) redirected to store portal.`);
        window.location.replace("dealer-dashboard.html");
        return;
      }

      if (isCustomerDash) {
        populateDashboardUser(user, "customer");
      } else if (isDealerDash) {
        populateDashboardUser(user, "dealer");
      }

      // ALWAYS invoke window.onNaijaSwapUserReady on ANY page that defines it
      if (typeof window.onNaijaSwapUserReady === "function") {
        window.onNaijaSwapUserReady(user, userRole);
      }

      updateLandingNavbar(user);
    } else {
      // Unauthenticated
      try {
        localStorage.removeItem("naijaswap_user");
        localStorage.removeItem("naijaswap_user");
      } catch (e) {}

      if (isAnyDash) {
        recordAuthDiagnostic("protected-page-without-user", {
          path: window.location.pathname
        });
        logNaijaSwap("warn", "Auth", `Protected page access without authentication (${window.location.pathname}). Redirecting to login.html`);
        sessionStorage.setItem("post_login_redirect", window.location.href);
        window.location.href = "login.html";
        return;
      }

      updateLandingNavbar(null);
    }
  }, error => {
    recordAuthDiagnostic("auth-state-listener-failed", {
      code: error?.code || "unknown",
      message: error?.message || String(error)
    });
    logNaijaSwap("error", "Auth", "Firebase auth state listener failed:", error);
  });
}

function populateDashboardUser(user, role = "customer") {
  const nameEl = document.getElementById("dashUserName");
  const emailEl = document.getElementById("dashUserEmail");
  const phoneEl = document.getElementById("dashUserPhone");
  const uidEl = document.getElementById("dashUserUid");
  const providerEl = document.getElementById("dashUserProvider");
  const avatarImg = document.getElementById("dashUserAvatar");
  const avatarFallback = document.getElementById("dashAvatarFallback");
  const shopNameEl = document.getElementById("dashShopName");

  const storedShop = localStorage.getItem("naijaswap_shop_" + user.uid);
  const displayName = user.displayName || (user.email ? user.email.split("@")[0] : "Verified User");

  if (nameEl) nameEl.textContent = displayName;
  if (shopNameEl) shopNameEl.textContent = storedShop || (displayName ? `${displayName}'s Gadget Store` : "My Phone Store");
  if (emailEl) emailEl.textContent = user.email || (user.phoneNumber ? user.phoneNumber : "No email attached");
  if (phoneEl) phoneEl.textContent = user.phoneNumber || "Not attached";
  if (uidEl) uidEl.textContent = user.uid;

  let providerName = "Email & Password";
  if (user.providerData && user.providerData.length > 0) {
    const providerId = user.providerData[0].providerId;
    if (providerId === "google.com") providerName = "Google Account";
    else if (providerId === "phone") providerName = "Phone Number (SMS)";
  } else if (user.phoneNumber) {
    providerName = "Phone Number (SMS)";
  }
  if (providerEl) providerEl.textContent = providerName;

  if (user.photoURL && avatarImg) {
    avatarImg.src = user.photoURL;
    avatarImg.style.display = "block";
    if (avatarFallback) avatarFallback.style.display = "none";
  } else {
    if (avatarFallback) {
      avatarFallback.textContent = displayName.charAt(0).toUpperCase();
      avatarFallback.style.display = "flex";
    }
    if (avatarImg) avatarImg.style.display = "none";
  }

  // Trigger page-specific data loader if present
  if (typeof window.onNaijaSwapUserReady === "function") {
    window.onNaijaSwapUserReady(user, role);
  }
}

function updateLandingNavbar(user) {
  const authNavContainer = document.getElementById("navAuthContainer");
  if (!authNavContainer) return;

  if (user) {
    const userRole = localStorage.getItem("naijaswap_role_" + user.uid) || localStorage.getItem("naijaswap_last_role") || "customer";
    const dashTarget = userRole === "dealer" ? "dealer-dashboard.html" : "dashboard.html";
    const displayName = user.displayName || (user.email ? user.email.split("@")[0] : "Account");
    authNavContainer.innerHTML = `
      <a href="${dashTarget}" class="nav-user-pill" title="View Account">
        <span class="user-pill-dot"></span>
        <span class="user-pill-name">${displayName}</span>
      </a>
      <button type="button" class="btn-glass nav-btn-signout" id="navSignOutBtn" title="Sign Out">Sign Out</button>
    `;

    const navSignOut = document.getElementById("navSignOutBtn");
    if (navSignOut) {
      navSignOut.addEventListener("click", async () => {
        await signOut(auth);
        window.location.reload();
      });
    }
  } else {
    authNavContainer.innerHTML = `
      <a href="login.html" class="btn-glass nav-btn-login">Log In</a>
    `;
  }
}

function startAuthServices() {
  setupPasswordToggles();
  initLoginForm();
  initSignupForm();
  initPhoneAuth();
  initDashboard();
  initRouteProtection();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startAuthServices);
} else {
  startAuthServices();
}
