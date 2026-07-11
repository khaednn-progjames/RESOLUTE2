// ============================================================
// POST /api/plaid-link-token
// Creates a Plaid `link_token` so the browser can launch Plaid Link
// (the hosted bank-login widget) without ever touching real
// credentials or secrets itself.
//
// Requires these Vercel env vars (server-side only):
//   PLAID_CLIENT_ID
//   PLAID_SECRET
//   PLAID_ENV        'sandbox' (default) or 'production'
// ============================================================
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV } = process.env;
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    res.status(500).json({ error: 'Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET in Vercel env vars.' });
    return;
  }

  const base = PLAID_ENV === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';

  try {
    const r = await fetch(base + '/link/token/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        user: { client_user_id: 'dashboard-user' },
        client_name: "Dashboard",
        products: ['auth'],
        country_codes: ['US', 'CA'],
        language: 'en',
      }),
    });
    const json = await r.json();
    if (json.error_code) { res.status(400).json(json); return; }
    res.status(200).json({ link_token: json.link_token });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
