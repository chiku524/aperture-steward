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

function parseAgentOrigin(raw) {
  const trimmed = raw?.trim().replace(/\/$/, '');
  if (!trimmed) return { ok: false, reason: 'missing' };
  try {
    const href = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    const u = new URL(href);
    const path = u.pathname.replace(/\/$/, '') || '';
    if (path.endsWith('/v1') || path === '/v1') {
      return {
        ok: false,
        reason: 'inference_url',
        detail:
          'AGENT_BASE_URL must be the agent HTTP origin (Eliza on port 3000), not the Qwen OpenAI-compatible inference URL. The inference base ends in /v1 and belongs only in OPENAI_BASE_URL on the Nosana container.',
      };
    }
    const origin = `${u.protocol}//${u.host}`;
    return { ok: true, origin };
  } catch {
    return { ok: false, reason: 'invalid_url', detail: 'AGENT_BASE_URL is not a valid http(s) origin.' };
  }
}

export default async function handler(req, res) {
  const parsed = parseAgentOrigin(process.env.AGENT_BASE_URL);
  if (!parsed.ok) {
    if (parsed.reason === 'missing') {
      res.status(503).json({ error: 'AGENT_BASE_URL is not set in Vercel project environment variables' });
      return;
    }
    res.status(400).json({ error: `agent_base_url_${parsed.reason}`, detail: parsed.detail });
    return;
  }
  const base = parsed.origin;

  if (process.env.VERCEL_URL) {
    try {
      const agent = new URL(base);
      const deployment = new URL(`https://${process.env.VERCEL_URL}`);
      if (agent.hostname === deployment.hostname) {
        res.status(400).json({
          error: 'agent_base_url_same_as_vercel',
          detail:
            'AGENT_BASE_URL must be your Nosana (or other) agent origin, not this Vercel hostname. The bridge cannot call into the same static deployment for JSON APIs.',
        });
        return;
      }
    } catch {
      /* ignore */
    }
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

  /** Steward JSON routes must not come back as the Eliza client SPA (common AGENT_BASE_URL misconfig). */
  const stewardApi = p.startsWith('api/steward');
  if (stewardApi && /text\/html/i.test(ct)) {
    res.status(502);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
    const probePath = `/aperture/${p}`;
    res.json({
      error: 'upstream_returned_html',
      detail:
        'AGENT_BASE_URL reached a server that returned HTML for a steward API path (often the stock ElizaOS web client, a loading page, or a generic reverse proxy). That origin must serve JSON from the aperture plugin.',
      agent_origin: base,
      upstream_path: probePath,
      upstream_status: upstream.status,
      verify_cli: `curl -sS "${base}${probePath}" | head -c 200`,
      checklist: [
        'Use the Nosana deployment URL for the container that exposes port 3000 (from deploy UI / endpoints), not the Qwen inference …/v1 host.',
        'Run this repo’s agent (Docker image nicobuilds/aperture-steward-agent or local pnpm) so the aperture plugin registers /aperture/api/steward/*.',
        `From your machine, GET ${base}/aperture/api/steward/health must return JSON with "aperture-steward-plugin" before the Vercel bridge will work.`,
      ],
    });
    return;
  }

  res.status(upstream.status);
  res.setHeader('Content-Type', ct);
  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  res.send(buf);
}
