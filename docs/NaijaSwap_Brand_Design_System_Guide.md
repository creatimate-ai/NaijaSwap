# 📱 NaijaSwap — Brand Identity & Design System Specification
**Official Handover Guide for Developers, Graphic Designers, Motion/Video Creators & Product Teams**  
*Version 1.0 • Updated November 2026 • Platform: NaijaSwap (Nigeria's #1 Phone Swap Network)*

---

## 📌 Executive Summary & Purpose
This document serves as the single source of truth for the **NaijaSwap** visual identity, digital design system, and technical interface specifications.

Whether you are:
- **A Frontend / Full-Stack Developer** building UI components, screens, or web/mobile features,
- **A Graphic / Brand Designer** crafting marketing flyers, banners, social media posts, or billboards,
- **A Motion / Video Editor** producing promo reels, TikTok/Instagram videos, explainers, or YouTube ads,
- **A Product / Content Manager** writing copy and maintaining brand consistency,

...this guide provides exact color codes, typography standards, logo assets, spacing, component rules, and design tokens to ensure 100% visual and functional consistency across every touchpoint.

---

## 💎 1. Brand Essence & Core Identity

| Attribute | Specification |
| :--- | :--- |
| **Official Brand Name** | **NaijaSwap** *(Note: camelCase wordmark styling with "Naija" + "Swap")* |
| **Primary Tagline** | *Nigeria's #1 Phone Swap Network* |
| **Secondary Taglines** | • *Swap Your Phone for The One You Want.*<br>• *Transparent Algorithmic Top-Up Valuations.*<br>• *No Stories, Just Swap.* |
| **Core Value Proposition** | Bilateral phone exchange connecting device owners with verified phone dealers across Nigerian physical tech hubs (Computer Village Ikeja, Banex Plaza Abuja, Garrison Port Harcourt) with guaranteed testing warranties and automated fair top-up calculations. |
| **Brand Personality** | Modern, Trustworthy, Fast, Cyber-Tech, Transparent, Proudly Nigerian. |
| **Currency Representation** | Nigerian Naira symbol: **₦** (Always preceding values with standard comma separators, e.g., `₦145,000`). |

---

## 🎨 2. Master Color Palette & Design Tokens

NaijaSwap features a high-tech dual palette: an **Emerald Nigerian Heritage Primary** paired with an **Electric Cyan Accent**, set against an **Obsidian Deep Space Dark Theme** and a **Slate Crisp Light Theme**.

### 2.1 Primary Brand & Accent Colors

| Color Role | Token Name | HEX | RGB | HSL | Best Used For |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Heritage Emerald** | `--brand-primary` | `#008751` | `rgb(0, 135, 81)` | `hsl(156, 100%, 26%)` | Primary buttons, official brand headers, Nigerian identity accents |
| **Deep Forest Emerald** | `--brand-dark` | `#005C37` | `rgb(0, 92, 55)` | `hsl(156, 100%, 18%)` | Button gradient endpoints, dark headers, active borders |
| **Vibrant Emerald** | `--brand-light` | `#059669` | `rgb(5, 150, 105)` | `hsl(161, 94%, 30%)` | Secondary CTA accents, badges, link hover states |
| **Neon Electric Emerald** | `--brand-accent` | `#10B981` | `rgb(16, 185, 129)` | `hsl(160, 84%, 39%)` | Highlighting key words ("Swap"), active pills, glow effects |
| **Cyber Mint (Dark UI)** | `--emerald-400` | `#00D26A` | `rgb(0, 210, 106)` | `hsl(150, 100%, 41%)` | Dark mode primary icons, card highlights, verification badges |
| **Cyber Mint Solid** | `--emerald-500` | `#00BA5E` | `rgb(0, 186, 94)` | `hsl(150, 100%, 36%)` | Pressed button states in dark mode, chart indicators |
| **Tech Cyan** | `--cyan-400` | `#06B6D4` | `rgb(6, 182, 212)` | `hsl(189, 94%, 43%)` | Secondary brand glow, algorithmic valuation badges, gradients |
| **Ocean Blue** | `--cyan-500` | `#0891B2` | `rgb(8, 145, 178)` | `hsl(192, 91%, 36%)` | Gradient endpoints for icons and badges |
| **Official WhatsApp** | `--brand-whatsapp` | `#25D366` | `rgb(37, 211, 102)` | `hsl(142, 70%, 49%)` | "Chat with Dealer on WhatsApp" buttons & direct messaging |

### 2.2 Functional & Status Colors

| Status | HEX Code | Soft Background | Border Color | Meaning & Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Success / Verified** | `#15803D` / `#00D26A` | `#ECFDF5` / `rgba(0,210,106,0.12)` | `#A7F3D0` / `rgba(0,210,106,0.32)` | Verified Dealer badges, Completed swaps, Battery >85% |
| **Warning / Gold Tier** | `#F59E0B` | `#FFFBEB` / `rgba(245,158,11,0.12)` | `#FDE68A` / `rgba(245,158,11,0.3)` | Pro/Gold Dealer tiers, Pending review, Moderate battery |
| **Danger / Alert** | `#EF4444` / `#F43F5E` | `#FEF2F2` / `rgba(244,63,94,0.12)` | `#FECACA` / `rgba(244,63,94,0.3)` | Declined offers, Out-of-stock items, Critical errors |
| **Information / Notice** | `#0284C7` | `#E0F2FE` / `rgba(2,132,199,0.12)` | `#BAE6FD` / `rgba(2,132,199,0.3)` | Educational hints, Inspection instructions, Hub info |

### 2.3 Dark Mode Canvas & Glassmorphic Surfaces (Obsidian Theme)

```css
:root {
  --bg-base: #05080B;                  /* Deepest Obsidian base background */
  --bg-surface: #090E14;               /* Solid surface for panels and modals */
  --bg-card: rgba(13, 21, 30, 0.62);   /* Frosted glass phone cards */
  --bg-card-hover: rgba(18, 28, 40, 0.78);
  --bg-panel: rgba(12, 19, 27, 0.72);
  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-border-hover: rgba(255, 255, 255, 0.18);
  --glass-specular: inset 0 1px 1px 0 rgba(255, 255, 255, 0.18);
}
```

### 2.4 Light Mode Surfaces (Clean Slate Theme)

```css
:root {
  --bg-page: #F8FAFC;                 /* Slate 50 background */
  --bg-surface: #FFFFFF;              /* Pure white card container */
  --bg-surface-glass: rgba(255, 255, 255, 0.88);
  --border-subtle: #E2E8F0;           /* Slate 200 border */
  --border-medium: #CBD5E1;           /* Slate 300 border */
}
```

### 2.5 Text & Content Colors

| Role | Light Theme HEX | Dark Theme HEX | Description |
| :--- | :--- | :--- | :--- |
| **Primary Text** | `#0F172A` (Slate 900) | `#FFFFFF` (Pure White) | Headings, model names, top-up prices |
| **Secondary Text** | `#475569` (Slate 600) | `#E2E8F0` (Slate 200) | Subtitles, specifications, body copy |
| **Muted Text** | `#64748B` (Slate 500) | `#94A3B8` (Slate 400) | Labels, timestamps, secondary hints |
| **Faint / Disabled** | `#94A3B8` (Slate 400) | `#64748B` (Slate 500) | Placeholders, inactive button labels |

### 2.6 Signature Gradients

1. **Brand Primary Gradient (Buttons & Accents)**:  
   `linear-gradient(135deg, #008751 0%, #059669 50%, #10B981 100%)`
2. **Cyber Glass Icon Gradient (Squircle Badges)**:  
   `linear-gradient(135deg, rgba(0, 210, 106, 0.28) 0%, rgba(6, 182, 212, 0.15) 100%)`
3. **Hero Ambient Dark Radial**:  
   `radial-gradient(circle at 50% -10%, #0D281A 0%, #09111E 60%, #050811 100%)`
4. **Emerald Text Shimmer**:  
   `linear-gradient(135deg, #34D399 0%, #10B981 50%, #059669 100%)`

---

## 🔤 3. Typography & Font Specifications

NaijaSwap employs a three-tier typography hierarchy engineered for clarity, readability, and modern high-tech appeal.

### 3.1 Primary Font Family: **Plus Jakarta Sans**
- **Source**: Google Fonts ([https://fonts.google.com/specimen/Plus+Jakarta+Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans))
- **Weights Used**: 
  - `400 (Regular)`: Body copy, FAQ descriptions, legal terms
  - `500 (Medium)`: Secondary metadata, form input text
  - `600 (SemiBold)`: Navigation links, table headers, form labels, small buttons
  - `700 (Bold)`: Card titles, device model names, feature headers
  - `800 (ExtraBold)`: Logo wordmark, hero display titles, key numbers
- **CSS Declaration**:
  ```css
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  ```

### 3.2 Monospace & Technical Font: **JetBrains Mono**
- **Source**: Google Fonts ([https://fonts.google.com/specimen/JetBrains+Mono](https://fonts.google.com/specimen/JetBrains+Mono))
- **Weights Used**: `500 (Medium)`, `700 (Bold)`, `800 (ExtraBold)`
- **Usage**: IMEI numbers, serial codes, verification tokens, battery percentages (e.g., `88% Health`), top-up calculation formulas.
- **CSS Declaration**:
  ```css
  font-family: 'JetBrains Mono', monospace, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas;
  ```

### 3.3 Formal & Prestigious Font: **Playfair Display**
- **Source**: Google Fonts ([https://fonts.google.com/specimen/Playfair+Display](https://fonts.google.com/specimen/Playfair+Display))
- **Weights Used**: `700 (Bold)`
- **Usage**: Official Diagnostic & Warranty Certificates, Gold Dealer Accreditations, Physical seal documents.

### 3.4 Type Scale & Hierarchy Reference

| Level | Size (Desktop) | Size (Mobile) | Weight | Line Height | Tracking / Spacing |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Hero Display** | `3.2rem - 3.6rem` (52–58px) | `2.3rem` (36px) | `800` | `1.15` | `-0.035em` |
| **Page Title (H1)** | `2.25rem` (36px) | `1.85rem` (30px) | `800` | `1.2` | `-0.025em` |
| **Section Title (H2)** | `1.65rem` (26px) | `1.4rem` (22px) | `700` | `1.25` | `-0.02em` |
| **Card Heading (H3)** | `1.25rem` (20px) | `1.15rem` (18px) | `700` | `1.3` | `-0.015em` |
| **Subtitle / Lead** | `1.125rem` (18px) | `1.0rem` (16px) | `400 / 500` | `1.6` | `0` |
| **Body Regular** | `0.925rem` (15px) | `0.875rem` (14px) | `400 / 500` | `1.55` | `0` |
| **Button Text** | `0.9rem - 1.0rem` | `0.9rem` | `600 / 700` | `1.0` | `0` |
| **Form Labels** | `0.825rem` (13px) | `0.825rem` | `600` | `1.2` | `0.01em` |
| **Badges / Micro Tags**| `0.725rem` (11.5px)| `0.68rem` (11px) | `700 / 800` | `1.0` | `0.04em (Uppercase)`|

---

## 📐 4. Logo, Iconography & Brand Assets

### 4.1 Logo Architecture & Anatomy
The NaijaSwap logo consists of two harmonized components:
1. **The Dual-Arrow Exchange Glyph (Logo Mark)**:
   - Represents the continuous, bilateral trade of devices between owners and dealers.
   - Top arrow points **left** (`#FFFFFF` or `#00D26A`), bottom arrow points **right** (`#00D26A` or `#6EE7B7`).
   - Housed within an iOS squircle badge (`rx="14"` on 56x56 base, or `rx="10"` on 36x36).
   - Filled with a cyber emerald-to-cyan gradient: `linear-gradient(135deg, #10B981 0%, #059669 50%, #0284C7 100%)`.
2. **The Brand Wordmark**:
   - Typeset in **Plus Jakarta Sans ExtraBold (800)** with letter-spacing `-0.5px`.
   - **"Naija"**: Clean White `#FFFFFF` (on dark) or Slate 900 `#0F172A` (on light).
   - **"Swap"**: Electric Emerald `#10B981` (on dark) or Heritage Emerald `#008751` (on light).

```
   ┌─────────┐
   │  ◄───   │   NaijaSwap
   │   ───►  │   ─────────
   └─────────┘     ↑    ↑
      Badge      White Emerald
```

### 4.2 Asset File Guide (In Repository)
- **`assets/logo.svg`**: Full horizontal master vector logo (280x64px), scalable to any resolution.
- **`assets/favicon.svg`**: Master app icon & favicon (64x64px squircle badge).
- **`assets/naijaswap-logo.png`**: High-resolution raster horizontal logo (for video overlays, decks, Canva).
- **`assets/naijaswap-icon.png`**: High-resolution raster app icon (for app stores, social media avatars).
- **`assets/og-banner.svg`**: 1200x630px social media open graph banner for WhatsApp previews, Twitter, and LinkedIn.

### 4.3 Logo Clear Space & Minimum Sizes
- **Clear Space**: Maintain minimum breathing room equal to half the height of the squircle badge around all four sides of the logo.
- **Minimum Digital Size**:
  - Horizontal Logo: `140px width` minimum.
  - Icon Badge Only: `24px width` minimum.
- **Minimum Print Size**:
  - Horizontal Logo: `35mm width` minimum.
  - Icon Badge Only: `8mm width` minimum.

### 4.4 Logo Misuse Rules (Do NOTs)
- ❌ **Do NOT** change the relative proportions between "Naija" and "Swap".
- ❌ **Do NOT** color "Naija" green and "Swap" white (always keep "Naija" neutral and "Swap" emerald).
- ❌ **Do NOT** place the dark-theme logo on low-contrast green or busy photographic backgrounds without a dark scrim overlay.
- ❌ **Do NOT** stretch, distort, or skew the glyph or wordmark.
- ❌ **Do NOT** substitute the font with Arial, Comic Sans, or Times New Roman.

---

## 🧱 5. UI Components & Design Tokens

### 5.1 Corner Radii
- **Micro Tags / Badges**: `6px` (`--radius-xs`)
- **Inputs & Small Buttons**: `8px - 10px` (`--radius-sm`)
- **Cards, Dropdowns & Modals**: `14px - 16px` (`--radius-md` / `--radius-lg`)
- **Swap Selector Card / Engine**: `22px - 28px` (`--radius-xl`)
- **Pill Chips & Avatars**: `9999px` (`--radius-pill` / `--radius-full`)

### 5.2 Elevation & Shadow Tokens
- **Subtle Surface**: `0 1px 3px rgba(0, 0, 0, 0.02), 0 4px 12px rgba(0, 0, 0, 0.02)`
- **Medium Card**: `0 4px 12px -2px rgba(0, 0, 0, 0.06), 0 2px 6px -1px rgba(0, 0, 0, 0.04)`
- **Hover Card**: `0 22px 35px -10px rgba(0, 135, 81, 0.12), 0 10px 20px -5px rgba(0, 0, 0, 0.05)`
- **Emerald Glow**: `0 0 20px rgba(0, 210, 106, 0.28)`
- **Modal Glass Backdrop**: `0 24px 60px -8px rgba(0, 0, 0, 0.8), 0 8px 24px rgba(0, 0, 0, 0.5)`

### 5.3 Button Specifications

| Button Class | Background | Text Color | Border | Usage |
| :--- | :--- | :--- | :--- | :--- |
| `.btn-primary` | `linear-gradient(135deg, #008751 0%, #005c37 100%)` | `#FFFFFF` | Subtle specular | Primary actions ("Submit Swap", "Find Swap") |
| `.btn-whatsapp`| `#25D366` (Hover `#1EB956`) | `#FFFFFF` | None | Direct WhatsApp dealer contact |
| `.btn-dealer` | `#ECFDF5` (Emerald Soft) | `#005C37` | `#A7F3D0` | Dealer portal actions, "For Dealers" CTA |
| `.btn-secondary`| `#1E293B` (Slate 800) | `#FFFFFF` | None | Secondary options, cancel actions |
| `.btn-outline` | `#FFFFFF` (or `transparent`) | `#334155` | `#E2E8F0` | Filter chips, edit triggers, back buttons |

### 5.4 Form Controls & Inputs
- **Height**: `46px - 48px` standard.
- **Border**: `1.5px solid #E2E8F0` (Light) or `1px solid rgba(255, 255, 255, 0.12)` (Dark).
- **Focus State**: Border color transitions to `#008751` (Light) or `#00D26A` (Dark) with `box-shadow: 0 0 0 3px rgba(0, 135, 81, 0.15)`.
- **Border Radius**: `10px` (`--radius-sm`).

### 5.5 Animation & Transitions
- **Timing Easing**: Apple native spring easing `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Fast Interactions (Hover, Clicks)**: `150ms - 200ms`.
- **Smooth Layout Transitions (Modals, Panels)**: `300ms - 400ms`.

---

## 🎬 6. Handover Instructions by Role

### 👨‍💻 6.1 For Frontend & App Developers
1. **Google Fonts Link to include in `<head>`**:
   ```html
   <link rel="preconnect" href="https://fonts.googleapis.com">
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700;800&display=swap" rel="stylesheet">
   ```
2. **Include Design Tokens**:
   Ensure `css/variables.css` or `css/dashboard.css` is imported at the top of your stylesheet:
   ```css
   @import url('./variables.css');
   ```
3. **Layout Breakpoints**:
   - Mobile: `< 640px` (single column, sticky bottom navigation bars)
   - Tablet: `640px – 1024px` (2-column grids)
   - Desktop: `> 1024px` (3 or 4-column device cards, max-width `1220px` container)
4. **Naira Currency Formatting Utility**:
   ```javascript
   function formatNaira(amount) {
     return '₦' + Number(amount).toLocaleString('en-NG');
   }
   // Example: formatNaira(185000) => "₦185,000"
   ```

### 🎨 6.2 For Graphic & Social Media Designers
1. **Canvas Presets**:
   - **Instagram / Facebook Post**: `1080 x 1080 px` (1:1) or `1080 x 1350 px` (4:5 Portrait)
   - **Instagram / TikTok / WhatsApp Story**: `1080 x 1920 px` (9:16 Vertical)
   - **Twitter / Web Banner (OG)**: `1200 x 630 px` (1.91:1)
   - **Print Flyer (A5 / A4)**: 300 DPI, CMYK conversion: Primary Green `#008751` ≈ `C:88 M:20 Y:90 K:12`
2. **Visual Hierarchy Rules**:
   - Always place the **NaijaSwap logo** in the top-left or top-center.
   - Use high-contrast device mockups (iPhone 13, 14, 15, Samsung S23/S24 Ultra) angled towards each other with the dual-arrow swap glyph between them.
   - Highlight top-up amounts with the **Emerald Pill Badge** (`#ECFDF5` background, `#008751` bold text).
   - Prominently feature the **Verified Dealer Hub** pill: *"Computer Village • Banex Plaza • Garrison"*.

### 🎥 6.3 For Motion Designers & Video Editors
1. **Intro & Outro Logo Animation**:
   - **Duration**: `1.2 to 2.0 seconds`.
   - **Action**: Squircle badge scales up with spring overshoot (`scale: 0.8 -> 1.05 -> 1.0`), arrows slide in from opposite sides, glowing with emerald bloom (`#00D26A`), followed by the "NaijaSwap" wordmark wiping from left to right.
2. **Color Grading & Mood**:
   - Deep obsidian/black shadows with emerald-cyan highlights.
   - Clean, modern, high-tech fintech aesthetic (reminiscent of modern Apple and CashApp commercial pacing).
3. **Lower Thirds & Text Graphics**:
   - Primary Font: **Plus Jakarta Sans ExtraBold**.
   - Numbers & Top-ups: **JetBrains Mono Bold** with Naira symbol `₦`.
   - Box Graphic: 14px rounded rectangle with 65% dark glass opacity and 1px emerald border.

---

## 📋 7. Quick Reference Cheatsheet

```text
================================================================================
NAIJASWAP DESIGN CHEATSHEET
================================================================================
Brand Name:       NaijaSwap
Tagline:          Nigeria's #1 Phone Swap Network
Primary Emerald:  #008751 (RGB: 0, 135, 81)
Neon Accent:      #10B981 (RGB: 16, 185, 129)
Cyber Dark UI:    #00D26A (RGB: 0, 210, 106)
Tech Cyan:        #06B6D4 (RGB: 6, 182, 212)
WhatsApp Green:   #25D366 (RGB: 37, 211, 102)
Obsidian Dark:    #05080B & #090E14
Slate Light:      #F8FAFC & #FFFFFF
Primary Font:     Plus Jakarta Sans (Weights: 400, 600, 700, 800)
Monospace Font:   JetBrains Mono (Weights: 500, 700)
Certificate Font: Playfair Display (Weight: 700)
Vector Logo:      assets/logo.svg
Icon Badge:       assets/favicon.svg
Banner (1200x630):assets/og-banner.svg
Naira Prefix:     ₦ (e.g. ₦120,000)
================================================================================
```

---
*Document prepared for the NaijaSwap Development & Creative Team. All brand assets are located in the `/assets` directory of this repository.*
