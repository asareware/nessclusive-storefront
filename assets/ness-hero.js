/* Nessclusive — hero video.

   The crossfade itself is CSS and needs no script. This file exists for the
   one thing CSS cannot do, which is start and stop a <video>.

   Three jobs:
     * keep the clips playing, including where a browser refuses the first
       autoplay attempt
     * mirror the pause checkbox onto them, so the control stops the footage
       as well as the crossfade
     * stop playback once the hero has scrolled out of view

   With this file blocked the hero still works: the clips carry the autoplay
   attribute and cross-fade on their own, and the checkbox still halts the
   crossfade through `:checked ~` in the stylesheet. What is lost is the
   ability to pause the footage itself, which is scripting-only by nature.

   On reduced motion: the clips still play. The stylesheet freezes the
   crossfade, so the layer-to-layer movement is gone, and the pause control is
   left on screen so the footage can be stopped in one click. An earlier
   version ticked that control automatically under reduced motion, which meant
   some visitors met a hero that had to be started by hand — the opposite of
   what a hero is for. */

(function () {
  'use strict';

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

      function wanted() {
        return onScreen && !(toggle && toggle.checked);
      }

      function start(video) {
        var played = video.play();
        /* A rejection here is normal, not an error: Safari in a Private
           window, iOS low-power mode, and data-saver settings all refuse the
           first programmatic play even for muted inline video. The poster is
           a still from the clip's own opening frame, so the hero looks right
           either way, and the listeners below get another attempt as soon as
           the browser is willing. Swallowed rather than logged — there is
           nothing here a visitor or a merchant can act on. */
        if (played && played.catch) played.catch(function () {});
      }

      function apply() {
        var play = wanted();
        Array.prototype.forEach.call(videos, function (video) {
          if (play) {
            start(video);
          } else if (!video.paused) {
            video.pause();
          }
        });
      }

      if (toggle) toggle.addEventListener('change', apply);

      /* Retry as each clip becomes playable. The first attempt runs the
         moment this script does, which for the later layers is usually before
         they hold any data — preload is "metadata" on those, so their first
         play() has nothing to play and resolves to nothing useful. */
      Array.prototype.forEach.call(videos, function (video) {
        video.addEventListener('canplay', function () {
          if (wanted() && video.paused) start(video);
        });
      });

      /* Last resort: a browser that refused autoplay outright will allow it
         once the visitor has interacted with the page at all. These fire once
         and remove themselves, and they only ever start playback the visitor
         has not explicitly paused. */
      var gestures = ['pointerdown', 'touchstart', 'keydown', 'scroll'];
      function onGesture() {
        gestures.forEach(function (type) {
          document.removeEventListener(type, onGesture);
        });
        if (wanted()) apply();
      }
      gestures.forEach(function (type) {
        document.addEventListener(type, onGesture, { passive: true, once: false });
      });

      /* Decoding three clips for a hero nobody is looking at costs battery on
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

      apply();
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
