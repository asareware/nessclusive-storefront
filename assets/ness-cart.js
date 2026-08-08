/* Nessclusive — cart drawer behaviour.

   Everything in this file is an upgrade over markup that already works:

     - The header's cart pill is a real link to /cart. This intercepts the
       click and opens the drawer instead. Blocked script → the shopper lands
       on the cart page.
     - Add-to-cart forms are real <form> POSTs. This intercepts submit, posts
       to /cart/add.js, and opens the drawer. Blocked script → the browser
       submits the form and Shopify redirects to /cart.
     - The quantity buttons are submit buttons on a form that POSTs to
       /cart/change, and Remove is `item.url_to_remove`. This intercepts both
       and calls /cart/change.js. Blocked script → each one is a full page
       load that still does the right thing.

   The drawer is never rebuilt here. After every mutation the Section Rendering
   API is asked for `ness-cart-drawer` and the returned [data-cart-content] is
   swapped in, so prices, discounts, and line item properties are always
   whatever Liquid rendered — not something this file assembled.

   Public API, used by the product page:
     window.NessCart.refresh()  → Promise, re-renders the drawer from the server
     window.NessCart.open()     → opens it
     window.NessCart.close()    → closes it
*/

(function () {
  'use strict';

  const DRAWER_ID = 'ness-cart-drawer';
  const SECTION_ID = 'ness-cart-drawer';
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const GENERIC_ERROR = 'Sorry — your bag could not be updated. Please try again.';

  const supported = 'fetch' in window && 'FormData' in window && 'DOMParser' in window;

  /* --- Small helpers ----------------------------------------------------- */

  function getDrawer() {
    return document.getElementById(DRAWER_ID);
  }

  /* Locale-aware. Shopify.routes.root is '/' on a single-market store and
     '/en-gb/' (with the trailing slash) inside a market subfolder, so every
     request below stays in the shopper's market and currency. */
  function rootUrl() {
    const root =
      window.Shopify && window.Shopify.routes && window.Shopify.routes.root;
    if (!root) return '/';
    return root.charAt(root.length - 1) === '/' ? root : root + '/';
  }

  function sectionsUrl() {
    return window.location.pathname + window.location.search;
  }

  function toast(message) {
    if (message && window.NessToast) window.NessToast.show(message);
  }

  /* Shopify's cart endpoints answer with JSON on success and on error alike.
     A non-JSON body means something else went wrong (a proxy, an outage), and
     is reported as a generic failure rather than thrown at the shopper. */
  function readJson(response) {
    return response
      .json()
      .catch(() => null)
      .then((body) => ({ ok: response.ok, status: response.status, body: body }));
  }

  function errorMessage(result) {
    const body = result && result.body;
    if (!body) return GENERIC_ERROR;
    return body.description || body.message || GENERIC_ERROR;
  }

  /* --- Header cart count -------------------------------------------------
     The pill's wording is authored in ness-header.liquid and may be relabelled
     there, so the base label is read out of the DOM once and kept, rather than
     hardcoded here. */
  function updateHeaderCount(count) {
    document.querySelectorAll('.ness-pill--cart span').forEach((span) => {
      if (!span.dataset.baseLabel) {
        span.dataset.baseLabel = span.textContent
          .replace(/\s*\(\s*\d+\s*\)\s*$/, '')
          .trim();
      }
      const base = span.dataset.baseLabel;
      span.textContent = count > 0 ? base + ' (' + count + ')' : base;
    });
  }

  /* --- Rendering ---------------------------------------------------------- */

  function fetchSection() {
    return fetch(rootUrl() + '?sections=' + SECTION_ID, {
      headers: { Accept: 'application/json' },
    })
      .then((response) => {
        if (!response.ok) throw new Error('Section render failed');
        return response.json();
      })
      .then((json) => json[SECTION_ID]);
  }

  /* Swaps in the freshly rendered content, then puts focus back where the
     shopper left it. Without the focus restore, pressing "+" would move focus
     to the body every time — a keyboard user could never press it twice. */
  function applySection(html) {
    const drawer = getDrawer();
    if (!drawer || !html) return;

    const live = drawer.querySelector('[data-cart-content]');
    const fresh = new DOMParser()
      .parseFromString(html, 'text/html')
      .querySelector('[data-cart-content]');
    if (!live || !fresh) return;

    const wasOpen = !drawer.hidden;
    const focusKey =
      wasOpen && document.activeElement && drawer.contains(document.activeElement)
        ? document.activeElement.getAttribute('data-focus-key')
        : null;

    live.replaceWith(fresh);

    updateHeaderCount(parseInt(fresh.getAttribute('data-item-count'), 10) || 0);

    /* Deferred a frame. On the add-to-cart path the drawer is still hidden at
       this point and is only opened by the caller afterwards — and a live
       region mutated while its subtree is display:none does not announce, nor
       does becoming visible later count as a mutation. Writing on the next
       frame puts the text in after the drawer is on screen. */
    const announcement = fresh.getAttribute('data-announce') || '';
    if (announcement) {
      window.requestAnimationFrame(() => {
        const status = drawer.querySelector('[data-cart-status]');
        if (status) status.textContent = announcement;
      });
    }

    if (wasOpen) {
      const target =
        findByFocusKey(drawer, focusKey) || drawer.querySelector('[data-cart-close]');
      if (target) target.focus();
    }
  }

  /* Matched by walking rather than with an attribute selector: a line item key
     is arbitrary text from Shopify and would need escaping inside a selector. */
  function findByFocusKey(drawer, key) {
    if (!key) return null;
    const nodes = drawer.querySelectorAll('[data-focus-key]');
    for (let i = 0; i < nodes.length; i += 1) {
      if (nodes[i].getAttribute('data-focus-key') === key) return nodes[i];
    }
    return null;
  }

  function setBusy(busy) {
    const drawer = getDrawer();
    const content = drawer && drawer.querySelector('[data-cart-content]');
    if (content) content.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function refresh() {
    if (!supported || !getDrawer()) return Promise.resolve();
    return fetchSection()
      .then(applySection)
      .catch(() => {
        /* The cart itself is fine — only our view of it is stale. Saying so is
           more use than a silent, wrong drawer. */
        toast(GENERIC_ERROR);
      });
  }

  /* --- The drawer --------------------------------------------------------- */

  class NessCartDrawer extends HTMLElement {
    connectedCallback() {
      if (this.ready) return;
      this.ready = true;

      this.opener = null;
      this.pending = false;

      this.onKeydown = this.onKeydown.bind(this);
      this.addEventListener('click', this.onClick.bind(this));
    }

    get panel() {
      return this.querySelector('[data-cart-panel]');
    }

    open(opener) {
      this.opener =
        opener ||
        this.opener ||
        (document.activeElement !== document.body ? document.activeElement : null);

      /* The menu drawer and this one share a scrim and a scroll lock; only one
         may hold them at a time. */
      const menu = document.getElementById('ness-menu-drawer');
      if (menu && !menu.hidden && typeof menu.close === 'function') menu.close();

      this.hidden = false;
      document.body.style.overflow = 'hidden';
      setOpenerState(true);
      document.addEventListener('keydown', this.onKeydown);

      const first = this.querySelector('[data-cart-close]');
      if (first) first.focus();
    }

    close() {
      if (this.hidden) return;
      this.hidden = true;
      document.body.style.overflow = '';
      setOpenerState(false);
      document.removeEventListener('keydown', this.onKeydown);
      if (this.opener && document.contains(this.opener)) this.opener.focus();
    }

    onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = this.panel;
      if (!panel) return;

      /* Focus is trapped inside the panel, not the host: the scrim is a button
         and would otherwise be a tab stop behind the dialog. Anything not
         actually rendered is dropped, so a hidden control cannot become the
         wrap-around point. */
      const focusables = Array.prototype.filter.call(
        panel.querySelectorAll(FOCUSABLE),
        (el) => el.getClientRects().length > 0,
      );
      if (!focusables.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    onClick(event) {
      const target = event.target;
      if (!target || !target.closest) return;

      if (target.closest('[data-cart-overlay], [data-cart-close]')) {
        event.preventDefault();
        this.close();
        return;
      }

      const step = target.closest('[data-cart-qty]');
      if (step) {
        event.preventDefault();
        this.change(step.getAttribute('data-line'), step.value);
        return;
      }

      const remove = target.closest('[data-cart-remove]');
      if (remove) {
        event.preventDefault();
        this.change(remove.getAttribute('data-line'), 0);
      }
    }

    /* Every quantity is absolute, never a delta, so a request that arrives out
       of order cannot compound. A second change is refused while one is in
       flight because its target quantity was read from a stale drawer. */
    change(line, quantity) {
      if (!supported || !line || this.pending) return Promise.resolve();
      this.pending = true;
      setBusy(true);

      return fetch(rootUrl() + 'cart/change.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          id: line,
          quantity: Number(quantity),
          sections: SECTION_ID,
          sections_url: sectionsUrl(),
        }),
      })
        .then(readJson)
        .then((result) => {
          if (!result.ok) {
            toast(errorMessage(result));
            /* Re-render anyway: the server refused, so the drawer is now
               showing a quantity the cart does not have. */
            return refresh();
          }
          const sections = result.body && result.body.sections;
          if (sections && sections[SECTION_ID]) {
            applySection(sections[SECTION_ID]);
            return undefined;
          }
          return refresh();
        })
        .catch(() => {
          toast(GENERIC_ERROR);
          return refresh();
        })
        .then(() => {
          this.pending = false;
          setBusy(false);
        });
    }
  }

  if (!customElements.get('ness-cart-drawer')) {
    customElements.define('ness-cart-drawer', NessCartDrawer);
  }

  /* --- Openers ------------------------------------------------------------
     With JavaScript the cart pill stops being a link to another page and
     becomes a dialog opener, so it is relabelled to say so. Done here rather
     than in Liquid: without this file it really is just a link. */
  function cartOpeners() {
    return document.querySelectorAll('a.ness-pill--cart, [data-ness-cart-open]');
  }

  function setOpenerState(expanded) {
    cartOpeners().forEach((el) => {
      el.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  }

  function upgradeOpeners() {
    if (!getDrawer()) return;
    cartOpeners().forEach((el) => {
      el.setAttribute('aria-haspopup', 'dialog');
      el.setAttribute('aria-controls', DRAWER_ID);
      el.setAttribute('aria-expanded', 'false');
    });
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const target = event.target;
    if (!target || !target.closest) return;

    const opener = target.closest('a.ness-pill--cart, [data-ness-cart-open]');
    if (!opener) return;

    /* Same reason as the submit handler: on /cart the drawer would shadow
       Shopify's own cart form, and edits made in it are reverted when that
       form is submitted. Let the pill be an ordinary link there. */
    if (document.body.dataset.nessTemplate === 'cart') return;

    const drawer = getDrawer();
    if (!drawer || typeof drawer.open !== 'function') return; // follow the link

    event.preventDefault();
    drawer.open(opener);
  });

  /* --- Add to cart --------------------------------------------------------
     The contract with the rest of the theme: any add-to-cart form carrying
     data-ness-add is posted here and opens the drawer. Product cards and the
     product page mark their forms with it. */
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!form || !form.matches || !form.matches('form[data-ness-add]')) return;
    if (!supported || !getDrawer()) return; // let the browser submit it

    /* "Buy Now" lives inside the same form as "Add to Cart" and is
       distinguished only by its submitter (name="checkout"). Intercepting it
       would add to the bag and open the drawer, which is precisely what Buy
       Now exists not to do — so it submits natively and Shopify takes the
       shopper to checkout.

       Read from event.submitter rather than a flag set on click: a form can
       also be submitted by Enter from a focused button, and FormData(form)
       does not include the submitter's own name/value at all. */
    if (event.submitter && event.submitter.name === 'checkout') return;

    /* On /cart the page below is Shopify's own cart form, whose updates[]
       inputs were rendered at page load and are positional. Editing quantities
       in the drawer and then using that form's checkout button would re-apply
       the stale quantities — silently, and to the wrong lines once something
       has been removed. On this template the drawer stays out of the way. */
    if (document.body.dataset.nessTemplate === 'cart') return;

    event.preventDefault();
    addToCart(form);
  });

  function addToCart(form) {
    if (form.dataset.nessBusy === 'true') return;
    form.dataset.nessBusy = 'true';

    const button = form.querySelector('[type="submit"]');

    /* Captured before the button is disabled. Disabling a focused control
       drops focus to <body>, and the drawer would then have nowhere to send
       it back to when the shopper closes it. */
    const returnTo =
      document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : button;

    if (button) {
      button.setAttribute('aria-busy', 'true');
      button.disabled = true;
    }

    const body = new FormData(form);
    /* Asking /cart/add.js to render the drawer in the same round trip: one
       request instead of two, and the response cannot describe a cart older
       than the add that produced it. */
    body.append('sections', SECTION_ID);
    body.append('sections_url', sectionsUrl());

    fetch(rootUrl() + 'cart/add.js', {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: body,
    })
      .then(readJson)
      .then((result) => {
        if (!result.ok) {
          /* Sold out, or more than stock allows. Shopify's `description` names
             the actual problem, so it is shown verbatim; the drawer is left
             shut because nothing was added. */
          toast(errorMessage(result));
          return refresh();
        }

        const sections = result.body && result.body.sections;
        const applied = sections && sections[SECTION_ID];
        if (applied) applySection(applied);

        return (applied ? Promise.resolve() : refresh()).then(() => {
          const drawer = getDrawer();
          if (drawer && typeof drawer.open === 'function') drawer.open(returnTo);
        });
      })
      .catch(() => {
        toast(GENERIC_ERROR);
      })
      .then(() => {
        form.dataset.nessBusy = 'false';
        if (button) {
          button.removeAttribute('aria-busy');
          button.disabled = false;
        }
      });
  }

  /* --- Public API ---------------------------------------------------------
     Present even when the drawer is not on the page, so a caller can rely on
     it without feature-testing. */
  window.NessCart = {
    refresh: refresh,
    open: function (opener) {
      const drawer = getDrawer();
      if (drawer && typeof drawer.open === 'function') drawer.open(opener);
    },
    close: function () {
      const drawer = getDrawer();
      if (drawer && typeof drawer.close === 'function') drawer.close();
    },
  };

  upgradeOpeners();
})();
