/**
 * NaijaSwap - User Onboarding & Activation Controller
 * Handles first-time setup wizards, location hub selection, device trade-in preview,
 * and interactive "Getting Started" dashboard checklists for Swappers and Dealers.
 */

import { db, doc, getDoc, setDoc } from './firebase-config.js';
import { NaijaSwapData, BRANDS_AND_MODELS } from './dashboard-data.js';

const ONBOARDING_VERSION = 'v2';
const KEY_PREFIX_DONE = `naijaswap_onboarded_${ONBOARDING_VERSION}_`;
const KEY_PREFIX_DISMISSED = `naijaswap_checklist_dismissed_`;

// Popular Nigerian smartphone trading hubs
export const TRADING_HUBS = [
  { id: 'Ikeja, Lagos', label: 'Lagos — Ikeja (Computer Village / Otigba)', state: 'Lagos' },
  { id: 'Lekki, Lagos', label: 'Lagos — Lekki & Victoria Island / Ajah', state: 'Lagos' },
  { id: 'Abuja', label: 'Abuja — Banex Plaza & Wuse 2 / Emab', state: 'Abuja' },
  { id: 'Port Harcourt', label: 'Port Harcourt — Garrison & Aba Road', state: 'Rivers' },
  { id: 'Other', label: 'Other Locations across Nigeria', state: 'Other' }
];

export function getOnboardingStatus(uid) {
  if (!uid) return false;
  return localStorage.getItem(KEY_PREFIX_DONE + uid) === 'true';
}

export function setOnboardingStatus(uid, isDone = true) {
  if (!uid) return;
  localStorage.setItem(KEY_PREFIX_DONE + uid, isDone ? 'true' : 'false');
  sessionStorage.removeItem('naijaswap_first_signup');
}

/**
 * Main Entry Point: Checks if onboarding should be triggered on the current dashboard.
 */
export async function initOnboarding(user, role = 'customer') {
  if (!user || !user.uid) return;
  const uid = user.uid;
  const isFirstSignup = sessionStorage.getItem('naijaswap_first_signup') === 'true';
  let isDone = getOnboardingStatus(uid);

  // Check remote Firestore if local is not set
  if (!isDone && !isFirstSignup) {
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap && snap.exists() && snap.data().onboardingCompleted) {
        isDone = true;
        setOnboardingStatus(uid, true);
      }
    } catch (_) {}
  }

  // Render the Getting Started Checklist on the dashboard
  renderGettingStartedWidget(user, role);

  // If first-time user, automatically pop up the onboarding wizard
  if (!isDone || isFirstSignup) {
    setTimeout(() => {
      openOnboardingModal(user, role);
    }, 450);
  }
}

/**
 * Open the Onboarding Modal (can also be called manually via menu)
 */
export function openOnboardingModal(user, role = 'customer') {
  let modal = document.getElementById('naijaswapOnboardingModal');
  if (!modal) {
    modal = createOnboardingModalDOM(role);
    document.body.appendChild(modal);
  } else {
    // Re-render contents to match current user/role
    modal.replaceWith(createOnboardingModalDOM(role));
    modal = document.getElementById('naijaswapOnboardingModal');
  }

  setupOnboardingWizardLogic(modal, user, role);

  // Trigger modal display
  requestAnimationFrame(() => {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  });
}

