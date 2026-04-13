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
import { mkdirSync, appendFileSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ARTIFACTS_DIR = join(process.cwd(), 'data', 'artifacts');
const TRACE_PATH = join(process.cwd(), 'data', 'sovereignty-trace.ndjson');

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

const stewardProvider: Provider = {
  name: 'APERTURE_CONTEXT',
  description:
    'Injects the operator attention budget, sovereignty mode, and recent on-disk artifacts into agent state.',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined
  ): Promise<ProviderResult> => {
    const budget = process.env.ATTENTION_BUDGET_LEVEL ?? 'normal';
    const mode = process.env.SOVEREIGNTY_MODE ?? 'strict';
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
          logger.debug({ err: e }, 'steward trace append skipped');
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
        res.send(readUiHtml());
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
          const { text: reply } = await runtime.generateText(text, {
            includeCharacter: true,
          });
          res.json({ reply });
        } catch (e) {
          logger.error({ e }, 'steward chat failed');
          res.status(500).json({ error: e instanceof Error ? e.message : 'chat failed' });
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
            .map((name: string) => ({
              name,
              content: JSON.parse(readFileSync(join(ARTIFACTS_DIR, name), 'utf-8')) as unknown,
            }));
          res.json({ items });
        } catch {
          res.json({ items: [] });
        }
      },
    },
  ],
};

export default apertureStewardPlugin;
