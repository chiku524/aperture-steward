/**
 * Vercel bridge: GET/POST /aperture/* → AGENT_BASE_URL/aperture/*
 * Invoked as /api/proxy?p=<rest> (see vercel.json rewrite). Flat file avoids nested [...] route 404s.
 */

export default async function handler(req, res) {
  const base = process.env.AGENT_BASE_URL?.replace(/\/$/, '');
  if (!base) {
    res.status(503).json({ error: 'AGENT_BASE_URL is not set in Vercel project environment variables' });
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  let p = url.searchParams.get('p') || '';
  p = p.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!p || p.includes('..')) {
    res.status(400).json({ error: 'missing_or_invalid_path' });
    return;
  }

  const usp = new URLSearchParams(url.search);
  usp.delete('p');
  const q = usp.toString();
  const target = `${base}/aperture/${p}${q ? `?${q}` : ''}`;

  const init = {
    method: req.method,
    headers: {},
  };

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const ct = req.headers['content-type'] || 'application/json';
    init.headers['Content-Type'] = ct;
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  }

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (e) {
    res.status(502).json({
      error: 'upstream_unreachable',
      detail: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  const ct = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
  const body = Buffer.from(await upstream.arrayBuffer());
  res.status(upstream.status);
  res.setHeader('Content-Type', ct);
  res.send(body);
}
