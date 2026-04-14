#!/usr/bin/env node
/**
 * Interactive helper: merge API keys and URLs into `.env`, optionally verify the
 * agent, list Nosana deployments, and push bridge vars to Vercel via REST API.
 *
 * Usage:
 *   node scripts/setup-credentials.mjs
 *   node scripts/setup-credentials.mjs --dry-run
 *
 * Nothing is printed back for secret values after entry. Never commit `.env`.
 *
 * Env (optional, non-interactive defaults):
 *   SETUP_NONINTERACTIVE=1 — skip prompts; only merge env from existing files / no write (not implemented; use --dry-run for inspection)
 */

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

const DRY = process.argv.includes('--dry-run');

const DEFAULTS = {
  OPENAI_API_KEY: 'nosana',
  /** Eliza `@elizaos/plugin-openai` reads this for chat — not `OPENAI_API_URL`. */
  OPENAI_BASE_URL: 'https://5i8frj7ann99bbw9gzpprvzj2esugg39hxbb4unypskq.node.k8s.prd.nos.ci/v1',
  OPENAI_EMBEDDING_URL: 'https://4yiccatpyxx773jtewo5ccwhw1s2hezq5pehndb6fcfq.node.k8s.prd.nos.ci/v1',
  OPENAI_EMBEDDING_API_KEY: 'nosana',
  OPENAI_EMBEDDING_MODEL: 'Qwen3-Embedding-0.6B',
  OPENAI_EMBEDDING_DIMENSIONS: '1024',
  MODEL_NAME: 'Qwen3.5-9B-FP8',
  ATTENTION_BUDGET_LEVEL: 'normal',
  SOVEREIGNTY_MODE: 'strict',
  SERVER_PORT: '3000',
};

function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function quoteVal(v) {
  if (/[\s#"'\\]/.test(v)) return `"${v.replace(/"/g, '\\"')}"`;
  return v;
}

function buildEnvFile(merged) {
  const lines = [
    '# =============================================================',
    '# Local environment (merged by scripts/setup-credentials.mjs)',
    `# ${new Date().toISOString()}`,
    '# Do not commit this file. See .env.example for field meanings.',
    '# =============================================================',
    '',
    '# LLM',
    `OPENAI_API_KEY=${quoteVal(merged.OPENAI_API_KEY)}`,
    `OPENAI_BASE_URL=${quoteVal(merged.OPENAI_BASE_URL)}`,
    `MODEL_NAME=${quoteVal(merged.MODEL_NAME)}`,
    '',
    '# Embeddings',
    `OPENAI_EMBEDDING_URL=${quoteVal(merged.OPENAI_EMBEDDING_URL)}`,
    `OPENAI_EMBEDDING_API_KEY=${quoteVal(merged.OPENAI_EMBEDDING_API_KEY)}`,
    `OPENAI_EMBEDDING_MODEL=${quoteVal(merged.OPENAI_EMBEDDING_MODEL)}`,
    `OPENAI_EMBEDDING_DIMENSIONS=${quoteVal(merged.OPENAI_EMBEDDING_DIMENSIONS)}`,
    '',
    '# Steward tuning',
    `ATTENTION_BUDGET_LEVEL=${quoteVal(merged.ATTENTION_BUDGET_LEVEL)}`,
    `SOVEREIGNTY_MODE=${quoteVal(merged.SOVEREIGNTY_MODE)}`,
    '',
    '# Server',
    `SERVER_PORT=${quoteVal(merged.SERVER_PORT)}`,
    '',
  ];

  if (merged.NOSANA_API_KEY) {
    lines.push('# Nosana Deploy API (scripts/nosana-deployment.mjs)', `NOSANA_API_KEY=${quoteVal(merged.NOSANA_API_KEY)}`, '');
  }
  if (merged.BASE_URL) {
    lines.push('# Smoke tests: pnpm run verify:deploy (uses BASE_URL)', `BASE_URL=${quoteVal(merged.BASE_URL)}`, '');
  }
  if (merged.AGENT_BASE_URL) {
    lines.push(
      '# Same origin you set on Vercel as AGENT_BASE_URL (optional local note)',
      `AGENT_BASE_URL=${quoteVal(merged.AGENT_BASE_URL)}`,
      ''
    );
  }
  if (merged.REPO_URL) {
    lines.push('# Landing page GitHub link (optional)', `REPO_URL=${quoteVal(merged.REPO_URL)}`, '');
  }
  if (merged.VERCEL_TOKEN) {
    lines.push(
      '# Vercel token for scripts only — revoke if leaked; prefer `vercel login` for CLI',
      `VERCEL_TOKEN=${quoteVal(merged.VERCEL_TOKEN)}`,
      ''
    );
  }
  if (merged.VERCEL_PROJECT_ID) {
    lines.push('# Vercel project id (prj_…) from dashboard or API', `VERCEL_PROJECT_ID=${quoteVal(merged.VERCEL_PROJECT_ID)}`, '');
  }
  if (merged.VERCEL_TEAM_ID) {
    lines.push('# Vercel team id (team_…) if project is under a team', `VERCEL_TEAM_ID=${quoteVal(merged.VERCEL_TEAM_ID)}`, '');
  }

  return lines.join('\n').replace(/\n+$/, '\n');
}

async function question(rl, q, def = '') {
  const hint = def ? ` [${def}]` : ' [skip]';
  const a = (await rl.question(`${q}${hint}: `)).trim();
  return a || def;
}

async function questionSecret(rl, q) {
  const a = (await rl.question(`${q} (input visible; leave empty to skip): `)).trim();
  return a;
}

async function vercelListEnv(token, projectId, teamId) {
  const q = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/env${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Vercel list env failed: ${res.status}`);
    err.detail = data;
    throw err;
  }
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.envs)) return data.envs;
  return [];
}

async function vercelRemoveEnv(token, projectId, teamId, envId) {
  const q = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/env/${envId}${q}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    const t = await res.text();
    throw new Error(`Vercel delete env ${envId}: ${res.status} ${t}`);
  }
}

async function vercelCreateEnv(token, projectId, teamId, key, value) {
  const q = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const res = await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env${q}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key,
      value,
      type: 'encrypted',
      target: ['production', 'preview'],
    }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Vercel create ${key}: ${res.status}`);
    err.detail = data;
    throw err;
  }
  return data;
}

async function vercelUpsertEnv(token, projectId, teamId, key, value) {
  const list = await vercelListEnv(token, projectId, teamId);
  const arr = Array.isArray(list) ? list : [];
  for (const e of arr) {
    if (e.key === key) {
      await vercelRemoveEnv(token, projectId, teamId, e.id);
    }
  }
  await vercelCreateEnv(token, projectId, teamId, key, value);
}

async function runVerify(base) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'verify-endpoints.mjs'), base], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, BASE_URL: base },
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
}

