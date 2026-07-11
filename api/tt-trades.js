// ============================================================
// GET /api/tt-trades — recent iron condor trade log (paper + live)
// ============================================================
import { recentTrades } from './_lib/tastytrade.js';

export default async function handler(req, res) {
  try {
    const trades = await recentTrades(50);
    res.status(200).json({ trades });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
