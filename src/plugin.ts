import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type Plugin,
  type Provider,
  type ProviderResult,
  type RouteRequest,
  type RouteResponse,
  type State,
  EventType,
  type MessagePayload,
  logger,
} from '@elizaos/core';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

const ARTIFACTS_DIR = join(process.cwd(), 'data', 'artifacts');
const TRACE_PATH = join(process.cwd(), 'data', 'sovereignty-trace.ndjson');
const PROCESS_STARTED_AT = Date.now();

const DEFAULT_MAX_MESSAGE_CHARS = 12_000;
const DEFAULT_CHAT_TIMEOUT_MS = 120_000;
const DEFAULT_TRACE_TAIL = 80;
const DEFAULT_TRACE_MAX_BYTES = 512 * 1024;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function maxMessageChars(): number {
  return envInt('STEWARD_MAX_MESSAGE_CHARS', DEFAULT_MAX_MESSAGE_CHARS);
}

function chatTimeoutMs(): number {
  return envInt('STEWARD_CHAT_TIMEOUT_MS', DEFAULT_CHAT_TIMEOUT_MS);
}

function attentionBudget(): string {
  return process.env.ATTENTION_BUDGET_LEVEL ?? 'normal';
}

function sovereigntyMode(): string {
  return process.env.SOVEREIGNTY_MODE ?? 'strict';
}

function ensureDataDirs(): void {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
}

function readUiHtml(): string {
  const path = join(process.cwd(), 'public', 'steward.html');
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '<!doctype html><html><body><p>Missing public/steward.html</p></body></html>';
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function readTraceTailLines(limit: number, maxBytes: number): { lines: unknown[]; truncated: boolean } {
  if (!existsSync(TRACE_PATH)) {
    return { lines: [], truncated: false };
  }
  try {
    const size = statSync(TRACE_PATH).size;
    let raw: string;
    let truncated = false;
    if (size > maxBytes) {
      const buf = Buffer.alloc(maxBytes);
      const handle = openSync(TRACE_PATH, 'r');
      try {
        readSync(handle, buf, 0, maxBytes, size - maxBytes);
      } finally {
        closeSync(handle);
      }
      raw = buf.toString('utf-8');
      const firstNl = raw.indexOf('\n');
      raw = firstNl === -1 ? raw : raw.slice(firstNl + 1);
      truncated = true;
    } else {
      raw = readFileSync(TRACE_PATH, 'utf-8');
    }
    const all = raw.split('\n').filter((l) => l.trim().length > 0);
    const slice = all.slice(-limit);
    const lines = slice.map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { raw: line, parseError: true };
      }
    });
    return { lines, truncated };
  } catch (e) {
    logger.warn({ err: e }, 'steward trace read failed');
    return { lines: [], truncated: false };
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

const stewardProvider: Provider = {
  name: 'APERTURE_CONTEXT',
  description:
    'Injects the operator attention budget, sovereignty mode, and recent on-disk artifacts into agent state.',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined
  ): Promise<ProviderResult> => {
    const budget = attentionBudget();
    const mode = sovereigntyMode();
    let recent = '';
    try {
      ensureDataDirs();
      const files = readdirSync(ARTIFACTS_DIR)
        .filter((f: string) => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, 3);
      if (files.length) {
        recent = files
          .map((f: string) => {
            try {
              const raw = readFileSync(join(ARTIFACTS_DIR, f), 'utf-8');
              return `- ${f}: ${raw.slice(0, 400)}${raw.length > 400 ? '…' : ''}`;
            } catch {
              return `- ${f}: (unreadable)`;
            }
          })
          .join('\n');
      }
    } catch {
      recent = '(no artifacts yet)';
    }

    const text = [
      `## Steward context`,
      `- Attention budget: ${budget} (operator-declared cognitive load tolerance).`,
      `- Sovereignty mode: ${mode} (strict = refuse low-signal automation and bulk-posting; permissive = allow more delegation).`,
      recent ? `## Recent commitment / digest files\n${recent}` : '## Recent artifacts\n(none yet)',
    ].join('\n');

    return { text, values: { attentionBudget: budget, sovereigntyMode: mode }, data: {} };
  },
};

const recordDigestAction: Action = {
  name: 'RECORD_DECISION_DIGEST',
  similes: ['LOG_DECISION', 'SAVE_DIGEST', 'COMMITMENT_LEDGER'],
  description:
    'When the operator asks to record a decision, commitment, or conclusion, persist a structured JSON artifact under data/artifacts/ for an auditable, exportable personal trail.',

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const t = (message.content.text ?? '').toLowerCase();
    return (
      /\b(record|log|save|write)\b/.test(t) &&
      /\b(decision|commitment|conclusion|digest|memo|resolution)\b/.test(t)
    );
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown> = {},
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    ensureDataDirs();
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(ARTIFACTS_DIR, `decision-${id}.json`);
    const payload = {
      kind: 'decision_digest',
      recordedAt: new Date().toISOString(),
      sourceText: message.content.text,
      agentId: runtime.agentId,
      attentionBudget: attentionBudget(),
      sovereigntyMode: sovereigntyMode(),
    };
    writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
    const msg = `Recorded decision digest to ${file} (local sovereign ledger).`;
    if (callback) {
      await callback({ text: msg, actions: ['RECORD_DECISION_DIGEST'], source: message.content.source });
    }
    return { text: msg, success: true, data: { path: file } };
  },

  examples: [],
};

