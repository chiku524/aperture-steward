# Nosana × ElizaOS — submission helpers

Copy the sections below into the hackathon form, X/Twitter, LinkedIn, or your README fork.

---

## Project description (≤300 words — paste into form)

Most personal assistants optimize for activity: more notifications, more channels, and automation that is easy to trigger but hard to unwind. Aperture Steward is built for the opposite problem: cognitive load and data sovereignty. It treats your attention as a finite resource, default-refuses noisy patterns such as blasting the same message across every social network without context, and answers in tight, decision-oriented form with explicit tradeoffs instead of endless reactive churn.

Technically, Aperture Steward is an ElizaOS v2 agent with a small custom plugin. Inference and embeddings use Nosana-hosted Qwen endpoints from the challenge, so the heavy model work runs on decentralized infrastructure rather than a proprietary SaaS loop. A first-party steward UI at /steward talks to POST /api/steward/chat; the agent also maintains an operator-owned audit trail on disk (sovereignty-trace.ndjson for inbound previews and data/artifacts/decision-*.json when you ask to record a digest) so what you committed to stays exportable and legible.

For the challenge, the repo includes a Nosana job definition with a container/create-volume step and a volume mounted at /app/data, so SQLite and steward files can survive restarts on the network. For judges and friends who do not run Docker locally, the same repository deploys a Vercel landing page (public/index.html) plus a tiny serverless bridge that forwards /api/steward/* to your live job using the AGENT_BASE_URL environment variable, so one public URL can present the product story while the agent still runs where it belongs: on Nosana.

Aperture Steward is deliberately narrow: it is not trying to be every integration at once. It is a stance (protect depth of thought, keep receipts, ship judgment) expressed as working code you can fork, deploy, and own.

_(About 277 words.)_

---

## Live Nosana URL — how to verify

1. Deploy the container job from `nos_job_def/nosana_eliza_job_definition.json` and copy the HTTPS origin Nosana gives you (no path).
2. In a browser (or curl), open:
   - `https://YOUR_ORIGIN/steward` — steward UI
   - `https://YOUR_ORIGIN/api/steward/health` — JSON with `status`, `ready`, `uptimeSec`
3. For Vercel: set `AGENT_BASE_URL=https://YOUR_ORIGIN` (no trailing slash), redeploy, then verify the same paths on your `.vercel.app` domain (the bridge proxies to Nosana).

---

## Social post (X / Bluesky / LinkedIn — edit placeholders)

**Short (X):**

> I shipped Aperture Steward for the Nosana × ElizaOS agent challenge — a personal cognitive-load steward on Qwen + ElizaOS, with a sovereign on-disk trace and /steward UI. Repo: https://github.com/chiku524/aperture-steward — Live: YOUR_VERCEL_OR_NOSANA_URL — #Nosana #ElizaOS

**Thread hook (optional 2/2):**

> Model + artifacts run on Nosana (/app/data volume). Marketing + API bridge on Vercel via AGENT_BASE_URL. Judges: /steward and /api/steward/health.

**LinkedIn (slightly longer):**

> I published Aperture Steward, my entry for the Nosana × ElizaOS personal agent challenge. It is an ElizaOS agent that optimizes for attention and operator-owned records (trace + decision JSON), uses Nosana-hosted Qwen for inference and embeddings, and ships a steward web UI. Source: https://github.com/chiku524/aperture-steward — try it live: YOUR_VERCEL_OR_NOSANA_URL

Replace YOUR_VERCEL_OR_NOSANA_URL with your real deployment (Vercel is recommended for the public page plus bridge; the Nosana URL is the upstream agent origin).
