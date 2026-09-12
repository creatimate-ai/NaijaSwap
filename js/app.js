/**
 * NigerSwap - Modern Interactive Landing Page Logic
 * Features:
 * - Interactive Device Swap Simulator with preset switching & dynamic animations
 * - Live Top-up and Dealer Match Calculators
 * - 3D Perspective Card Tilt on mouse move
 * - Featured Swaps Filter Engine
 * - Modals for "Find a Swap", "Become a Dealer", and "View Swap Details"
 * - Toast Notification System
 * - Scroll Reveal & Sticky Glass Header
 */

document.addEventListener('DOMContentLoaded', () => {
  initScrollHeader();
  initMobileMenu();
  initScrollReveal();
  initSwapSimulator();
  initCardTilt();
  initFilterTabs();
  initModals();
  initToast();
  initMobileSliders();
  initFAQ();
  initBackToTop();
});

/* ==========================================================================
   1. STICKY HEADER SCROLL STATE
   ========================================================================== */
function initScrollHeader() {
  const header = document.getElementById('siteHeader');
  if (!header) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }, { passive: true });
}

/* ==========================================================================
   2. MOBILE NAVIGATION DRAWER
   ========================================================================== */
function initMobileMenu() {
  const toggleBtn = document.getElementById('mobileMenuToggle');
  const drawer = document.getElementById('mobileDrawer');
  if (!toggleBtn || !drawer) return;

  toggleBtn.addEventListener('click', () => {
    const isOpen = drawer.classList.toggle('open');
    toggleBtn.setAttribute('aria-expanded', isOpen);
  });

  // Close mobile drawer when clicking a link
  drawer.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      drawer.classList.remove('open');
      toggleBtn.setAttribute('aria-expanded', 'false');
    });
  });
}

/* ==========================================================================
   3. SCROLL REVEAL ANIMATION
   ========================================================================== */
function initScrollReveal() {
  const revealItems = document.querySelectorAll('.reveal-item');
  if (!revealItems.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -40px 0px'
  });

  revealItems.forEach(item => observer.observe(item));
}

/* ==========================================================================
   4. INTERACTIVE HERO DEVICE SWAP SIMULATOR
   ========================================================================== */

/**
 * Dealer Matching Service (Demo / Backend Adapter)
 * 
 * BACKEND INTEGRATION NOTE:
 * The landing page currently displays "24 dealers matching" as demo content.
 * When integrating with a live database or backend API, update getMatchingCount()
 * to fetch live counts (e.g. from `/api/dealers/matching?have=${have}&want=${want}`).
 */
const DealerMatchingService = {
  // Demo example count for landing page presentation
  DEFAULT_MATCHING_COUNT: 24,

  // Fetch or calculate matching dealer count (ready for backend / database integration)
  getMatchingCount: function(sourceDevice, targetDevice) {
    // Return example count for the demo; replace with live backend data
    return this.DEFAULT_MATCHING_COUNT;
  },

  // Format count into user-facing badge label
  formatBadgeText: function(count) {
    return `${count} dealers matching`;
  }
};

const SWAP_PRESETS = [
  {
    // Preset 0
    source: {
      name: 'iPhone 12 Pro',
      spec: 'Pacific Blue • 128GB • Clean',
      battery: '87% Battery',
      image: 'assets/iPhone 12 Pro.jpg'
    },
    target: {
      name: 'iPhone 15 Pro',
      spec: 'Natural Titanium • 128GB',
      battery: '100% Battery',
      image: 'assets/iPhone 15 Pro.jpg'
    },
    topup: '+₦240,000'
  },
  {
    // Preset 1: iPhone 13 -> iPhone 14 Pro
    source: {
      name: 'iPhone 13',
      spec: 'Starlight White • 128GB • Pristine',
      battery: '91% Battery',
      image: 'assets/iPhone 13 (128GB).jpg'
    },
    target: {
      name: 'iPhone 14 Pro',
      spec: 'Silver / Space Black • 128GB',
      battery: '94% Battery',
      image: 'assets/iPhone 14 Pro (128GB).jpg'
    },
    topup: '+₦140,000'
  },
  {
    // Preset 2: Galaxy S22 -> Galaxy S24 Ultra
    source: {
      name: 'Galaxy S22 Ultra',
      spec: 'Phantom Black • 128GB • Grade A',
      battery: '88% Battery',
      image: 'assets/Samsung Galaxy S24 Ultra (256GB).jpg'
    },
    target: {
      name: 'Galaxy S24 Ultra',
      spec: 'Titanium Gray • 256GB • S-Pen',
      battery: '100% Battery',
      image: 'assets/Samsung Galaxy S24 Ultra (256GB).jpg'
    },
    topup: '+₦320,000'
  },
  {
    // Preset 3: iPhone 14 Pro -> iPhone 15 Pro Max
    source: {
      name: 'iPhone 14 Pro',
      spec: 'Space Black • 128GB • Clean',
      battery: '94% Battery',
      image: 'assets/iPhone 14 Pro (128GB).jpg'
    },
    target: {
      name: 'iPhone 15 Pro Max',
      spec: 'Natural Titanium • 256GB • Like New',
      battery: '100% Battery',
      image: 'assets/iPhone 15 Pro Max (256GB).jpg'
    },
    topup: '+₦280,000'
  }
];

