# 🔥 NigerSwap — Firebase Backend Architecture, Rules & Indexes

This guide details the complete Firebase configuration for NigerSwap, including Firestore collection schemas, Security Rules, Composite Indexes, and Authentication setup.

---

## 🏗️ 1. Firestore Database Schema

### `users` Collection (Customers, Dealers & Admins)
Path: `/users/{userId}`
```json
{
  "uid": "string (Firebase Auth UID)",
  "role": "customer" | "dealer" | "admin",
  "displayName": "Emeka Obi",
  "email": "emeka@example.com",
  "phoneNumber": "+2348012345678",
  "avatarUrl": "https://...",
  "state": "Lagos",
  "city": "Ikeja",
  "createdAt": "timestamp",
  "updatedAt": "timestamp",
  "isBanned": false
}
```

### `dealers` Collection (Public Business Profiles)
Path: `/dealers/{dealerId}` (matches `uid` of dealer user)
```json
{
  "dealerId": "string (UID)",
  "businessName": "SlotTech Gadgets",
  "marketHub": "Computer Village, Ikeja",
  "state": "Lagos",
  "fullAddress": "Shop 12, Medical Road, Computer Village, Ikeja, Lagos",
  "whatsappNumber": "+2348098765432",
  "phoneNumber": "+2348012345678",
  "cacNumber": "RC-1234567",
  "logoUrl": "https://...",
  "shopPhotos": ["https://..."],
  "openingHours": "Mon-Sat: 9:00 AM - 6:30 PM",
  "isVerified": true,
  "verificationTier": "gold" | "silver" | "standard",
  "rating": 4.9,
  "totalReviews": 34,
  "totalCompletedSwaps": 128,
  "subscriptionPlan": "pro",
  "subscriptionExpiresAt": "timestamp",
  "isFeatured": true,
  "featuredExpiresAt": "timestamp",
  "createdAt": "timestamp"
}
```

