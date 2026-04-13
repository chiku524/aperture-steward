## Learned User Preferences

- When doing explicit stage-list-and-push requests, keep the commit message concise and limit the commit to the listed paths only.
- Prioritizes hackathon-readiness work weighted toward ElizaOS quality, Nosana integration, UX, and clear setup documentation.

## Learned Workspace Facts

- ElizaOS registers this project’s plugin HTTP routes under **`/aperture`** (plugin id `aperture`). Judges and `pnpm run verify:deploy` use **`GET /aperture/steward`** (HTML) and **`GET /aperture/api/steward/health`** (JSON). The default **`/steward`** path may show the stock Eliza client, not the steward UI.
- The repository is set up for Nosana-hosted agent workloads and Vercel for the public web UI from the same GitHub repo. **`vercel.json` must not set `outputDirectory` to `public`**, or Vercel will not deploy **`/api/*`** serverless routes (bridge returns NOT_FOUND). Rewrites map **`/`** → **`/public/index.html`**, **`/aperture/steward`** → **`/public/steward.html`**, and **`/aperture/:path*`** → **`/api/nosana-proxy`** using **`AGENT_BASE_URL`**.
