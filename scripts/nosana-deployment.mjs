#!/usr/bin/env node
/**
 * Nosana Deploy REST API helper (no extra deps).
 * Base URL: https://learn.nosana.com/api/intro.html
 *
 * Usage:
 *   export NOSANA_API_KEY="nos_..."   # from https://deploy.nosana.com/account/
 *   node scripts/nosana-deployment.mjs list
 *   node scripts/nosana-deployment.mjs status <deploymentId>
 *   node scripts/nosana-deployment.mjs stop <deploymentId>
 *   node scripts/nosana-deployment.mjs start <deploymentId>
 *   node scripts/nosana-deployment.mjs restart <deploymentId> [--wait]
 *   node scripts/nosana-deployment.mjs revision <deploymentId> --file nos_job_def/nosana_eliza_job_definition.json
 *
 * Optional: NOSANA_API_BASE (default https://dashboard.k8s.prd.nos.ci/api)
 */

const API_BASE = (process.env.NOSANA_API_BASE || 'https://dashboard.k8s.prd.nos.ci/api').replace(/\/$/, '');

function authHeaders() {
  const key = process.env.NOSANA_API_KEY;
  if (!key || !String(key).trim()) {
    console.error('Missing NOSANA_API_KEY (Bearer token from deploy.nosana.com → Account → API Keys).');
    process.exit(1);
  }
  return {
    Authorization: `Bearer ${key.trim()}`,
    Accept: 'application/json',
  };
}

async function apiFetch(path, { method = 'GET', body } = {}) {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const init = { method, headers: { ...authHeaders() } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${method} ${path}`);
    err.detail = json;
    err.status = res.status;
    throw err;
  }
  return json;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getDeployment(id) {
  return apiFetch(`/deployments/${encodeURIComponent(id)}`);
}

async function cmdList() {
  const data = await apiFetch('/deployments');
  const rows = Array.isArray(data) ? data : data.deployments || data.items || [];
  if (!rows.length) {
    console.log('No deployments returned (empty list or unexpected shape).');
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  for (const d of rows) {
    console.log(`${d.id}\t${d.status}\t${d.name || ''}`);
  }
}

async function cmdStatus(id) {
  const d = await getDeployment(id);
  console.log(JSON.stringify(d, null, 2));
}

async function cmdStop(id) {
  const out = await apiFetch(`/deployments/${encodeURIComponent(id)}/stop`, { method: 'POST' });
  console.log(JSON.stringify(out, null, 2));
}

async function cmdStart(id) {
  const out = await apiFetch(`/deployments/${encodeURIComponent(id)}/start`, { method: 'POST' });
  console.log(JSON.stringify(out, null, 2));
}

async function waitForStatus(id, allowed, { timeoutMs = 180000, intervalMs = 4000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = await getDeployment(id);
    if (allowed.has(d.status)) return d;
    await sleep(intervalMs);
  }
  throw new Error(`Timeout waiting for status in [${[...allowed].join(', ')}]`);
}

async function cmdRestart(id, argv) {
  const wait = argv.includes('--wait');
  let d = await getDeployment(id);
  console.error(`Current status: ${d.status}`);

  if (d.status === 'RUNNING' || d.status === 'STARTING') {
    console.error('Sending stop…');
    await cmdStop(id);
    if (wait) {
      console.error('Waiting until stopped…');
      d = await waitForStatus(id, new Set(['STOPPED', 'DRAFT', 'ERROR']), { timeoutMs: 240000 });
      console.error(`After stop: ${d.status}`);
      if (d.status === 'ERROR') {
        console.error('Deployment is in ERROR; start may fail. Check dashboard.');
      }
    } else {
      await sleep(8000);
    }
  }

  console.error('Sending start…');
  await cmdStart(id);
  if (wait) {
    console.error('Waiting for RUNNING…');
    const running = await waitForStatus(id, new Set(['RUNNING']), { timeoutMs: 300000, intervalMs: 5000 });
    console.log(JSON.stringify(running, null, 2));
  }
}

async function cmdRevision(id, filePath) {
  const fs = await import('node:fs');
  const raw = fs.readFileSync(filePath, 'utf8');
  const jobDefinition = JSON.parse(raw);
  const out = await apiFetch(`/deployments/${encodeURIComponent(id)}/create-revision`, {
    method: 'POST',
    body: jobDefinition,
  });
  console.log(JSON.stringify(out, null, 2));
  console.error('\nIf the dashboard does not roll traffic automatically, run:');
  console.error(`  node scripts/nosana-deployment.mjs restart ${id} --wait`);
}

function usage() {
  console.error(`Nosana deployment API (${API_BASE})

Commands:
  list
  status <deploymentId>
  stop <deploymentId>
  start <deploymentId>
  restart <deploymentId> [--wait]
  revision <deploymentId> --file <job-definition.json>

Env:
  NOSANA_API_KEY   (required) Bearer token
  NOSANA_API_BASE  (optional) default production dashboard API
`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd) {
    usage();
    process.exit(1);
  }
  try {
    if (cmd === 'list') await cmdList();
    else if (cmd === 'status') await cmdStatus(rest[0]);
    else if (cmd === 'stop') await cmdStop(rest[0]);
    else if (cmd === 'start') await cmdStart(rest[0]);
    else if (cmd === 'restart') await cmdRestart(rest[0], rest);
    else if (cmd === 'revision') {
      const id = rest[0];
      const fi = rest.indexOf('--file');
      if (fi < 0 || !rest[fi + 1]) {
        usage();
        process.exit(1);
      }
      await cmdRevision(id, rest[fi + 1]);
    } else {
      usage();
      process.exit(1);
    }
  } catch (e) {
    console.error(e.message || e);
    if (e.detail) console.error(JSON.stringify(e.detail, null, 2));
    process.exit(e.status && e.status >= 400 ? e.status : 1);
  }
}

main();
