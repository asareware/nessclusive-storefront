/* Nessclusive — scroll behaviour.

   Three things, all progressive enhancement. With this file blocked the page
   is fully usable: anchors still jump (instantly rather than gliding), revealed
   content is visible because it starts visible, and the header pill keeps its
   resting appearance.

   Transcribed from project/Nessclusive Storefront.dc.html:929-995. */

(function () {
  'use strict';

  var reduced =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- Header pill ------------------------------------------------------
     The floating header is translucent at rest and turns near-opaque once the
     page scrolls, so copy passing underneath it stays readable. Driven by a
     class rather than inline styles (the prototype sets styles directly) so
     the values stay in the stylesheet with the rest of the design. */
  var pill = document.querySelector('[data-nav-pill]');
  if (pill) {
    var ticking = false;
    var apply = function () {
      pill.classList.toggle('ness-header__pill--scrolled', window.pageYOffset > 24);
      ticking = false;
    };
    window.addEventListener(
      'scroll',
      function () {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(apply);
        }
      },
      { passive: true },
    );
    apply();
  }

  /* --- Smooth scroll ----------------------------------------------------
     Delegated from the document so it covers links added later. The 108px
     offset clears the fixed header; duration scales with distance so a short
     hop is not artificially slow and a long one is not interminable.

     Under prefers-reduced-motion it jumps instead of animating — the
     destination is what matters, the travel is decoration. */
  var HEADER_OFFSET = 108;

  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[data-smooth]');
    if (!link) return;

    var href = link.getAttribute('href') || '';
    if (href.charAt(0) !== '#' || href.length < 2) return;

    var target = document.getElementById(href.slice(1));
    if (!target) return;

    event.preventDefault();

    var destination =
      target.getBoundingClientRect().top + window.pageYOffset - HEADER_OFFSET;

    if (reduced) {
      window.scrollTo(0, destination);
      focusTarget(target);
      return;
    }

    var from = window.pageYOffset;
    var distance = destination - from;
    var duration = Math.min(1700, Math.max(950, Math.abs(distance) * 0.55));
    var start = performance.now();

    var step = function (now) {
      var p = Math.min(1, (now - start) / duration);
      // easeInOutCubic
      var eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      window.scrollTo(0, from + distance * eased);
      if (p < 1) {
        window.requestAnimationFrame(step);
      } else {
        focusTarget(target);
      }
    };
    window.requestAnimationFrame(step);
  });

  /* Move focus to the destination after scrolling. Without this the smooth
     scroll is purely visual — a keyboard user's focus stays on the link they
     activated, so the next Tab continues from the top of the page rather than
     from where they were sent. preventScroll stops the browser undoing the
     animation we just ran. */
  function focusTarget(target) {
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    try {
      target.focus({ preventScroll: true });
    } catch (e) {
      target.focus();
    }
  }

  /* --- Reveal on scroll -------------------------------------------------
     Elements marked [data-reveal] fade and rise as they enter the viewport,
     staggered by the attribute's value in milliseconds.

     Elements start visible in CSS and are only hidden once this script
     confirms it can reveal them again — so a failure mid-way leaves content
     on screen rather than permanently invisible, which is the failure mode
     that matters. Skipped entirely under reduced motion. */
  var revealables = document.querySelectorAll('[data-reveal]');
  if (!reduced && 'IntersectionObserver' in window && revealables.length) {
    document.documentElement.classList.add('ness-reveal-ready');

    var observer = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var delay = parseInt(entry.target.getAttribute('data-reveal'), 10) || 0;
          entry.target.style.transitionDelay = delay + 'ms';
          entry.target.classList.add('ness-revealed');
          obs.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );

    revealables.forEach(function (el) {
      observer.observe(el);
    });
  }
})();
