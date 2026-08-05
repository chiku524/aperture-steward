# Aperture Steward — Podcast Cue Card

*Study card · aim ~30–45s per beat · scan left, expand if host digs in*

---

## One-line pitch

**Personal cognitive-load agent:** treat attention as scarce, default-refuse noisy automation, answer as decisions with tradeoffs, keep operator-owned receipts (trace + digests). ElizaOS on Nosana; not a task butler.

**Aperture metaphor:** widen for breadth, stop down for depth — intentional focus control.

---

## Arc map (host flow)

Origin → Load problem → Product → ElizaOS → Nosana → Future of cognitive agents

---

### 1. Into agents — why cognition, not task automation?

- Agents got real; demos optimize **activity** (more tasks/channels).
- Wrong scarce resource. **Working memory is tiny**; switches leave residue; decisions degrade under churn.
- Wanted a **steward**, not a butler: decide/defer, protect depth of thought.

### 2. AI-enhanced full-stack — meaning in practice

- Model in the loop of **judgment**, not only autocomplete.
- AI: explore + draft · Me: stance, architecture, **what we refuse**.
- Own the stack end-to-end: plugin, UI, Vercel front door, Nosana agent + Qwen, correct routes (`/aperture/...`).

### 3. What is cognitive load — why an agent problem?

- Load = pressure on limited working memory (Cognitive Load Theory).
- Productivity tools often **add** load (alerts, more state). Task-only agents can multiply noise.
- Right objective: reduce selection pressure, batch, crystallize decisions, refuse low-signal automation.

### 4. Personal version of the problem

- **[YOUR STORY — 2 sentences]** Stack “worked” on paper; attention failed.
- Half-decisions across tools; easy over-automation; no surface for *what am I committing to?*
- Built a **stance as software**: protect attention, keep decision receipts, run on infrastructure you control.

### 5. How does it know load — what does it do?

- Honest: **no brain sensors**. Operator-declared budget/mode + character policy.
- Default-deny noisy automation; crisp plans; tradeoffs; decide/defer framing.
- **Decision digests** + **sovereignty trace** on disk you own when you log commitments.

### 6. What calendar / task manager can’t do

| Calendar / tasks     | Steward                                      |
| -------------------- | -------------------------------------------- |
| Capture + schedule   | Protect **attention** + **decision quality** |
| More items/reminders | **Refuse** low-signal automation             |
| SaaS history         | **Operator-owned** artifacts                 |

Calendars say *when*. Tasks say *what’s open*. Steward asks *worth your working memory — and what are you committing to?*

### 7. Why ElizaOS — what it gave

- Challenge framework (Nosana × ElizaOS) = the arena.
- Got a real agent runtime: character, plugins, providers, actions, HTTP routes.
- Shipped **stance as code**: aperture plugin + steward UI, not a disposable chat wrapper.

### 8. Eliza constraints / friction

- Their composition: route prefixes (`/aperture/...`), env/model conventions, stock client traps.
- Thin custom stack = faster app; swarm frameworks = more orchestration (fights “less surface”).
- Constraint fitted the mission: one deliberate agent.

### 9. Docs didn’t prepare me for…

1. Routes under plugin id — judges need `/aperture/steward` + health.
2. `OPENAI_BASE_URL` → Nosana `…/v1`; wrong base = fake “bad key: nosana”.
3. Model IDs must exist on host (Qwen, not default gpt-4o).
4. Vercel = bridge only (`AGENT_BASE_URL`); models live on the agent.

### 10. Nosana challenge — what I built

- Personal AI on ElizaOS + Nosana compute; OpenClaw-adjacent ownership theme.
- Aperture Steward: cognitive load, digests/trace, steward UI, persistent volume, Qwen inference/embeddings, optional Vercel public door.
- Narrow on purpose: clarity > engagement.

### 11. Design differently next time

- Light **operator signals** for load (still honest, not pretend EEGs).
- One unmissable demo loop: decide → digest → artifacts/trace.
- Align UI chat with full tool/action path.
- UX for cold starts / decentralized latency.
- Stay narrow; sovereignty + judgment over integrations.

### 12. Close — if cognitive agents get good?

- Work optimizes **decision quality**, not busyness.
- Offload noise; keep high-stakes choice; trusted **owned** external memory.
- Saying no becomes legible. Depth when it matters; batch the rest.
- **An aperture you control** — not a feed that controls you.

---

## Science pocket (one breath)

Working memory is small → interruptions leave residue → micro-decisions tax judgment → tools that maximize activity raise load. Offload **commitments** to inspectable, owned records; refuse automation that burns attention without leverage.

## Demo (if asked · ~60s)

Open `/aperture/steward` → decide/defer prompt → “record a decision digest…” → show artifacts + trace → flash health.

## Phrases to land

- “Attention as a finite resource.”
- “Default-refuse noisy automation.”
- “Clarity, not engagement.”
- “Stance as code you can fork, deploy, and own.”
- “Protect depth of thought, keep receipts, ship judgment.”

## Guardrails

- Don’t claim biometric load **detection** — policy + declaration.
- Eliza: challenge first, then value, then hard-won deploy truth.
- Personal beat: insert your real week — only empty slot.
- Avoid hustle-bro / moralizing; short paragraphs; lead with the answer.

---

*Repo: github.com/chiku524/aperture-steward · Print: 2 pages max · Study out loud once through.*
