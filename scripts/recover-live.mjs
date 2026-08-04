#!/usr/bin/env node
/**
 * Recover Aperture Steward on Nosana:
 * - start agent deployment (primary or v2)
 * - wait for /aperture/api/steward/health
 * - warm shared Qwen; if still down, deploy Ollama qwen3.5:9b and re-point agent
 * - update .env + optional Vercel AGENT_BASE_URL
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BASE = (process.env.NOSANA_API_BASE || 'https://dashboard.k8s.prd.nos.ci/api').replace(/\/$/, '');
const KEY = (process.env.NOSANA_API_KEY || '').trim();
if (!KEY) {
  console.error('Missing NOSANA_API_KEY');
  process.exit(1);
}

const PRIMARY = '2buetasmJKDcE57xXjCSk2jPT9JNNb8sb3AVHp4gXknC';
const V2 = '73UeVxNsVLSXWcQD9P9VAUieiWapKQxxsddCW2TNC6Zz';
const SHARED_QWEN = 'https://5i8frj7ann99bbw9gzpprvzj2esugg39hxbb4unypskq.node.k8s.prd.nos.ci/v1';
const SHARED_EMB = 'https://4yiccatpyxx773jtewo5ccwhw1s2hezq5pehndb6fcfq.node.k8s.prd.nos.ci/v1';
const MARKET_3060 = '7AtiXMSH6R1jjBxrcYjehCkkSF7zvYWte63gwEDBcGHq';

const ORIGINS = {
  [PRIMARY]: 'https://3skqG9rwS4ZUgNiEYCVmbNbhXvBswdQrXVPGHTJxWrTr.node.k8s.prd.nos.ci',
  [V2]: 'https://4DHSHDAGrsHKjQ7mC4wU22xLgv4d16ajwsAyFudpwktf.node.k8s.prd.nos.ci',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, json };
}

async function probeHealth(origin) {
  try {
    const res = await fetch(`${origin}/aperture/api/steward/health`, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e) {
    return { status: 0, text: String(e) };
  }
}

async function probeModels(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: 'Bearer nosana' },
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    return { status: res.status, text: text.slice(0, 240), state: res.headers.get('x-frp-service-state') };
  } catch (e) {
    return { status: 0, text: String(e) };
  }
}

function agentJobEnv(openaiBase, apiKey, model) {
  return {
    version: '0.1',
    type: 'container',
    meta: { trigger: 'api' },
    ops: [
      {
        type: 'container/run',
        id: 'agent',
        args: {
          image: 'docker.io/nicobuilds/aperture-steward-agent:latest',
          expose: 3000,
          env: {
            OPENAI_API_KEY: apiKey,
            OPENAI_BASE_URL: openaiBase,
            MODEL_NAME: model,
            OPENAI_SMALL_MODEL: model,
            OPENAI_LARGE_MODEL: model,
            OPENAI_EMBEDDING_URL: SHARED_EMB,
            OPENAI_EMBEDDING_API_KEY: 'nosana',
            OPENAI_EMBEDDING_MODEL: 'Qwen3-Embedding-0.6B',
            OPENAI_EMBEDDING_DIMENSIONS: '1024',
            SERVER_PORT: '3000',
            NODE_ENV: 'production',
            ATTENTION_BUDGET_LEVEL: 'normal',
            SOVEREIGNTY_MODE: 'strict',
          },
        },
      },
    ],
  };
}

function writeEnv(updates) {
  const envPath = path.join(ROOT, '.env');
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  for (const [k, v] of Object.entries(updates)) {
    const line = `${k}=${v}`;
    if (new RegExp(`^${k}=`, 'm').test(text)) {
      text = text.replace(new RegExp(`^${k}=.*$`, 'm'), line);
    } else {
      text = `${text.trimEnd()}\n${line}\n`;
    }
  }
  fs.writeFileSync(envPath, text, 'utf8');
  console.log('Wrote .env updates:', Object.keys(updates).join(', '));
}

async function ensureStarted(depId) {
  const detail = await api('GET', `/deployments/${depId}`);
  if (!detail.ok) {
    console.log('missing deploy', depId, detail.status);
    return detail;
  }
  const d = detail.json;
  const jobs = await api('GET', `/deployments/${depId}/jobs`);
  const running = (jobs.json?.jobs || []).filter((j) => j.state === 'RUNNING');
  console.log(depId.slice(0, 12), 'status=', d.status, 'active_jobs=', d.active_jobs, 'running=', running.length);

  // Clear zombie RUNNING jobs that leave deploy in STOPPED/unstartable state only if health is down
  const origin = ORIGINS[depId];
  const health = origin ? await probeHealth(origin) : { status: 0 };
  if (d.status === 'STOPPED' && running.length && health.status !== 200) {
    for (const j of running) {
      console.log('stop zombie job', j.job);
      await api('POST', `/jobs/${j.job}/stop`);
    }
    await sleep(5000);
  }

  if (['DRAFT', 'STOPPED', 'ERROR'].includes(d.status) && health.status !== 200) {
    const start = await api('POST', `/deployments/${depId}/start`);
    console.log('start', depId.slice(0, 12), start.status, JSON.stringify(start.json).slice(0, 200));
  }
  return detail;
}

async function waitForAgent(maxIters = 40) {
  for (let i = 0; i < maxIters; i++) {
    for (const [depId, origin] of Object.entries(ORIGINS)) {
      const h = await probeHealth(origin);
      const d = await api('GET', `/deployments/${depId}`);
      console.log(`[${i}] ${depId.slice(0, 8)} deploy=${d.json?.status} health=${h.status}`);
      if (h.status === 200 && h.text.includes('ok')) {
        return { depId, origin, health: h };
      }
    }
    if (i > 0 && i % 8 === 0) {
      await ensureStarted(PRIMARY);
      await ensureStarted(V2);
    }
    await sleep(8000);
  }
  return null;
}

async function main() {
  console.log('credits', (await api('GET', '/credits/balance')).json);

  await ensureStarted(PRIMARY);
  await ensureStarted(V2);

  const agent = await waitForAgent(45);
  if (!agent) {
    console.error('Agent did not become healthy in time');
    // try one more fresh create+start
    const created = await api('POST', '/deployments/create', {
      name: `aperture-steward-${Date.now().toString(36)}`,
      market: MARKET_3060,
      timeout: 720,
      replicas: 1,
      strategy: 'SIMPLE',
      job_definition: agentJobEnv(SHARED_QWEN, 'nosana', 'Qwen3.5-9B-FP8'),
    });
    console.log('fresh create', created.status, JSON.stringify(created.json).slice(0, 400));
    if (created.ok && created.json?.id) {
      ORIGINS[created.json.id] = created.json.endpoints?.[0]?.url;
      await api('POST', `/deployments/${created.json.id}/start`);
      const agent2 = await waitForAgent(40);
      if (!agent2) {
        process.exit(2);
      }
      Object.assign(agent || {}, agent2);
    } else {
      process.exit(2);
    }
  }

  const liveAgent = agent || (await waitForAgent(5));
  console.log('AGENT LIVE', liveAgent.origin);

  // Warm shared Qwen
  let qwenBase = SHARED_QWEN;
  let model = 'Qwen3.5-9B-FP8';
  let apiKey = 'nosana';
  let qwenOk = false;
  for (let i = 0; i < 20; i++) {
    const m = await probeModels(SHARED_QWEN);
    console.log(`shared qwen[${i}]`, m.status, m.state || '', m.text.slice(0, 100));
    if (m.status === 200) {
      qwenOk = true;
      break;
    }
    await sleep(12000);
  }

  let ollamaDepId = null;
  let ollamaOrigin = null;
  if (!qwenOk) {
    console.log('Shared Qwen still unavailable — deploying Ollama qwen3.5:9b on Nosana');
    const job_definition = {
      version: '0.1',
      type: 'container',
      meta: { trigger: 'api', system_requirements: { vram_total_mb: 9216 } },
      global: { variables: { MODEL: 'qwen3.5:9b' } },
      ops: [
        {
          id: 'server',
          type: 'container/run',
          args: {
            gpu: true,
            image: 'docker.io/ollama/ollama:0.31.2',
            expose: [
              {
                port: 11434,
                health_checks: [
                  {
                    path: '/api/tags',
                    type: 'http',
                    method: 'GET',
                    continuous: false,
                    expected_status: 200,
                  },
                ],
              },
            ],
            resources: [{ type: 'Ollama', model: 'qwen3.5:9b' }],
          },
        },
      ],
    };
    const created = await api('POST', '/deployments/create', {
      name: `aperture-qwen-ollama-${Date.now().toString(36)}`,
      market: MARKET_3060,
      timeout: 360,
      replicas: 1,
      strategy: 'SIMPLE',
      job_definition,
    });
    console.log('ollama create', created.status, JSON.stringify(created.json).slice(0, 500));
    if (created.ok && created.json?.id) {
      ollamaDepId = created.json.id;
      ollamaOrigin = created.json.endpoints?.[0]?.url;
      await api('POST', `/deployments/${ollamaDepId}/start`);
      for (let i = 0; i < 60; i++) {
        const d = await api('GET', `/deployments/${ollamaDepId}`);
        try {
          const tags = await fetch(`${ollamaOrigin}/api/tags`, { signal: AbortSignal.timeout(15000) });
          const body = await tags.text();
          console.log(`ollama[${i}] deploy=${d.json?.status} tags=${tags.status} ${body.slice(0, 120)}`);
          if (tags.status === 200) {
            const models = await probeModels(`${ollamaOrigin}/v1`);
            console.log('openai models', models.status, models.text.slice(0, 160));
            if (models.status === 200) {
              qwenOk = true;
              qwenBase = `${ollamaOrigin}/v1`;
              model = 'qwen3.5:9b';
              apiKey = 'ollama';
              break;
            }
            // Ollama may need pull time; keep waiting
          }
        } catch (e) {
          console.log(`ollama[${i}] deploy=${d.json?.status} wait ${e.name || e}`);
        }
        await sleep(10000);
      }
    }
  }

  // If we switched inference, revise agent job env and bounce
  if (qwenOk && ollamaDepId) {
    console.log('Pointing agent at self-hosted Ollama', qwenBase);
    const rev = await api(
      'POST',
      `/deployments/${liveAgent.depId}/create-revision`,
      agentJobEnv(qwenBase, apiKey, model)
    );
    console.log('revision', rev.status, JSON.stringify(rev.json).slice(0, 300));
    // Prefer stop job then start deployment
    const jobs = await api('GET', `/deployments/${liveAgent.depId}/jobs`);
    for (const j of jobs.json?.jobs || []) {
      if (j.state === 'RUNNING') {
        await api('POST', `/jobs/${j.job}/stop`);
      }
    }
    await sleep(8000);
    await api('POST', `/deployments/${liveAgent.depId}/start`);
    for (let i = 0; i < 30; i++) {
      const h = await probeHealth(liveAgent.origin);
      console.log(`agent reboot[${i}]`, h.status, h.text.slice(0, 100));
      if (h.status === 200 && h.text.includes('ok')) break;
      await sleep(8000);
    }
  }

  // Chat smoke test
  try {
    const res = await fetch(`${liveAgent.origin}/aperture/api/steward/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'In one short sentence, who are you?' }),
      signal: AbortSignal.timeout(180000),
    });
    const text = await res.text();
    console.log('CHAT', res.status, text.slice(0, 800));
  } catch (e) {
    console.log('CHAT FAIL', e);
  }

  writeEnv({
    BASE_URL: liveAgent.origin,
    AGENT_BASE_URL: liveAgent.origin,
    OPENAI_BASE_URL: qwenBase,
    OPENAI_API_KEY: apiKey,
    MODEL_NAME: model,
    OPENAI_SMALL_MODEL: model,
    OPENAI_LARGE_MODEL: model,
    NOSANA_DEPLOYMENT_ID: liveAgent.depId,
    ...(ollamaDepId ? { NOSANA_OLLAMA_DEPLOYMENT_ID: ollamaDepId, NOSANA_OLLAMA_ORIGIN: ollamaOrigin } : {}),
  });

  console.log('credits', (await api('GET', '/credits/balance')).json);
  console.log(
    JSON.stringify(
      {
        agentOrigin: liveAgent.origin,
        depId: liveAgent.depId,
        qwenBase,
        model,
        qwenOk,
        ollamaDepId,
        ollamaOrigin,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
