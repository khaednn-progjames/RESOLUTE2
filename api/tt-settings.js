// ============================================================
// GET  /api/tt-settings  → current bot settings + connection status
// POST /api/tt-settings  → update settings (body: partial settings object)
//
// `enabled` is the master kill switch. It defaults to false and is
// never flipped on by anything but an explicit user action here.
// ============================================================
import { loadSettings, saveSettings, loadSession } from './_lib/tastytrade.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const [settings, session] = await Promise.all([loadSettings(), loadSession()]);
      res.status(200).json({
        settings,
        connected: !!(session && session.session_token),
        environment: session ? session.environment : null,
        account_number: session ? session.account_number : null,
      });
      return;
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      // Never accept token-like fields through this endpoint.
      delete body.session_token; delete body.remember_token;
      await saveSettings(body);
      const settings = await loadSettings();
      res.status(200).json({ ok: true, settings });
      return;
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
