/* Nessclusive — full-screen predictive search overlay.

   Strictly an upgrade over something that already works. The header control is
   a real <a href="/search">; this file intercepts a plain left-click on it and
   opens the overlay instead. Blocked, failed, or disabled, the link navigates
   to the search page and nothing is lost — which is also why the overlay
   markup ships with `hidden` set rather than being hidden in CSS.

   Inside the overlay the form is a real GET form pointed at /search, so Enter
   always reaches the full results page even if the suggestion fetch is
   failing. Suggestions are the enhancement; submitting is the guarantee.

   Results markup lives in Liquid (sections/ness-predictive-search.liquid) and
   is fetched through Shopify's Predictive Search API with `section_id`, so
   this file never builds product HTML from JSON. */

const NESS_SEARCH_DEBOUNCE = 250;
const NESS_SEARCH_MIN_LENGTH = 2;
const NESS_SEARCH_LIMIT = 8;
const NESS_SEARCH_SECTION = 'ness-predictive-search';

class NessSearch extends HTMLElement {
  connectedCallback() {
    this.panel = this.querySelector('[data-search-panel]');
    this.scrim = this.querySelector('[data-search-scrim]');
    this.input = this.querySelector('[data-search-input]');
    this.resultsEl = this.querySelector('[data-search-results]');
    this.summaryEl = this.querySelector('[data-search-summary]');
    this.openers = document.querySelectorAll('[data-search-open]');

    if (!this.input || !this.resultsEl) return;

    this.close = this.close.bind(this);
    this.onKeydown = this.onKeydown.bind(this);
    this.onInput = this.onInput.bind(this);

    this.timer = null;
    this.controller = null;
    this.lastQuery = null;
    this.returnFocusTo = null;

    this.openers.forEach((opener) => {
      /* The control only advertises itself as opening a dialog once there is
         a dialog to open. Without this script it stays an unremarkable link,
         which is exactly what it is. */
      opener.setAttribute('aria-haspopup', 'dialog');
      opener.addEventListener('click', (event) => this.onOpenerClick(event, opener));
    });

    this.scrim?.addEventListener('click', this.close);
    this.querySelectorAll('[data-search-close]').forEach((el) =>
      el.addEventListener('click', this.close),
    );
    this.input.addEventListener('input', this.onInput);
  }

  onOpenerClick(event, opener) {
    if (event.defaultPrevented) return;
    /* Modified clicks belong to the browser. Someone Cmd-clicking the search
       control wants /search in a new tab, and swallowing that is the quickest
       way to make a link feel broken. */
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (typeof event.button === 'number' && event.button !== 0) return;

    event.preventDefault();
    this.open(opener);
  }

  open(opener) {
    if (!this.hidden) return;

    /* Safari does not focus a link on click, so document.activeElement is
       often <body> at this point — the element that was clicked is the honest
       answer to "where should Escape put me back". */
    this.returnFocusTo = opener || (document.activeElement !== document.body ? document.activeElement : null);

    this.hidden = false;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', this.onKeydown);

    this.input.focus();
    this.input.select();

    /* Reopening with a term still in the field should show its results again
       rather than an empty panel. */
    if (this.input.value.trim().length >= NESS_SEARCH_MIN_LENGTH) {
      this.search(this.input.value);
    }
  }

  close() {
    if (this.hidden) return;

    clearTimeout(this.timer);
    this.abort();

    this.hidden = true;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', this.onKeydown);

    const target = this.returnFocusTo || this.openers[0];
    if (target && typeof target.focus === 'function') target.focus();
    this.returnFocusTo = null;
  }

  onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab' || !this.panel) return;

    const focusables = this.focusable();
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

  /* The panel's focusable elements, minus the ones that are not actually
     there. The shared product card carries a quick-add control that the
     overlay hides with display:none — left in the list it would become the
     trap's "last" element, focus() would do nothing, and Tab would escape the
     dialog entirely. */
  focusable() {
    const selector =
      'a[href], button:not([disabled]), input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
    return Array.from(this.panel.querySelectorAll(selector)).filter(
      (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0,
    );
  }

  onInput() {
    clearTimeout(this.timer);
    const value = this.input.value.trim();

    if (value.length < NESS_SEARCH_MIN_LENGTH) {
      this.abort();
      this.lastQuery = null;
      this.resultsEl.innerHTML = '';
      this.setSummary('');
      return;
    }

    this.timer = setTimeout(() => this.search(value), NESS_SEARCH_DEBOUNCE);
  }

  search(rawQuery) {
    const query = rawQuery.trim();
    if (query === this.lastQuery) return;
    this.lastQuery = query;

    this.abort();

    const controller = new AbortController();
    this.controller = controller;
    this.resultsEl.setAttribute('aria-busy', 'true');

    const base = (window.routes && window.routes.predictive_search_url) || '/search/suggest';
    const url =
      base +
      '?q=' +
      encodeURIComponent(query) +
      '&resources[type]=product' +
      '&resources[limit]=' +
      NESS_SEARCH_LIMIT +
      '&resources[options][unavailable_products]=last' +
      '&section_id=' +
      NESS_SEARCH_SECTION;

    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Predictive search responded ' + response.status);
        return response.text();
      })
      .then((html) => {
        /* A newer keystroke has already taken over; this answer is stale. */
        if (this.controller !== controller) return;
        this.controller = null;
        this.settle();
        this.render(html, query);
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        if (this.controller !== controller) return;
        this.controller = null;
        this.settle();
        this.renderFallback(query);
      });
  }

  render(html, query) {
    const incoming = new DOMParser()
      .parseFromString(html, 'text/html')
      .getElementById('ness-predictive-search-results');

    if (!incoming) {
      this.renderFallback(query);
      return;
    }

    this.resultsEl.innerHTML = incoming.innerHTML;
    this.setSummary(incoming.getAttribute('data-summary') || '');
  }

  /* Nothing to show, but the shopper is not stuck: the form underneath still
     submits to the real search page. Clearing lastQuery lets the same term be
     retried rather than being swallowed by the duplicate-query guard. */
  renderFallback(query) {
    this.lastQuery = null;
    this.resultsEl.innerHTML = '';
    this.setSummary('Press Enter to search for “' + query + '”.');
  }

  abort() {
    if (!this.controller) return;
    this.controller.abort();
    this.controller = null;
    /* The in-flight query never produced results, so it must not count as
       "already searched". Without this, closing the overlay mid-request and
       reopening it hits the duplicate-query guard in search(): no fetch is
       made, the results panel is still empty, and the shopper stares at their
       own term with nothing under it. On a slow connection that is the common
       case, not an edge one. */
    this.lastQuery = null;
    this.settle();
  }

  settle() {
    this.resultsEl.removeAttribute('aria-busy');
  }

  /* textContent, never innerHTML — the summary carries a shopper-typed term. */
  setSummary(text) {
    if (!this.summaryEl) return;
    if (this.summaryEl.textContent === text) return;
    this.summaryEl.textContent = text;
  }
}

if (!customElements.get('ness-search')) {
  customElements.define('ness-search', NessSearch);
}
