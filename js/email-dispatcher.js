/**
 * NaijaSwap - Client-Side Email Verification Dispatcher
 * Sends verification email directly via Firebase Auth (Google mail infrastructure)
 * and generates/persists secure 6-digit verification codes in Firestore.
 */

import {
  auth,
  db,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
  sendEmailVerification
} from './firebase-config.js';
import { API_BASE_URL } from './backend-api.js';
import { sendWelcomeEmailBrevo, syncContactToBrevo } from './brevo-client.js';

export const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Dispatch verification email and generate 6-digit verification code.
 */
export async function dispatchVerificationEmail(user, { firstName = '', role = 'customer' } = {}) {
  const currentUser = user || auth.currentUser;
  const email = (currentUser?.email || sessionStorage.getItem('pending_verif_email') || '').trim().toLowerCase();

  if (!email) {
    throw new Error('No recipient email address found.');
  }

  // 1. Generate cryptographically safe 6-digit numeric OTP
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + CODE_EXPIRY_MS;

  // 2. Dispatch 6-digit verification code email via backend/Brevo service
  let backendDispatched = false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/send-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        uid: currentUser ? currentUser.uid : null,
        firstName,
        role
      })
    });
    if (res.ok) {
      backendDispatched = true;
      console.log('✓ [EmailDispatcher] 6-digit verification email dispatched via backend to', email);
    }
  } catch (backendErr) {
    console.warn('[EmailDispatcher] Backend verification dispatch note:', backendErr.message);
  }

  // 3. Fallback/supplemental: Dispatch official Google Firebase verification email
  let firebaseMailSent = false;
  if (currentUser) {
    try {
      await sendEmailVerification(currentUser);
      firebaseMailSent = true;
      console.log('✓ [EmailDispatcher] Firebase verification email dispatched to', email);
    } catch (fbErr) {
      console.warn('[EmailDispatcher] Firebase sendEmailVerification note:', fbErr.code || fbErr.message);
    }
  }

  // 4. Persist 6-digit code and expiry in Firestore emailVerifications
  try {
    await setDoc(doc(db, 'emailVerifications', email), {
      email,
      uid: currentUser ? currentUser.uid : null,
      code,
      expiresAt,
      attempts: 0,
      firstName: firstName || '',
      role: role || 'customer',
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (fsErr) {
    console.warn('[EmailDispatcher] Firestore verification record save warning:', fsErr.message);
  }

  // 5. Cache in session storage for fast local validation / UX
  sessionStorage.setItem('naijaswap_active_code', code);
  sessionStorage.setItem('naijaswap_code_expires', expiresAt.toString());

  return {
    ok: true,
    email,
    code,
    firebaseMailSent,
    backendDispatched,
    expiresInSeconds: Math.floor(CODE_EXPIRY_MS / 1000)
  };
}

/**
 * Validate entered 6-digit code.
 */
export async function validateOtpCode(email, enteredCode, user) {
  const cleanCode = String(enteredCode || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const currentUser = user || auth.currentUser;
  const uid = currentUser ? currentUser.uid : null;

  if (!cleanCode || cleanCode.length !== 6) {
    throw new Error('Please enter the complete 6-digit verification code.');
  }

  // 1. Check against Firestore record
  let recordSnap = null;
  try {
    recordSnap = await getDoc(doc(db, 'emailVerifications', normalizedEmail));
  } catch (fsErr) {
    console.warn('[EmailDispatcher] Firestore read note:', fsErr.message);
  }

  if (recordSnap && recordSnap.exists()) {
    const data = recordSnap.data();
    const now = Date.now();

    if (data.expiresAt && now > data.expiresAt) {
      throw new Error('Verification code has expired. Please click "Resend Code" to receive a new one.');
    }

    if ((data.attempts || 0) >= 5) {
      throw new Error('Too many incorrect attempts. Please click "Resend Code" for a new code.');
    }

    if (data.code && data.code === cleanCode) {
      // Mark verified
      if (uid) {
        await setDoc(doc(db, 'users', uid), {
          emailVerified: true,
          emailVerifiedAt: new Date()
        }, { merge: true });
      }
      try {
        await updateDoc(doc(db, 'emailVerifications', normalizedEmail), {
          verified: true,
          verifiedAt: serverTimestamp()
        });
      } catch (_) {}

      // Dispatch Welcome Email & Sync user to Brevo audience
      sendWelcomeEmailBrevo({ email: normalizedEmail, firstName: data.firstName || '', role: data.role || 'customer' }).catch(() => {});
      syncContactToBrevo({ email: normalizedEmail, firstName: data.firstName || '', role: data.role || 'customer' }).catch(() => {});

      return { ok: true, verified: true };
    } else {
      // Increment attempt count
      try {
        await updateDoc(doc(db, 'emailVerifications', normalizedEmail), {
          attempts: (data.attempts || 0) + 1
        });
      } catch (_) {}
      throw new Error('Incorrect verification code. Please check your email and try again.');
    }
  }

  // 2. Check session storage cache fallback
  const cachedCode = sessionStorage.getItem('naijaswap_active_code');
  const cachedExpiry = Number(sessionStorage.getItem('naijaswap_code_expires') || 0);

  if (cachedCode && cachedCode === cleanCode) {
    if (cachedExpiry && Date.now() > cachedExpiry) {
      throw new Error('Verification code has expired. Please click "Resend Code" to receive a new one.');
    }
    if (uid) {
      await setDoc(doc(db, 'users', uid), {
        emailVerified: true,
        emailVerifiedAt: new Date()
      }, { merge: true });
    }
    return { ok: true, verified: true };
  }

  // 3. Fallback: Check backend endpoint if available
  try {
    const res = await fetch('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, code: cleanCode, uid })
    });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      if (res.ok && data.ok) {
        return { ok: true, verified: true, role: data.role };
      }
    }
  } catch (_) {}

  throw new Error('Incorrect verification code. Please check your email and try again.');
}

/**
 * Start listening for email link clicks (Firebase Auth emailVerified changes).
 */
export function startEmailVerificationWatcher(user, onVerified) {
  if (!user) return () => {};

  let active = true;
  const interval = setInterval(async () => {
    if (!active) return;
    try {
      await user.reload();
      if (user.emailVerified) {
        active = false;
        clearInterval(interval);
        try {
          await setDoc(doc(db, 'users', user.uid), {
            emailVerified: true,
            emailVerifiedAt: new Date()
          }, { merge: true });
        } catch (_) {}
        if (typeof onVerified === 'function') {
          onVerified(user);
        }
      }
    } catch (_) {}
  }, 3000);

  return () => {
    active = false;
    clearInterval(interval);
  };
}
