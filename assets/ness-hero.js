/* Nessclusive — hero video.

   The crossfade itself is CSS and needs no script. This file exists for the
   one thing CSS cannot do, which is stop a <video> from playing.

   Three jobs:
     * mirror the pause checkbox onto the clips
     * honour prefers-reduced-motion, which the markup's autoplay ignores
     * stop playback once the hero has scrolled out of view

   With this file blocked the hero still works: the clips autoplay and
   cross-fade, and the checkbox still halts the crossfade through `:checked ~`
   in the stylesheet. What is lost is the ability to pause the footage itself.
   That is unavoidable — pausing a video is a scripting-only capability — and
   it is why the markup ships autoplay rather than starting playback here:
   a script-started hero would show nothing at all to a visitor with
   JavaScript disabled. */

(function () {
  'use strict';

  var reducedQuery =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

  function setup(root) {
    var heroes = (root || document).querySelectorAll('.ness-hero');

    Array.prototype.forEach.call(heroes, function (hero) {
      /* The theme editor re-renders a section on every settings change, so
         setup runs repeatedly against the same page. Re-wiring a hero would
         stack duplicate listeners on the checkbox. */
      if (hero.getAttribute('data-ness-hero-ready') === 'true') return;

      var videos = hero.querySelectorAll('video');
      if (!videos.length) return;
      hero.setAttribute('data-ness-hero-ready', 'true');

      var toggle = hero.querySelector('[data-ness-hero-pause]');
      var onScreen = true;

      function reduced() {
        return !!(reducedQuery && reducedQuery.matches);
      }

      function apply() {
        var shouldPlay = onScreen && !reduced() && !(toggle && toggle.checked);

        Array.prototype.forEach.call(videos, function (video) {
          if (shouldPlay) {
            var played = video.play();
            /* Autoplay can still be refused — iOS low-power mode, a
               data-saver setting, a browser that wants a gesture first. The
               poster is a still from the clip's own opening frame, so a
               refusal leaves the right picture on screen. Nothing to recover
               from, and nothing worth logging. */
            if (played && played.catch) {
              played.catch(function () {});
            }
          } else if (!video.paused) {
            video.pause();
          }
        });
      }

      if (toggle) {
        toggle.addEventListener('change', apply);
      }

      /* Reduced motion resolves to a paused hero rather than a still one, so
         the control stays on screen (see ness-hero.css) and the checkbox is
         ticked to match. Without this the control would read "Pause" next to
         footage that is already stopped — and unticking it would then be the
         visitor's way to opt back in, which is the correct escape hatch. */
      function syncReduced() {
        if (reduced() && toggle && !toggle.checked) {
          toggle.checked = true;
        }
        apply();
      }

      if (reducedQuery) {
        if (reducedQuery.addEventListener) {
          reducedQuery.addEventListener('change', syncReduced);
        } else if (reducedQuery.addListener) {
          /* Safari before 14. */
          reducedQuery.addListener(syncReduced);
        }
      }

      /* Decoding two clips for a hero nobody is looking at costs battery on
         phones and buys nothing. Browsers do not stop offscreen video on
         their own. */
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              onScreen = entry.isIntersecting;
              apply();
            });
          },
          { threshold: 0.01 },
        ).observe(hero);
      }

      syncReduced();
    });
  }

  setup(document);

  /* Shopify swaps the section's DOM when a setting changes in the theme
     editor. The replacement carries fresh video elements that have never been
     wired up, and the old ones are gone along with their listeners. */
  document.addEventListener('shopify:section:load', function (event) {
    setup(event.target);
  });
})();
