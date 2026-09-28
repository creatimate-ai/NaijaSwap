# 📱 NigerSwap — Complete Platform Pages Specification

This document defines all 33 pages of the NigerSwap application, their core functionality, key user interactions, and technical requirements.

---

## 🟢 1. Customer Pages

| # | Page Name | Route / File | What It Does & Key Features |
|---|-----------|--------------|-----------------------------|
| **1** | **Landing Page** | `index.html` | Introduces NigerSwap, explains how phone swapping works, presents the dual "Phone I Have ➔ Phone I Want" quick search widget, showcases featured swap deals across Nigeria with estimated top-ups in Naira (`₦`), highlights verified dealer hubs (Computer Village, Banex, Garrison), and drives customer/dealer onboarding. |
| **2** | **Find My Swap** | `pages/customer/find-swap.html` | Step-by-step interactive swap discovery engine. Customers select the phone they currently own (brand, model, storage, cosmetic grade, battery health) and the phone they desire. Matches them with verified dealers holding that target device and accepting their trade-in. |
| **3** | **Browse Swap Offers** | `pages/customer/browse-offers.html` | Searchable, filterable catalog of all active phone swap listings posted by verified dealers. Filters include Target Brand/Model, Acceptable Trade-Ins, State/Market Hub (Lagos, Abuja, PH), Battery Health, Condition (UK Used, Brand New, Open Box), and Top-Up price bracket. |
| **4** | **Swap Offer Details** | `pages/customer/offer-details.html` | Deep-dive view of a specific swap offer. Displays high-resolution device photos, specifications, battery health, SIM status, accepted trade-in devices with estimated top-up ranges (₦), dealer shop location & verification badge, shop opening hours, and direct action buttons (Submit Request, WhatsApp Chat, Call Dealer). |
| **5** | **Dealer Profile** | `pages/customer/dealer-profile.html` | Public profile for a verified phone dealer. Includes shop name, physical market address with map pin, verification badge, trust rating & customer reviews, operating hours, WhatsApp/phone contact channels, and a gallery of all active swap offers available in their shop. |
| **6** | **Submit Swap Request** | `pages/customer/submit-request.html` | Structured swap proposal form where a customer submits their exact device details (photos, storage, IMEI/serial info optional, battery health, cosmetic condition, preferred inspection date/time) to a specific dealer offer. |
| **7** | **My Swap Requests** | `pages/customer/my-requests.html` | Customer's swap request tracker. Displays live status badges (`Pending Dealer Review`, `Accepted — Ready for Inspection`, `Declined`, `Completed`), dealer notes, estimated top-up breakdown, and direct chat/directions to the shop. |
| **8** | **Customer Dashboard** | `pages/customer/dashboard.html` | Central hub for logged-in customers. Provides quick stats (Active Swap Requests, Saved Deals, Favorite Dealers), recent notifications, recommended swap deals matching their current phone, and quick-action shortcuts. |
| **9** | **Favorites / Saved Swaps** | `pages/customer/favorites.html` | Saved swap listings and bookmarked verified dealers for quick price checking and future inspection visits. |
| **10** | **Notifications** | `pages/customer/notifications.html` | Real-time and historical notification center for swap request updates, dealer counter-offers, price drop alerts on desired models, and security notices. |
| **11** | **Profile / Account Settings** | `pages/customer/profile.html` | Customer profile management: personal info, phone number verification, default delivery/pickup city, notification preferences, saved current device info, and password/security settings. |

---

## 🔐 2. Authentication Pages

| # | Page Name | Route / File | What It Does & Key Features |
|---|-----------|--------------|-----------------------------|
| **12** | **Sign Up** | `pages/auth/signup.html` | Multi-role registration (Customer or Dealer). Supports Email/Password, Google OAuth 1-tap sign-in, and Nigerian Phone Number SMS OTP verification. Dealer registration prompts for business name and market hub. |
| **13** | **Login** | `pages/auth/login.html` | Seamless authentication portal with Email/Password, Google Sign-in, and Phone SMS login options with "Remember Me" and role-based redirect (Customer ➔ Dashboard, Dealer ➔ Dealer Portal, Admin ➔ Admin Panel). |
| **14** | **Forgot / Reset Password** | `pages/auth/forgot-password.html` | Firebase password reset email flow and phone SMS PIN recovery for seamless account recovery. |

---

## 🏪 3. Dealer Pages

