/**
 * NaijaSwap - User Onboarding & Re-engagement Automation Engine
 * Runs background checks for onboarding sequences (Day 2, Day 3),
 * inactivity reminders (7, 14, 30 days), and pending swap proposal reminders.
 */

const { emailService } = require('./email-service');

class AutomationService {
  constructor(options = {}) {
    this.db = options.db || null;
  }

  setFirestore(db) {
    this.db = db;
  }

  /**
   * Run all scheduled automated email jobs
   */
  async runDailyAutomations() {
    if (!this.db) {
      console.warn('[AutomationService] Firestore not initialized. Skipping daily automations.');
      return { ok: false, error: 'Firestore not initialized' };
    }

    const results = {
      onboardingDay2Sent: 0,
      onboardingDay3Sent: 0,
      inactivitySent: 0,
      pendingSwapRemindersSent: 0,
      errors: []
    };

    try {
      results.onboardingDay2Sent = await this.processOnboardingDay2();
    } catch (err) {
      results.errors.push(`Onboarding Day 2 error: ${err.message}`);
    }

    try {
      results.onboardingDay3Sent = await this.processOnboardingDay3();
    } catch (err) {
      results.errors.push(`Onboarding Day 3 error: ${err.message}`);
    }

    try {
      results.inactivitySent = await this.processInactivityReminders();
    } catch (err) {
      results.errors.push(`Inactivity reminders error: ${err.message}`);
    }

    try {
      results.pendingSwapRemindersSent = await this.processPendingSwapReminders();
    } catch (err) {
      results.errors.push(`Pending swaps error: ${err.message}`);
    }

    console.log('[AutomationService] Daily automations completed:', results);
    return { ok: true, results };
  }

  /**
   * Day 2 Onboarding: 24h after verification if first action is incomplete
   */
  async processOnboardingDay2() {
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000);

