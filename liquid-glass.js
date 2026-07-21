// =============================================================
// Liquid Glass — shared motion engine for the dashboard.
// Include after design-system.css, anywhere in <head> or <body>:
//   <script src="liquid-glass.js" defer></script>
//
// What this does automatically, with zero per-page wiring:
//   - Staggers in .bento tiles and top-level .card sections on load
//     (fade + rise + scale, like iOS springboard icons appearing).
//   - Animates any element marked .lg-number whenever its text content
//     changes, counting between the old and new value instead of
//     snapping (numbers only — non-numeric text just swaps instantly).
//
// What needs one call per page (a single line each):
//   LiquidGlass.presentSheet(bgEl, panelEl, triggerEl) — opens a modal
//     by growing it from the trigger element's position/size instead
//     of a plain centered fade-in.
//   LiquidGlass.dismissSheet(bgEl, panelEl, triggerEl, onDone) — the
//     reverse, shrinking back toward the trigger before hiding.
//
// Everything here respects prefers-reduced-motion: reduce — the CSS
// side (design-system.css) already collapses transition/animation
// durations to ~0 globally, and the JS below skips the FLIP math and
// count-up tweening entirely, jumping straight to the end state.
// =============================================================
(function () {
  'use strict';

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ---------- auto stagger-in ----------
  function initStagger() {
    const containers = document.querySelectorAll('.bento, .page > .card');
    containers.forEach((el) => {
      if (el.classList.contains('lg-stagger')) return;
      el.classList.add('lg-stagger');
      Array.from(el.children).forEach((child, i) => {
        child.style.setProperty('--lg-i', i);
      });
    });
  }

  // ---------- auto number count-up ----------
  // Parses a leading/trailing non-numeric part (currency symbols,
  // units like "kg" or "%") so it can tween the numeric middle and
  // reassemble the original formatting exactly.
  function animateNumberChange(el, oldText, newText) {
    const numRe = /-?[\d,]+\.?\d*/;
    const oldMatch = oldText.match(numRe);
    const newMatch = newText.match(numRe);
    if (!oldMatch || !newMatch) { el.textContent = newText; return; }
    const oldNum = parseFloat(oldMatch[0].replace(/,/g, ''));
    const newNum = parseFloat(newMatch[0].replace(/,/g, ''));
    if (isNaN(oldNum) || isNaN(newNum) || oldNum === newNum) { el.textContent = newText; return; }
    const prefix = newText.slice(0, newMatch.index);
    const suffix = newText.slice(newMatch.index + newMatch[0].length);
    const decimals = (newMatch[0].split('.')[1] || '').length;
    const useCommas = /,/.test(newMatch[0]);
    const duration = 450;
    const start = performance.now();
    function format(n) {
      let s = n.toFixed(decimals);
      if (useCommas) {
        const parts = s.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        s = parts.join('.');
      }
      return s;
    }
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic — quick start, gentle settle
      const val = oldNum + (newNum - oldNum) * eased;
      el.textContent = prefix + format(val) + suffix;
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = newText;
    }
    requestAnimationFrame(tick);
  }

  function watchNumber(el) {
    let lastText = el.textContent;
    const mo = new MutationObserver(() => {
      const newText = el.textContent;
      if (newText === lastText || el.dataset.lgAnimating) return;
      const oldText = lastText;
      lastText = newText;
      el.dataset.lgAnimating = '1';
      animateNumberChange(el, oldText, newText);
      setTimeout(() => { delete el.dataset.lgAnimating; }, 500);
    });
    mo.observe(el, { childList: true, characterData: true, subtree: true });
  }

  function initNumberWatchers() {
    if (reducedMotion()) return;
    document.querySelectorAll('.lg-number').forEach(watchNumber);
  }

  // ---------- sheet presentation (shared-element style expand) ----------
  // Grows `panel` from `trigger`'s on-screen rect to its natural
  // (already-centered-by-CSS) rect, using a FLIP: read the natural end
  // state, transform it back to look like the start state, then let it
  // transition to identity on the next frame.
  function presentSheet(bg, panel, trigger) {
    bg.classList.add('show');
    if (reducedMotion() || !trigger) return;
    const from = trigger.getBoundingClientRect();
    // Force layout so the panel is in its natural centered position/size
    // before we measure it.
    panel.style.transition = 'none';
    const to = panel.getBoundingClientRect();
    const scaleX = from.width / to.width;
    const scaleY = from.height / to.height;
    const originX = from.left + from.width / 2 - (to.left + to.width / 2);
    const originY = from.top + from.height / 2 - (to.top + to.height / 2);
    panel.style.transformOrigin = 'center';
    panel.style.transform = 'translate(' + originX + 'px,' + originY + 'px) scale(' + scaleX + ',' + scaleY + ')';
    panel.style.opacity = '0';
    // eslint-disable-next-line no-unused-expressions
    panel.offsetHeight; // force reflow so the transform above actually applies before we clear it
    panel.style.transition = '';
    // A single rAF isn't reliably enough for the browser to have
    // painted the "shrunk" state before we change it again — without
    // a second rAF this collapses to an instant snap instead of a
    // transition on most engines.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panel.classList.add('lg-sheet-animating');
        panel.style.transform = '';
        panel.style.opacity = '';
        setTimeout(() => panel.classList.remove('lg-sheet-animating'), 650);
      });
    });
  }

  function dismissSheet(bg, panel, trigger, onDone) {
    if (reducedMotion() || !trigger) {
      bg.classList.remove('show');
      if (onDone) onDone();
      return;
    }
    const from = trigger.getBoundingClientRect();
    const to = panel.getBoundingClientRect();
    const scaleX = from.width / to.width;
    const scaleY = from.height / to.height;
    const originX = from.left + from.width / 2 - (to.left + to.width / 2);
    const originY = from.top + from.height / 2 - (to.top + to.height / 2);
    panel.style.transformOrigin = 'center';
    panel.classList.add('lg-sheet-animating');
    panel.style.transform = 'translate(' + originX + 'px,' + originY + 'px) scale(' + scaleX + ',' + scaleY + ')';
    panel.style.opacity = '0';
    setTimeout(() => {
      bg.classList.remove('show');
      panel.classList.remove('lg-sheet-animating');
      panel.style.transform = '';
      panel.style.opacity = '';
      if (onDone) onDone();
    }, 320);
  }

  window.LiquidGlass = { presentSheet, dismissSheet };

  function init() {
    initStagger();
    initNumberWatchers();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