| # | Page Name | Route / File | What It Does & Key Features |
|---|-----------|--------------|-----------------------------|
| **15** | **Dealer Dashboard** | `pages/dealer/dashboard.html` | Command center for phone dealers: active swap listings count, incoming swap requests, monthly lead volume, profile views, subscription status, and quick links to post new swap offers. |
| **16** | **Dealer Profile Setup** | `pages/dealer/profile-setup.html` | Management of the dealer's public profile: business name, shop logo/photo, physical store address, market hub (e.g. Ikeja Computer Village), WhatsApp business number, phone lines, CAC business registration number (for verification), and shop opening/closing hours. |
| **17** | **Add Swap Offer** | `pages/dealer/add-offer.html` | Form for dealers to list a phone available for swap. Specify offered phone (Brand, Model, Storage, Color, Condition, Battery %, Photos) and define accepted trade-in models with expected top-up ranges (e.g. "Accepts iPhone 12 Pro (₦180k - ₦220k top-up), iPhone 13 (₦120k - ₦150k top-up)"). |
| **18** | **Manage Swap Offers** | `pages/dealer/manage-offers.html` | Inventory table allowing dealers to edit pricing/top-up estimates, pause listings (e.g. when reserved), mark as swapped/completed, promote to featured, or delete. |
| **19** | **Swap Requests / Leads** | `pages/dealer/swap-requests.html` | Inbound swap lead management. View customer device specs, photos, and proposed trade-in. Dealer can Accept (with invitation to visit shop), Counter-Offer (adjust estimated top-up), or Decline with reason. |
| **20** | **Subscription & Billing** | `pages/dealer/subscription.html` | Tiered dealer subscription plans (Free Starter, Pro Dealer, Market Leader). Features Paystack / Flutterwave integration for automated Naira card / bank transfer renewals and invoice history. |
| **21** | **Featured Listings & Boosts** | `pages/dealer/featured-listings.html` | Dealer self-service tool to purchase homepage banners, top-of-search boosts, and "Verified Dealer Spotlight" placements to maximize swap inquiry volume. |

---

## 🛡️ 4. Admin Pages

| # | Page Name | Route / File | What It Does & Key Features |
|---|-----------|--------------|-----------------------------|
| **22** | **Admin Dashboard** | `pages/admin/dashboard.html` | High-level business analytics: total registered customers, active dealers, live swap offers, completed swap requests, total subscription revenue (₦), and system health metrics. |
| **23** | **Manage Customers** | `pages/admin/customers.html` | Directory of registered customers with search, account activity logs, phone verification status, and ability to suspend/ban fraudulent accounts. |
| **24** | **Manage Dealers & Verifications** | `pages/admin/dealers.html` | Review dealer applications, inspect shop photos & CAC documents, grant or revoke "Verified Dealer" badges, manage tier assignments, and suspend non-compliant vendors. |
| **25** | **Manage Swap Offers** | `pages/admin/offers.html` | Moderation queue for active swap listings. Flags unrealistic top-up values, inappropriate content, or misleading specs with quick remove/warning actions. |
| **26** | **Manage Featured Listings** | `pages/admin/featured.html` | Control active homepage hero spotlights, featured search banners, expiration dates, and custom promotional slots. |
| **27** | **Manage Subscription Plans** | `pages/admin/subscriptions.html` | Configure dealer subscription tiers, pricing (₦/month), listing limits, lead caps, and promotional discounts. |
| **28** | **Payments & Revenue** | `pages/admin/payments.html` | Comprehensive ledger of all subscription payments, featured listing fees, transaction IDs, payment gateway logs, and exportable financial reports. |
| **29** | **Reports & Dispute Resolution** | `pages/admin/reports.html` | Review reports submitted by customers or dealers regarding no-shows, condition misrepresentation, or shop disputes. Admin can take disciplinary actions. |

---

## ℹ️ 5. Supporting Pages

| # | Page Name | Route / File | What It Does & Key Features |
|---|-----------|--------------|-----------------------------|
| **30** | **Help / FAQ** | `pages/support/faq.html` | Comprehensive answers to common questions: "How does phone swapping work?", "How is the top-up calculated?", "What happens during shop inspection?", "How do I become a verified dealer?", "Is NigerSwap free for customers?". |
| **31** | **Contact & Support** | `pages/support/contact.html` | Customer and dealer contact channels: direct support ticketing form, WhatsApp support hotline, email, and physical office location in Nigeria. |
| **32** | **Terms & Conditions** | `pages/support/terms.html` | Clear legal guidelines defining NigerSwap as a discovery platform, clarifying dealer liability for device condition/inspection, and outlining user conduct rules. |
| **33** | **Privacy Policy** | `pages/support/privacy.html` | Compliance with Nigerian Data Protection Regulation (NDPR): how customer phone numbers, location data, and cookies are securely stored and protected. |
