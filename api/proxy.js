/**
 * Vercel bridge: /aperture/api/* → AGENT_BASE_URL/aperture/api/*
 * Query: ?p=api/<rest> (see vercel.json). POST: Vercel often omits req.body — read raw stream when needed.
 */

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function getBodyForUpstream(req) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return undefined;
  }
  if (req.body != null) {
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    if (typeof req.body === 'string') return req.body;
    if (typeof req.body === 'object') return JSON.stringify(req.body);
  }
  const raw = await readRawBody(req);
  return raw && raw.length > 0 ? raw : '{}';
}

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

  const body = await getBodyForUpstream(req);

  /** @type {RequestInit} */
  const init = {
    method: req.method,
    headers: {
      Accept: req.headers.accept || 'application/json',
    },
  };

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    init.headers['Content-Type'] = req.headers['content-type'] || 'application/json';
    init.body = body;
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
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.status(upstream.status);
  res.setHeader('Content-Type', ct);
  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  res.send(buf);
}
