// =============================================================
// Shared cloud-sync helper for the dashboard.
// Each page calls initCloudSync({...}) once with its config:
//   appKey         — string row key in the public.app_state table
//   syncedKeys     — exact localStorage keys to mirror
//   syncedPrefixes — localStorage key prefixes to mirror (e.g. 'goals:')
//   onApplied      — optional callback after remote state has been applied
//
// Requires:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="sync.js" defer></script>
//
// Sync model: merge-before-push with tombstones.
// ------------------------------------------------------------
// Every push first fetches the current remote state and adopts any key
// it doesn't have locally yet (e.g. a note created on another device a
// moment ago), THEN uploads the merged result. A key is only ever
// deleted locally if it's in the tombstone log — a small per-appKey
// record of "this key was deliberately removed at time T" that travels
// inside the synced payload as data.__tombstones__ so every device
// converges on the same view of what was actually deleted vs. just not
// synced yet. Without this, two devices writing close together could
// silently erase each other's most recent data — a full-snapshot
// overwrite has no way to tell "I don't have this because it's new
// elsewhere" apart from "I don't have this because it was deleted".
// =============================================================
(function () {
  'use strict';

  // Prefer Vercel env vars (served via /api/config → window.DASH_*),
  // otherwise fall back to these defaults.
  const SUPABASE_URL = (typeof window !== 'undefined' && window.DASH_SUPABASE_URL) || 'https://srajryooffirbroltjmg.supabase.co';
  const SUPABASE_KEY = (typeof window !== 'undefined' && window.DASH_SUPABASE_KEY) || 'sb_publishable_5142ZwTLF_DkSVRzciNuRA_bHwRAu4c';

  window.initCloudSync = function (config) {
    const appKey = config && config.appKey;
    const syncedKeys = (config && config.syncedKeys) || [];
    const syncedPrefixes = (config && config.syncedPrefixes) || [];
    const onApplied = config && config.onApplied;
    if (!appKey) return;
    if (!window.supabase) return;
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    if (SUPABASE_URL.indexOf('PASTE-') === 0 || SUPABASE_KEY.indexOf('PASTE-') === 0) return;

    let supa = null;
    let pushTimer = null;
    let suppressSync = false;
    let lastSyncedJson = null;
    const TOMBSTONE_LS_KEY = 'sync:tombstones:' + appKey;
    const TOMBSTONE_MAX_AGE_MS = 30 * 86400000; // 30 days

    // Guards against a delayed/out-of-order incoming snapshot (a slow
    // network round trip, or a realtime echo of an earlier push that
    // lands late) stomping a key we just wrote locally moments ago —
    // e.g. rapid water +1 taps each kick off their own push, and a
    // stale one landing after a newer local increment would otherwise
    // silently roll the count back. Recent local writes win for a
    // short window; the next merge cycle reconciles normally either way.
    const RECENT_WRITE_GUARD_MS = 5000;
    const recentLocalWrites = {};

    function matches(k) {
      if (!k) return false;
      if (syncedKeys.indexOf(k) !== -1) return true;
      for (let i = 0; i < syncedPrefixes.length; i++) {
        if (k.indexOf(syncedPrefixes[i]) === 0) return true;
      }
      return false;
    }
    function listAllKeys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (matches(k)) out.push(k);
      }
      return out;
    }
    function collect() {
      const out = {};
      for (const k of listAllKeys()) {
        const v = localStorage.getItem(k);
        if (v == null) continue;
        try { out[k] = JSON.parse(v); } catch (e) { out[k] = v; }
      }
      return out;
    }

    const origSet = localStorage.setItem.bind(localStorage);
    const origRemove = localStorage.removeItem.bind(localStorage);

    function loadTombstones() {
      try { return JSON.parse(localStorage.getItem(TOMBSTONE_LS_KEY)) || {}; }
      catch (e) { return {}; }
    }
    function saveTombstonesLocal(t) {
      try { origSet(TOMBSTONE_LS_KEY, JSON.stringify(t)); } catch (e) {}
    }
    function recordTombstone(k) {
      const t = loadTombstones();
      t[k] = Date.now();
      const cutoff = Date.now() - TOMBSTONE_MAX_AGE_MS;
      Object.keys(t).forEach((kk) => { if (t[kk] < cutoff) delete t[kk]; });
      saveTombstonesLocal(t);
    }

    localStorage.setItem = function (k, v) {
      origSet(k, v);
      try {
        if (!suppressSync && matches(k)) {
          recentLocalWrites[k] = Date.now();
          schedulePush();
        }
      } catch (e) {}
    };
    localStorage.removeItem = function (k) {
      origRemove(k);
      try {
        if (!suppressSync && matches(k)) {
          recordTombstone(k);
          schedulePush();
        }
      } catch (e) {}
    };

    // Adopts remote keys we don't have locally (unless we deliberately
    // deleted them — tracked via tombstones), and removes local keys
    // that a tombstone says were deleted elsewhere. Never deletes a
    // local key just because it's merely absent from `remote` — that's
    // the change from the old "delete anything not in remote" behavior,
    // which could wipe not-yet-synced data from another device.
    function mergeRemoteIntoLocal(remote) {
      if (!remote || typeof remote !== 'object') return false;
      const remoteTombstones = remote.__tombstones__ || {};
      const localTombstones = loadTombstones();
      let tombstonesChanged = false;
      Object.keys(remoteTombstones).forEach((k) => {
        if (!localTombstones[k] || remoteTombstones[k] > localTombstones[k]) {
          localTombstones[k] = remoteTombstones[k];
          tombstonesChanged = true;
        }
      });
      if (tombstonesChanged) saveTombstonesLocal(localTombstones);

      let changed = false;
      suppressSync = true;
      try {
        for (const k of Object.keys(remote)) {
          if (k === '__tombstones__' || !matches(k)) continue;
          if (recentLocalWrites[k] && (Date.now() - recentLocalWrites[k]) < RECENT_WRITE_GUARD_MS) continue;
          const incoming = JSON.stringify(remote[k]);
          const local = localStorage.getItem(k);
          if (local !== incoming) {
            try { origSet(k, incoming); changed = true; } catch (e) {}
          }
        }
        for (const k of listAllKeys()) {
          if (localTombstones[k] && localStorage.getItem(k) != null) {
            try { origRemove(k); changed = true; } catch (e) {}
          }
        }
      } finally { suppressSync = false; }
      return changed;
    }

    function applyRemote(remote) {
      const changed = mergeRemoteIntoLocal(remote);
      if (changed && typeof onApplied === 'function') {
        try { onApplied(); } catch (e) {}
      }
      return changed;
    }

    async function pushNow() {
      if (!supa) return;
      // Merge in whatever's on the server first, so this push can never
      // silently erase a key another device already synced.
      try {
        const { data } = await supa.from('app_state').select('data').eq('key', appKey).maybeSingle();
        if (data && data.data) {
          const changed = mergeRemoteIntoLocal(data.data);
          if (changed && typeof onApplied === 'function') { try { onApplied(); } catch (e) {} }
        }
      } catch (e) { /* offline — push local state as-is */ }

      const state = collect();
      state.__tombstones__ = loadTombstones();
      const json = JSON.stringify(state);
      if (json === lastSyncedJson) return;
      try {
        const { error } = await supa.from('app_state').upsert(
          { key: appKey, data: state, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
        if (!error) lastSyncedJson = json;
      } catch (e) {}
    }
    function schedulePush() {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(pushNow, 250);
    }
    function flushOnUnload() {
      // Can't reliably await a pre-fetch during unload, so this remains a
      // best-effort blind push — the next normal pushNow (on any device)
      // will merge-reconcile if this one raced with something.
      const state = collect();
      state.__tombstones__ = loadTombstones();
      const json = JSON.stringify(state);
      if (json === lastSyncedJson) return;
      try {
        fetch(SUPABASE_URL + '/rest/v1/app_state?on_conflict=key', {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify({ key: appKey, data: state, updated_at: new Date().toISOString() }),
          keepalive: true,
        }).catch(() => {});
        lastSyncedJson = json;
      } catch (e) {}
    }

    (async function init() {
      supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      await pushNow(); // fetch + merge remote, then push the merged result back
      supa.channel('app_state_' + appKey)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'app_state',
          filter: 'key=eq.' + appKey,
        }, (payload) => {
          if (!payload.new || !payload.new.data) return;
          const incoming = JSON.stringify(payload.new.data);
          if (incoming === lastSyncedJson) return;
          applyRemote(payload.new.data);
        })
        .subscribe();
    })();

    window.addEventListener('beforeunload', flushOnUnload);
    window.addEventListener('pagehide', flushOnUnload);
    window.addEventListener('storage', (e) => {
      if (e.key && matches(e.key)) schedulePush();
    });
  };
})();