let currentPresetIndex = 0;

function initSwapSimulator() {
  const presetButtons = document.querySelectorAll('.preset-pill');
  const triggerButton = document.getElementById('swapTriggerButton');
  if (!presetButtons.length) return;

  presetButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.currentTarget.dataset.swap, 10);
      if (index !== currentPresetIndex) {
        applySwapPreset(index);
      }
    });
  });

  // Clicking the center swap orb cycles to the next preset
  if (triggerButton) {
    triggerButton.addEventListener('click', () => {
      const nextIndex = (currentPresetIndex + 1) % SWAP_PRESETS.length;
      applySwapPreset(nextIndex);
      showToast('Switched to simulated phone pair!');
    });
  }
}

function applySwapPreset(index) {
  currentPresetIndex = index;
  const data = SWAP_PRESETS[index];
  if (!data) return;

  // Update preset active buttons
  document.querySelectorAll('.preset-pill').forEach((btn, i) => {
    btn.classList.toggle('active', i === index);
  });

  // Animate phone cards with a quick smooth micro-scale
  const sourceCard = document.getElementById('sourceDeviceCard');
  const targetCard = document.getElementById('targetDeviceCard');
  const triggerButton = document.getElementById('swapTriggerButton');

  if (triggerButton) {
    triggerButton.style.transform = 'scale(1.15) rotate(360deg)';
    setTimeout(() => {
      triggerButton.style.transform = '';
    }, 400);
  }

  if (sourceCard && targetCard) {
    sourceCard.style.opacity = '0.5';
    targetCard.style.opacity = '0.5';
    sourceCard.style.transform = 'scale(0.97)';
    targetCard.style.transform = 'scale(0.97)';

    setTimeout(() => {
      // Update Source
      setText('sourceDeviceName', data.source.name);
      setText('sourceDeviceSpec', data.source.spec);
      setText('sourcePhoneBattery', data.source.battery);

      const sourceImg = document.getElementById('sourcePhoneImg');
      if (sourceImg && data.source.image) {
        sourceImg.src = data.source.image;
        sourceImg.alt = data.source.name;
      }

      // Update Target
      setText('targetDeviceName', data.target.name);
      setText('targetDeviceSpec', data.target.spec);
      setText('targetPhoneBattery', data.target.battery);

      const targetImg = document.getElementById('targetPhoneImg');
      if (targetImg && data.target.image) {
        targetImg.src = data.target.image;
        targetImg.alt = data.target.name;
      }

      // Update Swap Hub: Estimated Top-up & Dealer Match Count
      setText('swapTopupAmount', data.topup);

      // Structure dealer count so it can easily connect to real backend data
      const matchingCount = DealerMatchingService.getMatchingCount(data.source.name, data.target.name);
      setText('swapDealersCount', DealerMatchingService.formatBadgeText(matchingCount));

      sourceCard.style.opacity = '1';
      targetCard.style.opacity = '1';
      sourceCard.style.transform = '';
      targetCard.style.transform = '';
    }, 200);
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/* ==========================================================================
   5. 3D PERSPECTIVE CARD TILT EFFECT (DESKTOP ONLY)
   ========================================================================== */
function initCardTilt() {
  if (window.matchMedia('(pointer: coarse)').matches) return; // Skip touch devices

  const tiltCards = document.querySelectorAll('.tilt-element');
  tiltCards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      const rotateX = ((y - centerY) / centerY) * -6;
      const rotateY = ((x - centerX) / centerX) * 6;

      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });
}

/* ==========================================================================
   6. FEATURED SWAPS CATEGORY FILTER
   ========================================================================== */
function initFilterTabs() {
  const filterButtons = document.querySelectorAll('.filter-btn');
  const cards = document.querySelectorAll('.swap-offer-card');
  if (!filterButtons.length) return;

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const grid = document.getElementById('swapCardsGrid');
      if (grid) grid.scrollTo({ left: 0, behavior: 'smooth' });

      cards.forEach(card => {
        const category = card.dataset.category;
        if (filter === 'all' || category === filter) {
          card.style.display = 'flex';
          card.style.opacity = '0';
          setTimeout(() => {
            card.style.transition = 'opacity 0.35s ease';
            card.style.opacity = '1';
          }, 20);
        } else {
          card.style.display = 'none';
        }
      });
    });
  });
}

/* ==========================================================================
   7. MODAL DIALOGS & INTERACTIVE FLOWS
   ========================================================================== */
