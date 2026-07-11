// ============================================================
// GET /api/plaid-balances
// Loads every stored Plaid item (server-side only, via the
// service-role key) and fetches live account balances from Plaid.
// Returns balances to the browser — never the access tokens.
//
// Requires: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV,
//           SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!PLAID_CLIENT_ID || !PLAID_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Plaid or Supabase service role is not configured.' });
    return;
  }

  const base = PLAID_ENV === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: items, error } = await supa.from('plaid_items').select('item_id, access_token, institution_name');
    if (error) { res.status(500).json({ error: error.message }); return; }

    const results = [];
    for (const item of (items || [])) {
      try {
        const r = await fetch(base + '/accounts/balance/get', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, access_token: item.access_token }),
        });
        const json = await r.json();
        if (json.error_code) {
          results.push({ item_id: item.item_id, institution_name: item.institution_name, error: json.error_message || json.error_code });
          continue;
        }
        results.push({
          item_id: item.item_id,
          institution_name: item.institution_name || 'Bank',
          accounts: (json.accounts || []).map(a => ({
            account_id: a.account_id,
            name: a.name,
            official_name: a.official_name,
            mask: a.mask,
            type: a.type,
            subtype: a.subtype,
            balances: a.balances,
          })),
        });
      } catch (e) {
        results.push({ item_id: item.item_id, institution_name: item.institution_name, error: String(e) });
      }
    }
    res.status(200).json({ items: results });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
