/* Nessclusive — collection page controls.

   Progressive enhancement over a form that already works without it: the
   filters panel is a plain <details>-less block revealed by a button, and the
   form submits via its Apply button. This file only makes those nicer —
   remembering the panel's open state and submitting the moment sort changes.

   With this blocked: the panel starts open (see the no-JS rule in the
   stylesheet) and Apply submits. Nothing is unreachable. */

(function () {
  'use strict';

  var form = document.getElementById('ness-facets');
  if (!form) return;

  var panel = document.getElementById('ness-filters');
  var toggle = form.querySelector('.ness-collection__filter-toggle');

  /* The panel is hidden here rather than in the markup so that a visitor
     without JavaScript never gets a panel they cannot open. */
  document.documentElement.classList.add('ness-facets-ready');

  if (panel && toggle) {
    /* Keep the panel open across a submit if the shopper had opened it —
       otherwise applying a filter collapses the controls they were using. */
    var STORAGE_KEY = 'ness:filters-open';
    var wasOpen = false;
    try {
      wasOpen = sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
      /* Private browsing can throw on sessionStorage. Not worth failing over. */
    }

    var setOpen = function (open) {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      try {
        sessionStorage.setItem(STORAGE_KEY, open ? '1' : '0');
      } catch (e) {}
    };

    setOpen(wasOpen || hasActiveFilters());

    toggle.addEventListener('click', function () {
      setOpen(panel.hidden);
    });
  }

  /* Sort applies immediately, which is what the prototype's dropdown does.
     The control is a native <select> so it stays keyboard- and
     screen-reader-native; only the submit is scripted. */
  var sort = form.querySelector('.ness-collection__sort-select');
  if (sort) {
    sort.addEventListener('change', function () {
      form.submit();
    });
  }

  /* If any facet is already applied, the panel opens on load — a shopper
     arriving on a filtered URL should be able to see what is filtering it. */
  function hasActiveFilters() {
    return /[?&]filter\./.test(window.location.search);
  }
})();
