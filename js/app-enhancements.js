/**
 * NaijaSwap App Enhancements
 * - Real-Time Unread Inbox Badges across bottom navigation & header
 * - Web Audio Chime Synthesizer
 */

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { collection, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// ─── 1. WEB AUDIO MESSAGE CHIME SYNTHESIZER ──────────────────────────────────
let audioCtx = null;

export function playMessageChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    
    // Smooth dual-tone pleasant ping
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.16); // D6

    gainNode.gain.setValueAtTime(0.18, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.35);
    osc2.stop(now + 0.35);

    // Haptic feedback for mobile devices
    if (navigator.vibrate) {
      navigator.vibrate([30, 40, 30]);
    }
  } catch (err) {
    console.debug('[Audio] Chime skipped:', err.message);
  }
}

// ─── 2. REAL-TIME UNREAD INBOX BADGES ────────────────────────────────────────
function updateInboxBadges(unreadCount) {
  const inboxLinks = document.querySelectorAll('a[href*="inbox.html"]');
  inboxLinks.forEach(link => {
    let badge = link.querySelector('.nav-badge, .header-nav-badge');
    if (unreadCount > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = link.classList.contains('mobile-bottom-nav-item') ? 'nav-badge' : 'header-nav-badge';
        link.style.position = 'relative';
        link.appendChild(badge);
      }
      badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
      badge.style.display = 'inline-flex';
    } else if (badge) {
      badge.style.display = 'none';
    }
  });
}

function initInboxBadgeTracker() {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      updateInboxBadges(0);
      return;
    }

    try {
      // Listen to active swap proposals for both customer and store
      const qCustomer = query(collection(db, 'swapRequests'), where('userId', '==', user.uid));
      const qDealer = query(collection(db, 'swapRequests'), where('storeId', '==', user.uid));

      let customerActiveCount = 0;
      let dealerActiveCount = 0;

      onSnapshot(qCustomer, (snap) => {
        customerActiveCount = snap.docs.filter(d => {
          const st = d.data().status;
          return st && st !== 'completed' && st !== 'rejected' && st !== 'cancelled';
        }).length;
        updateInboxBadges(customerActiveCount + dealerActiveCount);
      }, () => {});

      onSnapshot(qDealer, (snap) => {
        dealerActiveCount = snap.docs.filter(d => {
          const st = d.data().status;
          return st === 'pending' || st === 'inspected' || st === 'countered' || st === 'hub_booked';
        }).length;
        updateInboxBadges(customerActiveCount + dealerActiveCount);
      }, () => {});
    } catch (e) {
      console.debug('[Badges] Firestore tracker setup:', e);
    }
  });
}

// Auto-run unread badge tracker when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initInboxBadgeTracker);
} else {
  initInboxBadgeTracker();
}