export function closeOnboardingModal() {
  const modal = document.getElementById('naijaswapOnboardingModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

/**
 * Generate Modal DOM Structure
 */
function createOnboardingModalDOM(role = 'customer') {
  const modal = document.createElement('div');
  modal.id = 'naijaswapOnboardingModal';
  modal.className = 'onboarding-modal-overlay';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', role === 'dealer' ? 'Partner Store Onboarding' : 'Welcome to NaijaSwap');

  const isDealer = role === 'dealer';

  modal.innerHTML = `
    <div class="onboarding-modal-card">
      <!-- Glow Elements -->
      <div class="onboarding-glow"></div>

      <!-- Header with steps & close -->
      <div class="onboarding-header">
        <div class="onboarding-steps-indicator" id="onboardingStepDots">
          <span class="step-dot active" data-step="1">1</span>
          <span class="step-line"></span>
          <span class="step-dot" data-step="2">2</span>
          <span class="step-line"></span>
          <span class="step-dot" data-step="3">3</span>
          ${isDealer ? `
          <span class="step-line"></span>
          <span class="step-dot" data-step="4">4</span>
          ` : ''}
        </div>
        <button type="button" class="onboarding-close-btn" id="closeOnboardingBtn" aria-label="Close guide">&times;</button>
      </div>

      <!-- Step Panels Container -->
      <div class="onboarding-body" id="onboardingStepsContainer">
        ${isDealer ? getDealerStepsHTML() : getSwapperStepsHTML()}
      </div>
    </div>
  `;

  return modal;
}

/**
 * HTML Templates for Swapper Steps
 */
function getSwapperStepsHTML() {
  return `
    <!-- STEP 1: WELCOME & TRUST PROMISE -->
    <div class="onboarding-step-panel active" data-step="1">
      <div class="onboarding-badge">🇳🇬 Nigeria's Verified Smartphone Exchange</div>
      <h2 class="onboarding-title">Welcome to <span class="brand-text">Naija<span>Swap</span></span></h2>
      <p class="onboarding-subtitle">Upgrade your iPhone or Samsung Galaxy safely with verified stores across Nigeria without fear of scams or unfair valuations.</p>

      <div class="onboarding-features-list">
        <div class="feature-item">
          <div class="feature-icon icon-emerald">🏬</div>
          <div class="feature-text">
            <strong>Verified Store Partners Only</strong>
            <p>Every swap partner is vetted with physical stores and verified device inventory.</p>
          </div>
        </div>
        <div class="feature-item">
          <div class="feature-icon icon-cyan">⚖️</div>
          <div class="feature-text">
            <strong>Algorithmic Fair Valuation</strong>
            <p>No guesswork. Calculate the transparent top-up difference between your current phone and target upgrade.</p>
          </div>
        </div>
        <div class="feature-item">
          <div class="feature-icon icon-gold">🛡️</div>
          <div class="feature-text">
            <strong>Safe In-Person Inspection</strong>
            <p>Test batteries, verify IMEI & iCloud/Google lock removal, and complete the exchange safely.</p>
          </div>
        </div>
      </div>

      <div class="onboarding-actions-row">
        <button type="button" class="btn-onboarding-primary" id="btnStep1Next">
          <span>Get Started (1 min)</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        </button>
      </div>
    </div>

    <!-- STEP 2: NAME & WHATSAPP CONTACT -->
    <div class="onboarding-step-panel" data-step="2">
      <div class="onboarding-badge">👤 Step 2 of 3 &bull; Contact Info</div>
      <h2 class="onboarding-title">Let's connect your WhatsApp</h2>
      <p class="onboarding-subtitle">Provide your WhatsApp contact so verified stores can coordinate swap trade offers and appointments with you.</p>

      <div class="onboarding-form-group">
        <label class="onboarding-label" for="obFullName">Your Full Name</label>
        <input type="text" class="onboarding-input" id="obFullName" placeholder="e.g. Tunde Balogun">
      </div>

      <div class="onboarding-form-group">
        <label class="onboarding-label" for="obWhatsApp">WhatsApp Phone Number</label>
        <div class="onboarding-phone-wrap">
          <span class="phone-prefix">+234</span>
          <input type="tel" class="onboarding-input phone-input" id="obWhatsApp" placeholder="801 234 5678" maxlength="11">
        </div>
        <span class="onboarding-hint">Used strictly for swap trade updates and store appointment confirmations.</span>
      </div>

      <div class="onboarding-actions-row">
        <button type="button" class="btn-onboarding-secondary" id="btnStep2Back">&larr; Back</button>
        <button type="button" class="btn-onboarding-primary" id="btnStep2Next">
          <span>Continue</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        </button>
      </div>
    </div>

    <!-- STEP 3: EXPLORE OR LIST PHONE (FINAL STEP) -->
    <div class="onboarding-step-panel" data-step="3">
      <div class="onboarding-badge">🚀 Step 3 of 3 &bull; Ready to Swap</div>
      <h2 class="onboarding-title">How would you like to start?</h2>
      <p class="onboarding-subtitle">Your contact details are saved! Choose whether to explore available phones or list your device to receive direct trade offers.</p>

      <div class="onboarding-choice-container" style="display: flex; flex-direction: column; gap: 14px; margin: 22px 0 24px 0;">
        <!-- Option 1: Let us know the phone you have (Redirects to proper listing page) -->
        <button type="button" class="launch-card-btn highlight" id="btnStep3ListPhone">
          <div class="launch-icon">📱</div>
          <div class="launch-info">
            <strong>Let us know the phone you have</strong>
            <span>Upload photos, specs & condition to list your phone properly &rarr;</span>
          </div>
          <div class="launch-arrow">&rarr;</div>
        </button>

        <!-- Option 2: Explore phones -->
        <button type="button" class="launch-card-btn" id="btnStep3Explore">
          <div class="launch-icon">🔍</div>
          <div class="launch-info">
            <strong>Explore Phones</strong>
            <span>Browse available iPhones and Samsung devices on the marketplace</span>
          </div>
          <div class="launch-arrow">&rarr;</div>
        </button>
      </div>

      <div class="onboarding-actions-row">
        <button type="button" class="btn-onboarding-secondary" id="btnStep3Back">&larr; Back</button>
      </div>
    </div>
  `;
}

/**
 * HTML Templates for Dealer Steps
 */
function getDealerStepsHTML() {
  const hubOptions = TRADING_HUBS.map(h => 
    `<option value="${h.id}">${h.label}</option>`
  ).join('');

  return `
    <!-- STEP 1: WELCOME PARTNER STORE -->
    <div class="onboarding-step-panel active" data-step="1">
      <div class="onboarding-badge">🏬 Partner Store Onboarding</div>
      <h2 class="onboarding-title">Welcome to the <span class="brand-text">Naija<span>Swap</span></span> Dealer Hub</h2>
      <p class="onboarding-subtitle">Scale your phone business with pre-qualified buyers and verified swap trade-ins across Nigeria.</p>

      <div class="onboarding-features-list">
        <div class="feature-item">
          <div class="feature-icon icon-emerald">✅</div>
          <div class="feature-text">
            <strong>Verified Dealer Trust Badge</strong>
            <p>Stand out from informal sellers. Buyers prefer swapping with verified retail shops.</p>
          </div>
        </div>
        <div class="feature-item">
          <div class="feature-icon icon-cyan">📦</div>
          <div class="feature-text">
            <strong>Direct Inventory Inquiries</strong>
            <p>Customers submit their current devices with photos and specs directly to your store portal.</p>
          </div>
        </div>
        <div class="feature-item">
          <div class="feature-icon icon-gold">💰</div>
          <div class="feature-text">
            <strong>Guaranteed Top-Up Settlements</strong>
            <p>Agree on top-up amounts with confidence using our standardized valuation criteria.</p>
          </div>
        </div>
      </div>

      <div class="onboarding-actions-row">
        <button type="button" class="btn-onboarding-primary" id="btnDealerStep1Next">
          <span>Setup Store Profile (1 min) &rarr;</span>
        </button>
      </div>
    </div>

    <!-- STEP 2: STORE LOCATION & STALL ADDRESS -->
    <div class="onboarding-step-panel" data-step="2">
      <div class="onboarding-badge">📍 Step 2 of 4 &bull; Storefront Identity</div>
      <h2 class="onboarding-title">Where is your physical shop?</h2>
      <p class="onboarding-subtitle">Swappers need to know where to bring their phones for physical testing and exchange.</p>

      <div class="onboarding-form-group">
        <label class="onboarding-label" for="obDealerShopName">Shop or Business Name</label>
        <input type="text" class="onboarding-input" id="obDealerShopName" placeholder="e.g. Apex Gadgets Hub">
      </div>

      <div class="onboarding-form-group">
        <label class="onboarding-label" for="obDealerHub">Tech Market Hub</label>
        <select class="onboarding-select" id="obDealerHub">
          ${hubOptions}
        </select>
      </div>

      <div class="onboarding-form-group">
        <label class="onboarding-label" for="obDealerAddress">Shop / Plaza Physical Address</label>
        <input type="text" class="onboarding-input" id="obDealerAddress" placeholder="e.g. Shop 14, Digital Complex, Otigba St, Computer Village">
      </div>

      <div class="onboarding-form-group">
        <label class="onboarding-label" for="obDealerWhatsApp">Official WhatsApp Hotline</label>
        <div class="onboarding-phone-wrap">
          <span class="phone-prefix">+234</span>
          <input type="tel" class="onboarding-input phone-input" id="obDealerWhatsApp" placeholder="802 345 6789" maxlength="11">
        </div>
      </div>

      <div class="onboarding-actions-row">
        <button type="button" class="btn-onboarding-secondary" id="btnDealerStep2Back">&larr; Back</button>
        <button type="button" class="btn-onboarding-primary" id="btnDealerStep2Next">
          <span>Continue</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        </button>
      </div>
    </div>

    <!-- STEP 3: VERIFICATION ROADMAP -->
    <div class="onboarding-step-panel" data-step="3">
      <div class="onboarding-badge">🛡️ Step 3 of 4 &bull; Verification Roadmap</div>
      <h2 class="onboarding-title">How to get Verified</h2>
      <p class="onboarding-subtitle">Verification takes under 5 minutes and unlocks unlimited phone listings on NaijaSwap.</p>

      <div class="onboarding-checklist-preview">
        <div class="check-item-preview">
          <div class="check-num">1</div>
          <div class="check-content">
            <strong>Government ID</strong>
            <span>NIN Slip, Driver's License, or International Passport</span>
          </div>
        </div>
        <div class="check-item-preview">
          <div class="check-num">2</div>
          <div class="check-content">
            <strong>Store Front Proof / Geotag</strong>
            <span>Clear photo showing your shop sign or plaza unit number</span>
          </div>
        </div>
        <div class="check-item-preview">
          <div class="check-num">3</div>
          <div class="check-content">
            <strong>CAC Business Registration (Optional for Tier 1)</strong>
            <span>CAC certificate for premium 'Platinum Verified Partner' ranking</span>
          </div>
        </div>
        <div class="check-item-preview">
          <div class="check-num">4</div>
          <div class="check-content">
            <strong>Settlement Bank Account</strong>
            <span>Nigerian bank account for receiving top-up escrow balances</span>
          </div>
        </div>
      </div>

      <div class="onboarding-actions-row">
        <button type="button" class="btn-onboarding-secondary" id="btnDealerStep3Back">&larr; Back</button>
        <button type="button" class="btn-onboarding-primary" id="btnDealerStep3Next">
          <span>Ready to Launch &rarr;</span>
        </button>
      </div>
    </div>

    <!-- STEP 4: LAUNCH OPTIONS -->
    <div class="onboarding-step-panel" data-step="4">
      <div class="onboarding-success-icon">🚀</div>
      <h2 class="onboarding-title">Store Profile Configured!</h2>
      <p class="onboarding-subtitle">Your store details have been saved. You can now complete your verification or start exploring incoming swap requests.</p>

      <div class="onboarding-launch-cards">
        <a href="dealer-verification.html" class="launch-card-btn highlight" id="btnLaunchVerification">
          <div class="launch-icon">🛡️</div>
          <div class="launch-info">
            <strong>Complete Verification Now (Recommended)</strong>
            <span>Upload ID & shop photo to activate listings in ~24 hours</span>
          </div>
          <div class="launch-arrow">&rarr;</div>
        </a>

        <button type="button" class="launch-card-btn" id="btnLaunchDashboard">
          <div class="launch-icon">🏬</div>
          <div class="launch-info">
            <strong>Go to Store Dashboard</strong>
            <span>View inventory tools and manage pending trade-ins</span>
          </div>
          <div class="launch-arrow">&rarr;</div>
        </button>
      </div>
    </div>
  `;
}

/**
 * Logic and Event Listeners for the Onboarding Wizard
 */
function setupOnboardingWizardLogic(modal, user, role) {
  let currentStep = 1;
  const isDealer = role === 'dealer';
  const uid = user ? user.uid : '';

  const stepPanels = modal.querySelectorAll('.onboarding-step-panel');
  const stepDots = modal.querySelectorAll('.step-dot');
  const closeBtn = modal.querySelector('#closeOnboardingBtn');

  function goToStep(step) {
    currentStep = step;
    stepPanels.forEach(p => {
      p.classList.toggle('active', parseInt(p.getAttribute('data-step')) === step);
    });
    stepDots.forEach(d => {
      const s = parseInt(d.getAttribute('data-step'));
      d.classList.toggle('active', s === step);
      d.classList.toggle('done', s < step);
    });
  }

  // Close Button
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      setOnboardingStatus(uid, true);
      closeOnboardingModal();
      renderGettingStartedWidget(user, role);
    });
  }

  // Step Dots navigation (only to previously completed steps)
  stepDots.forEach(d => {
    d.addEventListener('click', () => {
      const s = parseInt(d.getAttribute('data-step'));
      if (s <= currentStep) goToStep(s);
    });
  });

  if (!isDealer) {
    // --- SWAPPER FLOW LOGIC ---
    const btnStep1Next = modal.querySelector('#btnStep1Next');
    const btnStep2Back = modal.querySelector('#btnStep2Back');
    const btnStep2Next = modal.querySelector('#btnStep2Next');
    const btnStep3Back = modal.querySelector('#btnStep3Back');
    const btnStep3ListPhone = modal.querySelector('#btnStep3ListPhone');
    const btnStep3Explore = modal.querySelector('#btnStep3Explore');

    const inputName = modal.querySelector('#obFullName');
    const inputWhatsApp = modal.querySelector('#obWhatsApp');

    // Pre-fill existing user info
    if (inputName && user && user.displayName) inputName.value = user.displayName;
    if (inputWhatsApp && user && user.phoneNumber) {
      inputWhatsApp.value = user.phoneNumber.replace(/^\+234/, '').replace(/^0/, '');
    }

    // Step 1 -> Step 2
    if (btnStep1Next) {
      btnStep1Next.addEventListener('click', () => goToStep(2));
    }

    // Step 2 -> Back & Next
    if (btnStep2Back) btnStep2Back.addEventListener('click', () => goToStep(1));
    if (btnStep2Next) {
      btnStep2Next.addEventListener('click', async () => {
        const rawPhone = (inputWhatsApp?.value || '').replace(/\D/g, '');
        if (rawPhone.length < 10) {
          alert('Please enter a valid Nigerian WhatsApp number (at least 10 digits).');
          inputWhatsApp?.focus();
          return;
        }

        const fullName = inputName?.value.trim() || (user && user.displayName) || 'Swapper';
        const phone = rawPhone.startsWith('234') ? `+${rawPhone}` : `+234${rawPhone.replace(/^0/, '')}`;

        // Save contact info locally
        localStorage.setItem('naijaswap_user_whatsapp_' + uid, phone);
        localStorage.setItem('naijaswap_phone_' + uid, phone);

        // Update profile in local cache
        try {
          const userObj = JSON.parse(localStorage.getItem('naijaswap_user') || '{}');
          userObj.displayName = fullName;
          userObj.phoneNumber = phone;
          localStorage.setItem('naijaswap_user', JSON.stringify(userObj));
        } catch (_) {}

        // Asynchronously sync contact with Firestore
        if (uid) {
          try {
            setDoc(doc(db, 'users', uid), {
              displayName: fullName,
              phoneNumber: phone,
              updatedAt: new Date().toISOString()
            }, { merge: true });
          } catch (err) {
            console.warn('[NaijaSwap Onboarding] Firestore sync note:', err.message);
          }
        }

        goToStep(3);
      });
    }

    // Step 3 Actions
    if (btnStep3Back) btnStep3Back.addEventListener('click', () => goToStep(2));

    async function finishSwapperOnboarding() {
      setOnboardingStatus(uid, true);
      closeOnboardingModal();
      renderGettingStartedWidget(user, role);

      if (uid) {
        try {
          await setDoc(doc(db, 'users', uid), {
            onboardingCompleted: true,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (err) {
          console.warn('[NaijaSwap Onboarding] Firestore completion note:', err.message);
        }
      }
    }

    // Button: "Let us know the phone you have" -> Redirect to proper listing page
    if (btnStep3ListPhone) {
      btnStep3ListPhone.addEventListener('click', async () => {
        await finishSwapperOnboarding();
        if (window.location.pathname.toLowerCase().includes('my-swaps')) {
          const consumerModal = document.getElementById('consumerSwapModal');
          if (consumerModal) consumerModal.classList.add('active');
        } else {
          window.location.href = 'my-swaps.html?action=new';
        }
      });
    }

    // Button: "Explore Phones" -> Scroll to phonesGrid or redirect to dashboard.html#phonesGrid
    if (btnStep3Explore) {
      btnStep3Explore.addEventListener('click', async () => {
        await finishSwapperOnboarding();
        if (window.location.pathname.toLowerCase().includes('dashboard')) {
          const phonesSection = document.getElementById('phonesGrid') || document.querySelector('.phones-grid') || document.querySelector('.search-container');
          if (phonesSection) {
            phonesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        } else {
          window.location.href = 'dashboard.html#phonesGrid';
        }
      });
    }

  } else {
    // --- DEALER FLOW LOGIC ---
    const btnDStep1Next = modal.querySelector('#btnDealerStep1Next');
    const btnDStep2Back = modal.querySelector('#btnDealerStep2Back');
    const btnDStep2Next = modal.querySelector('#btnDealerStep2Next');
    const btnDStep3Back = modal.querySelector('#btnDealerStep3Back');
    const btnDStep3Next = modal.querySelector('#btnDealerStep3Next');
    const btnLaunchVerif = modal.querySelector('#btnLaunchVerification');
    const btnLaunchDash = modal.querySelector('#btnLaunchDashboard');

    const inputShop = modal.querySelector('#obDealerShopName');
    const selectHub = modal.querySelector('#obDealerHub');
    const inputAddress = modal.querySelector('#obDealerAddress');
    const inputWhatsApp = modal.querySelector('#obDealerWhatsApp');

    // Pre-fill existing stored shop
    const cachedShop = localStorage.getItem('naijaswap_shop_' + uid) || '';
    if (inputShop && cachedShop) inputShop.value = cachedShop;

    if (btnDStep1Next) btnDStep1Next.addEventListener('click', () => goToStep(2));
    if (btnDStep2Back) btnDStep2Back.addEventListener('click', () => goToStep(1));

    if (btnDStep2Next) {
      btnDStep2Next.addEventListener('click', async () => {
        const shopName = inputShop?.value.trim();
        const hub = selectHub?.value || 'Ikeja, Lagos';
        const address = inputAddress?.value.trim();
        const rawPhone = (inputWhatsApp?.value || '').replace(/\D/g, '');

        if (!shopName) {
          alert('Please enter your shop or business name.');
          inputShop?.focus();
          return;
        }

        // Save store details locally
        localStorage.setItem('naijaswap_shop_' + uid, shopName);
        localStorage.setItem('naijaswap_dealer_hub_' + uid, hub);
        if (address) localStorage.setItem('naijaswap_dealer_address_' + uid, address);
        if (rawPhone) {
          const phone = rawPhone.startsWith('234') ? `+${rawPhone}` : `+234${rawPhone.replace(/^0/, '')}`;
          localStorage.setItem('naijaswap_dealer_phone_' + uid, phone);
        }

        // Asynchronously sync with Firestore
        if (uid) {
          try {
            await setDoc(doc(db, 'dealers', uid), {
              shopName,
              hub,
              shopAddress: address || '',
              hotline: rawPhone ? `+234${rawPhone.replace(/^0/, '')}` : '',
              onboardingCompleted: true,
              updatedAt: new Date().toISOString()
            }, { merge: true });
          } catch (err) {
            console.warn('[NaijaSwap Onboarding] Dealer sync note:', err.message);
          }
        }

        setOnboardingStatus(uid, true);
        goToStep(3);
      });
    }

    if (btnDStep3Back) btnDStep3Back.addEventListener('click', () => goToStep(2));
    if (btnDStep3Next) btnDStep3Next.addEventListener('click', () => goToStep(4));

    if (btnLaunchVerif) {
      btnLaunchVerif.addEventListener('click', () => {
        setOnboardingStatus(uid, true);
        closeOnboardingModal();
      });
    }

    if (btnLaunchDash) {
      btnLaunchDash.addEventListener('click', () => {
        setOnboardingStatus(uid, true);
        closeOnboardingModal();
        renderGettingStartedWidget(user, role);
      });
    }
  }
}

/**
 * Render Interactive "Getting Started" Checklist Banner on the Dashboard
 */
export function renderGettingStartedWidget(user, role = 'customer') {
  if (!user || !user.uid) return;
  const uid = user.uid;

  // Check if user dismissed the widget
  if (localStorage.getItem(KEY_PREFIX_DISMISSED + uid) === 'true') {
    return;
  }

  // Find widget container or insert before main content
  let container = document.getElementById('gettingStartedChecklistContainer');
  if (!container) {
    const targetParent = document.querySelector('.dash-main') || document.querySelector('main');
    if (!targetParent) return;

    container = document.createElement('div');
    container.id = 'gettingStartedChecklistContainer';
    container.className = 'getting-started-banner';
    targetParent.insertBefore(container, targetParent.firstChild);
  }

  const isDealer = role === 'dealer';

  if (!isDealer) {
    // --- SWAPPER CHECKLIST ---
    const hasPhone = Boolean(localStorage.getItem('naijaswap_user_whatsapp_' + uid) || (user && user.phoneNumber));
    const hasDevice = Boolean(localStorage.getItem('naijaswap_user_device_' + uid));
    const swapReqs = JSON.parse(localStorage.getItem('naijaswap_swap_requests') || '[]');
    const hasMadeSwap = Array.isArray(swapReqs) && swapReqs.some(r => r.customerUid === uid);

    let completedTasks = 1; // Account created
    if (hasPhone) completedTasks++;
    if (hasDevice) completedTasks++;
    if (hasMadeSwap) completedTasks++;

    const totalTasks = 4;
    const progressPercent = Math.round((completedTasks / totalTasks) * 100);

    // If 100% completed, don't overwhelm user
    if (progressPercent === 100) {
      container.style.display = 'none';
      return;
    }

    container.innerHTML = `
      <div class="gs-card">
        <div class="gs-top-row">
          <div class="gs-header-info">
            <div class="gs-title-wrap">
              <span class="gs-badge">⚡ Quick Start</span>
              <h3 class="gs-title">Setup your Swapper Profile (${completedTasks}/${totalTasks} completed)</h3>
            </div>
            <p class="gs-subtitle">Complete these quick steps to get verified swap proposals from stores.</p>
          </div>
          <div class="gs-actions-right">
            <button type="button" class="btn-gs-tour" id="btnRestartSwapperGuide">
              <span>Restart Guide</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </button>
            <button type="button" class="btn-gs-dismiss" id="btnDismissGettingStarted" aria-label="Dismiss checklist">&times;</button>
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="gs-progress-bar-wrap">
          <div class="gs-progress-fill" style="width: ${progressPercent}%;"></div>
        </div>

        <!-- Task Checklist Grid -->
        <div class="gs-tasks-grid">
          <div class="gs-task-item done">
            <div class="gs-task-check">✓</div>
            <div class="gs-task-info">
              <span class="gs-task-label">Create Account</span>
              <span class="gs-task-sub">Account is active</span>
            </div>
          </div>

          <div class="gs-task-item ${hasPhone ? 'done' : 'pending'}" id="taskItemWhatsApp">
            <div class="gs-task-check">${hasPhone ? '✓' : '2'}</div>
            <div class="gs-task-info">
              <span class="gs-task-label">Add WhatsApp Contact</span>
              <span class="gs-task-sub">${hasPhone ? 'Connected' : 'Click to add WhatsApp number'}</span>
            </div>
          </div>

          <div class="gs-task-item ${hasDevice ? 'done' : 'pending'}" id="taskItemDevice">
            <div class="gs-task-check">${hasDevice ? '✓' : '3'}</div>
            <div class="gs-task-info">
              <span class="gs-task-label">List Your Phone to Swap</span>
              <span class="gs-task-sub">${hasDevice ? 'Phone listed for swap' : 'Click to list phone with photos & specs'}</span>
            </div>
          </div>

          <div class="gs-task-item ${hasMadeSwap ? 'done' : 'pending'}" id="taskItemFirstSwap">
            <div class="gs-task-check">${hasMadeSwap ? '✓' : '4'}</div>
            <div class="gs-task-info">
              <span class="gs-task-label">Propose a Phone Swap</span>
              <span class="gs-task-sub">${hasMadeSwap ? 'Swap request sent' : 'Find a phone and submit a proposal'}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    // Bind event clicks
    container.querySelector('#btnRestartSwapperGuide')?.addEventListener('click', () => {
      openOnboardingModal(user, 'customer');
    });

    container.querySelector('#btnDismissGettingStarted')?.addEventListener('click', () => {
      localStorage.setItem(KEY_PREFIX_DISMISSED + uid, 'true');
      container.style.display = 'none';
    });

    container.querySelector('#taskItemWhatsApp')?.addEventListener('click', () => {
      openOnboardingModal(user, 'customer');
    });

    container.querySelector('#taskItemDevice')?.addEventListener('click', () => {
      window.location.href = 'my-swaps.html?action=new';
    });

    container.querySelector('#taskItemFirstSwap')?.addEventListener('click', () => {
      const openModalBtn = document.getElementById('openConsumerSwapModalBtn');
      if (openModalBtn) openModalBtn.click();
    });

  } else {
    // --- DEALER CHECKLIST ---
    const hasShop = Boolean(localStorage.getItem('naijaswap_shop_' + uid));
    const isVerified = localStorage.getItem('naijaswap_dealer_verified_' + uid) === 'true';
    const listings = JSON.parse(localStorage.getItem('naijaswap_marketplace_listings') || '[]');
    const hasListing = Array.isArray(listings) && listings.some(l => l.storeId === uid || l.storeId === 'store_prime');

    let completedTasks = 1; // Dealer account created
    if (hasShop) completedTasks++;
    if (isVerified) completedTasks++;
    if (hasListing) completedTasks++;

    const totalTasks = 4;
    const progressPercent = Math.round((completedTasks / totalTasks) * 100);

    if (progressPercent === 100) {
      container.style.display = 'none';
      return;
    }

    container.innerHTML = `
      <div class="gs-card gs-card-dealer">
        <div class="gs-top-row">
          <div class="gs-header-info">
            <div class="gs-title-wrap">
              <span class="gs-badge gs-badge-cyan">🏬 Store Activation</span>
              <h3 class="gs-title">Partner Store Launchpad (${completedTasks}/${totalTasks} steps)</h3>
            </div>
            <p class="gs-subtitle">Complete your partner store profile to unlock verified badge and receive buyer swap inquiries.</p>
          </div>
          <div class="gs-actions-right">
            <button type="button" class="btn-gs-tour" id="btnRestartDealerGuide">
              <span>Setup Guide</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </button>
            <button type="button" class="btn-gs-dismiss" id="btnDismissGettingStarted" aria-label="Dismiss checklist">&times;</button>
          </div>
        </div>

        <div class="gs-progress-bar-wrap">
          <div class="gs-progress-fill gs-fill-cyan" style="width: ${progressPercent}%;"></div>
        </div>

        <div class="gs-tasks-grid">
          <div class="gs-task-item done">
            <div class="gs-task-check">✓</div>
            <div class="gs-task-info">
              <span class="gs-task-label">Store Account</span>
              <span class="gs-task-sub">Partner account ready</span>
            </div>
          </div>

          <div class="gs-task-item ${hasShop ? 'done' : 'pending'}" id="dealerTaskShop">
            <div class="gs-task-check">${hasShop ? '✓' : '2'}</div>
            <div class="gs-task-info">
              <span class="gs-task-label">Physical Stall & Hub</span>
              <span class="gs-task-sub">${hasShop ? 'Configured' : 'Add shop address & hotline'}</span>
            </div>
          </div>

          <div class="gs-task-item ${isVerified ? 'done' : 'pending'}" id="dealerTaskVerif">
            <div class="gs-task-check">${isVerified ? '✓' : '3'}</div>
            <div class="gs-task-info">
              <span class="gs-task-label">KYC Verification</span>
              <span class="gs-task-sub">${isVerified ? 'Verified Partner' : 'Submit ID & shop proof'}</span>
            </div>
          </div>

          <div class="gs-task-item ${hasListing ? 'done' : 'pending'}" id="dealerTaskListing">
            <div class="gs-task-check">${hasListing ? '✓' : '4'}</div>
            <div class="gs-task-info">
              <span class="gs-task-label">Publish Phone Listing</span>
              <span class="gs-task-sub">${hasListing ? 'Stock listed' : 'Add your first phone for swap'}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnRestartDealerGuide')?.addEventListener('click', () => {
      openOnboardingModal(user, 'dealer');
    });

    container.querySelector('#btnDismissGettingStarted')?.addEventListener('click', () => {
      localStorage.setItem(KEY_PREFIX_DISMISSED + uid, 'true');
      container.style.display = 'none';
    });

    container.querySelector('#dealerTaskShop')?.addEventListener('click', () => {
      openOnboardingModal(user, 'dealer');
    });

    container.querySelector('#dealerTaskVerif')?.addEventListener('click', () => {
      window.location.href = 'dealer-verification.html';
    });

    container.querySelector('#dealerTaskListing')?.addEventListener('click', () => {
      window.location.href = 'dealer-listings.html?action=new';
    });
  }
}

// Expose globally on window for manual triggers and menu dropdowns
if (typeof window !== 'undefined') {
  window.NaijaSwapOnboarding = {
    init: initOnboarding,
    open: openOnboardingModal,
    close: closeOnboardingModal,
    renderChecklist: renderGettingStartedWidget
  };
}
