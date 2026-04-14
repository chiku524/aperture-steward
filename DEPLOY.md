# Aperture Steward — deploy and verify

**Official project name:** **Aperture Steward**  
**One-line pitch:** A personal cognitive-load agent on ElizaOS — sovereign trace, decision artifacts, steward UI at **`/aperture/steward`**, Nosana inference.

Technical package name (npm / Docker): `aperture-steward-agent`.

---

## 1. Build and push the container

Replace `YOURUSER` with your Docker Hub username (public repository).

```bash
pnpm install
pnpm build
docker build -t YOURUSER/aperture-steward-agent:latest .
docker run --rm -p 3000:3000 --env-file .env YOURUSER/aperture-steward-agent:latest
# Local: http://localhost:3000/aperture/steward and http://localhost:3000/aperture/api/steward/health

docker login
docker push YOURUSER/aperture-steward-agent:latest
```

---

## 2. Nosana (dashboard)

Create a **new** deployment (do not reuse a Jupyter / PyTorch-only job).

1. Open the Nosana deploy UI and paste a job definition that runs **your** image with **`expose`: 3000** and the env block from [`nos_job_def/nosana_eliza_job_definition.json`](./nos_job_def/nosana_eliza_job_definition.json) (after changing `image` to `docker.io/YOURUSER/aperture-steward-agent:latest`).
2. If the UI does not support `container/create-volume`, use a **single** `container/run` op and omit `volumes` (see README “Step 2” fallback note).
3. Wait for a public **HTTPS origin** (ends with something like `.node.k8s.prd.nos.ci`).

---

## 3. Verify the live agent

From your machine (no secrets):

```bash
pnpm run verify:deploy https://YOUR_JOB_ORIGIN.node.k8s.prd.nos.ci
```

Or:

```bash
set BASE_URL=https://YOUR_ORIGIN
pnpm run verify:deploy
```

You want **`/aperture/api/steward/health`** → JSON with `"status":"ok"` (or `"degraded"` with details) and **`/aperture/steward`** → HTML 200.

---

## 3b. Scripted `.env` + optional Vercel push (optional)

From the repo root:

```bash
pnpm run setup:creds
```

The wizard merges answers into **`.env`** (gitignored), can run **`pnpm run verify:deploy`** against your Nosana URL, **`pnpm run nosana:deployments list`** if you enter `NOSANA_API_KEY`, and optionally **upserts `AGENT_BASE_URL` / `REPO_URL` on Vercel** using a **`VERCEL_TOKEN`** and **`VERCEL_PROJECT_ID`** (see [Vercel token docs](https://vercel.com/docs/rest-api#authentication)). Use **`pnpm run setup:creds -- --dry-run`** to preview without writing. Never commit secrets.

---

## 4. Vercel (optional front door)

1. Connect this GitHub repo to Vercel (root of repo).
2. **Environment variables:** `AGENT_BASE_URL` = the same Nosana origin (no trailing slash). Optional: `REPO_URL` for the landing GitHub link.
3. **Do not** set `vercel.json` → `outputDirectory` to `public` alone — that deploys static files only and **`/api/*` (the Nosana bridge) returns 404**. This repo’s `vercel.json` runs a short **`buildCommand`** that copies `public/index.html` and `public/steward.html` to the deployment root (so `/` and `/aperture/steward` rewrites resolve); the Nosana bridge is **`api/proxy.js`** (`/api/proxy?p=…`).
4. Redeploy, then open your `.vercel.app` and repeat the checks (paths under **`/aperture/*`** rewrite to the Nosana proxy).

---

## 5. Hackathon submission

- Copy description and social text from [`HACKATHON_SUBMISSION.md`](./HACKATHON_SUBMISSION.md).
- Submit the **Nosana** URL (required) and, if you use it, your **Vercel** URL as the friendly entry point.
- Record **&lt;1 min** demo: landing or **`/aperture/steward`** → chat → “record a decision digest …” → artifacts → health.

---

## Common mistakes

| Mistake | Fix |
|--------|-----|
| Jupyter / port **8888** | Agent must **expose 3000** and run the Eliza image, not `pytorch-jupyter`. |
| Checking **`/steward`** or **`/api/steward/health`** | ElizaOS mounts this plugin under **`/aperture`** — use **`/aperture/steward`** and **`/aperture/api/steward/health`**. |
| Image is private | Docker Hub repo must be **public** so Nosana can pull. |
| `yourusername/...` still in JSON | Replace with your real Docker Hub name before deploy. |
| “Incorrect API key provided: nosana” | Eliza **`@elizaos/plugin-openai` uses `OPENAI_BASE_URL`** for chat (not `OPENAI_API_URL`). Set **`OPENAI_BASE_URL`** to the Nosana **`…/v1`** URL and **`OPENAI_API_KEY=nosana`** on the **agent** (Nosana env or `.env`), then restart. |
| Vercel **`AGENT_BASE_URL`** set to the **Qwen inference** host (`…/v1`) | **`AGENT_BASE_URL` must be the Nosana deployment HTTPS origin** for port 3000 (from the deployment’s **`endpoints[].url`**, no `/v1` path). Inference URLs belong only in **`OPENAI_BASE_URL`** on the **agent**, not in Vercel. |
| Steward chat **500** / *“Failed after 3 attempts… Service Unavailable”* | The **Qwen inference URL** (`OPENAI_BASE_URL` …`/v1`) returned **503** (often **cold start**: HTML “Service Initializing”, header `X-Frp-Service-State: loading`). Wait and retry, or probe with `curl -X POST "$OPENAI_BASE_URL/chat/completions"`; ask Nosana if the endpoint rotated. Not a Vercel bug if **`/aperture/api/steward/health`** already returns JSON. |
| *The model `gpt-4o` does not exist* (or similar) from the inference host | **`@elizaos/plugin-openai`** uses **`OPENAI_LARGE_MODEL` / `OPENAI_SMALL_MODEL`** (defaults **`gpt-4o`** / **`gpt-4o-mini`**). Set them to the id from **`GET $OPENAI_BASE_URL/models`**, same as **`MODEL_NAME`**, and restart the agent. The baked character also sets **`settings.LARGE_MODEL` / `SMALL_MODEL`**. |
| Vercel steward **502** / *upstream_returned_html* / *AGENT_BASE_URL reached … HTML* | **`AGENT_BASE_URL`** must be the **agent** HTTPS origin (port **3000**), **no `/v1` path**. Run **`curl -sS "$ORIGIN/aperture/api/steward/health"`** against that origin; you want JSON mentioning **`aperture-steward-plugin`**. If you see HTML, the URL is wrong, the container is not this repo’s image, or the agent is not up yet. Do **not** use the Qwen **`…/v1`** inference URL here (the proxy now rejects values whose path ends in **`/v1`**). |
