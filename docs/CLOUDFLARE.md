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

`.github/workflows/cloudflare-worker.yml` validates and deploys the Cloudflare
deployables on push to `main`/`master` (when relevant source changes) or via manual
dispatch. The `build-app` job runs `npm run build:cf` as a gate — it fails the CI if
the OpenNext bundle can't be produced (e.g. a new Node-only import that esbuild
can't resolve). The `test` job (which needs `build-app`) runs the cloud worker
contract tests, and the `deploy` job (which needs `test`) deploys the `cloud/`
companion worker via `cloudflare/wrangler-action@v3`:

1. `npm install`
2. `npm run build:cf` (OpenNext build → `.open-next/`) — **gate**
3. cloud worker contract tests
4. `cloudflare/wrangler-action@v3` `deploy` + maps the companion worker secrets.

**`deploy-app`** (needs `build-app`, non-PR only) deploys the **full app**
(`9router-app`) to its own workers.dev subdomain:

1. `npm install`
2. `npm run deploy:cf` — `opennextjs-cloudflare deploy` (build + bundle +
   `wrangler deploy` of the root `wrangler.toml` → `9router-app`)
3. sets the app runtime secrets (`JWT_SECRET`, `INITIAL_PASSWORD`,
   `API_KEY_SECRET`, `MACHINE_ID_SALT`) on `9router-app`.

> ⚠️ `9router-app` and `9router-cloud` are **separate workers with separate
> `*.workers.dev` subdomains**. The login page/dashboard live on
> `https://9router-app.<account-subdomain>.workers.dev`. The
> `9router-cloud.<account-subdomain>.workers.dev` subdomain only serves the JSON
> health/sync/embeddings API (it has no dashboard) — seeing that JSON at the
> `9router-cloud` URL is expected, not a bug.

Repo setup (**Settings → Secrets and variables → Actions**):

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Workers edit token |
| `CLOUDFLARE_ACCOUNT_ID` | account ID |
| `JWT_SECRET`, `INITIAL_PASSWORD`, `API_KEY_SECRET`, `MACHINE_ID_SALT` | app runtime secrets (used by `deploy-app`) |

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

### `Could not resolve "bun:sqlite"` (and `node:sqlite` / `better-sqlite3`)

This is a special case that the `next.config.mjs` alias **cannot** fix on its own.
Next.js hard-codes every `bun:*` module as a webpack "external" for the Node.js server
build (`next/dist/build/handle-externals.js`: `request.startsWith("bun:")`), and
`node:sqlite` / `better-sqlite3` are externals too. Webpack therefore emits stub
modules `a.exports=require("bun:sqlite")` that survive into the compiled
`middleware.js` and page chunks. Webpack evaluates `externals` *before*
`resolve.alias`, so the alias in `next.config.mjs` never replaces the import.

When OpenNext then re-bundles those files with **esbuild** (a separate step from the
webpack build), esbuild cannot resolve `bun:sqlite` (a Bun-only built-in) and the
build fails:

```
✘ [ERROR] Could not resolve "bun:sqlite"
```

The fix is `scripts/patch-cf-externals.mjs`, wired in via the `buildCommand` in
`open-next.config.ts`. It runs right after `next build` (and before OpenNext copies
the traced files) and rewrites the `require("bun:sqlite")` /
`require("node:sqlite")` / `require("better-sqlite3")` stubs in every compiled
server chunk to a throwing getter, so esbuild no longer needs to resolve them. At
runtime the app's DB driver (`src/lib/db/driver.js`) already wraps these imports in
try/catch and falls back to `sql.js`, so the throw is never reached in practice.

If a **new** Node-only import surfaces in the esbuild step (not one of the three
SQLite modules above), add it to `EXTERNAL_MODULES` in
`scripts/patch-cf-externals.mjs` *and* to the alias map in `next.config.mjs`.

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
| `open-next.config.ts` | OpenNext Cloudflare config (sets `buildCommand` to run the patch script after `next build`) |
| `wrangler.toml` (root) | app worker definition (`.open-next/worker.js`, assets, nodejs_compat, D1 reserved) |
| `open-next/shims/node-stub.js` | stubs for Node-only modules during the CF build (webpack alias layer) |
| `scripts/patch-cf-externals.mjs` | post-`next build` patch: rewrites `require("bun:sqlite")` / `require("node:sqlite")` / `require("better-sqlite3")` webpack external stubs to throwing getters so OpenNext's esbuild bundle resolves (see Troubleshooting) |
| `next.config.mjs` (`CF_WORKER_BUILD` branch) | drops `standalone`, adjusts externals, adds the stub aliases |
| `package.json` | `@opennextjs/cloudflare` + `wrangler` devDeps, `build:cf`/`preview:cf`/`deploy:cf` scripts, `next` floor ≥ 16.3.3 |
| `.github/workflows/cloudflare-worker.yml` | build + validate + deploy CI (`build-app` job runs `npm run build:cf` as a gate) |