export const apertureStewardPlugin: Plugin = {
  name: 'aperture-steward',
  description:
    'Personal cognitive-load steward: sovereign trace logging, decision artifacts, and a dedicated /steward UI.',

  providers: [stewardProvider],
  actions: [recordDigestAction],

  events: {
    [EventType.MESSAGE_RECEIVED]: [
      async (payload: MessagePayload) => {
        try {
          ensureDataDirs();
          const line = JSON.stringify({
            ts: new Date().toISOString(),
            source: payload.source,
            preview: (payload.message.content.text ?? '').slice(0, 280),
          });
          appendFileSync(TRACE_PATH, `${line}\n`, 'utf-8');
        } catch (e) {
          logger.warn({ err: e }, 'steward trace append skipped');
        }
      },
    ],
  },

  routes: [
    {
      name: 'steward-ui',
      path: '/steward',
      type: 'GET',
      public: true,
      handler: async (_req: RouteRequest, res: RouteResponse) => {
        res.setHeader?.('Content-Type', 'text/html; charset=utf-8');
        res.setHeader?.('X-Frame-Options', 'DENY');
        res.setHeader?.('Referrer-Policy', 'no-referrer');
        res.send(readUiHtml());
      },
    },
    {
      name: 'steward-health',
      path: '/api/steward/health',
      type: 'GET',
      public: true,
      handler: async (_req: RouteRequest, res: RouteResponse, runtime: IAgentRuntime) => {
        try {
          const ready = await runtime.isReady();
          res.json({
            status: 'ok',
            service: 'aperture-steward',
            ready,
            uptimeSec: Math.round(process.uptime()),
            startedAtMs: PROCESS_STARTED_AT,
            port: process.env.SERVER_PORT ?? '3000',
            nodeEnv: process.env.NODE_ENV ?? 'development',
          });
        } catch (e) {
          res.status(503).json({
            status: 'degraded',
            error: e instanceof Error ? e.message : 'health check failed',
          });
        }
      },
    },
    {
      name: 'steward-meta',
      path: '/api/steward/meta',
      type: 'GET',
      public: true,
      handler: async (_req: RouteRequest, res: RouteResponse, runtime: IAgentRuntime) => {
        res.json({
          agentName: runtime.character.name,
          attentionBudget: attentionBudget(),
          sovereigntyMode: sovereigntyMode(),
          limits: {
            maxMessageChars: maxMessageChars(),
            chatTimeoutMs: chatTimeoutMs(),
          },
          paths: {
            stewardUi: '/steward',
            chat: '/api/steward/chat',
            artifacts: '/api/steward/artifacts',
            trace: '/api/steward/trace',
          },
        });
      },
    },
    {
      name: 'steward-trace',
      path: '/api/steward/trace',
      type: 'GET',
      public: true,
      handler: async (req: RouteRequest, res: RouteResponse) => {
        try {
          ensureDataDirs();
          const limit = clampInt(req.query?.limit, 1, 200, DEFAULT_TRACE_TAIL);
          const maxBytes = clampInt(req.query?.maxBytes, 4096, 2 * 1024 * 1024, DEFAULT_TRACE_MAX_BYTES);
          const { lines, truncated } = readTraceTailLines(limit, maxBytes);
          res.json({ lines, truncated, limit, maxBytes });
        } catch (e) {
          logger.error({ e }, 'steward trace list failed');
          res.status(500).json({ error: e instanceof Error ? e.message : 'trace failed' });
        }
      },
    },
    {
      name: 'steward-chat',
      path: '/api/steward/chat',
      type: 'POST',
      public: true,
      handler: async (req: RouteRequest, res: RouteResponse, runtime: IAgentRuntime) => {
        try {
          const body = (req.body ?? {}) as { message?: string };
          const text = (body.message ?? '').trim();
          if (!text) {
            res.status(400).json({ error: 'message required' });
            return;
          }
          const maxChars = maxMessageChars();
          if (text.length > maxChars) {
            res.status(413).json({ error: `message exceeds max length (${maxChars} chars)` });
            return;
          }
          const generate = runtime.generateText(text, {
            includeCharacter: true,
          });
          const { text: reply } = await withTimeout(generate, chatTimeoutMs(), 'steward chat');
          res.json({ reply });
        } catch (e) {
          logger.error({ e }, 'steward chat failed');
          const message = e instanceof Error ? e.message : 'chat failed';
          const status = /timed out/i.test(message) ? 504 : 500;
          res.status(status).json({ error: message });
        }
      },
    },
    {
      name: 'steward-artifacts',
      path: '/api/steward/artifacts',
      type: 'GET',
      public: true,
      handler: async (_req: RouteRequest, res: RouteResponse) => {
        try {
          ensureDataDirs();
          const files = readdirSync(ARTIFACTS_DIR).filter((f: string) => f.endsWith('.json'));
          const items = files
            .sort()
            .reverse()
            .slice(0, 40)
            .map((name: string) => {
              try {
                const raw = readFileSync(join(ARTIFACTS_DIR, name), 'utf-8');
                return { name, content: JSON.parse(raw) as unknown };
              } catch (e) {
                return {
                  name,
                  parseError: true,
                  error: e instanceof Error ? e.message : 'read failed',
                };
              }
            });
          res.json({ items });
        } catch (e) {
          logger.warn({ err: e }, 'steward artifacts list failed');
          res.json({ items: [] });
        }
      },
    },
  ],
};

export default apertureStewardPlugin;
