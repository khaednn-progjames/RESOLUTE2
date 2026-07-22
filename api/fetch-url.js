// ============================================================
// GET /api/fetch-url?url=https://example.com/product/123
//
// Server-side fetch of a product page so the browser can identify
// what a saved link goes to without hitting CORS (most e-commerce
// sites don't allow cross-origin fetches from arbitrary pages).
// Extracts <title> + Open Graph meta tags via regex — no HTML
// parser dependency needed for a handful of well-formed <head> tags.
//
// Some sites (Amazon especially) block obvious bot traffic even
// with a browser User-Agent — this always returns 200 with an
// `error` field on failure so the caller can fall back gracefully
// (e.g. let Sirius infer a product name from the URL slug alone)
// instead of treating it as fatal.
// ============================================================
export default async function handler(req, res) {
  const target = (req.query.url || '').toString().trim();
  if (!target) { res.status(400).json({ error: 'Missing url' }); return; }

  let parsed;
  try { parsed = new URL(target); } catch (e) { res.status(400).json({ error: 'Not a valid URL' }); return; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    res.status(400).json({ error: 'Only http(s) URLs are supported' });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const fallback = (error) => ({
    url: parsed.toString(),
    title: null,
    description: null,
    siteName: parsed.hostname.replace(/^www\./, ''),
    error,
  });

  try {
    const upstream = await fetch(parsed.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timeout);

    if (!upstream.ok || !upstream.body) {
      res.status(200).json(fallback('Site returned ' + upstream.status));
      return;
    }

    // Read only the first ~250KB (or until </head>) — meta tags always live near the top.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    let bytes = 0;
    const CAP = 250000;
    while (bytes < CAP) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    try { reader.cancel(); } catch (e) {}

    const grab = (re) => { const m = html.match(re); return m ? m[1].trim() : null; };
    const decodeEntities = (s) => s == null ? s : s
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    const ogTitle = grab(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)
                 || grab(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i);
    const rawTitle = grab(/<title[^>]*>([^<]*)<\/title>/i);
    const ogDesc = grab(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)
                || grab(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i)
                || grab(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
                || grab(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
    const ogSite = grab(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i)
                || grab(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:site_name["']/i);
    const ogImage = grab(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i)
                  || grab(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:image["']/i);
    const ogPrice = grab(/<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']*)["']/i)
                  || grab(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']product:price:amount["']/i)
                  || grab(/<meta[^>]+property=["']og:price:amount["'][^>]+content=["']([^"']*)["']/i)
                  || grab(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:price:amount["']/i);

    let imageUrl = null;
    if (ogImage) {
      try { imageUrl = new URL(ogImage, parsed).toString(); } catch (e) { imageUrl = null; }
    }

    res.status(200).json({
      url: parsed.toString(),
      title: decodeEntities(ogTitle || rawTitle),
      description: decodeEntities(ogDesc),
      siteName: decodeEntities(ogSite) || parsed.hostname.replace(/^www\./, ''),
      image: imageUrl,
      price: ogPrice ? ogPrice.replace(/[^0-9.]/g, '') || null : null,
    });
  } catch (e) {
    clearTimeout(timeout);
    res.status(200).json(fallback(String(e.message || e)));
  }
}
