// ============================================================
// POST /api/plaid-exchange-token
// Body: { public_token, institution_name }
//
// Exchanges Plaid Link's short-lived, single-use `public_token`
// (safe to pass through the browser — Plaid designs it that way)
// for a permanent `access_token`, then stores the access_token
// SERVER-SIDE ONLY in the `plaid_items` Supabase table.
//
// That table has NO anon access (see SETUP.md) — only this function,
// using SUPABASE_SERVICE_ROLE_KEY, can read or write it. The access
// token never reaches the browser, localStorage, or the public
// app_state table the rest of the dashboard uses.
//
// Requires: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV,
//           SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { public_token, institution_name } = req.body || {};
  if (!public_token) { res.status(400).json({ error: 'Missing public_token' }); return; }

  const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) { res.status(500).json({ error: 'Plaid is not configured.' }); return; }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { res.status(500).json({ error: 'Supabase service role is not configured.' }); return; }

  const base = PLAID_ENV === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';

  try {
    const r = await fetch(base + '/item/public_token/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, public_token }),
    });
    const json = await r.json();
    if (json.error_code) { res.status(400).json(json); return; }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supa.from('plaid_items').upsert({
      item_id: json.item_id,
      access_token: json.access_token,
      institution_name: institution_name || null,
    }, { onConflict: 'item_id' });
    if (error) { res.status(500).json({ error: error.message }); return; }

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
