// =============================================================
// Shared Sirius (Anthropic API) usage/cost tracker.
// Drop this on any page that calls the Anthropic API with:
//     <script src="sirius-usage.js" defer></script>
// After each API response, call:
//     window.logSiriusUsage('feature-name', json.usage)
// where json.usage is the { input_tokens, output_tokens, ... }
// object Anthropic returns on every /v1/messages response.
// Local-only (not synced) — usage is a per-browser estimate.
// =============================================================
(function () {
  'use strict';
  const KEY = 'sirius:usage';
  const MAX = 1000;

  // Claude Opus pricing, USD per 1M tokens. Approximate — every feature
  // on this dashboard uses the same model, so one rate covers all of them.
  const PRICE_IN = 15;
  const PRICE_OUT = 75;
  const PRICE_CACHE_WRITE = 18.75;
  const PRICE_CACHE_READ = 1.5;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function save(arr) {
    try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {}
  }

  window.logSiriusUsage = function (feature, usage) {
    if (!usage) return;
    const inTok = Number(usage.input_tokens) || 0;
    const outTok = Number(usage.output_tokens) || 0;
    const cacheWrite = Number(usage.cache_creation_input_tokens) || 0;
    const cacheRead = Number(usage.cache_read_input_tokens) || 0;
    const cost = (inTok / 1e6) * PRICE_IN + (outTok / 1e6) * PRICE_OUT +
      (cacheWrite / 1e6) * PRICE_CACHE_WRITE + (cacheRead / 1e6) * PRICE_CACHE_READ;
    const arr = load();
    arr.push({ ts: Date.now(), feature: String(feature || 'unknown'), inTok, outTok, cost });
    if (arr.length > MAX) arr.splice(0, arr.length - MAX);
    save(arr);
  };

  window.siriusUsageSummary = function () {
    const arr = load();
    const now = Date.now();
    const day = 86400000;
    const cost30 = arr.filter((x) => now - x.ts < 30 * day).reduce((s, x) => s + (x.cost || 0), 0);
    const totalCost = arr.reduce((s, x) => s + (x.cost || 0), 0);
    const byFeature = {};
    arr.forEach((x) => { byFeature[x.feature] = (byFeature[x.feature] || 0) + (x.cost || 0); });
    return { totalCost, cost30, calls: arr.length, byFeature };
  };
})();
