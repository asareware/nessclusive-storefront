/* Nessclusive — global chrome behaviour.
   Mobile menu drawer and the toast utility. Everything degrades to working
   links if this file fails to load: the drawer is only needed below 1180px,
   and the toast is purely advisory. */

class NessDrawer extends HTMLElement {
  connectedCallback() {
    this.panel = this.querySelector('[data-drawer-panel]');
    this.overlay = this.querySelector('[data-drawer-overlay]');
    this.opener = document.querySelector('[data-drawer-open]');

    this.open = this.open.bind(this);
    this.close = this.close.bind(this);
    this.onKeydown = this.onKeydown.bind(this);

    this.opener?.addEventListener('click', this.open);
    this.overlay?.addEventListener('click', this.close);
    this.querySelectorAll('[data-drawer-close]').forEach((el) =>
      el.addEventListener('click', this.close),
    );
  }

  open() {
    this.hidden = false;
    document.body.style.overflow = 'hidden';
    this.opener?.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', this.onKeydown);
    // Focus the first link so keyboard users land inside the drawer.
    this.panel?.querySelector('a, button')?.focus();
  }

  close() {
    this.hidden = true;
    document.body.style.overflow = '';
    this.opener?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', this.onKeydown);
    this.opener?.focus();
  }

  onKeydown(event) {
    if (event.key === 'Escape') {
      this.close();
      return;
    }
    if (event.key !== 'Tab' || !this.panel) return;

    // Trap focus inside the panel while it is open.
    const focusables = this.panel.querySelectorAll(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
}

if (!customElements.get('ness-drawer')) {
  customElements.define('ness-drawer', NessDrawer);
}

/* Toast. Call as: NessToast.show('Added to bag'). Announced to screen readers
   via the live region rather than stealing focus. */
window.NessToast = (function () {
  let node = null;
  let timer = null;

  function show(message, duration = 2600) {
    if (!message) return;
    if (!node) {
      node = document.createElement('div');
      node.className = 'ness-toast';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      node.hidden = true;
    }, duration);
  }

  return { show };
})();
