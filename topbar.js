// =============================================================
// Persistent dashboard top bar.
// Drop this on any page with:
//     <script src="topbar.js" defer></script>
// It self-injects HTML + CSS, reads progress from the same
// localStorage keys the dashboard's tabs already use, and a
// water "+1" button writes to localStorage and (if configured)
// pushes a merged update to the Supabase health row so the
// new bottle appears on every device within ~1 second.
// =============================================================
(function () {
  'use strict';

  // -------- Supabase config (same project as the rest of the dashboard) --------
  // For your audience's standalone, replace these with placeholders
  // and have them paste their own values, just like the other pages.
  // Prefer Vercel env vars (served via /api/config → window.DASH_*),
  // otherwise fall back to these defaults.
  const TOPBAR_SUPABASE_URL = (window.DASH_SUPABASE_URL) || 'https://srajryooffirbroltjmg.supabase.co';
  const TOPBAR_SUPABASE_KEY = (window.DASH_SUPABASE_KEY) || 'sb_publishable_5142ZwTLF_DkSVRzciNuRA_bHwRAu4c';

  // -------- CSS --------
  const css = `
.topbar {
  position: sticky; top: 0; z-index: 40;
  display: flex; justify-content: flex-end; align-items: center;
  gap: 8px;
  padding: max(10px, env(safe-area-inset-top)) 14px 8px;
  background: #0a0a0b;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
}
.topbar-water-wrap {
  display: flex; align-items: stretch;
}
.topbar-water-pill {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-right: none;
  border-radius: 12px 0 0 12px;
  text-decoration: none;
  color: #FAFAFA;
  -webkit-tap-highlight-color: transparent;
}
.topbar-water-pill .topbar-pill-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #B8B6B0; flex-shrink: 0;
}
.topbar-water-pill.warn .topbar-pill-dot { background: #fbbf24; }
.topbar-water-pill.miss .topbar-pill-dot {
  background: #ff8a8a;
  animation: topbar-miss-pulse 1.6s ease-in-out infinite;
}
@keyframes topbar-miss-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
  50%      { box-shadow: 0 0 0 5px rgba(239, 68, 68, 0); }
}
.topbar-pill-count {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 13px; font-weight: 700;
  color: #FAFAFA;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.topbar-water-add {
  width: 44px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.10));
  color: #FFFFFF;
  font-family: inherit; font-size: 20px; font-weight: 700; line-height: 1;
  cursor: pointer;
  border-radius: 0 12px 12px 0;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, transform 0.10s;
}
.topbar-water-add:active { transform: scale(0.94); }
.topbar-water-add.flash {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.65), rgba(255, 255, 255, 0.35));
}
.topbar-finance-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s;
}
.topbar-finance-btn:hover { background: rgba(255, 255, 255, 0.08); }
.topbar-finance-icon {
  font-size: 20px; line-height: 1;
  filter: grayscale(100%) brightness(1.4);
  opacity: 0.85;
}

/* ===== Focus timer ===== */
.topbar-focus-wrap { position: relative; }
.topbar-focus-btn {
  display: inline-flex; align-items: center; gap: 7px;
  height: 42px; padding: 0 13px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.55);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12.5px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.topbar-focus-btn:hover { background: rgba(255, 255, 255, 0.08); color: #FAFAFA; }
.topbar-focus-btn.running { color: #FAFAFA; border-color: rgba(255,255,255,0.30); background: rgba(255,255,255,0.09); }
.topbar-focus-btn.done {
  color: #6BE3A4; border-color: rgba(107,227,164,0.45); background: rgba(107,227,164,0.10);
  animation: focus-done-pulse 1.2s ease-in-out infinite;
}
@keyframes focus-done-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(107,227,164,0.35); }
  50%      { box-shadow: 0 0 0 6px rgba(107,227,164,0); }
}
.focus-menu {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 310;
  display: none; flex-direction: column; gap: 4px;
  min-width: 170px; padding: 7px;
  background: #101012;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 13px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.7);
}
.focus-menu.show { display: flex; }
.focus-menu button {
  border: 0; background: transparent; text-align: left;
  padding: 10px 12px; border-radius: 9px;
  color: #D8D6D0; font-family: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer;
}
.focus-menu button:hover { background: rgba(255,255,255,0.09); color: #FFFFFF; }
.focus-menu .focus-stop { color: #FF8A8A; }

/* ===== Command palette (Cmd/Ctrl+K) ===== */
.topbar-cmdk-btn {
  display: inline-flex; align-items: center; gap: 7px;
  height: 42px; padding: 0 13px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.55);
  font-family: inherit; font-size: 12.5px; font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, color 0.15s;
}
.topbar-cmdk-btn:hover { background: rgba(255, 255, 255, 0.08); color: #FAFAFA; }
.topbar-cmdk-kbd {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 10.5px; font-weight: 700;
  padding: 2px 6px; border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.5);
}
@media (max-width: 600px) {
  .topbar-cmdk-btn { padding: 0 12px; }
  .topbar-cmdk-label, .topbar-cmdk-kbd { display: none; }
}

.cmdk-bg {
  position: fixed; inset: 0; z-index: 300; display: none;
  align-items: flex-start; justify-content: center;
  padding: min(14vh, 130px) 20px 20px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.cmdk-bg.show { display: flex; }
.cmdk {
  width: 100%; max-width: 560px;
  background: #101012;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255,255,255,0.08);
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
}
.cmdk-input-row {
  display: flex; align-items: center; gap: 10px;
  padding: 15px 17px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.cmdk-input-row svg { width: 17px; height: 17px; color: rgba(255,255,255,0.4); flex-shrink: 0; }
.cmdk-input {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
  color: #FAFAFA; font-family: inherit; font-size: 15.5px;
}
.cmdk-input::placeholder { color: rgba(255, 255, 255, 0.30); }
.cmdk-list { max-height: min(46vh, 400px); overflow-y: auto; padding: 7px; }
.cmdk-group-label {
  font-size: 9.5px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.32);
  padding: 9px 11px 4px;
}
.cmdk-item {
  display: flex; align-items: center; gap: 11px;
  padding: 10px 11px; border-radius: 10px; cursor: pointer;
  color: #D8D6D0; font-size: 13.5px; font-weight: 500;
}
.cmdk-item .cmdk-ic { width: 22px; text-align: center; font-size: 15px; flex-shrink: 0; filter: grayscale(100%) brightness(1.35); opacity: 0.8; }
.cmdk-item .cmdk-sub { margin-left: auto; font-size: 11px; color: rgba(255,255,255,0.30); white-space: nowrap; }
.cmdk-item.sel { background: rgba(255, 255, 255, 0.10); color: #FFFFFF; }
.cmdk-item.sel .cmdk-ic { opacity: 1; }
.cmdk-empty { text-align: center; color: rgba(255,255,255,0.35); font-size: 13px; padding: 22px 0 26px; }
.cmdk-foot {
  display: flex; gap: 14px; align-items: center;
  padding: 9px 15px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 10.5px; color: rgba(255, 255, 255, 0.30);
}
.cmdk-foot b {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-weight: 700; font-size: 10px;
  padding: 1px 5px; border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.45);
}

/* Bottom tab bar — Instagram-style */
.bottombar {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 40;
  display: flex; justify-content: space-around; align-items: stretch;
  padding: 6px 0 calc(6px + env(safe-area-inset-bottom));
  background: #0a0a0b;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
}
.bottombar-tab {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px;
  padding: 6px 0 4px;
  text-decoration: none;
  color: rgba(255, 255, 255, 0.45);
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.04em;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.15s;
}
.bottombar-tab-icon {
  font-size: 24px; line-height: 1;
  filter: grayscale(100%) brightness(1.2);
  opacity: 0.55;
  transition: opacity 0.15s, filter 0.15s, transform 0.10s;
}
.bottombar-tab.active {
  color: #FAFAFA;
}
.bottombar-tab.active .bottombar-tab-icon {
  filter: grayscale(100%) brightness(1.6);
  opacity: 1;
}
.bottombar-tab:active .bottombar-tab-icon { transform: scale(0.92); }

/* Push page content above the fixed bottom bar */
body.has-bottombar {
  padding-bottom: calc(72px + env(safe-area-inset-bottom)) !important;
}

@media (max-width: 480px) {
  .topbar { padding-left: 10px; padding-right: 10px; gap: 6px; }
  .topbar-water-pill { padding: 8px 11px; gap: 6px; }
  .topbar-pill-count { font-size: 12px; }
  .topbar-water-add { width: 40px; font-size: 18px; }
  .topbar-finance-btn { width: 40px; height: 38px; }
  .topbar-finance-icon { font-size: 18px; }
  .bottombar-tab-icon { font-size: 22px; }
  .bottombar-tab { font-size: 10px; }
}

/* === Global mobile lockdown ===
   1) Hide the right-side scrollbar on phones (iOS uses overlay scrollbars anyway).
   2) Stop iOS auto-text-size-adjust.
   3) touch-action: pan-y prevents pinch-zoom while still allowing vertical scroll.
   4) overscroll-behavior on every common modal class stops scroll chaining —
      scrolling inside a settings popup won't drag the page behind it.
   5) When body has .topbar-modal-open, the page can't scroll at all (locked).
*/
html, body {
  -webkit-text-size-adjust: 100%;
}
@media (max-width: 768px) {
  html { touch-action: pan-y; }
  ::-webkit-scrollbar { width: 0; height: 0; display: none; }
  html, body { scrollbar-width: none; -ms-overflow-style: none; }
}
.modal-bg, .modal, .po-modal-bg, .po-modal, .wt-overlay, .wt-viewer {
  overscroll-behavior: contain;
}
body.topbar-modal-open {
  overflow: hidden;
  touch-action: none;
}
/* On phones, blow the modals up to full screen and let them be the only
   scrolling element. Way less "is this scrolling the page or the modal?"
   confusion. */
@media (max-width: 480px) {
  .modal-bg, .po-modal-bg {
    padding: 0 !important;
    align-items: stretch !important;
    justify-content: stretch !important;
  }
  .modal, .po-modal {
    width: 100% !important;
    max-width: 100% !important;
    max-height: 100vh !important;
    height: 100vh !important;
    border-radius: 0 !important;
    padding-top: max(20px, env(safe-area-inset-top)) !important;
    padding-bottom: max(28px, env(safe-area-inset-bottom)) !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
  }
}
`;

  // -------- HTML --------
  const topbarHtml = `
<header class="topbar" id="topbar" role="navigation" aria-label="Quick actions">
  <div class="topbar-focus-wrap">
    <button class="topbar-focus-btn" id="topbarFocus" type="button" aria-label="Focus timer">◔ Focus</button>
    <div class="focus-menu" id="focusMenu">
      <button type="button" data-min="25">25 min — deep focus</button>
      <button type="button" data-min="50">50 min — long block</button>
      <button type="button" data-min="5">5 min — break</button>
      <button type="button" data-min="10">10 min — break</button>
      <button type="button" class="focus-stop" id="focusStop" style="display:none">Stop timer</button>
    </div>
  </div>
  <button class="topbar-cmdk-btn" id="topbarCmdk" type="button" aria-label="Open command palette">
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <span class="topbar-cmdk-label">Search</span>
    <span class="topbar-cmdk-kbd">⌘K</span>
  </button>
  <div class="topbar-water-wrap">
    <a href="health.html#water" class="topbar-water-pill" id="topbarWater" aria-label="Water progress">
      <span class="topbar-pill-dot"></span>
      <span class="topbar-pill-count" id="topbarWaterCount">0/0</span>
    </a>
    <button class="topbar-water-add" id="topbarWaterAdd" aria-label="Log one drink" type="button">+</button>
  </div>
  <a href="finance.html" class="topbar-finance-btn" id="topbarFinance" aria-label="Finance">
    <span class="topbar-finance-icon">📊</span>
  </a>
</header>
`;

  const cmdkHtml = `
<div class="cmdk-bg" id="cmdkBg" role="dialog" aria-label="Command palette">
  <div class="cmdk">
    <div class="cmdk-input-row">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input class="cmdk-input" id="cmdkInput" type="text" placeholder="Jump to a page or run an action…" autocomplete="off" spellcheck="false">
    </div>
    <div class="cmdk-list" id="cmdkList"></div>
    <div class="cmdk-foot"><span><b>↑↓</b> navigate</span><span><b>↵</b> open</span><span><b>esc</b> close</span></div>
  </div>
</div>
`;

  const bottombarHtml = `
<nav class="bottombar" id="bottombar" role="navigation" aria-label="Main tabs">
  <a href="index.html" class="bottombar-tab" data-page="main">
    <span class="bottombar-tab-icon">🏠</span>
    <span>Main</span>
  </a>
</nav>
`;

  // Pages where we suppress the app chrome: finance has its own internal
  // 4-tab bottom nav and self-contained back button.
  function isFinancePage() {
    const p = (window.location.pathname || '').toLowerCase();
    return p.endsWith('/finance.html') || p.endsWith('finance.html');
  }
  // When the water tracker is iframed inside health.html, the embedded
  // page shouldn't render its own chrome again.
  function isEmbedded() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }
  function shouldShowChrome() {
    return !isFinancePage() && !isEmbedded();
  }
  function currentPageKey() {
    return 'main'; // the bottom nav only has one tab today
  }

  function injectStyleAndHTML() {
    if (document.getElementById('topbar') || document.getElementById('bottombar')) return;
    if (!shouldShowChrome()) return;

    const style = document.createElement('style');
    style.id = 'topbar-style';
    style.textContent = css;
    document.head.appendChild(style);

    const topWrap = document.createElement('div');
    topWrap.innerHTML = topbarHtml.trim();
    document.body.insertBefore(topWrap.firstChild, document.body.firstChild);

    const bottomWrap = document.createElement('div');
    bottomWrap.innerHTML = bottombarHtml.trim();
    document.body.appendChild(bottomWrap.firstChild);

    // Highlight the active bottom tab.
    const active = currentPageKey();
    document.querySelectorAll('.bottombar-tab').forEach((t) => {
      t.classList.toggle('active', t.getAttribute('data-page') === active);
    });

    // Reserve room above the fixed bottom bar so page content can scroll
    // past it without being hidden.
    document.body.classList.add('has-bottombar');
  }

  // -------- Active-date helpers (match the goals page 6 AM rollover) --------
  function activeDateKey() {
    const now = new Date();
    const d = new Date(now);
    if (now.getHours() < 6) d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function calendarDateKey() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // -------- Read progress from localStorage --------
  function getGoalsProgress() {
    const key = 'goals:' + activeDateKey();
    let goals = [];
    try { goals = JSON.parse(localStorage.getItem(key)) || []; } catch (e) {}
    const total = Array.isArray(goals) ? goals.length : 0;
    const done = total ? goals.filter(g => g && g.done).length : 0;
    return { done, total };
  }

  function getStackProgress() {
    let items = [];
    try { items = JSON.parse(localStorage.getItem('stack:items')) || []; } catch (e) {}
    let taken = {};
    try { taken = JSON.parse(localStorage.getItem('stack:taken:' + activeDateKey())) || {}; } catch (e) {}
    const total = Array.isArray(items) ? items.length : 0;
    const done = total ? items.filter(i => i && taken[i.id]).length : 0;
    return { done, total };
  }

  function getWaterProgress() {
    let state = null;
    try { state = JSON.parse(localStorage.getItem('po_water_v1')); } catch (e) {}
    if (!state) return { done: 0, total: 0 };
    const todayKey = calendarDateKey();
    const done = (state.logs || {})[todayKey] || 0;
    const p = state.profile || { weightKg: 75 };
    const wKg = state.weightUnit === 'lb' ? (p.weightKg || 0) / 2.20462 : (p.weightKg || 0);
    const base = wKg * 35;
    const exercise = (p.activityHrsPerWeek || 0) / 7 * 500;
    const caffeine = Math.max(0, (state.caffeineMgPerDay || 0) - 200) * 1.5;
    const subs = (state.substances || []).reduce((s, x) => {
      const dose = (x && x.dose != null ? x.dose : (x && x.defaultDose)) || 0;
      return s + Math.max(0, dose * ((x && x.mlPerUnit) || 0));
    }, 0);
    let adjust = 0;
    if (p.sex === 'm') adjust += 200;
    if ((p.age || 0) >= 50) adjust += 100;
    const totalMl = base + exercise + caffeine + subs + adjust;
    let unitVol;
    if (state.unit === 'glass') unitVol = state.glassMl || 250;
    else if (state.unit === 'oz') unitVol = 30;
    else if (state.unit === 'ml') unitVol = 1;
    else unitVol = state.bottleMl || 500;
    const total = Math.max(1, Math.ceil(totalMl / unitVol));
    return { done, total };
  }

  function classifyStatus(done, total) {
    if (total === 0) return 'idle';
    if (done >= total) return 'good';
    if (done >= total * 0.5) return 'warn';
    // Past 6pm and still under half → flag as missed
    const h = new Date().getHours();
    if (h >= 18 && done < total * 0.5) return 'miss';
    return 'warn';
  }

  function setPillStatus(pillEl, status) {
    pillEl.classList.remove('good', 'warn', 'miss');
    if (status === 'warn' || status === 'miss') pillEl.classList.add(status);
  }

  function render() {
    const waterEl = document.getElementById('topbarWater');
    if (!waterEl) return; // not injected yet

    const w = getWaterProgress();
    const countEl = document.getElementById('topbarWaterCount');
    if (countEl) countEl.textContent = w.total ? w.done + '/' + w.total : '0/0';
    setPillStatus(waterEl, classifyStatus(w.done, w.total));
  }

  // -------- Water +1 (works from any page) --------
  function defaultWaterState() {
    return {
      unit: 'bottle', bottleMl: 500, glassMl: 250, weightUnit: 'kg',
      profile: { weightKg: 75, age: 25, sex: 'm', activityHrsPerWeek: 5 },
      caffeineMgPerDay: 200, substances: [], logs: {}
    };
  }

  async function pushWaterMergedToSupabase(localWater) {
    // Only do this when we're NOT on the health page — health page
    // has its own sync that already detects the localStorage change.
    if (window.location.pathname.endsWith('/health.html') ||
        window.location.pathname.endsWith('health.html')) return;

    if (!window.supabase || !TOPBAR_SUPABASE_URL || !TOPBAR_SUPABASE_KEY) return;
    if (TOPBAR_SUPABASE_URL.indexOf('PASTE-') === 0) return;

    try {
      const supa = window.supabase.createClient(TOPBAR_SUPABASE_URL, TOPBAR_SUPABASE_KEY);
      const { data } = await supa
        .from('app_state').select('data').eq('key', 'health').maybeSingle();
      const current = (data && data.data) || {};
      const merged = Object.assign({}, current, { po_water_v1: localWater });
      await supa.from('app_state').upsert(
        { key: 'health', data: merged, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    } catch (e) { /* offline — local change will sync next time user visits health */ }
  }

  function addWater() {
    let state = null;
    try { state = JSON.parse(localStorage.getItem('po_water_v1')); } catch (e) {}
    if (!state || typeof state !== 'object') state = defaultWaterState();
    state.logs = state.logs || {};
    const k = calendarDateKey();
    state.logs[k] = (state.logs[k] || 0) + 1;
    try { localStorage.setItem('po_water_v1', JSON.stringify(state)); } catch (e) {}
    render();

    const btn = document.getElementById('topbarWaterAdd');
    if (btn) {
      btn.classList.add('flash');
      setTimeout(() => btn.classList.remove('flash'), 220);
    }

    pushWaterMergedToSupabase(state);
  }

  // -------- Focus timer (persists across pages via localStorage) --------
  const FOCUS_KEY = 'focus:timer'; // { endTs, min } | { doneAt } | null

  function focusState() {
    try { return JSON.parse(localStorage.getItem(FOCUS_KEY)); } catch (e) { return null; }
  }
  function setFocusState(s) {
    try {
      if (s) localStorage.setItem(FOCUS_KEY, JSON.stringify(s));
      else localStorage.removeItem(FOCUS_KEY);
    } catch (e) {}
  }

  function renderFocus() {
    const btn = document.getElementById('topbarFocus');
    if (!btn) return;
    const stopBtn = document.getElementById('focusStop');
    const s = focusState();
    btn.classList.remove('running', 'done');
    if (stopBtn) stopBtn.style.display = s && s.endTs ? '' : 'none';
    if (!s) { btn.textContent = '◔ Focus'; return; }
    if (s.doneAt) { btn.textContent = '✓ Done'; btn.classList.add('done'); return; }
    const left = s.endTs - Date.now();
    if (left <= 0) {
      setFocusState({ doneAt: Date.now() });
      btn.textContent = '✓ Done';
      btn.classList.add('done');
      if (document.title.indexOf('⏰') !== 0) document.title = '⏰ ' + document.title;
      return;
    }
    const m = Math.floor(left / 60000);
    const sec = Math.floor((left % 60000) / 1000);
    btn.textContent = '◔ ' + m + ':' + String(sec).padStart(2, '0');
    btn.classList.add('running');
  }

  function initFocus() {
    const btn = document.getElementById('topbarFocus');
    if (!btn) return;
    const menu = document.getElementById('focusMenu');
    btn.addEventListener('click', () => {
      const s = focusState();
      if (s && s.doneAt) { // acknowledge finished timer
        setFocusState(null);
        document.title = document.title.replace(/^⏰ /, '');
        renderFocus();
        return;
      }
      menu.classList.toggle('show');
    });
    menu.querySelectorAll('button[data-min]').forEach((b) => {
      b.addEventListener('click', () => {
        const min = parseInt(b.dataset.min, 10);
        setFocusState({ endTs: Date.now() + min * 60000, min });
        menu.classList.remove('show');
        renderFocus();
      });
    });
    document.getElementById('focusStop').addEventListener('click', () => {
      setFocusState(null);
      menu.classList.remove('show');
      renderFocus();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.topbar-focus-wrap')) menu.classList.remove('show');
    });
    setInterval(renderFocus, 1000);
    renderFocus();
  }

  // -------- Command palette (Cmd/Ctrl+K) --------
  const CMDK_COMMANDS = [
    { group: 'Pages', ic: '🏠', label: 'Home',            sub: 'hub',                href: 'index.html',        kw: 'hub dashboard tiles home' },
    { group: 'Pages', ic: '🎯', label: 'Main',            sub: 'goals & daily plan', href: 'main.html',         kw: 'goals today plan countdown ticker' },
    { group: 'Pages', ic: '💧', label: 'Water',           sub: 'hydration',          href: 'po-water.html',     kw: 'water hydration drink' },
    { group: 'Pages', ic: '📅', label: 'Planner',         sub: 'goals & events',     href: 'planner.html',      kw: 'planner month schedule monthly goals events countdown birthday deadline trip' },
    { group: 'Pages', ic: '📊', label: 'Finance',         sub: 'net worth & budget', href: 'finance.html',      kw: 'money net worth budget subs subscriptions wishlist orders' },
    { group: 'Pages', ic: '🧠', label: 'Sirius',          sub: 'AI mentor',          href: 'nova-lite.html',    kw: 'ai chat mentor sirius ask' },
    { group: 'Pages', ic: '📝', label: 'Notes',           sub: 'ideas & docs',       href: 'notes.html',        kw: 'notes docs writing ideas quick thought web' },
    { group: 'Pages', ic: '📖', label: 'Personal Study',  sub: 'grow with Jehovah',  href: 'study.html',        kw: 'personal study bible jw jehovah witness scripture prayer ministry meeting daily text' },
    { group: 'Pages', ic: '🔗', label: 'Links',           sub: 'saved & sorted',     href: 'links.html',        kw: 'links bookmarks saved urls' },
    { group: 'Pages', ic: '🗂', label: 'Miscellaneous',   sub: 'everything else',    href: 'misc.html',         kw: 'misc other tools' },
    { group: 'Pages', ic: '❤️', label: 'Health',          sub: 'meals & water',      href: 'health.html',       kw: 'health meals food calories water supplements stack vitamins' },
    { group: 'Pages', ic: '🏋️', label: 'Gym',             sub: 'training & weight',  href: 'gym.html',          kw: 'gym workout lifts training bodyweight fitness' },
    { group: 'Pages', ic: '☕', label: 'Caffeine',        sub: 'intake & timing',    href: 'caffeine.html',     kw: 'caffeine coffee energy drinks' },
    { group: 'Pages', ic: '💡', label: 'Money Ideas',     sub: 'AI brainstorm',      href: 'money-ideas.html',  kw: 'money ideas brainstorm income' },
    { group: 'Pages', ic: '🏦', label: 'Bank Accounts',   sub: 'Plaid',              href: 'bank-accounts.html', kw: 'bank accounts plaid balances' },
    { group: 'Pages', ic: '📦', label: 'USPS Tracking',   sub: 'packages',           href: 'usps-tracking.html', kw: 'usps packages tracking mail shipping' },
    { group: 'Pages', ic: '🤖', label: 'Iron Condor Bot', sub: 'options bot',        href: 'iron-condor.html',  kw: 'trading options bot spy tastytrade' },
    { group: 'Pages', ic: '🛒', label: 'Products',        sub: 'link tracker',       href: 'products.html',     kw: 'products links spreadsheet purchase tracker good bad verdict' },
    { group: 'Pages', ic: '🔧', label: 'Maintenance',     sub: 'recurring due-dates', href: 'maintenance.html', kw: 'maintenance oil change filter reminder recurring due car home' },
    { group: 'Pages', ic: '🎯', label: 'Skills',          sub: 'practice streaks',   href: 'skills.html',       kw: 'skills learning language practice streak instrument' },
    { group: 'Actions', ic: '➕', label: 'Log a drink of water', sub: 'instant', action: 'water',  kw: 'water add drink log +1' },
    { group: 'Actions', ic: '📅', label: "Open today's Daily Note", sub: 'notes', href: 'notes.html#daily', kw: 'daily note today journal write' },
    { group: 'Actions', ic: '🕸', label: 'Open the Web of notes', sub: 'graph', href: 'notes.html#web', kw: 'web graph notes connections obsidian' },
  ];

  let cmdkOpen = false;
  let cmdkSel = 0;
  let cmdkMatches = [];

  function cmdkFilter(q) {
    q = q.trim().toLowerCase();
    if (!q) return CMDK_COMMANDS.slice();
    const terms = q.split(/\s+/);
    const scored = [];
    CMDK_COMMANDS.forEach((c, order) => {
      const label = c.label.toLowerCase();
      const hay = (c.label + ' ' + (c.sub || '') + ' ' + (c.kw || '')).toLowerCase();
      if (!terms.every((t) => hay.indexOf(t) !== -1)) return;
      // Rank: label prefix > label substring > keyword-only match.
      let score = 2;
      if (terms.some((t) => label.indexOf(t) === 0)) score = 0;
      else if (terms.some((t) => label.indexOf(t) !== -1)) score = 1;
      scored.push({ c, score, order });
    });
    scored.sort((a, b) => a.score - b.score || a.order - b.order);
    return scored.map((s) => s.c);
  }

  function cmdkRender() {
    const list = document.getElementById('cmdkList');
    if (!list) return;
    list.innerHTML = '';
    if (cmdkMatches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cmdk-empty';
      empty.textContent = 'No matches.';
      list.appendChild(empty);
      return;
    }
    let lastGroup = null;
    cmdkMatches.forEach((c, i) => {
      if (c.group !== lastGroup) {
        lastGroup = c.group;
        const gl = document.createElement('div');
        gl.className = 'cmdk-group-label';
        gl.textContent = c.group;
        list.appendChild(gl);
      }
      const row = document.createElement('div');
      row.className = 'cmdk-item' + (i === cmdkSel ? ' sel' : '');
      row.innerHTML = '<span class="cmdk-ic"></span><span></span><span class="cmdk-sub"></span>';
      row.children[0].textContent = c.ic;
      row.children[1].textContent = c.label;
      row.children[2].textContent = c.sub || '';
      row.addEventListener('click', () => cmdkRun(c));
      row.addEventListener('mousemove', () => {
        if (cmdkSel !== i) { cmdkSel = i; cmdkRender(); }
      });
      list.appendChild(row);
    });
    const selEl = list.querySelectorAll('.cmdk-item')[cmdkSel];
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  }

  function cmdkRun(c) {
    if (c.action === 'water') { addWater(); closeCmdk(); return; }
    if (c.href) window.location.href = c.href;
  }

  function openCmdk() {
    const bg = document.getElementById('cmdkBg');
    if (!bg) return;
    cmdkOpen = true;
    bg.classList.add('show');
    document.body.classList.add('topbar-modal-open');
    const input = document.getElementById('cmdkInput');
    input.value = '';
    cmdkSel = 0;
    cmdkMatches = cmdkFilter('');
    cmdkRender();
    setTimeout(() => input.focus(), 0);
  }
  function closeCmdk() {
    const bg = document.getElementById('cmdkBg');
    if (!bg) return;
    cmdkOpen = false;
    bg.classList.remove('show');
    document.body.classList.remove('topbar-modal-open');
  }

  function initCmdk() {
    if (!shouldShowChrome()) return;
    if (document.getElementById('cmdkBg')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = cmdkHtml.trim();
    document.body.appendChild(wrap.firstChild);

    const btn = document.getElementById('topbarCmdk');
    if (btn) btn.addEventListener('click', openCmdk);

    const bg = document.getElementById('cmdkBg');
    bg.addEventListener('click', (e) => { if (e.target === bg) closeCmdk(); });

    const input = document.getElementById('cmdkInput');
    input.addEventListener('input', () => {
      cmdkSel = 0;
      cmdkMatches = cmdkFilter(input.value);
      cmdkRender();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); cmdkSel = Math.min(cmdkSel + 1, cmdkMatches.length - 1); cmdkRender(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkSel = Math.max(cmdkSel - 1, 0); cmdkRender(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (cmdkMatches[cmdkSel]) cmdkRun(cmdkMatches[cmdkSel]); }
    });

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        cmdkOpen ? closeCmdk() : openCmdk();
      } else if (e.key === 'Escape' && cmdkOpen) {
        e.preventDefault();
        closeCmdk();
      }
    });
  }

  // -------- Mobile lockdown helpers --------
  // Belt-and-suspenders zoom prevention — iOS Safari sometimes ignores
  // user-scalable=no, so we also kill the gesture events directly.
  function blockGesture(e) { e.preventDefault(); }
  function lockGestures() {
    document.addEventListener('gesturestart', blockGesture, { passive: false });
    document.addEventListener('gesturechange', blockGesture, { passive: false });
    document.addEventListener('gestureend', blockGesture, { passive: false });
    // Also kill the iOS double-tap-to-zoom on any tap.
    let lastTouch = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTouch <= 300) e.preventDefault();
      lastTouch = now;
    }, { passive: false });
  }

  // Watch every known modal-bg / overlay class — when any one of them
  // gets `.show` or `.is-open`, lock the body scroll. When the last
  // one closes, unlock.
  function startModalLock() {
    const MODAL_SELECTORS = [
      '.modal-bg', '.po-modal-bg', '.wt-overlay', '.wt-viewer', '.wt-cam'
    ];
    function anyOpen() {
      for (const sel of MODAL_SELECTORS) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (el.classList.contains('show') || el.classList.contains('is-open')) {
            return true;
          }
        }
      }
      return false;
    }
    function sync() {
      document.body.classList.toggle('topbar-modal-open', anyOpen());
    }
    const observer = new MutationObserver(sync);
    // Observe class changes anywhere in body — modal toggles are rare so
    // a global subtree observer is cheap.
    observer.observe(document.body, {
      attributes: true, attributeFilter: ['class'], subtree: true
    });
    sync();
  }

  // -------- Boot --------
  function boot() {
    injectStyleAndHTML();
    initCmdk();
    initFocus();
    const btn = document.getElementById('topbarWaterAdd');
    if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); addWater(); });
    render();
    lockGestures();
    startModalLock();

    // Re-render when localStorage changes from another tab/window OR when
    // the page becomes visible (sync may have pulled in the background).
    window.addEventListener('storage', render);
    window.addEventListener('focus', render);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

    // Periodic refresh so counts stay current after midnight rollover etc.
    setInterval(render, 30 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
