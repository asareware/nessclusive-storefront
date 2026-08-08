/* Nessclusive — product page.

   Three enhancements over a form that already works without any of them:
   resolving the selected options to a variant (price, availability, hidden id),
   the − / + quantity buttons, and handing the submit to the cart drawer.

   With this file blocked: the radios still post options[] to /cart/add, which
   Shopify resolves server-side; quantity is a plain number input; and the form
   submits to /cart normally. Nothing is unreachable — the page is just less
   immediate. */

(function () {
  'use strict';

  var root = document.querySelector('[data-ness-product]');
  if (!root) return;

  var data = root.querySelector('[data-ness-variant-data]');
  var variants = [];

  if (data) {
    try {
      variants = JSON.parse(data.textContent) || [];
    } catch (e) {
      /* Malformed variant JSON must not take the page down — without it the
         form still posts options[] and Shopify resolves the variant. */
      variants = [];
    }
  }

  /* --- Quantity ---------------------------------------------------------- */

  var qtyWrap = root.querySelector('[data-ness-quantity]');
  var qtyInput = qtyWrap && qtyWrap.querySelector('input');

  if (qtyWrap && qtyInput) {
    var makeStep = function (delta, label) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'ness-quantity__step';
      button.setAttribute('aria-label', label);
      button.textContent = delta < 0 ? '−' : '+';
      button.addEventListener('click', function () {
        var min = parseInt(qtyInput.getAttribute('min') || '1', 10);
        var next = (parseInt(qtyInput.value, 10) || min) + delta;
        qtyInput.value = String(Math.max(min, next));
        qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return button;
    };

    qtyWrap.classList.add('ness-quantity--enhanced');
    qtyWrap.insertBefore(makeStep(-1, 'Decrease quantity'), qtyInput);
    qtyWrap.appendChild(makeStep(1, 'Increase quantity'));
  }

  /* --- Variant resolution ------------------------------------------------ */

  var priceEl = root.querySelector('[data-ness-price]');
  var idInput = root.querySelector('[data-ness-variant-id]');
  var addButton = root.querySelector('.ness-product__add');
  var addLabel = root.querySelector('[data-ness-add-label]');
  var buyButton = root.querySelector('.ness-product__buy');

  function selectedOptions() {
    /* Read by option index rather than by name. Option names in this catalog
       are inconsistent — "Cap Szie", "Cap size", "Parts" — so matching on them
       would silently fail on exactly the products that need it most. */
    var chosen = [];
    root.querySelectorAll('[data-ness-option]').forEach(function (el) {
      var index = parseInt(el.getAttribute('data-ness-option'), 10) - 1;
      if (el.tagName === 'SELECT') {
        chosen[index] = el.value;
      } else if (el.checked) {
        chosen[index] = el.value;
      }
    });
    return chosen;
  }

  function findVariant(chosen) {
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      var options = [v.option1, v.option2, v.option3];
      var match = true;
      for (var j = 0; j < chosen.length; j++) {
        if (chosen[j] !== undefined && options[j] !== chosen[j]) {
          match = false;
          break;
        }
      }
      if (match) return v;
    }
    return null;
  }

  function formatMoney(cents) {
    /* Shopify's money format is a shop setting this script cannot read, so the
       server-rendered price is the source of truth on load. This only has to
       match it well enough for a live update; currency comes from the markup
       already on the page. */
    var symbol = (priceEl && priceEl.textContent.trim().charAt(0)) || '$';
    return symbol + (cents / 100).toFixed(2);
  }

  function update() {
    if (!variants.length) return;
    var variant = findVariant(selectedOptions());

    if (!variant) {
      if (addButton) addButton.disabled = true;
      if (addLabel) addLabel.textContent = 'Unavailable';
      if (buyButton) buyButton.hidden = true;
      return;
    }

    if (idInput) idInput.value = variant.id;
    if (priceEl) priceEl.textContent = formatMoney(variant.price);

    var sellable = variant.available;
    if (addButton) addButton.disabled = !sellable;
    if (addLabel) addLabel.textContent = sellable ? 'Add to Cart' : 'Sold Out';
    if (buyButton) buyButton.hidden = !sellable;

    /* Keep the URL in step so a shared link opens on the same variant. */
    if (window.history && window.history.replaceState) {
      var url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url.toString());
    }
  }

  root.addEventListener('change', function (event) {
    if (event.target.matches('[data-ness-option]')) update();
  });

  update();

  /* Adding to cart belongs to the cart drawer, which intercepts submit on
     [data-ness-add]. Buy Now is deliberately NOT intercepted: ness-cart.js
     checks event.submitter for name="checkout" and lets the browser submit
     natively so Shopify takes the shopper to checkout.

     There is nothing to do here. An earlier version set a flag attribute on
     click, which nothing read, and which would have missed a submit triggered
     by Enter on the focused button anyway. */
})();

/* --- Recommendations ----------------------------------------------------
   Shopify computes these per product, so the section renders empty and fills
   itself from the Recommendations API. Nothing is lost without JavaScript —
   the section simply is not there, rather than showing an empty heading. */
(function () {
  'use strict';
  var host = document.querySelector('[data-ness-recommendations]');
  if (!host || !host.dataset.url) return;

  fetch(host.dataset.url)
    .then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      return res.text();
    })
    .then(function (html) {
      var parsed = new DOMParser().parseFromString(html, 'text/html');
      var fresh = parsed.querySelector('[data-ness-recommendations]');
      if (fresh && fresh.innerHTML.trim()) host.innerHTML = fresh.innerHTML;
    })
    .catch(function () {
      /* Leave the empty section alone. Recommendations are a nicety. */
    });
})();

