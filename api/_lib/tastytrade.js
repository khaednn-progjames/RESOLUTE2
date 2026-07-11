// ============================================================
// Shared Tastytrade + Supabase helpers for the Iron Condor bot.
// Underscore-prefixed folder so Vercel doesn't treat this as a route.
//
// SECURITY: the Tastytrade session token lives ONLY in the
// `tt_session` Supabase table, which has RLS enabled with zero
// policies (see SETUP.md) — the public anon key used everywhere
// else in this app has no access to it. Every function here uses
// the service-role key, which must only ever be read from a Vercel
// env var inside api/*.js, never shipped to the browser.
// ============================================================
import { createClient } from '@supabase/supabase-js';

export function supaAdmin() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY / SUPABASE_URL not configured');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export function ttBaseUrl(environment) {
  return environment === 'production'
    ? 'https://api.tastyworks.com'
    : 'https://api.cert.tastyworks.com'; // sandbox / certification
}

// ---- session storage (single row, id=1) ----
export async function loadSession() {
  const supa = supaAdmin();
  const { data, error } = await supa.from('tt_session').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function saveSession(fields) {
  const supa = supaAdmin();
  const { error } = await supa.from('tt_session').upsert({ id: 1, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

// ---- settings storage (single row, id=1) ----
const DEFAULT_SETTINGS = {
  id: 1,
  enabled: false,          // master kill switch — off by default
  mode: 'paper',           // 'paper' (simulate only) | 'live' (real orders)
  symbol: 'SPY',
  short_delta_target: 0.16,     // used only as a label; actual selection uses otm_pct approximation below
  short_otm_pct: 0.6,      // % OTM from spot for short strikes (approximation — see iron-condor-run.js)
  wing_width: 2,           // $ width of each wing
  contracts: 1,
  max_risk_per_trade: 200, // $ — hard cap, trade is skipped if max loss exceeds this
  daily_loss_limit: 400,   // $ — circuit breaker; bot disables itself for the day if tripped
  entry_window_start: '09:45', // ET
  entry_window_end: '10:15',   // ET
};

export async function loadSettings() {
  const supa = supaAdmin();
  const { data, error } = await supa.from('tt_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { ...DEFAULT_SETTINGS, ...data } : DEFAULT_SETTINGS;
}

export async function saveSettings(fields) {
  const supa = supaAdmin();
  const { error } = await supa.from('tt_settings').upsert({ ...DEFAULT_SETTINGS, ...fields, id: 1, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

// ---- trade log ----
export async function logTrade(row) {
  const supa = supaAdmin();
  const { error } = await supa.from('tt_trades').insert(row);
  if (error) throw new Error(error.message);
}

export async function recentTrades(limit) {
  const supa = supaAdmin();
  const { data, error } = await supa.from('tt_trades').select('*').order('opened_at', { ascending: false }).limit(limit || 50);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function todaysRealizedLoss() {
  const supa = supaAdmin();
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supa.from('tt_trades').select('realized_pnl').gte('opened_at', startOfDay.toISOString());
  if (error) throw new Error(error.message);
  return (data || []).reduce((sum, r) => sum + Math.min(0, r.realized_pnl || 0), 0); // negative sum of losses
}

export async function tradedToday() {
  const supa = supaAdmin();
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supa.from('tt_trades').select('id').gte('opened_at', startOfDay.toISOString()).limit(1);
  if (error) throw new Error(error.message);
  return (data || []).length > 0;
}

// ---- Tastytrade API calls ----
export async function ttLogin(username, password, environment) {
  const base = ttBaseUrl(environment);
  const r = await fetch(base + '/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: username, password, 'remember-me': true }),
  });
  const json = await r.json();
  if (!r.ok || !json.data) throw new Error((json.error && json.error.message) || 'Login failed');
  return json.data; // { session-token, remember-token, user }
}

export async function ttAccounts(sessionToken, environment) {
  const base = ttBaseUrl(environment);
  const r = await fetch(base + '/customers/me/accounts', {
    headers: { Authorization: sessionToken },
  });
  const json = await r.json();
  if (!r.ok) throw new Error((json.error && json.error.message) || 'Could not load accounts');
  return (json.data && json.data.items) || [];
}

export async function ttGet(path, sessionToken, environment) {
  const base = ttBaseUrl(environment);
  const r = await fetch(base + path, { headers: { Authorization: sessionToken } });
  const json = await r.json();
  if (!r.ok) throw new Error((json.error && json.error.message) || ('Tastytrade GET ' + path + ' failed'));
  return json.data;
}

export async function ttPost(path, sessionToken, environment, body) {
  const base = ttBaseUrl(environment);
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { Authorization: sessionToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error((json.error && json.error.message) || ('Tastytrade POST ' + path + ' failed'));
  return json.data;
}

// Refresh session if needed (Tastytrade sessions expire ~24h; re-login with stored creds
// isn't possible since we don't keep the password — re-auth requires the remember-token).
export async function ttRefreshIfNeeded(session) {
  if (!session) return null;
  const expiresAt = session.expires_at ? new Date(session.expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 5 * 60 * 1000) return session; // still valid for 5+ more minutes

  const base = ttBaseUrl(session.environment);
  const r = await fetch(base + '/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'login': session.username, 'remember-token': session.remember_token }),
  });
  const json = await r.json();
  if (!r.ok || !json.data) throw new Error('Session refresh failed — reconnect your Tastytrade account.');

  const updated = {
    session_token: json.data['session-token'],
    remember_token: json.data['remember-token'] || session.remember_token,
    expires_at: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
  };
  await saveSession({ ...session, ...updated });
  return { ...session, ...updated };
}

// ---- ET (America/New_York) time helpers, DST-safe via Intl ----
export function nowET() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t).value;
  return {
    weekday: get('weekday'), // 'Mon'..'Sun'
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
    dateStr: get('year') + '-' + get('month') + '-' + get('day'),
  };
}

export function isWithinWindow(et, startHHMM, endHHMM) {
  const cur = et.hour * 60 + et.minute;
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  return cur >= sh * 60 + sm && cur <= eh * 60 + em;
}

export function isWeekday(et) {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(et.weekday);
}
