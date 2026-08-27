# Deploying 9Router to Cloudflare

There are **two separate Cloudflare deployables** in this repo. They are independent
and solve different problems.

| Deployable | Path / config | What it serves | Status |
| --- | --- | --- | --- |
| **Companion worker** | `cloud/` → `cloud/wrangler.toml` | `/health`, `/sync/{machineId}`, `/v1/embeddings` (cloud-sync + edge proxy). **No dashboard.** | Lightweight, deploys cleanly |
| **Full app (dashboard + API)** | repo root → `wrangler.toml` (OpenNext) | The whole Next.js app incl. `/dashboard` | **Degraded** — see below |

> **Read this first.** 9Router is a *local-first* routing gateway. Its server features
> lean on Node-only capabilities that have **no equivalent in the Cloudflare Workers
> sandbox**. Deploying the full app to Workers therefore produces a **degraded** app.
> The **Node/Docker deployment is the full-featured, supported path** — deploy the app
> to Workers only if you accept the limitations below.

## Prerequisites

- Cloudflare account with **Workers** enabled.
- `npm install` (installs `@opennextjs/cloudflare` + `wrangler`, added to `devDependencies`).
- `wrangler login` (or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).
- **Next.js ≥ 16.3.3** — `@opennextjs/cloudflare` requires it, so the `next` floor in
  `package.json` was raised to `^16.3.3`. (The repo has no committed lockfile, so a fresh
  install already resolves to ≥ 16.3.3.)

## Quick start — full app on Workers (OpenNext)

```bash
npm install

# Build the worker bundle (.open-next/) — sets CF_WORKER_BUILD=true, which drops the
# Node "standalone" output and stubs Node-only deps via open-next/shims/node-stub.js.
npm run build:cf

# Preview locally in workerd (no deploy):
npm run preview:cf

# Deploy:
npm run deploy:cf
```

Then open `https://9router-app.<your-subdomain>.workers.dev/dashboard`.

Set the app's secrets (matches `.env.example`):

```bash
wrangler secret put JWT_SECRET
wrangler secret put INITIAL_PASSWORD
wrangler secret put API_KEY_SECRET
wrangler secret put MACHINE_ID_SALT
```

> On Windows, the `*:cf` scripts set `CF_WORKER_BUILD` inline (POSIX). Use WSL, or install
> `cross-env` and prefix the scripts with it.

## What breaks at the edge (degraded features)

These modules are stubbed during the CF build (`open-next/shims/node-stub.js`) or rely
on Node APIs that Workers doesn't provide. Invoking them returns/throws a clear error.

| Feature | Why it breaks |
| --- | --- |
| **Persistent state (settings, connections, keys)** | DB drivers are native/`node:sqlite`/`sql.js`-wasm. Stubbed/fail at the edge → **state is ephemeral** unless wired to D1 (see below). |
| **Cloudflare/Tailscale tunnels** | spawn `cloudflared`/`tailscale` via `child_process`. |
| **MITM proxy** (`src/mitm`) | raw sockets + `child_process` + cert files on disk. |
| **CLI-tool auto-config** (`/api/cli-tools/*`) | reads/writes local CLI config files (`fs`) and spawns processes. |
| **OAuth local auto-import** (e.g. Cursor) | reads local app databases via `fs`. |
| **Machine ID** | `node-machine-id` is native. |
| **Outbound proxy agents** | `undici`/`socks-proxy-agent` assume Node sockets. |
| **`custom-server.js` IP hardening** | not used by OpenNext; use Cloudflare's `CF-Connecting-IP` instead. |

The chat/LLM API (`/v1/*`) routes through `open-sse`, whose per-request logging uses
`@/lib/usageDb` (fs-based) — expect request-logging to no-op/fail at the edge.

## Persisting state with D1 (follow-up)

The app's DB layer (`src/lib/db/driver.js`) is **synchronous** (`db.get/all/run` return
values directly). Cloudflare **D1 is async-only**, so it can't drop into that chain
without converting the repo layer (`src/lib/db/repos/*`) and its callers to async. That's
the real follow-up if you want durable state at the edge. The `cloud/` worker already has
a D1 schema + storage layer you can reuse. The root `wrangler.toml` has a commented
`[[d1_databases]]` block ready.

## CI/CD

`.github/workflows/cloudflare-app.yml` builds + deploys the app worker on push to
`main`/`master` (when app source changes) or via manual dispatch:

1. `npm install`
2. `npm run build:cf` (OpenNext build → `.open-next/`)
3. `cloudflare/wrangler-action@v3` `deploy` + maps the app secrets.

Repo setup (**Settings → Secrets and variables → Actions**):

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Workers edit token |
| `CLOUDFLARE_ACCOUNT_ID` | account ID |
| `JWT_SECRET`, `INITIAL_PASSWORD`, `API_KEY_SECRET`, `MACHINE_ID_SALT` | app runtime secrets |

> Note: adding/editing files under `.github/workflows/` via Git requires the token to
> have the **workflows** permission. If `git push` is rejected for the workflow file,
> add it through the GitHub web UI instead (it bypasses that restriction).

## Troubleshooting the edge build

The first real `npm run build:cf` may surface app-specific Node-only imports that still
need stubbing. When it does:

1. Read the esbuild/webpack error — it names the module that can't resolve for the edge.
2. Add that module to the alias map in `next.config.mjs` (the `isCfBuild` block) and add a
   matching throwing export in `open-next/shims/node-stub.js`.
3. Rebuild.

If Next itself fails to compile under OpenNext, check `@opennextjs/cloudflare` release
notes for Next 16.x support and pin `next` accordingly.

## Recommendation

For a **fully working** 9Router (tunnels, MITM, CLI auto-config, persistent state), use
the **Docker / Node** deployment (`Dockerfile`, `docker-publish.yml`, or
`npm run build && npm run start`). Use the Workers deployment only for a lightweight,
always-on dashboard/API where the degraded feature set is acceptable.

## Files added for the app worker

| File | Purpose |
| --- | --- |
| `open-next.config.ts` | OpenNext Cloudflare config |
| `wrangler.toml` (root) | app worker definition (`.open-next/worker.js`, assets, nodejs_compat, D1 reserved) |
| `open-next/shims/node-stub.js` | stubs for Node-only modules during the CF build |
| `next.config.mjs` (`CF_WORKER_BUILD` branch) | drops `standalone`, adjusts externals, adds the stub aliases |
| `package.json` | `@opennextjs/cloudflare` + `wrangler` devDeps, `build:cf`/`preview:cf`/`deploy:cf` scripts, `next` floor ≥ 16.3.3 |
| `.github/workflows/cloudflare-app.yml` | build + deploy CI |
