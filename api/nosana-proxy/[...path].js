/**
 * Proxies /aperture/* (after rewrite) to AGENT_BASE_URL, preserving path and query.
 * Browser hits /aperture/api/steward/health → rewrite → this handler → upstream same path.
 */

export default async function handler(req, res) {
  const base = process.env.AGENT_BASE_URL?.replace(/\/$/, '');
  if (!base) {
    res.status(503).json({ error: 'AGENT_BASE_URL is not set in Vercel project environment variables' });
    return;
  }

  const segs = req.query.path;
  const mid = Array.isArray(segs) ? segs.join('/') : String(segs ?? '');
  const rawUrl = typeof req.url === 'string' ? req.url : '';
  const q = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : '';
  const target = `${base}/aperture/${mid}${q}`;

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