### `swap_offers` Collection (Dealer Swap Listings)
Path: `/swap_offers/{offerId}`
```json
{
  "offerId": "string (Auto ID)",
  "dealerId": "string (Dealer UID)",
  "dealerName": "SlotTech Gadgets",
  "dealerLocation": {
    "state": "Lagos",
    "marketHub": "Computer Village, Ikeja"
  },
  "offeredPhone": {
    "brand": "Apple",
    "model": "iPhone 15 Pro",
    "storage": "256GB",
    "color": "Natural Titanium",
    "condition": "Pristine UK-Used" | "Brand New" | "Open Box" | "Good Condition",
    "batteryHealth": 96,
    "simType": "Physical Dual SIM" | "eSIM + Physical" | "Single SIM",
    "warrantyDays": 90,
    "images": ["https://..."]
  },
  "acceptedTradeIns": [
    {
      "brand": "Apple",
      "model": "iPhone 13 Pro",
      "minCondition": "Good",
      "estimatedTopUpMin": 220000,
      "estimatedTopUpMax": 260000
    },
    {
      "brand": "Apple",
      "model": "iPhone 14 Pro",
      "minCondition": "Good",
      "estimatedTopUpMin": 110000,
      "estimatedTopUpMax": 140000
    },
    {
      "brand": "Samsung",
      "model": "Galaxy S23 Ultra",
      "minCondition": "Good",
      "estimatedTopUpMin": 130000,
      "estimatedTopUpMax": 160000
    }
  ],
  "status": "active" | "paused" | "swapped",
  "isFeatured": true,
  "viewCount": 240,
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### `swap_requests` Collection (Customer Inquiries)
Path: `/swap_requests/{requestId}`
```json
{
  "requestId": "string (Auto ID)",
  "offerId": "string (Swap Offer ID)",
  "customerId": "string (Customer UID)",
  "customerName": "Tunde Bakare",
  "customerPhone": "+2348033334444",
  "dealerId": "string (Dealer UID)",
  "customerDevice": {
    "brand": "Apple",
    "model": "iPhone 13 Pro",
    "storage": "128GB",
    "color": "Sierra Blue",
    "condition": "Clean, minor edge scuff",
    "batteryHealth": 85,
    "hasOriginalBox": true,
    "hasReceipt": true,
    "photos": ["https://..."]
  },
  "proposedTopUp": 240000,
  "customerNote": "Can come to Computer Village on Saturday afternoon for physical inspection.",
  "status": "pending" | "accepted" | "counter_offered" | "declined" | "completed",
  "dealerResponse": {
    "note": "Bring it in Saturday before 4 PM. Target top-up ₦235,000 if battery health and screen are verified original.",
    "counterTopUp": 235000,
    "respondedAt": "timestamp"
  },
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### `reviews` Collection
Path: `/reviews/{reviewId}`
```json
{
  "reviewId": "string",
  "dealerId": "string",
  "customerId": "string",
  "customerName": "Chioma Eze",
  "swapSummary": "Swapped iPhone 11 for iPhone 13",
  "rating": 5,
  "comment": "Smooth transaction at their Banex shop. Fair valuation and clean phone!",
  "createdAt": "timestamp"
}
```

### `subscriptions` Collection
Path: `/subscriptions/{subId}`
```json
{
  "subId": "string",
  "dealerId": "string",
  "planId": "starter" | "pro" | "market_leader",
  "amountPaid": 25000,
  "currency": "NGN",
  "paymentReference": "pstk_ref_987654321",
  "status": "active" | "expired",
  "startedAt": "timestamp",
  "expiresAt": "timestamp"
}
```

---

## 🔒 2. Firestore Security Rules

Copy and paste these rules into your **Firebase Console ➔ Firestore Database ➔ Rules**:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper Functions
    function isSignedIn() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return isSignedIn() && request.auth.uid == userId;
    }
    
    function getUserData() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }
    
    function isAdmin() {
      return isSignedIn() && getUserData().role == 'admin';
    }
    
    function isDealer() {
      return isSignedIn() && (getUserData().role == 'dealer' || getUserData().role == 'admin');
    }

    // Users Collection
    match /users/{userId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn() && request.auth.uid == userId;
      allow update: if isOwner(userId) || isAdmin();
      allow delete: if isAdmin();
    }

    // Dealers Collection (Public business profiles)
    match /dealers/{dealerId} {
      allow read: if true; // Public directory
      allow create: if isSignedIn() && request.auth.uid == dealerId;
      allow update: if isOwner(dealerId) || isAdmin();
      allow delete: if isAdmin();
    }

    // Swap Offers Collection
    match /swap_offers/{offerId} {
      allow read: if true; // Publicly browsable
      allow create: if isDealer() && request.resource.data.dealerId == request.auth.uid;
      allow update: if (isDealer() && resource.data.dealerId == request.auth.uid) || isAdmin();
      allow delete: if (isDealer() && resource.data.dealerId == request.auth.uid) || isAdmin();
    }

    // Swap Requests Collection (Private customer-dealer transactions)
    match /swap_requests/{requestId} {
      allow read: if isSignedIn() && (
        resource.data.customerId == request.auth.uid || 
        resource.data.dealerId == request.auth.uid || 
        isAdmin()
      );
      allow create: if isSignedIn() && request.resource.data.customerId == request.auth.uid;
      allow update: if isSignedIn() && (
        resource.data.customerId == request.auth.uid || 
        resource.data.dealerId == request.auth.uid || 
        isAdmin()
      );
      allow delete: if isAdmin();
    }

    // Reviews Collection
    match /reviews/{reviewId} {
      allow read: if true;
      allow create: if isSignedIn() && request.resource.data.customerId == request.auth.uid;
      allow update, delete: if isOwner(resource.data.customerId) || isAdmin();
    }

    // Subscriptions Collection
    match /subscriptions/{subId} {
      allow read: if isSignedIn() && (resource.data.dealerId == request.auth.uid || isAdmin());
      allow write: if isAdmin();
    }

    // Favorites Collection
    match /favorites/{favId} {
      allow read, write: if isSignedIn() && request.auth.uid == resource.data.userId;
      allow create: if isSignedIn() && request.resource.data.userId == request.auth.uid;
    }

    // Notifications Collection
    match /notifications/{notifId} {
      allow read, update: if isSignedIn() && resource.data.userId == request.auth.uid;
      allow create: if isSignedIn(); // Triggered by swap status events
      allow delete: if isOwner(resource.data.userId) || isAdmin();
    }
  }
}
```

---

## ⚡ 3. Required Firestore Composite Indexes

To allow high-speed filtering of swap listings by brand, location, and featured status, configure these composite indexes in **Firebase Console ➔ Firestore Database ➔ Indexes**:

### Index 1: Browse Active Offers by Brand & Recency
* **Collection ID:** `swap_offers`
* **Fields indexed:**
  1. `offeredPhone.brand` (Ascending)
  2. `status` (Ascending)
  3. `createdAt` (Descending)
* **Query Scope:** Collection

### Index 2: Featured Offers by State & Recency
* **Collection ID:** `swap_offers`
* **Fields indexed:**
  1. `dealerLocation.state` (Ascending)
  2. `isFeatured` (Ascending)
  3. `status` (Ascending)
  4. `createdAt` (Descending)
* **Query Scope:** Collection

### Index 3: Dealer Customer Swap Requests by Status
* **Collection ID:** `swap_requests`
* **Fields indexed:**
  1. `dealerId` (Ascending)
  2. `status` (Ascending)
  3. `createdAt` (Descending)
* **Query Scope:** Collection

### Index 4: Customer Inquiries History
* **Collection ID:** `swap_requests`
* **Fields indexed:**
  1. `customerId` (Ascending)
  2. `status` (Ascending)
  3. `createdAt` (Descending)
* **Query Scope:** Collection

---

## 🔑 4. Firebase Authentication Setup Checklist

In **Firebase Console ➔ Build ➔ Authentication ➔ Sign-in method**, enable:

1. **Email/Password:**
   - Enable "Email/Password".
   - (Optional) Enable "Email link (passwordless sign-in)".

2. **Google:**
   - Enable "Google" provider.
   - Configure public support email.

3. **Phone:**
   - Enable "Phone" provider.
   - Add test phone numbers (e.g., `+234 800 000 0000` with verification code `123456`) for local testing without incurring SMS charges.

4. **Authorized Domains:**
   - Ensure `localhost`, `127.0.0.1`, and your production domain are added under **Settings ➔ Authorized domains**.
