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
| Instagram strip | `sections/instagram-strip.liquid` — **live feed**, see Instagram decision below |
| Footer (links, socials, newsletter) | `sections/footer.liquid`, newsletter via `{% form 'customer' %}` |
| All Products page (chips, filters, sort, grid) | `templates/collection.json` + `sections/main-collection.liquid` using Shopify's **Search & Discovery** filtering (availability, price) and native `sort_by` |
| Single Product page (gallery, options, qty, accelerated checkout, authorization form callout) | `templates/product.json` + `sections/main-product.liquid`; "You may also Like" via product recommendations API |
| Booking page (3-step wizard) | `templates/page.booking.json` — see Booking decision below |
| Cart drawer | `snippets/cart-drawer.liquid` + **AJAX Cart API** (add/change/remove, persisted server-side — replaces the prototype's localStorage cart) |
| Search overlay | **Predictive Search API** styled as the full-screen overlay |
| Currency switcher (USD/CAD/GBP) | **Shopify Markets** `localization` form — real exchange rates replace the prototype's hardcoded ones |
| Sign in | Native customer accounts |
| Toasts | Small JS utility (`assets/toast.js`) |

### Product options — ⚠️ corrected against live catalog data (Phase 0)

The prototype hardcodes five option groups: Size, Part, Cap Size, Processing
Time, Pickup Option. **Auditing the real catalog through the dev theme shows
this matches almost no actual product.**

Live catalog, 29 products:

| Collection | Products | Option shapes found |
|---|---|---|
| Pre-order | 17 | 12× `Length, Cap Size, Part` — plus 5 one-off variations |
| Ready to Ship | 9 | **7 different shapes across 9 products** |
| Accessories | 3 | 2× `Title` (no real options), 1× `Band type` |

Two problems fall out of this.

**1. The real option is `Length`, not "Size".** Values are `12"`–`22"+`. The
prototype's "Select Size" label is wrong; the design's own fine print
("Model is wearing Length 18\"") confirms Length is the real dimension.

**2. Naming is inconsistent, including a typo that is live right now:**

```
Cap Size   Cap size   Cap Szie   ← typo, currently visible to customers
Part       Parts
Size       size       Length
```

Option *order* varies too — one product is `Cap Size, Part, Length`.

### Consequences for the build

- **The product template must render options dynamically** from
  `product.options_with_values`. It cannot hardcode five labelled groups, or
  Ready to Ship products (many of which have one option) and Accessories (which
  have none) will render broken.
- **No styling may key off option name.** "Render Length as pills, Cap Size as
  a dropdown" breaks the moment it meets `Cap Szie`. Style by position or by
  value count instead — or normalise the data first.
- **Visual option order will vary by product** unless the catalog is normalised.

### 🚩 Data cleanup task (owner, before Phase 4)

Normalise option names across all 29 products to exactly `Length`, `Cap Size`,
`Part`, in that order. This is admin work, not theme work, and it is worth doing
regardless of this project — the `Cap Szie` typo is on the live store today.

Once normalised, the theme can style options by name safely and the product page
gains consistent ordering for free.

### Line item properties

- **Processing Time, Pickup Option** — not product options on any live product,
  so they become line item properties as planned, carried on the order.
  Confirm whether they should appear on Accessories at all, or only on wigs.
- **Wig Authorization Form callout:** link block on the product template pointing to the
  Google Form (see Decisions log #3).

### Checkout path — DECIDED: no express button on the product page

The prototype's secondary CTA reads "Buy with Shop Pay"
(`project/Nessclusive Storefront.dc.html:487`). **Dropped.** Shopify's checkout
page already presents Shop Pay, Apple Pay, and Google Pay as express options,
picking the right one for the buyer's device — so the product page does not need
to duplicate them.

Everything routes **Add to Cart → cart → checkout**. This is the safer design:
because nothing skips the cart, Processing Time and Pickup Option are guaranteed
to reach the order. Express buttons on the product page bypass the cart, which
is exactly where those fulfillment-critical properties could have been lost.

**Both buttons stay — DECIDED.** The prototype's two-button layout is preserved:

- **Add to Cart** (primary, `#6B0D83`) — adds and opens the cart drawer.
- **Buy Now** (secondary, outlined) — adds to cart, then redirects straight to
  `/checkout`. Same markup and styling as the prototype's second button, only
  the label changes from "Buy with Shop Pay".

Because Buy Now still routes through the cart, line item properties carry
normally. The buyer meets Apple Pay / Google Pay / Shop Pay one step later, on
the checkout page, where Shopify picks the right one for their device.

*(Trade-off, for the record: removing product-page express buttons costs a
little conversion for repeat buyers who would have checked out in one tap. Given
that a lost Pickup Option means a mis-fulfilled wig, the trade is worth it.)*

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

## Editability policy — DECIDED

**Principle: structure is locked, content is editable, and every editable field
is constrained rather than open.** The owner can run the store day to day —
swap photos, reword headings, add an FAQ — without any ability to break the
design.

### The mechanism that makes "locked" real

Use **`templates/index.liquid` with static `{% section %}` tags**, not
`templates/index.json`.

This matters more than any individual setting. A JSON template lets the merchant
**reorder, remove, and duplicate sections** in the customizer — which would let
someone delete the hero or push testimonials above the fold. A `.liquid`
template with static sections still exposes every section's *settings* for
editing, but the running order is fixed in code and cannot be changed from the
admin.

Same approach for the product, collection, and booking templates.

### What is never exposed

No setting is created for any of these, in any section:

- Colors, fonts, font sizes, letter spacing, line heights
- Padding, margins, gaps, border radii, container widths
- Section order, section removal, section duplication
- Anything in the design-token set

### Per-section settings

| Section | Editable | Locked |
|---|---|---|
| **Announcement marquee** | On/off toggle; message text (blocks, max 4) | Speed, colors, height |
| **Header nav** | Label text per item (e.g. "Booking" → "Book Me"); destination via closed dropdown | 6 slots exactly, order, typography, sticky behaviour, logo |
| **Hero** | Headline, subcopy, CTA label, CTA destination (dropdown), the arched images | Layout, arch shapes, overlay gradient |
| **Explore Collection cards** | Per card: image, title, destination (dropdown) | Exactly 3 cards, grid layout, card radius |
| **Booking banner** | Heading, body copy, CTA label | Background treatment; CTA always goes to the Acuity URL theme setting |
| **Bestsellers** | Section heading; which collection feeds it | Card design, grid, product count per row |
| **About** | Heading, body copy, the 3 photos | Layout, image arrangement |
| **Testimonials** | Quote + author name per block (max 6) | Carousel behaviour, card styling |
| **FAQ** | Question + answer per block (max 10) | Accordion behaviour, typography |
| **Contact** | Heading, body copy | Form fields, `{% form 'contact' %}` wiring |
| **Instagram strip** | Section heading, profile URL | Images — they come live from the metafield (Decision #10), not from settings |
| **Footer** | Column headings, link labels + destinations (dropdowns), social URLs, newsletter copy | Column count, layout |
| **Shop / collection** | Nothing — pure skeleton | Everything. Products, prices, availability, filters all come from Shopify |
| **Product page** | Nothing — pure skeleton | Everything. Title, price, variants, images, inventory, sold-out state all come from Shopify |
| **Cart / search overlays** | Nothing | Everything |

### Two implementation notes

**Destinations are dropdowns, not URL fields.** Each nav and card link uses a
`select` listing the site's real destinations (Ready to Ship, Pre-Order,
Accessories, Booking, FAQ anchor, Contact anchor). The owner can relabel freely
and re-point among valid targets, but cannot type a URL and cannot create a
broken link.

*Slight widening of the brief, flagged for veto:* the owner asked for
destinations to be entirely fixed. A closed dropdown is marginally more open —
it allows re-pointing among real pages — but removes the need for a developer if
the nav ever needs rearranging, and it is still impossible to produce a 404.
Say the word and these become hardcoded per slot instead.

**Image constraints are enforced by CSS, not by the picker.** Shopify's
`image_picker` cannot reject an upload for being the wrong shape. The design
holds regardless because every image slot has a fixed `aspect-ratio` with
`object-fit: cover`, so any upload is cropped to fit rather than distorting the
layout. Schema `info` text states the recommended dimensions so the crop lands
where intended.

## Booking flow — DECIDED: redirect to existing Acuity page

The studio already has an **Acuity Scheduling** page set up. The theme's booking page will be redesigned per the prototype's look (hero banner, "Plan your Perfect Style" steps, Booking Policy / Custom Wig & Drop-off cards) but instead of the 3-step wizard, the primary CTA — and every "Book a Session" button site-wide — links out to the Acuity page. The Acuity URL is a theme setting so the owner can change it without a developer.

*Optional enhancement to evaluate later:* Acuity supports an inline embed (iframe), so the scheduler could live inside the booking page instead of redirecting. Start with the redirect; embedding is a one-line change if the owner prefers it.

## Instagram strip — DECIDED: live feed, tiles link to the profile

The prototype hardcodes five images (`Nessclusive Storefront.dc.html:281-285`)
and the tiles are plain `div`s with no links. Both change: the strip pulls
**live posts from @Nessclusive**, and clicking a tile opens Instagram.

**This is harder than it looks.** Meta shut down the Instagram Basic Display API
on **4 December 2024**. The replacement (Instagram API with Instagram Login /
Graph API) requires:

- an Instagram **Business or Creator** account, linked to a Facebook Page —
  ✅ **confirmed present for @Nessclusive**
- a Meta developer app and an access token
- **token refresh every ~60 days** — tokens expire

A Liquid theme has no backend, and theme assets are publicly readable, so the
token cannot live in theme code or theme settings.

**DECIDED: serverless proxy (option B).** No feed app.

### Design fidelity: yes, exactly

The proxy approach keeps the prototype **pixel-for-pixel**, because the theme
renders its own markup and the proxy supplies only data. Nothing third-party
touches the DOM. The strip stays exactly as designed — five tiles, 4:5 aspect
ratio, 10px radius, horizontal scroll, `clamp(10px, 1vw, 16px)` gap — with each
`div` becoming an `<a href="{permalink}" target="_blank" rel="noopener">`.

### Scope

Confirmed requirement, deliberately small: **the 5 most recent posts, kept
current, each linking to its Instagram post.** No captions, likes, carousels, or
lightbox. That keeps the API surface to a single call.

### Architecture — scheduled push into Shopify (recommended)

Rather than having the browser call the proxy at page load, a **Cloudflare
Worker on a cron trigger** pushes the data into Shopify, and Liquid renders it
server-side:

```
Cloudflare Worker (cron, hourly)
  → Instagram Graph API: /me/media?fields=id,media_type,media_url,thumbnail_url,permalink&limit=5
  → download each image, upload to Shopify Files (Admin API)
  → write [{src, permalink}] into a shop metafield
Theme: sections/instagram-strip.liquid reads the metafield, renders normally
```

Why this shape over a browser-side fetch:

| | Scheduled push | Browser fetch |
|---|---|---|
| Renders server-side in Liquid | ✅ | ❌ appears after JS |
| Layout shift / Lighthouse | none | CLS risk |
| CORS handling | not needed | required |
| If the Worker dies | last images persist | empty strip |

The last row matters most: a failure degrades to slightly stale photos rather
than a hole in the homepage.

### ⚠️ Instagram CDN URLs expire — re-host the images

`media_url` from the Graph API is a **signed, expiring CDN link**. Meta
explicitly warns against storing it long-term. Writing those URLs straight into
a metafield produces a strip that works on launch day and silently breaks a few
weeks later — the failure mode most likely to go unnoticed.

So the Worker **downloads each image and re-uploads it to Shopify Files**,
storing the permanent Shopify CDN URL. This also serves the images from the same
CDN as the rest of the site.

*(Simpler variant if that proves fiddly: store the raw Instagram URLs, refresh
hourly, and put an `onerror` fallback to the static images on each `<img>`.
Accepts a small risk of a broken tile between refreshes.)*

### Other implementation notes

- **Token refresh.** Long-lived tokens last ~60 days. The same cron refreshes
  the token weekly, so it never reaches expiry. Add a failure alert — this is
  the one component with an ongoing failure mode.
- **Reels/video posts.** When `media_type` is `VIDEO`, use `thumbnail_url`;
  `media_url` returns the video file. Easy to miss until a reel is posted.
- **Fallback.** Ship the five prototype images as the metafield's default so the
  section renders correctly before the first cron run and if data ever goes
  missing.
- **Cost.** Cloudflare Workers free tier covers this comfortably.

**Effort:** ~1–2 days including the Shopify Files re-hosting and cron setup.
This is real infrastructure the business now owns — small, but not zero.

## Catalog & content — DECIDED: Shopify catalog is the CMS

Confirmed approach: the **Shopify product catalog is the single source of truth**, and the theme pulls everything from it dynamically via Liquid — this is native theme behavior, no extra tooling needed. The owner manages products, prices, photos, inventory, and collections entirely in Shopify admin; the storefront updates automatically. The prototype's hardcoded products (MABEL $490, MIDNIGHT $420, …) are placeholders only and will not be baked into the theme.

To set up in Shopify admin — **reusing existing records, never creating
replacements** (Decision #9):
- Collections: the existing `/collections/pre-order`, `/collections/ready-to-ship`,
  `/collections/accessories`. Display headings may be restyled (e.g. "Pre-Order
  Wigs"); **handles and SEO fields are not touched.**
- Products with photos, prices, variants (Size/Part/Cap Size), inventory, and collection assignments — sourced from the store's existing catalog
- Pages: the existing `/pages/booking`, `/pages/faqs`, `/pages/contact-us`, and
  the existing policy pages
- **Wig Authorization Form:** hosted as a **Google Form**. The product-page
  callout button links to it via a theme setting, same pattern as the Acuity URL.
  **To-do, not a blocker:** the form exists today in another format and the
  theme setting points at its current location. Swap in the Google Form URL when
  it is ready — a one-field change, no redeploy (see Decision #3).
- Navigation menus (main + footer), Markets (USD/CAD/GBP), Shop Pay + installments enabled
- Search & Discovery app configured for availability + price filters
- **Newsletter:** footer signup uses Shopify's native customer form, which feeds the store's customer list; campaigns sent via **Shopify Email** (assumed until confirmed). Note: the domain's Google MX records (Google Workspace mailboxes) are unaffected — Shopify Email sends campaigns via its own infrastructure and only needs sender-domain verification (SPF/DKIM CNAMEs), not MX changes.

## Phases — execution checklist

> **How this document is organised.** Everything above this point is
> **reference**: decisions, specs, and design mapping, organised by topic.
> This section is the **tracker** — the actual units of work, in order.
> A phase number never corresponds to a heading above; when a phase needs
> detail, it links to the reference section that holds it.

**Legend** — ✅ done · 🔜 next · ⬜ not started · 👤 owner action, cannot be
automated

- [x] ✅ **Phase 0a — Scaffold.** Shopify CLI 4.6.0 installed; Dawn copied in wholesale as a reviewable baseline; design tokens, self-hosted WOFF2 fonts, and base styles wired into `layout/theme.liquid`; `shopify theme check` passes with 0 errors. *(commit `4b38e46`)*
- [x] ✅ 👤 **Phase 0b — Store access.** Development theme `#159626559687` created and running on `127.0.0.1:9292`; CLI session cached. Live theme is `Champion #133414355143`, retained as the rollback
- [x] ✅ **Phase 0d — Live-store audit.** Catalog option shapes audited (see [Product options](#product-options----corrected-against-live-catalog-data-phase-0)); live theme pulled and inspected for app embeds and inline tracking. Found the `Cap Szie` typo, the seven option shapes across Ready to Ship, and that no analytics are hardcoded *(commits `993de0d`, `74a5617`)*
- [x] ✅ **Phase 0c — Strip to skeleton.** Removed 17 sections, 3 snippets, 10 stylesheets — 8,468 lines with no route into them. Eight sections that *looked* unreferenced are fetched at runtime via the Section Rendering API (cart drawer, cart icon bubble, cart notifications, pickup availability, predictive search) and were kept; all verified returning content afterwards. Sections still referenced by templates were left in place so the preview keeps working until each replacement lands. Verified: theme check 150 files / 0 errors, 15 routes serving *(commit `b6ae6d8`)*
- [ ] ⬜ 👤 **Phase 0e — Catalog cleanup.** Normalise product option names to `Length`, `Cap Size`, `Part` across all 29 products. Admin work, not theme work. Worth doing regardless — `Cap Szie` is live today
- [ ] 🔜 **Phase 1 — Global chrome.** Announcement marquee, header (sticky, hamburger below `--ness-nav-collapse` 1180px), mobile menu drawer, footer, toast utility
- [ ] ⬜ **Phase 2 — Homepage.** Hero, collection cards, booking banner, bestsellers, about, testimonials, FAQ, contact, Instagram strip (renders from the metafield, with the five prototype images as fallback)
- [ ] ⬜ **Phase 2b — Instagram worker.** Meta app + long-lived token, Cloudflare Worker with hourly cron, image re-hosting to Shopify Files, metafield write, token auto-refresh, failure alert. Independent of the theme work and can run in parallel
- [ ] ⬜ **Phase 3 — Shop.** Collection template with chips/filters/sort, product card snippet, pagination
- [ ] ⬜ **Phase 4 — Product page.** Gallery + thumbs, **dynamic** option pickers rendered from `options_with_values` (never hardcoded — see Product options), qty, add-to-cart and Buy Now (no express button, Decision #7), installments line, authorization callout, recommendations
- [ ] ⬜ **Phase 5 — Cart & search.** AJAX cart drawer, predictive search overlay
- [ ] ⬜ **Phase 6 — Booking page.** Redesigned page with Acuity redirect CTA (hero, steps, policy cards)
- [ ] ⬜ 👤 **Phase 7 — Content & data.** Menus, Markets, policies, shipping zones/duties. **Reuse existing collection and page handles** — do not create duplicates (Decision #9)
- [ ] ⬜ **Phase 8 — QA.** Cross-device/browser pass vs. prototype, Lighthouse/a11y (focus states, aria labels, reduced-motion), 404/gift-card/account templates styled
- [ ] ⬜ 👤 **Phase 8b — Live order test.** Place a real paid order and refund it. Verify Processing Time and Pickup Option appear on the order, that the confirmation email carries the **real** Google Form link, and that international currency/shipping behave. The only step that proves the store actually works
- [ ] ⬜ 👤 **Phase 9 — Cutover.** Push final theme, owner review in customizer, publish; keep `Champion` as rollback; verify domains and re-enable nothing (all apps being removed — Decision #6)

## Decisions log (answered 2026-08-06)

1. **Booking** → redirect to the existing **Acuity Scheduling** page (URL as a theme setting; inline embed optional later). **Confirmed URL: `https://nessclusive.as.me/schedule/6f74a017`**
2. **Catalog** → Shopify product catalog is the CMS; theme pulls all real products/collections from it dynamically.
3. **Wig Authorization Form** → will be hosted as a **Google Form**; button links to it via a theme setting. The form already exists in another format and customers know where to find it, so converting it to a Google Form is a **to-do, not a launch blocker** — the theme setting simply points at wherever it currently lives and is updated when the Google Form is ready. Because failure to submit it cancels the order, the link should also go in the **order confirmation notification** (Settings → Notifications), not just the product page — that template is not part of the theme and is easy to forget.
4. **Store access** → store address is **`nessclusive-llc.myshopify.com`** (confirmed from Shopify admin → Settings → Domains; `nessclusive.myshopify.com` is an older alias). Live site runs on the custom domain **www.nessclusive.com** (Primary, Online Store channel). Owner (Vanessa Amoako / info@nessclusive.com) is on the store; development runs via the owner's login with Shopify CLI.
   - ⚠️ **Oxygen environments exist** on the store: "nessclusive (Production)" and "nessclusive (staging)" with `*.o2.myshopify.dev` domains — remnants of a Hydrogen (headless) storefront setup. They don't hold the custom domain, so they don't affect this build; at cutover, verify www.nessclusive.com remains targeted at the Online Store channel where the new theme is published.
5. **Newsletter** → assume **Shopify Email**; Google MX records for mailbox email are unaffected.
6. **Installed apps** → **clean slate, confirmed by removal.** The owner is
   deleting every installed app from the admin, so nothing needs to survive the
   theme swap and nothing needs re-enabling at cutover.

   For the record, Phase 0 found these attached to the live storefront:
   **Shopify Inbox** (chat, active app embed), **Elfsight** (client-side widget,
   almost certainly the current Instagram feed — which is why "instagram"
   appears nowhere in the page source), **Hextom: Sales Boost** (theme app
   extension), **Translate & Adapt**, and **Udesly Nexus** (leftover from the
   Hydrogen experiment).

   Two consequences of removing them, both accepted:
   - **Live chat goes away.** Shopify Inbox is the only customer-contact channel
     on the current site besides the contact form. The new site's contact
     section replaces it.
   - **Existing translations go away** with Translate & Adapt. Only matters if
     the store currently serves more than one language — worth a glance in
     admin before deleting, since translated content is not recoverable
     afterwards.

   Search & Discovery is Shopify's own and stays, for collection filtering.
7. **Checkout path** → **no express button on the product page.** Both prototype
   buttons stay: **Add to Cart**, and **Buy Now** which adds to cart then
   redirects to `/checkout`. Shopify offers Shop Pay / Apple Pay / Google Pay at
   checkout, per device. Nothing skips the cart, so fulfillment-critical line
   item properties always carry.
8. **Feature parity with the old site is explicitly NOT a goal.** The new site
   replaces the current one outright; anything on nessclusive.com that is not in
   the prototype is dropped by design, including the existing UGC treatment.
   *(This governs features only — see #9.)*
9. **URLs, slugs, and SEO metadata are preserved exactly.** Only the front end
   changes. No collection, product, or page handle is created, renamed, or
   replaced; existing SEO titles and meta descriptions stay as they are.
   **Display headings are independent of handles** — a collection may show
   "Pre-Order Wigs" as its on-page heading while remaining
   `/collections/pre-order`. Shopify does not change an existing record's handle
   when its title is edited, so renaming for display is safe; just never touch
   the handle field itself.
10. **Instagram** → **self-hosted serverless proxy**, no app. Cloudflare Worker
    on a cron pulls the 5 most recent posts, re-hosts the images to Shopify
    Files, and writes them to a metafield the theme renders server-side. Keeps
    the prototype's markup exactly. Account confirmed Business/Creator + Page.
11. **Stack** → **Liquid theme confirmed, not Hydrogen.** Both stacks can hit
    the design pixel-for-pixel, so fidelity was not the deciding factor.
    Hydrogen has no theme customizer at all — every copy or image change would
    be a code change and a deploy. The owner wants day-to-day editing, so Liquid
    wins outright.
12. **Editability** → structure locked, content editable, all editable fields
    constrained. Static `{% section %}` tags in `.liquid` templates so sections
    cannot be reordered or deleted. Full policy in the Editability section above.

## Amendments — carried over from review, still open

**URL preservation — RESOLVED, see Decision #9.** Existing handles are kept
verbatim:

```
/collections/pre-order        /pages/booking      /policies/terms-of-service
/collections/ready-to-ship    /pages/faqs         /policies/privacy-policy
/collections/accessories      /pages/contact-us
```

⚠️ **This supersedes the setup list above**, which said to create collections
named "Pre-order Wigs" / "Ready to Ship" / "Accessories". Do **not** create
them — `/collections/pre-order` already exists and creating a new one would
yield `/collections/pre-order-wigs` and 404 the indexed URL. Reuse the existing
records; change only their display headings if desired.

Before Phase 7, export the full list of live URLs (products included) and treat
it as the contract. Nothing in it may 404 after cutover.

**International selling.** The goal is orders worldwide. Markets handles
currency display, but shipping zones, duties/import fees, and tax registrations
are separate settings and are not yet covered by any phase. Confirm which
countries are actually being sold to.

**Order-notification templates.** Not part of the theme, so they survive the
swap untouched — which also means they will not automatically reflect anything
new. Review at minimum the order confirmation (see Decision #3).

**Analytics — RESOLVED in Phase 0.** Pulled the live theme and grepped
`layout/theme.liquid` for inline tracking: **zero hardcoded scripts**. Nothing
is lost in the swap. Whatever analytics exist run through Customer Events or app
embeds, both of which are configured outside the theme.

## Remaining items to confirm

Resolved:

- ~~Acuity Scheduling page URL~~ → `https://nessclusive.as.me/schedule/6f74a017`
- ~~Instagram: app, proxy, or static?~~ → serverless proxy (Decision #10)
- ~~Instagram account type~~ → confirmed Business/Creator + Facebook Page
- ~~Second product-page button~~ → kept as "Buy Now" (Decision #7)
- ~~Wig Authorization Form~~ → to-do, not a blocker (Decision #3)

Still open:

- **Current Wig Authorization Form location** — the URL the theme setting points
  at until the Google Form exists
- **Where the Instagram Worker lives** — which Cloudflare account owns it, and
  who gets the failure alert. Small, but it is production infrastructure with an
  owner
- Confirm Shopify Email (vs. Klaviyo/Mailchimp) once known
- Countries sold to, for shipping zones and duties
