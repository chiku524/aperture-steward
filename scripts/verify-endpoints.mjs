#!/usr/bin/env node
/**
 * Smoke-check a deployed Aperture Steward origin (Nosana or local).
 * Usage:
 *   pnpm run verify:deploy https://your-origin.node.k8s.prd.nos.ci
 *   BASE_URL=https://... pnpm run verify:deploy
 */

const argv = process.argv.slice(2).filter((a) => a !== '--');
const rawArg = argv.find((a) => /^https?:\/\//i.test(a));
const base = (process.env.BASE_URL || rawArg || '').replace(/\/$/, '');

if (!base) {
  console.error('Missing base URL. Example:\n  pnpm run verify:deploy https://your-job.node.k8s.prd.nos.ci\n  BASE_URL=https://127.0.0.1:3000 pnpm run verify:deploy');
  process.exit(1);
}

const paths = [
  { path: '/api/steward/health', wantJson: true },
  { path: '/steward', wantJson: false },
];

let failed = false;

for (const { path, wantJson } of paths) {
  const url = `${base}${path}`;
  try {
    const res = await fetch(url, { redirect: 'manual' });
    const ct = res.headers.get('content-type') || '';
    let ok = res.ok;
    let detail = `${res.status} ${res.statusText}`;

    if (wantJson) {
      const text = await res.text();
      try {
        const j = JSON.parse(text);
        if (j.status === 'ok' || j.status === 'degraded') {
          detail += ` | body.status=${j.status}`;
        } else {
          ok = false;
          detail += ` | unexpected JSON`;
        }
      } catch {
        ok = false;
        detail += ` | not JSON (${ct})`;
      }
    } else {
      if (!ct.includes('text/html') && res.status !== 200) {
        ok = false;
      }
      detail += ` | content-type=${ct || '(none)'}`;
    }

    console.log(ok ? 'OK  ' : 'FAIL', path, detail);
    if (!ok) failed = true;
  } catch (e) {
    console.log('FAIL', path, e instanceof Error ? e.message : String(e));
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
