// ============================================================
// POST /api/plaid-remove-item
// Body: { item_id }
// Disconnects a linked bank: tells Plaid to invalidate the access
// token, then deletes the stored row.
// ============================================================
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { item_id } = req.body || {};
  if (!item_id) { res.status(400).json({ error: 'Missing item_id' }); return; }

  const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { res.status(500).json({ error: 'Supabase service role is not configured.' }); return; }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: itemRow } = await supa.from('plaid_items').select('access_token').eq('item_id', item_id).maybeSingle();
    if (itemRow && itemRow.access_token && PLAID_CLIENT_ID && PLAID_SECRET) {
      const base = PLAID_ENV === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';
      await fetch(base + '/item/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, access_token: itemRow.access_token }),
      }).catch(() => {});
    }
    await supa.from('plaid_items').delete().eq('item_id', item_id);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
