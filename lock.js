// =============================================================
// Passcode / Face ID lock — gates the whole dashboard.
// Include as the FIRST script tag in <head> on every page:
//   <script src="lock.js"></script>
// Unlocking (PIN or Face ID) is valid for 6 hours (per browser),
// tracked locally only — never synced across devices.
//
// Face ID note: there's no server here to do real WebAuthn
// verification, so this uses the platform authenticator (Face ID /
// Touch ID / Windows Hello / Android biometric) purely as a LOCAL
// device gate — a successful navigator.credentials.get() means the
// OS biometric check passed. It's not cryptographic proof to a
// remote party, just a convenience unlock backed by the real
// biometric prompt. The PIN is the actual gate; Face ID is a
// faster path to the same local unlock.
// =============================================================
(function () {
  'use strict';

  const PIN = '6448';
  const PIN_LEN = PIN.length;
  const UNLOCK_KEY = 'lock:unlockedAt'; // local-only, deliberately never synced
  const SESSION_MS = 6 * 60 * 60 * 1000; // 6 hours
  const CRED_KEY = 'lock:webauthnCredId';

  function isUnlocked() {
    try {
      const t = parseInt(localStorage.getItem(UNLOCK_KEY), 10);
      return !!t && (Date.now() - t) < SESSION_MS;
    } catch (e) { return false; }
  }

  if (isUnlocked()) return; // nothing to do — page loads normally

  // Hide the page immediately so nothing flashes behind the lock screen.
  const hideStyle = document.createElement('style');
  hideStyle.textContent = 'html{visibility:hidden!important}';
  document.head.appendChild(hideStyle);

  function markUnlocked() {
    try { localStorage.setItem(UNLOCK_KEY, String(Date.now())); } catch (e) {}
    const overlay = document.getElementById('lockOverlay');
    if (overlay) overlay.remove();
    hideStyle.remove();
  }

  // ---------- WebAuthn (Face ID / Touch ID / Windows Hello) ----------
  function b64urlToBuf(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf;
  }
  function bufToB64url(buf) {
    let bin = '';
    const arr = new Uint8Array(buf);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function webauthnAvailable() {
    try {
      return !!(window.PublicKeyCredential &&
        typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function' &&
        await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
    } catch (e) { return false; }
  }
  async function registerFaceId() {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Dashboard' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'owner', displayName: 'Owner' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000,
      },
    });
    if (!cred) return false;
    try { localStorage.setItem(CRED_KEY, bufToB64url(cred.rawId)); } catch (e) {}
    return true;
  }
  async function verifyFaceId() {
    let credId;
    try { credId = localStorage.getItem(CRED_KEY); } catch (e) {}
    if (!credId) return registerFaceId(); // first use on this device — registering itself requires the biometric prompt
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: b64urlToBuf(credId), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return !!assertion;
  }

  // ---------- UI ----------
  const css = `
  .lock-overlay {
    position: fixed; inset: 0; z-index: 999999;
    display: flex; align-items: center; justify-content: center;
    background: #050506;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    visibility: visible; /* override the inherited html{visibility:hidden} that hides the page underneath */
  }
  .lock-overlay * { visibility: visible; }
  .lock-overlay::before {
    content: ''; position: fixed; inset: 0;
    background:
      radial-gradient(circle at 80% 10%, rgba(255,255,255,0.22), transparent 55%),
      radial-gradient(circle at 15% 92%, rgba(200,200,210,0.12), transparent 60%);
    filter: blur(90px); pointer-events: none;
  }
  .lock-card {
    position: relative; width: 100%; max-width: 320px; padding: 32px 28px;
    background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.14);
    border-radius: 20px; backdrop-filter: blur(38px) saturate(1.8); -webkit-backdrop-filter: blur(38px) saturate(1.8);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.30), 0 20px 60px rgba(0,0,0,0.6);
    text-align: center;
  }
  .lock-icon { font-size: 30px; margin-bottom: 10px; }
  .lock-title { font-size: 19px; font-weight: 700; color: #FAFAFA; letter-spacing: -0.01em; margin-bottom: 4px; }
  .lock-sub { font-size: 12.5px; color: #76746E; margin-bottom: 22px; }
  .lock-dots { display: flex; justify-content: center; gap: 12px; margin-bottom: 22px; }
  .lock-dot {
    width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.28);
    background: transparent; transition: background 0.15s, border-color 0.15s, transform 0.15s;
  }
  .lock-dot.filled { background: #FAFAFA; border-color: #FAFAFA; }
  .lock-card.lock-shake { animation: lock-shake 0.4s ease; }
  .lock-card.lock-shake .lock-dot.filled { background: #FF6B6B; border-color: #FF6B6B; }
  @keyframes lock-shake {
    0%, 100% { transform: translateX(0); }
    20%, 60% { transform: translateX(-8px); }
    40%, 80% { transform: translateX(8px); }
  }
  .lock-error { font-size: 11.5px; color: #FF6B6B; min-height: 16px; margin-bottom: 10px; }
  .lock-keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
  .lock-key {
    padding: 16px 0; border-radius: 14px; border: 1px solid rgba(255,255,255,0.10);
    background: rgba(255,255,255,0.04); color: #FAFAFA; font-size: 19px; font-weight: 600; cursor: pointer;
    transition: background 0.12s, transform 0.08s; -webkit-tap-highlight-color: transparent;
  }
  .lock-key:hover { background: rgba(255,255,255,0.09); }
  .lock-key:active { transform: scale(0.94); background: rgba(255,255,255,0.14); }
  .lock-key.lock-key-ghost { background: transparent; border-color: transparent; cursor: default; }
  .lock-faceid-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
    padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.05); color: #FAFAFA; font-size: 13px; font-weight: 700; cursor: pointer;
    transition: background 0.15s; margin-top: 4px;
  }
  .lock-faceid-btn:hover { background: rgba(255,255,255,0.10); }
  `;

  function mount() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'lock-overlay';
    overlay.id = 'lockOverlay';
    overlay.innerHTML =
      '<div class="lock-card" id="lockCard">' +
        '<div class="lock-icon">🔒</div>' +
        '<div class="lock-title">Locked</div>' +
        '<div class="lock-sub" id="lockSub">Enter your passcode</div>' +
        '<div class="lock-dots" id="lockDots"></div>' +
        '<div class="lock-error" id="lockError"></div>' +
        '<div class="lock-keypad" id="lockKeypad"></div>' +
        '<button type="button" class="lock-faceid-btn" id="lockFaceIdBtn" style="display:none">Use Face ID</button>' +
      '</div>';
    document.body.appendChild(overlay);

    const dotsEl = document.getElementById('lockDots');
    for (let i = 0; i < PIN_LEN; i++) {
      const dot = document.createElement('div');
      dot.className = 'lock-dot';
      dotsEl.appendChild(dot);
    }

    const keypad = document.getElementById('lockKeypad');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    keys.forEach((k) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lock-key' + (k === '' ? ' lock-key-ghost' : '');
      btn.textContent = k;
      if (k === '') { btn.disabled = true; }
      else if (k === '⌫') { btn.addEventListener('click', backspace); }
      else { btn.addEventListener('click', () => enterDigit(k)); }
      keypad.appendChild(btn);
    });

    let entered = '';
    function renderDots() {
      dotsEl.querySelectorAll('.lock-dot').forEach((d, i) => d.classList.toggle('filled', i < entered.length));
    }
    function enterDigit(d) {
      if (entered.length >= PIN_LEN) return;
      entered += d;
      renderDots();
      if (entered.length === PIN_LEN) check();
    }
    function backspace() {
      entered = entered.slice(0, -1);
      renderDots();
    }
    function check() {
      if (entered === PIN) {
        markUnlocked();
        return;
      }
      const card = document.getElementById('lockCard');
      card.classList.add('lock-shake');
      document.getElementById('lockError').textContent = 'Incorrect code';
      setTimeout(() => {
        card.classList.remove('lock-shake');
        entered = '';
        renderDots();
      }, 400);
    }

    document.addEventListener('keydown', function onKey(e) {
      if (!document.getElementById('lockOverlay')) { document.removeEventListener('keydown', onKey); return; }
      if (e.key >= '0' && e.key <= '9') enterDigit(e.key);
      else if (e.key === 'Backspace') backspace();
    });

    webauthnAvailable().then((ok) => {
      if (!ok) return;
      const btn = document.getElementById('lockFaceIdBtn');
      btn.style.display = '';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Checking…';
        try {
          const passed = await verifyFaceId();
          if (passed) { markUnlocked(); return; }
          document.getElementById('lockError').textContent = 'Face ID didn\'t match — use your passcode.';
        } catch (e) {
          document.getElementById('lockError').textContent = 'Face ID unavailable — use your passcode.';
        }
        btn.disabled = false;
        btn.textContent = original;
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