function initModals() {
  const viewSwapModal = document.getElementById('viewSwapModal');

  // Ensure all modals are closed on load and when restored from browser back-forward cache (bfcache)
  function closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach(modal => closeModal(modal));
  }
  closeAllModals();
  window.addEventListener('pageshow', closeAllModals);

  // View Swap Card Details Trigger
  const viewSwapButtons = document.querySelectorAll('.view-swap-btn');
  viewSwapButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const dataset = btn.dataset;
      setText('detailTargetPhone', dataset.device || 'Featured Phone');
      setText('detailTradeIn', dataset.swapFrom || 'Any standard smartphone');
      setText('detailTopup', dataset.topup || '₦0');
      setText('detailCondition', dataset.condition || 'Grade A');
      setText('detailDealerName', dataset.dealer || 'Verified Partner Dealer');
      setText('detailDealerLocation', dataset.location || 'Computer Village, Ikeja, Lagos');
      setText('detailColor', dataset.color || 'Standard Finish');

      const modalImg = document.getElementById('detailDeviceImg');
      if (modalImg && dataset.img) {
        modalImg.src = dataset.img;
        modalImg.alt = dataset.device || 'Device preview';
      }

      openModal(viewSwapModal);
    });
  });

  // Footer dealer verification trigger
  const openDealerCheckBtn = document.getElementById('openDealerCheckModal');
  if (openDealerCheckBtn) {
    openDealerCheckBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showToast('✅ All NigerSwap dealers hold physical verification and CAC registration.');
    });
  }

  // Close handlers
  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.close;
      const modal = document.getElementById(targetId);
      if (modal) closeModal(modal);
    });
  });

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        closeModal(backdrop);
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop.active').forEach(m => closeModal(m));
    }
  });

  // Swap Request WhatsApp Button inside View Swap Modal
  const requestSwapBtn = document.getElementById('btnRequestThisSwap');
  if (requestSwapBtn) {
    requestSwapBtn.addEventListener('click', () => {
      closeModal(viewSwapModal);
      showToast('🚀 Opening WhatsApp chat with verified dealer for instant inspection booking...');
    });
  }
}

function openModal(modal) {
  if (!modal) return;
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

/* ==========================================================================
   8. TOAST NOTIFICATION UTILITY
   ========================================================================== */
function initToast() {
  // Toast container is declared in HTML
}

function showToast(message, duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span class="toast-dot" style="color: #00D26A;">●</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ==========================================================================
   9. MOBILE SLIDER CONTROLLER & DOTS SYNC
   ========================================================================== */
function initMobileSliders() {
  // Steps Slider Dots
  const stepsGrid = document.querySelector('.steps-grid');
  const stepDots = document.querySelectorAll('#stepsSliderDots .dot');

  if (stepsGrid && stepDots.length) {
    stepsGrid.addEventListener('scroll', () => {
      const scrollPos = stepsGrid.scrollLeft;
      const card = stepsGrid.querySelector('.step-card');
      const cardWidth = card ? card.offsetWidth + 12 : 280;
      const activeIdx = Math.round(scrollPos / cardWidth);

      stepDots.forEach((dot, idx) => {
        dot.classList.toggle('active', idx === Math.min(Math.max(0, activeIdx), stepDots.length - 1));
      });
    }, { passive: true });
  }

  // Why NigerSwap Slider Dots
  const whyGrid = document.querySelector('.why-grid');
  const whyDots = document.querySelectorAll('#whySliderDots .dot');

  if (whyGrid && whyDots.length) {
    whyGrid.addEventListener('scroll', () => {
      const scrollPos = whyGrid.scrollLeft;
      const card = whyGrid.querySelector('.why-card');
      const cardWidth = card ? card.offsetWidth + 12 : 280;
      const activeIdx = Math.round(scrollPos / cardWidth);

      whyDots.forEach((dot, idx) => {
        dot.classList.toggle('active', idx === Math.min(Math.max(0, activeIdx), whyDots.length - 1));
      });
    }, { passive: true });
  }
}

/* ==========================================================================
   10. FREQUENTLY ASKED QUESTIONS (FAQ) ACCORDION
   ========================================================================== */
function initFAQ() {
  const faqItems = document.querySelectorAll('.faq-item');
  if (!faqItems.length) return;

  faqItems.forEach(item => {
    const btn = item.querySelector('.faq-question-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const isCurrentlyOpen = item.classList.contains('active');

      // Close all other FAQ items for a clean single-open accordion feel
      faqItems.forEach(otherItem => {
        if (otherItem !== item) {
          otherItem.classList.remove('active');
          const otherBtn = otherItem.querySelector('.faq-question-btn');
          if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
        }
      });

      // Toggle current item
      if (isCurrentlyOpen) {
        item.classList.remove('active');
        btn.setAttribute('aria-expanded', 'false');
      } else {
        item.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

/* ==========================================================================
   11. FLOATING BACK TO TOP BUTTON
   ========================================================================== */
function initBackToTop() {
  const btn = document.getElementById('backToTopBtn');
  if (!btn) return;

  const toggleVisibility = () => {
    if (window.scrollY > 350) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  };

  window.addEventListener('scroll', toggleVisibility, { passive: true });
  toggleVisibility();

  btn.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
}
