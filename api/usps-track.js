// ============================================================
// GET /api/usps-track?trackingNumber=XXXX
//
// Looks up a package's status via USPS's official Tracking API
// (developer.usps.com). Fetches a fresh OAuth2 client-credentials
// token on every call — tracking lookups are infrequent for a
// personal dashboard, so there's no need for token caching/storage.
//
// Requires Vercel env vars: USPS_CONSUMER_KEY, USPS_CONSUMER_SECRET
// (server-side only — never sent to the browser).
// ============================================================
export default async function handler(req, res) {
  const trackingNumber = (req.query.trackingNumber || '').toString().trim();
  if (!trackingNumber) { res.status(400).json({ error: 'Missing trackingNumber' }); return; }

  const { USPS_CONSUMER_KEY, USPS_CONSUMER_SECRET } = process.env;
  if (!USPS_CONSUMER_KEY || !USPS_CONSUMER_SECRET) {
    res.status(500).json({ error: 'USPS tracking is not configured. Add USPS_CONSUMER_KEY and USPS_CONSUMER_SECRET in Vercel env vars — see SETUP.md.' });
    return;
  }

  try {
    const tokenRes = await fetch('https://apis.usps.com/oauth2/v3/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: USPS_CONSUMER_KEY,
        client_secret: USPS_CONSUMER_SECRET,
        scope: 'tracking',
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      res.status(400).json({ error: 'USPS auth failed: ' + (tokenJson.error_description || tokenJson.error || tokenRes.status) });
      return;
    }

    const trackRes = await fetch('https://apis.usps.com/tracking/v3/tracking/' + encodeURIComponent(trackingNumber), {
      headers: { Authorization: 'Bearer ' + tokenJson.access_token, Accept: 'application/json' },
    });
    const trackJson = await trackRes.json();
    if (!trackRes.ok) {
      res.status(trackRes.status === 404 ? 404 : 400).json({ error: (trackJson.error && (trackJson.error.message || trackJson.error)) || 'Could not find tracking info for this number.' });
      return;
    }

    // Normalize into a shape the frontend can rely on even if USPS's exact
    // field names shift — this hasn't been verified against a live account.
    const events = (trackJson.trackingEvents || trackJson.events || []).map(e => ({
      description: e.eventDescription || e.description || e.status || '',
      date: e.eventDate || e.date || null,
      time: e.eventTime || null,
      city: e.eventCity || e.city || null,
      state: e.eventState || e.state || null,
      zip: e.eventZIP || e.zip || null,
    }));

    res.status(200).json({
      trackingNumber,
      status: trackJson.status || trackJson.statusCategory || (events[0] && events[0].description) || 'Unknown',
      statusCategory: trackJson.statusCategory || null,
      expectedDelivery: trackJson.expectedDeliveryDate || trackJson.guaranteedDeliveryDate || null,
      events,
      raw: trackJson,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
