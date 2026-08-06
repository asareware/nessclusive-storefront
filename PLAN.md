# Nessclusive Storefront — Implementation Plan

**Goal:** Rebuild the Claude Design prototype ([project/Nessclusive Storefront.dc.html](project/Nessclusive%20Storefront.dc.html)) as a production Shopify theme and publish it on the existing Nessclusive Shopify store, replacing the current site.

**Target technology:** Custom **Shopify Online Store 2.0 theme** — Liquid + JSON templates + CSS + vanilla JS, scaffolded from **Dawn** (Shopify's reference theme) and restyled to match the prototype pixel-perfectly. No headless/Hydrogen — every feature in the design maps to native Shopify capability, and a native theme keeps the site editable by the owner in the Shopify customizer with zero hosting to maintain.

---

## Store & environment setup

The owner has an existing Shopify store but **no Partner dev store**. That's fine — we develop safely against the live store:

1. Install **Shopify CLI** locally (`npm i -g @shopify/cli`).
2. `shopify theme dev --store <store>.myshopify.com` — this creates a **development theme**: unpublished, invisible to customers, hot-reloads locally. The live theme is never touched.
3. Keep the theme in **Git** from day one.
4. When approved: `shopify theme push` as a new unpublished theme → final review in the theme editor → **Publish** (instant cutover, old theme kept as rollback).

Access needed from the owner: collaborator/staff access to the store with "Themes" permission (and "Products" to seed catalog data).

## Design → theme mapping

The prototype is a single-file mock with 4 screens plus global overlays. Mapping to theme architecture:

| Prototype piece | Shopify implementation |
|---|---|
| Announcement marquee | `sections/announcement-marquee.liquid` (toggle + editable messages, matches `announcementBar` prop) |
| Sticky header, nav, search, account, cart buttons | `sections/header.liquid` (header group) |
| Homepage hero ("Be Bold, Be Exclusive" + arched images) | `sections/hero.liquid` with image pickers |
| Explore Collection cards (Pre-order / Ready to Ship / Accessories) | `sections/collection-cards.liquid` → links to real collections |
| "Step Up Your Style, Book Now" banner | `sections/booking-banner.liquid` |
| Bestsellers grid | `sections/featured-products.liquid` (collection picker) |
| "A little about us" | `sections/about.liquid` |
| Testimonials carousel | `sections/testimonials.liquid` (blocks = quotes) |
| FAQ accordion + contact prompt | `sections/faq.liquid` (blocks = Q&A pairs) |
| "Let's Stay Connected" contact block | `sections/contact.liquid` using `{% form 'contact' %}` |
| Instagram strip | `sections/instagram-strip.liquid` (image blocks) |
| Footer (links, socials, newsletter) | `sections/footer.liquid`, newsletter via `{% form 'customer' %}` |
| All Products page (chips, filters, sort, grid) | `templates/collection.json` + `sections/main-collection.liquid` using Shopify's **Search & Discovery** filtering (availability, price) and native `sort_by` |
| Single Product page (gallery, options, qty, Shop Pay, authorization form callout) | `templates/product.json` + `sections/main-product.liquid`; "You may also Like" via product recommendations API |
| Booking page (3-step wizard) | `templates/page.booking.json` — see Booking decision below |
| Cart drawer | `snippets/cart-drawer.liquid` + **AJAX Cart API** (add/change/remove, persisted server-side — replaces the prototype's localStorage cart) |
| Search overlay | **Predictive Search API** styled as the full-screen overlay |
| Currency switcher (USD/CAD/GBP) | **Shopify Markets** `localization` form — real exchange rates replace the prototype's hardcoded ones |
| Sign in | Native customer accounts |
| Toasts | Small JS utility (`assets/toast.js`) |

### Product options
Prototype product page offers: Size, Part, Cap Size, Processing Time, Pickup Option.
- **Variants (max 3 options):** Size, Part, Cap Size — these can affect price/inventory.
- **Line item properties:** Processing Time, Pickup Option — informational choices carried on the order.
- **Wig Authorization Form callout:** link block on the product template pointing to the real form (page or external form — confirm URL with owner).

### Theme settings (from the prototype's `data-props`)
- `announcementBar` (boolean) → section toggle
- `currency` enum → handled by Shopify Markets instead
- `instalmentsBadge` (boolean) → toggle for the Shop Pay installments line (`{{ form | payment_terms }}`)

### Design tokens
Extract from prototype into `config/settings_schema.json` + CSS custom properties:
- Colors: `#6B0D83` (primary purple), `#621E69` (deep purple), `#FEF1D5` (cream), `#FFFDF8` (background), `#15001A` (ink), `#F7E8F1` / `#ECD6E3` (pink surfaces), `#E3D2E6` (borders), `#5F5462` (muted text), `#D8C08E` (gold accents), `#FDF9F0`, `#F4E8E8`
- Fonts: **Bricolage Grotesque** (display) + **Inter Tight** (body) via Google Fonts
- Radii: 20px cards, 10px buttons/images, 41–42px pills; 55px button height
- Keyframes: marquee, rise, slide-in, fade

## Booking flow — DECIDED: redirect to existing Acuity page

The studio already has an **Acuity Scheduling** page set up. The theme's booking page will be redesigned per the prototype's look (hero banner, "Plan your Perfect Style" steps, Booking Policy / Custom Wig & Drop-off cards) but instead of the 3-step wizard, the primary CTA — and every "Book a Session" button site-wide — links out to the Acuity page. The Acuity URL is a theme setting so the owner can change it without a developer.

*Optional enhancement to evaluate later:* Acuity supports an inline embed (iframe), so the scheduler could live inside the booking page instead of redirecting. Start with the redirect; embedding is a one-line change if the owner prefers it.

## Catalog & content — DECIDED: Shopify catalog is the CMS

Confirmed approach: the **Shopify product catalog is the single source of truth**, and the theme pulls everything from it dynamically via Liquid — this is native theme behavior, no extra tooling needed. The owner manages products, prices, photos, inventory, and collections entirely in Shopify admin; the storefront updates automatically. The prototype's hardcoded products (MABEL $490, MIDNIGHT $420, …) are placeholders only and will not be baked into the theme.

To set up in Shopify admin:
- Collections: **Pre-order Wigs**, **Ready to Ship**, **Accessories** (nav + collection cards target these)
- Products with photos, prices, variants (Size/Part/Cap Size), inventory, and collection assignments — sourced from the store's existing catalog
- Pages: Booking, Terms of Service, Privacy Policy
- **Wig Authorization Form:** lives externally as a **Google Form** (assumed — confirm the link). The product-page callout button links to it via a theme setting, same pattern as the Acuity URL.
- Navigation menus (main + footer), Markets (USD/CAD/GBP), Shop Pay + installments enabled
- Search & Discovery app configured for availability + price filters
- **Newsletter:** footer signup uses Shopify's native customer form, which feeds the store's customer list; campaigns sent via **Shopify Email** (assumed until confirmed). Note: the domain's Google MX records (Google Workspace mailboxes) are unaffected — Shopify Email sends campaigns via its own infrastructure and only needs sender-domain verification (SPF/DKIM CNAMEs), not MX changes.

## Phases

- [ ] **Phase 0 — Setup:** CLI + Git + store access; scaffold theme from Dawn; strip to skeleton; wire design tokens, fonts, base styles
- [ ] **Phase 1 — Global chrome:** announcement marquee, header (sticky, responsive ≤1180px hamburger behavior), mobile menu drawer, footer, toast utility
- [ ] **Phase 2 — Homepage:** hero, collection cards, booking banner, bestsellers, about, testimonials, FAQ, contact, Instagram strip
- [ ] **Phase 3 — Shop:** collection template with chips/filters/sort, product card snippet, pagination
- [ ] **Phase 4 — Product page:** gallery + thumbs, variant/option pickers, qty, add-to-cart, Shop Pay/installments, authorization callout, recommendations
- [ ] **Phase 5 — Cart & search:** AJAX cart drawer, predictive search overlay
- [ ] **Phase 6 — Booking page:** redesigned page with Acuity redirect CTA (hero, steps, policy cards)
- [ ] **Phase 7 — Content & data:** collections, products, pages, menus, Markets, policies
- [ ] **Phase 8 — QA:** cross-device/browser pass vs. prototype, Lighthouse/a11y (focus states, aria labels, reduced-motion), 404/gift-card/account templates styled
- [ ] **Phase 9 — Cutover:** push final theme, owner review in customizer, publish; keep old theme as rollback; verify domains, analytics, and app embeds

## Decisions log (answered 2026-08-06)

1. **Booking** → redirect to the existing **Acuity Scheduling** page (URL as a theme setting; inline embed optional later).
2. **Catalog** → Shopify product catalog is the CMS; theme pulls all real products/collections from it dynamically.
3. **Wig Authorization Form** → assumed **Google Form**; button links to it via theme setting. *(Owner to confirm the actual link.)*
4. **Store access** → store address is **`nessclusive-llc.myshopify.com`** (confirmed from Shopify admin → Settings → Domains; `nessclusive.myshopify.com` is an older alias). Live site runs on the custom domain **www.nessclusive.com** (Primary, Online Store channel). Owner (Vanessa Amoako / info@nessclusive.com) is on the store; development runs via the owner's login with Shopify CLI.
   - ⚠️ **Oxygen environments exist** on the store: "nessclusive (Production)" and "nessclusive (staging)" with `*.o2.myshopify.dev` domains — remnants of a Hydrogen (headless) storefront setup. They don't hold the custom domain, so they don't affect this build; at cutover, verify www.nessclusive.com remains targeted at the Online Store channel where the new theme is published.
5. **Newsletter** → assume **Shopify Email**; Google MX records for mailbox email are unaffected.
6. **Installed apps** → none that must survive the theme swap. Clean slate.

## Remaining items to confirm

- Acuity Scheduling page URL
- Actual Wig Authorization Google Form link
- Confirm Shopify Email (vs. Klaviyo/Mailchimp) once known
