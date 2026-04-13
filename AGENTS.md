## Learned User Preferences

- When doing explicit stage-list-and-push requests, keep the commit message concise and limit the commit to the listed paths only.
- Prioritizes hackathon-readiness work weighted toward ElizaOS quality, Nosana integration, UX, and clear setup documentation.

## Learned Workspace Facts

- ElizaOS registers this project’s plugin HTTP routes under **`/aperture`** (plugin id `aperture`). Judges and `pnpm run verify:deploy` use **`GET /aperture/steward`** (HTML) and **`GET /aperture/api/steward/health`** (JSON). The default **`/steward`** path may show the stock Eliza client, not the steward UI.
- **`OPENAI_*` and embedding env vars apply to the Eliza process (Nosana job env or local `.env`), not Vercel.** Vercel only bridges HTTP via **`AGENT_BASE_URL`**. **`@elizaos/plugin-openai` uses `OPENAI_BASE_URL` for chat** (not `OPENAI_API_URL`). For Nosana inference set **`OPENAI_API_KEY=nosana`** and **`OPENAI_BASE_URL`** to the Nosana OpenAI-compatible URL ending in **`/v1`** (see **`nos_job_def/nosana_eliza_job_definition.json`**). If **`OPENAI_BASE_URL`** is unset, the plugin defaults to **api.openai.com**, which surfaces misleading “Incorrect API key provided: nosana” errors. Embeddings still use **`OPENAI_EMBEDDING_URL`** / **`OPENAI_EMBEDDING_API_KEY`**.
- The repository is set up for Nosana-hosted agent workloads and Vercel for the public web UI from the same GitHub repo. **`vercel.json` must not set `outputDirectory` to `public`**, or Vercel will not deploy **`/api/*`** serverless routes (bridge returns NOT_FOUND). **`buildCommand`** copies `public/index.html` and `public/steward.html` to the deployment root; rewrites map **`/`** → **`/index.html`**, **`/aperture/steward`** → **`/steward.html`**, and **`/aperture/api/(.*)`** → **`/api/proxy?p=api/$1`** (flat **`api/proxy.js`**) using **`AGENT_BASE_URL`**; **`Cache-Control: no-store`** applies to **`/aperture/api/*`**.