async function runNosanaList(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'nosana-deployment.mjs'), 'list'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
}

async function main() {
  const rl = readline.createInterface({ input, output });

  let existing = {};
  try {
    existing = parseEnv(fs.readFileSync(ENV_PATH, 'utf8'));
  } catch {
    /* no .env */
  }

  console.log('\nAperture Steward — credential setup');
  console.log('─'.repeat(50));
  console.log('Inference profile:');
  console.log('  1) Nosana hosted Qwen (OPENAI_API_KEY=nosana + Nosana OPENAI_BASE_URL)');
  console.log('  2) OpenAI platform (your sk-… key + https://api.openai.com/v1)');
  console.log('  3) Keep existing .env LLM fields (only change what you re-enter below)');
  const profile = (await rl.question('Choose [1/2/3] (default 1): ')).trim() || '1';

  /** Existing keys win over baked-in defaults. */
  /** @type {Record<string, string>} */
  const merged = { ...DEFAULTS, ...existing };
  if (!merged.OPENAI_BASE_URL && merged.OPENAI_API_URL) {
    merged.OPENAI_BASE_URL = merged.OPENAI_API_URL;
  }

  if (profile === '2') {
    merged.OPENAI_API_KEY = await questionSecret(rl, 'OpenAI API key (sk-…)');
    if (!merged.OPENAI_API_KEY) {
      console.error('OpenAI profile requires a key. Aborting.');
      process.exit(1);
    }
    merged.OPENAI_BASE_URL = await question(rl, 'OpenAI base URL', 'https://api.openai.com/v1');
    merged.MODEL_NAME = await question(rl, 'Chat model name', merged.MODEL_NAME || 'gpt-4o-mini');
    const emb = (await rl.question('Use same OpenAI key for embeddings? [Y/n]: ')).trim().toLowerCase();
    if (emb !== 'n') {
      merged.OPENAI_EMBEDDING_URL = merged.OPENAI_BASE_URL;
      merged.OPENAI_EMBEDDING_API_KEY = merged.OPENAI_API_KEY;
    } else {
      merged.OPENAI_EMBEDDING_API_KEY = await questionSecret(rl, 'Embedding API key');
      merged.OPENAI_EMBEDDING_URL = await question(rl, 'Embedding base URL', merged.OPENAI_BASE_URL);
    }
  } else if (profile === '3') {
    console.log('Keeping LLM-related keys from existing .env / defaults.');
  } else {
    merged.OPENAI_API_KEY = 'nosana';
    merged.OPENAI_BASE_URL = await question(rl, 'Nosana OPENAI_BASE_URL', merged.OPENAI_BASE_URL);
    const embSame = (await rl.question('Use default Nosana embedding URL + nosana key? [Y/n]: ')).trim().toLowerCase();
    if (embSame === 'n') {
      merged.OPENAI_EMBEDDING_URL = await question(rl, 'OPENAI_EMBEDDING_URL', merged.OPENAI_EMBEDDING_URL);
      merged.OPENAI_EMBEDDING_API_KEY = await question(rl, 'OPENAI_EMBEDDING_API_KEY', merged.OPENAI_EMBEDDING_API_KEY);
    } else {
      merged.OPENAI_EMBEDDING_URL = DEFAULTS.OPENAI_EMBEDDING_URL;
      merged.OPENAI_EMBEDDING_API_KEY = 'nosana';
    }
  }

  merged.MODEL_NAME = await question(rl, 'MODEL_NAME', merged.MODEL_NAME);
  merged.ATTENTION_BUDGET_LEVEL = await question(rl, 'ATTENTION_BUDGET_LEVEL', merged.ATTENTION_BUDGET_LEVEL);
  merged.SOVEREIGNTY_MODE = await question(rl, 'SOVEREIGNTY_MODE', merged.SOVEREIGNTY_MODE);

  const nosk = await questionSecret(rl, 'NOSANA_API_KEY (for `pnpm run nosana:deployments`)');
  if (nosk) merged.NOSANA_API_KEY = nosk;

  const base = await question(rl, 'Agent public HTTPS origin (Nosana job URL, no trailing slash)', merged.BASE_URL || merged.AGENT_BASE_URL || '');
  if (base) {
    merged.BASE_URL = base.replace(/\/$/, '');
    merged.AGENT_BASE_URL = merged.BASE_URL;
  }

  const repo = await question(rl, 'REPO_URL (optional, for Vercel landing)', merged.REPO_URL || '');
  if (repo) merged.REPO_URL = repo;

  const out = buildEnvFile(merged);

  if (DRY) {
    console.log('\n--- dry-run: would write .env (secrets redacted) ---\n');
    console.log(
      out.replace(/OPENAI_API_KEY=.*/, 'OPENAI_API_KEY=<redacted>').replace(/NOSANA_API_KEY=.*/, 'NOSANA_API_KEY=<redacted>')
    );
  } else {
    fs.writeFileSync(ENV_PATH, out, 'utf8');
    console.log(`\nWrote ${path.relative(ROOT, ENV_PATH)}`);
  }

  const runList = (await rl.question('\nRun Nosana deployment list now? [y/N]: ')).trim().toLowerCase();
  if (runList === 'y' && merged.NOSANA_API_KEY) {
    const code = await runNosanaList({ NOSANA_API_KEY: merged.NOSANA_API_KEY });
    if (code !== 0) console.error(`nosana list exited ${code}`);
  } else if (runList === 'y') {
    console.log('Skipped (no NOSANA_API_KEY).');
  }

  const runV = (await rl.question('Run deploy smoke check (verify-endpoints)? [y/N]: ')).trim().toLowerCase();
  if (runV === 'y' && merged.BASE_URL) {
    const code = await runVerify(merged.BASE_URL);
    if (code !== 0) console.error(`verify exited ${code}`);
  } else if (runV === 'y') {
    console.log('Skipped (no agent URL captured).');
  }

  const push = (await rl.question('\nPush AGENT_BASE_URL (and REPO_URL if set) to Vercel via API? [y/N]: ')).trim().toLowerCase();
  if (push === 'y' && !DRY) {
    const token = await questionSecret(rl, 'VERCEL_TOKEN (https://vercel.com/account/tokens)');
    const projectId = await question(rl, 'VERCEL_PROJECT_ID (prj_… from Project Settings)', merged.VERCEL_PROJECT_ID || '');
    const teamId = await question(rl, 'VERCEL_TEAM_ID (optional, team_…)', merged.VERCEL_TEAM_ID || '');
    if (!token || !projectId) {
      console.log('Missing token or project id — skipping Vercel push.');
    } else {
      merged.VERCEL_TOKEN = token;
      merged.VERCEL_PROJECT_ID = projectId;
      if (teamId) merged.VERCEL_TEAM_ID = teamId;
      try {
        if (merged.AGENT_BASE_URL) {
          console.log('Upserting AGENT_BASE_URL…');
          await vercelUpsertEnv(token, projectId, teamId || undefined, 'AGENT_BASE_URL', merged.AGENT_BASE_URL);
        }
        if (merged.REPO_URL) {
          console.log('Upserting REPO_URL…');
          await vercelUpsertEnv(token, projectId, teamId || undefined, 'REPO_URL', merged.REPO_URL);
        }
        console.log('Vercel env updated. Trigger a redeploy in the Vercel dashboard if needed.');
      } catch (e) {
        console.error(e.message);
        if (e.detail) console.error(JSON.stringify(e.detail, null, 2));
      }
      fs.writeFileSync(ENV_PATH, buildEnvFile(merged), 'utf8');
      console.log('Saved VERCEL_* fields into .env for repeat runs (keep file private).');
    }
  }

  console.log('\nNext steps:');
  console.log('  • Nosana: paste env vars from .env into the deployment job definition (or dashboard env UI).');
  console.log('  • Local Docker: docker run … --env-file .env');
  console.log('  • Vercel: ensure AGENT_BASE_URL matches your Nosana origin; redeploy after env changes.');
  console.log('  • Restart: pnpm run nosana:deployments restart "<id>" --wait\n');

  await rl.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