    let sentCount = 0;
    try {
      // Find users verified between 24 and 48 hours ago
      const usersSnap = await this.db.collection('users')
        .where('emailVerified', '==', true)
        .where('emailVerifiedAt', '<=', dayAgo)
        .where('emailVerifiedAt', '>=', twoDaysAgo)
        .limit(100)
        .get();

      for (const doc of usersSnap.docs) {
        const user = doc.data();
        if (!user.email || user.onboardingDay2Sent) continue;

        const role = user.accountType || user.role || 'customer';
        let hasCompletedAction = false;

        if (role === 'dealer') {
          // Check if dealer has published at least 1 listing
          const listings = await this.db.collection('listings')
            .where('dealerUid', '==', doc.id)
            .limit(1)
            .get();
          hasCompletedAction = !listings.empty;
        } else {
          // Check if swapper has submitted at least 1 swap request or completed profile
          const swaps = await this.db.collection('swapRequests')
            .where('customerUid', '==', doc.id)
            .limit(1)
            .get();
          hasCompletedAction = !swaps.empty || (user.phoneNumber && user.displayName);
        }

        if (!hasCompletedAction) {
          const firstName = user.displayName ? user.displayName.split(' ')[0] : '';
          const result = await emailService.sendMailDirect({
            to: user.email,
            subject: "You're one step closer to your next swap.",
            html: require('./email-templates').templateOnboardingNudgeDay2({
              firstName,
              accountType: role
            }).html,
            text: require('./email-templates').templateOnboardingNudgeDay2({
              firstName,
              accountType: role
            }).text,
            templateName: 'onboarding_day2',
            idempotencyKey: `onboarding_day2_${doc.id}`,
            isMarketing: false
          });

          if (result.ok && !result.skipped) {
            sentCount++;
            await doc.ref.update({ onboardingDay2Sent: true, onboardingDay2SentAt: new Date() });
          }
        }
      }
    } catch (e) {
      console.warn('[AutomationService] processOnboardingDay2 note:', e.message);
    }
    return sentCount;
  }

  /**
   * Day 3 Onboarding: 72h after verification if still incomplete
   */
  async processOnboardingDay3() {
    const now = Date.now();
    const threeDaysAgo = new Date(now - 72 * 60 * 60 * 1000);
    const fourDaysAgo = new Date(now - 96 * 60 * 60 * 1000);

    let sentCount = 0;
    try {
      const usersSnap = await this.db.collection('users')
        .where('emailVerified', '==', true)
        .where('emailVerifiedAt', '<=', threeDaysAgo)
        .where('emailVerifiedAt', '>=', fourDaysAgo)
        .limit(100)
        .get();

      for (const doc of usersSnap.docs) {
        const user = doc.data();
        if (!user.email || user.onboardingDay3Sent) continue;

        const role = user.accountType || user.role || 'customer';
        const firstName = user.displayName ? user.displayName.split(' ')[0] : '';

        const result = await emailService.sendMailDirect({
          to: user.email,
          subject: 'Ready to get started on NaijaSwap?',
          html: require('./email-templates').templateOnboardingGuideDay3({
            firstName,
            accountType: role
          }).html,
          text: require('./email-templates').templateOnboardingGuideDay3({
            firstName,
            accountType: role
          }).text,
          templateName: 'onboarding_day3',
          idempotencyKey: `onboarding_day3_${doc.id}`,
          isMarketing: false
        });

        if (result.ok && !result.skipped) {
          sentCount++;
          await doc.ref.update({ onboardingDay3Sent: true, onboardingDay3SentAt: new Date() });
        }
      }
    } catch (e) {
      console.warn('[AutomationService] processOnboardingDay3 note:', e.message);
    }
    return sentCount;
  }

  /**
   * Inactivity reminders (7, 14, 30 days)
   */
  async processInactivityReminders() {
    let sentCount = 0;
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

    try {
      const usersSnap = await this.db.collection('users')
        .where('emailVerified', '==', true)
        .limit(200)
        .get();

      for (const doc of usersSnap.docs) {
        const user = doc.data();
        if (!user.email || user.status === 'suspended' || user.status === 'banned') continue;

        // Check last active timestamp
        const lastActiveTime = user.lastActiveAt 
          ? (user.lastActiveAt.toMillis ? user.lastActiveAt.toMillis() : new Date(user.lastActiveAt).getTime())
          : (user.createdAt ? (user.createdAt.toMillis ? user.createdAt.toMillis() : new Date(user.createdAt).getTime()) : 0);

        if (!lastActiveTime) continue;

        const daysInactive = Math.floor((now - lastActiveTime) / (24 * 60 * 60 * 1000));
        let shouldSend = false;
        let milestone = 0;

        if (daysInactive >= 30 && !user.inactivity30Sent) {
          shouldSend = true;
          milestone = 30;
        } else if (daysInactive >= 14 && !user.inactivity14Sent) {
          shouldSend = true;
          milestone = 14;
        } else if (daysInactive >= 7 && !user.inactivity7Sent) {
          shouldSend = true;
          milestone = 7;
        }

        if (shouldSend) {
          const firstName = user.displayName ? user.displayName.split(' ')[0] : '';
          const result = await emailService.sendMailDirect({
            to: user.email,
            subject: milestone >= 30 ? 'We miss you on NaijaSwap!' : 'New phone swaps are waiting for you on NaijaSwap',
            html: require('./email-templates').templateInactivityReminder({
              firstName,
              daysInactive: milestone
            }).html,
            text: require('./email-templates').templateInactivityReminder({
              firstName,
              daysInactive: milestone
            }).text,
            templateName: `inactivity_${milestone}`,
            idempotencyKey: `inactivity_${milestone}_${doc.id}`,
            isMarketing: true // Respects suppression & unsubscribe
          });

          if (result.ok && !result.skipped) {
            sentCount++;
            await doc.ref.update({
              [`inactivity${milestone}Sent`]: true,
              [`inactivity${milestone}SentAt`]: new Date()
            });
          }
        }
      }
    } catch (e) {
      console.warn('[AutomationService] processInactivityReminders note:', e.message);
    }
    return sentCount;
  }

  /**
   * Pending swap request reminders (unanswered > 24 hours)
   */
  async processPendingSwapReminders() {
    let sentCount = 0;
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

    try {
      const pendingSnap = await this.db.collection('swapRequests')
        .where('status', '==', 'pending')
        .where('createdAt', '<=', dayAgo)
        .limit(50)
        .get();

      for (const doc of pendingSnap.docs) {
        const swap = doc.data();
        if (swap.pendingReminderSent) continue;

        // Retrieve dealer / listing owner email
        let dealerEmail = swap.dealerEmail;
        let dealerName = swap.dealerName || 'Dealer';

        if (!dealerEmail && swap.dealerUid) {
          const userDoc = await this.db.collection('users').doc(swap.dealerUid).get();
          if (userDoc.exists) {
            dealerEmail = userDoc.data().email;
            dealerName = userDoc.data().displayName || userDoc.data().shopName || 'Dealer';
          }
        }

        if (dealerEmail) {
          const result = await emailService.sendPendingSwapReminder(dealerEmail, {
            recipientName: dealerName,
            requesterName: swap.customerName || 'A customer',
            targetPhone: swap.targetDeviceModel || 'Phone',
            requestId: doc.id
          });

          if (result.ok) {
            sentCount++;
            await doc.ref.update({
              pendingReminderSent: true,
              pendingReminderSentAt: new Date()
            });
          }
        }
      }
    } catch (e) {
      console.warn('[AutomationService] processPendingSwapReminders note:', e.message);
    }
    return sentCount;
  }
}

const automationService = new AutomationService();

module.exports = {
  AutomationService,
  automationService
};
