// =============================================================
// Shared "Claude History" store — lets Sirius features pull relevant
// context from the user's past claude.ai conversations.
//
// There is no API that lets a browser app read claude.ai chat history
// live, so this works from a one-time (or periodic) manual export:
// claude.ai → Settings → Account → Export data → unzip → upload the
// conversations.json file here.
//
// Stored in IndexedDB (NOT localStorage — a full export can be tens of
// MB, far past localStorage's quota) and NEVER synced to Supabase —
// this is per-device, local-only, deliberately not part of the
// cross-device sync payload given its size and sensitivity.
//
// Usage from any page:
//   <script src="claude-history.js" defer></script>
//   const ctx = await window.SiriusHistory.getContext(userQueryText);
//   // ctx is '' if nothing imported or nothing relevant, otherwise a
//   // formatted block to append to a system prompt.
// =============================================================
(function () {
  'use strict';

  const DB_NAME = 'sirius-claude-history';
  const DB_VERSION = 1;
  const STORE = 'conversations';
  const META_STORE = 'meta';
  const INDEX_TEXT_CAP = 6000; // per-conversation chars kept in the in-memory search index

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB not available in this browser.')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open the history database.'));
    });
  }

  function tx(db, stores, mode) {
    return db.transaction(stores, mode);
  }

  async function getMeta(key) {
    const db = await openDb();
    return new Promise((resolve) => {
      const req = tx(db, [META_STORE], 'readonly').objectStore(META_STORE).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => resolve(null);
    });
  }
  async function setMeta(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = tx(db, [META_STORE], 'readwrite');
      t.objectStore(META_STORE).put({ key, value });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async function clearAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = tx(db, [STORE, META_STORE], 'readwrite');
      t.objectStore(STORE).clear();
      t.objectStore(META_STORE).clear();
      t.oncomplete = () => { memIndex = null; resolve(); };
      t.onerror = () => reject(t.error);
    });
  }

  // ---------- parsing a claude.ai conversations.json export ----------
  function extractMessageText(msg) {
    if (typeof msg.text === 'string' && msg.text.trim()) return msg.text.trim();
    if (Array.isArray(msg.content)) {
      return msg.content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join(' ').trim();
    }
    return '';
  }
  function messageRoleLabel(msg) {
    const s = (msg.sender || msg.role || '').toLowerCase();
    return (s === 'human' || s === 'user') ? 'You' : 'Claude';
  }

  function parseExport(raw) {
    let data;
    try { data = JSON.parse(raw); } catch (e) { throw new Error('That file is not valid JSON.'); }
    let list = Array.isArray(data) ? data : (Array.isArray(data && data.conversations) ? data.conversations : null);
    if (!list) throw new Error("That doesn't look like a claude.ai conversations export. Upload the conversations.json file from inside the exported zip.");

    const out = [];
    list.forEach((conv, i) => {
      if (!conv || typeof conv !== 'object') return;
      const msgs = conv.chat_messages || conv.messages || [];
      if (!Array.isArray(msgs) || msgs.length === 0) return;
      const lines = [];
      msgs.forEach((m) => {
        const text = extractMessageText(m || {});
        if (text) lines.push(messageRoleLabel(m) + ': ' + text);
      });
      if (lines.length === 0) return;
      out.push({
        id: conv.uuid || conv.id || ('conv' + i),
        title: (conv.name || conv.title || 'Untitled conversation').trim(),
        createdAt: conv.created_at || conv.createdAt || null,
        text: lines.join('\n\n'),
      });
    });
    if (out.length === 0) throw new Error('That export parsed, but no conversations with readable messages were found in it.');
    return out;
  }

  async function importFile(file) {
    const raw = await file.text();
    const conversations = parseExport(raw);
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const t = tx(db, [STORE], 'readwrite');
      const store = t.objectStore(STORE);
      conversations.forEach((c) => store.put(c));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    await setMeta('count', conversations.length);
    await setMeta('importedAt', Date.now());
    memIndex = null; // force the in-memory search index to rebuild
    return { count: conversations.length };
  }

  async function getStats() {
    const count = await getMeta('count');
    const importedAt = await getMeta('importedAt');
    return { count: count || 0, importedAt: importedAt || null };
  }

  // ---------- lightweight in-memory search index ----------
  let memIndex = null; // [{ id, title, textLower }] — loaded lazily, cached per page load
  let memIndexPromise = null;

  async function loadIndex() {
    if (memIndex) return memIndex;
    if (memIndexPromise) return memIndexPromise;
    memIndexPromise = (async () => {
      const count = await getMeta('count');
      if (!count) { memIndex = []; return memIndex; }
      const db = await openDb();
      const items = await new Promise((resolve, reject) => {
        const out = [];
        const req = tx(db, [STORE], 'readonly').objectStore(STORE).openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const v = cursor.value;
            out.push({ id: v.id, title: v.title, textLower: (v.title + ' ' + v.text.slice(0, INDEX_TEXT_CAP)).toLowerCase() });
            cursor.continue();
          } else resolve(out);
        };
        req.onerror = () => reject(req.error);
      });
      memIndex = items;
      return memIndex;
    })();
    return memIndexPromise;
  }

  const STOPWORDS = new Set(['the','a','an','and','or','but','to','of','in','on','for','with','is','are','was','were','be','been','my','me','i','you','your','it','this','that','what','how','do','does','did','can','could','should','would','about']);
  function tokenize(q) {
    return (q || '').toLowerCase().match(/[a-z0-9']+/g)?.filter((w) => w.length >= 3 && !STOPWORDS.has(w)) || [];
  }

  async function search(query, maxResults) {
    const words = tokenize(query);
    if (words.length === 0) return [];
    const index = await loadIndex();
    if (index.length === 0) return [];
    const scored = index.map((item) => {
      let score = 0;
      words.forEach((w) => {
        const titleHits = (item.title.toLowerCase().match(new RegExp(w, 'g')) || []).length;
        const bodyHits = (item.textLower.match(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        score += titleHits * 4 + bodyHits;
      });
      return { id: item.id, title: item.title, score };
    }).filter((x) => x.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults || 3);
  }

  async function fetchFullText(id) {
    const db = await openDb();
    return new Promise((resolve) => {
      const req = tx(db, [STORE], 'readonly').objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  function excerptAround(fullText, words, maxChars) {
    const lower = fullText.toLowerCase();
    let pos = -1;
    for (const w of words) {
      const idx = lower.indexOf(w);
      if (idx !== -1 && (pos === -1 || idx < pos)) pos = idx;
    }
    if (pos === -1) return fullText.slice(0, maxChars);
    const start = Math.max(0, pos - Math.floor(maxChars / 3));
    return (start > 0 ? '…' : '') + fullText.slice(start, start + maxChars) + (start + maxChars < fullText.length ? '…' : '');
  }

  async function getContext(queryText, opts) {
    opts = opts || {};
    const maxResults = opts.maxResults || 3;
    const maxCharsPerConvo = opts.maxCharsPerConvo || 1200;
    try {
      const count = await getMeta('count');
      if (!count) return '';
      const matches = await search(queryText, maxResults);
      if (matches.length === 0) return '';
      const words = tokenize(queryText);
      const blocks = [];
      for (const m of matches) {
        const full = await fetchFullText(m.id);
        if (!full) continue;
        const dateLabel = full.createdAt ? new Date(full.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const excerpt = excerptAround(full.text, words, maxCharsPerConvo);
        blocks.push('[Past conversation: "' + full.title + '"' + (dateLabel ? ' — ' + dateLabel : '') + ']\n' + excerpt);
      }
      if (blocks.length === 0) return '';
      return "The user has these possibly-relevant excerpts from their past Claude conversations (use them only if actually relevant, don't force a connection):\n\n" + blocks.join('\n\n---\n\n');
    } catch (e) {
      return ''; // never let a history lookup break the actual Sirius call
    }
  }

  // A general sense of how the user naturally writes, for features that
  // want to MATCH THEIR VOICE rather than find topically-relevant
  // excerpts (e.g. drafting something in first person on their behalf).
  // Pulls a few random human-authored lines across different past
  // conversations, deliberately not query-targeted.
  async function getVoiceSample(maxChars) {
    maxChars = maxChars || 1500;
    try {
      const count = await getMeta('count');
      if (!count) return '';
      const index = await loadIndex();
      if (index.length === 0) return '';
      const sampleSize = Math.min(6, index.length);
      const shuffled = index.slice().sort(() => Math.random() - 0.5).slice(0, sampleSize);
      const samples = [];
      for (const item of shuffled) {
        const full = await fetchFullText(item.id);
        if (!full) continue;
        const humanLines = full.text.split('\n\n')
          .filter((l) => l.indexOf('You: ') === 0)
          .map((l) => l.replace(/^You:\s*/, ''))
          .filter((l) => l.length > 25); // skip throwaway one-word replies
        if (humanLines.length) samples.push(humanLines[Math.floor(Math.random() * humanLines.length)]);
      }
      let joined = samples.filter(Boolean).join('\n---\n');
      if (joined.length > maxChars) joined = joined.slice(0, maxChars) + '…';
      return joined;
    } catch (e) { return ''; }
  }

  window.SiriusHistory = {
    isAvailable: () => !!window.indexedDB,
    importFile,
    getStats,
    clearAll,
    getContext,
    getVoiceSample,
  };
})();
