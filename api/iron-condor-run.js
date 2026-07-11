// ============================================================
// GET/POST /api/iron-condor-run
// Triggered on a schedule by Vercel Cron (see vercel.json). This is
// the entire "brain" of the 0DTE SPY iron condor bot — every check
// below runs on every invocation, in order, and any one of them can
// skip the trade for the day. Nothing here overrides the kill switch.
//
// SAFETY NOTES (read before ever flipping mode to 'live'):
//  - This has NOT been tested against a live Tastytrade account —
//    there was no account/credentials available to verify against
//    while building it. Test thoroughly in Sandbox (mode: paper,
//    then mode: live against a Tastytrade *certification* account)
//    before pointing this at real money.
//  - The risk cap (max_risk_per_trade) is checked against the
//    worst-case loss (wing_width, assuming $0 credit received) —
//    not the actual credit — so it can never be violated even if
//    the live credit estimate below is wrong.
//  - If live quotes can't be fetched/parsed with confidence, the
//    bot SKIPS the trade rather than guessing at an order price.
//  - Protect this endpoint with a CRON_SECRET env var (see
//    SETUP.md) so only Vercel's own cron can trigger it.
// ============================================================
import {
  loadSettings, loadSession, ttRefreshIfNeeded, ttGet, ttPost,
  logTrade, todaysRealizedLoss, tradedToday, nowET, isWithinWindow, isWeekday,
} from './_lib/tastytrade.js';

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer ' + process.env.CRON_SECRET) { res.status(401).json({ error: 'Unauthorized' }); return; }
  }

  try {
    const settings = await loadSettings();
    if (!settings.enabled) { res.status(200).json({ skipped: 'bot disabled (kill switch off)' }); return; }

    const et = nowET();
    if (!isWeekday(et)) { res.status(200).json({ skipped: 'not a weekday' }); return; }
    if (!isWithinWindow(et, settings.entry_window_start, settings.entry_window_end)) {
      res.status(200).json({ skipped: 'outside entry window (' + settings.entry_window_start + '-' + settings.entry_window_end + ' ET)' });
      return;
    }
    if (await tradedToday()) { res.status(200).json({ skipped: 'already traded today' }); return; }

    const lossSoFar = await todaysRealizedLoss();
    if (Math.abs(lossSoFar) >= settings.daily_loss_limit) {
      res.status(200).json({ skipped: 'daily loss circuit breaker tripped ($' + Math.abs(lossSoFar).toFixed(2) + ' >= $' + settings.daily_loss_limit + ')' });
      return;
    }

    let session = await loadSession();
    if (!session || !session.session_token) { res.status(200).json({ skipped: 'Tastytrade not connected' }); return; }
    session = await ttRefreshIfNeeded(session);

    // ---- 1. Spot price ----
    const quote = await ttGet('/market-data/by-type?equity=' + settings.symbol, session.session_token, session.environment).catch(() => null);
    const spot = quote && quote.items && quote.items[0] && parseFloat(quote.items[0].last || quote.items[0].mark);
    if (!spot) { res.status(200).json({ skipped: 'could not get ' + settings.symbol + ' spot price' }); return; }

    // ---- 2. 0DTE option chain ----
    const chain = await ttGet('/option-chains/' + settings.symbol + '/nested', session.session_token, session.environment);
    const underlying = chain.items && chain.items[0];
    const todaysExpiration = underlying && underlying.expirations && underlying.expirations.find(e => e['days-to-expiration'] === 0);
    if (!todaysExpiration) { res.status(200).json({ skipped: 'no 0DTE expiration available today for ' + settings.symbol }); return; }

    // ---- 3. Pick strikes by % OTM from spot (approximation, not live delta —
    //         verify against Tastytrade's real greeks before relying on this) ----
    const strikes = todaysExpiration.strikes.map(s => parseFloat(s['strike-price'])).sort((a, b) => a - b);
    const nearest = (target) => strikes.reduce((best, s) => Math.abs(s - target) < Math.abs(best - target) ? s : best);
    const shortCall = nearest(spot * (1 + settings.short_otm_pct / 100));
    const shortPut  = nearest(spot * (1 - settings.short_otm_pct / 100));
    const longCall  = nearest(shortCall + settings.wing_width);
    const longPut   = nearest(shortPut - settings.wing_width);

    // ---- 4. Worst-case risk check (credit-agnostic — safe even if credit turns out to be $0) ----
    const worstCaseLoss = settings.wing_width * 100 * settings.contracts;
    if (worstCaseLoss > settings.max_risk_per_trade) {
      res.status(200).json({ skipped: 'worst-case risk $' + worstCaseLoss + ' exceeds max_risk_per_trade $' + settings.max_risk_per_trade });
      return;
    }

    const legs = resolveLegSymbols(todaysExpiration, shortCall, longCall, shortPut, longPut);
    if (!legs) { res.status(200).json({ skipped: 'could not resolve option symbols for the selected strikes' }); return; }

    if (settings.mode !== 'live') {
      const estCredit = +(settings.wing_width * 0.3).toFixed(2); // rule-of-thumb estimate for paper mode only
      await logTrade({
        opened_at: new Date().toISOString(), symbol: settings.symbol, expiration: todaysExpiration['expiration-date'],
        short_call_strike: shortCall, long_call_strike: longCall, short_put_strike: shortPut, long_put_strike: longPut,
        credit: estCredit, max_loss: +(settings.wing_width - estCredit).toFixed(2), contracts: settings.contracts,
        mode: 'paper', status: 'simulated', note: 'estimated credit (rule of thumb) — not a live quote',
      });
      res.status(200).json({ ok: true, mode: 'paper', shortCall, longCall, shortPut, longPut });
      return;
    }

    // ---- Live mode: fetch real quotes before ever building a real order ----
    let netCredit;
    try {
      netCredit = await estimateNetCredit(legs, session);
    } catch (e) {
      await logTrade({
        opened_at: new Date().toISOString(), symbol: settings.symbol, expiration: todaysExpiration['expiration-date'],
        short_call_strike: shortCall, long_call_strike: longCall, short_put_strike: shortPut, long_put_strike: longPut,
        credit: null, max_loss: null, contracts: settings.contracts, mode: 'live', status: 'skipped',
        note: 'could not fetch live quotes, refused to guess an order price: ' + e.message,
      });
      res.status(200).json({ skipped: 'could not fetch live quotes for order pricing: ' + e.message });
      return;
    }

    const order = buildIronCondorOrder(legs, settings.contracts, netCredit);
    const result = await ttPost('/accounts/' + session.account_number + '/orders', session.session_token, session.environment, order);

    await logTrade({
      opened_at: new Date().toISOString(), symbol: settings.symbol, expiration: todaysExpiration['expiration-date'],
      short_call_strike: shortCall, long_call_strike: longCall, short_put_strike: shortPut, long_put_strike: longPut,
      credit: netCredit, max_loss: +(settings.wing_width - netCredit).toFixed(2), contracts: settings.contracts,
      mode: 'live', status: 'submitted', order_id: (result && result.order && result.order.id) || null, note: null,
    });
    res.status(200).json({ ok: true, mode: 'live', order: result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}

function resolveLegSymbols(expiration, shortCall, longCall, shortPut, longPut) {
  const byStrike = {};
  expiration.strikes.forEach(s => { byStrike[parseFloat(s['strike-price'])] = s; });
  const sc = byStrike[shortCall], lc = byStrike[longCall], sp = byStrike[shortPut], lp = byStrike[longPut];
  if (!sc || !lc || !sp || !lp) return null;
  return { shortCall: sc.call, longCall: lc.call, shortPut: sp.put, longPut: lp.put };
}

// Best-effort REST quote lookup. If Tastytrade's bulk quote shape differs from this in
// practice, this throws — and the caller skips the trade rather than mis-pricing an order.
async function estimateNetCredit(legs, session) {
  const symbols = [legs.shortCall, legs.longCall, legs.shortPut, legs.longPut];
  const qs = symbols.map(s => 'symbol[]=' + encodeURIComponent(s)).join('&');
  const data = await ttGet('/market-data/quotes?' + qs, session.session_token, session.environment);
  const bySymbol = {};
  (data.items || []).forEach(q => { bySymbol[q.symbol] = q; });
  const mid = (q) => q && (parseFloat(q.bid) + parseFloat(q.ask)) / 2;
  const scMid = mid(bySymbol[legs.shortCall]), lcMid = mid(bySymbol[legs.longCall]);
  const spMid = mid(bySymbol[legs.shortPut]), lpMid = mid(bySymbol[legs.longPut]);
  if ([scMid, lcMid, spMid, lpMid].some(v => v == null || isNaN(v))) throw new Error('incomplete quote data');
  return +((scMid - lcMid) + (spMid - lpMid)).toFixed(2);
}

function buildIronCondorOrder(legs, contracts, netCredit) {
  return {
    'order-type': 'Limit',
    'price': netCredit,
    'price-effect': 'Credit',
    'time-in-force': 'Day',
    legs: [
      { 'instrument-type': 'Equity Option', symbol: legs.shortCall, quantity: contracts, action: 'Sell to Open' },
      { 'instrument-type': 'Equity Option', symbol: legs.longCall, quantity: contracts, action: 'Buy to Open' },
      { 'instrument-type': 'Equity Option', symbol: legs.shortPut, quantity: contracts, action: 'Sell to Open' },
      { 'instrument-type': 'Equity Option', symbol: legs.longPut, quantity: contracts, action: 'Buy to Open' },
    ],
  };
}
