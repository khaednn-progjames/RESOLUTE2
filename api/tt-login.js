// ============================================================
// POST /api/tt-login
// Body: { username, password, environment: 'sandbox' | 'production' }
//
// Logs into Tastytrade, fetches the account number, and stores the
// session server-side only (tt_session table — RLS locked, zero
// anon policies). The password is never stored; only the session
// token + remember-token (used to silently refresh later).
// ============================================================
import { ttLogin, ttAccounts, saveSession } from './_lib/tastytrade.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const { username, password, environment } = req.body || {};
  if (!username || !password) { res.status(400).json({ error: 'Missing username or password' }); return; }
  const env = environment === 'production' ? 'production' : 'sandbox';

  try {
    const data = await ttLogin(username, password, env);
    const accounts = await ttAccounts(data['session-token'], env);
    const accountNumber = accounts[0] && accounts[0].account && accounts[0].account['account-number'];

    await saveSession({
      username,
      session_token: data['session-token'],
      remember_token: data['remember-token'] || null,
      environment: env,
      account_number: accountNumber || null,
      expires_at: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
    });

    res.status(200).json({ ok: true, environment: env, account_number: accountNumber || null });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
}
