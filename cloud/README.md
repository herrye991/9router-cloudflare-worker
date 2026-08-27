# 9router-cloud — Cloudflare Worker + D1

The optional Cloudflare companion for 9Router. It provides:

- **Cloud Sync backend** — stores each machine's 9Router state (provider
  connections, API keys, model aliases, combos, settings) in **Cloudflare D1**, behind
  the app's `CLOUD_URL`. This is the piece that makes "sync config across devices" work.
- **(Opt-in) Edge LLM proxy** — an OpenAI-compatible `/v1/embeddings` endpoint that
  reuses the [`open-sse`](../open-sse) engine and the machine's D1-stored credentials,
  with multi-account fallback and rate-limit backoff. More modalities can follow the
  same pattern.

The worker talks to **D1** (Cloudflare's serverless SQLite) via the `DB` binding.

## Layout

```
cloud/
├── src/
│   ├── index.js            # default entry — dependency-light (health + sync + auth)
│   ├── index.edge.js       # opt-in edge gateway (adds /v1/embeddings via open-sse)
│   ├── router.js           # shared route table
│   ├── handlers/
│   │   ├── health.js       # GET /health (D1 ping)
│   │   ├── sync.js         # GET|PUT|DELETE /sync/{machineId}
│   │   └── embeddings.js   # POST [/…/]v1/embeddings (edge build only)
│   ├── services/
│   │   ├── d1.js           # async wrapper over env.DB (first/all/run/batch)
│   │   └── storage.js      # getMachineData / saveMachineData / api-keys index
│   └── utils/
│       ├── apiKey.js       # sk-{machineId}-{keyId}-{crc8} auth (Web Crypto HMAC)
│       ├── cors.js         # CORS preflight + header wrapper
│       ├── logger.js
│       └── respond.js      # dependency-light JSON responders
├── migrations/0001_initial.sql   # D1 schema (managed)
├── schema.sql                    # same schema, for one-shot/manual apply
├── shims/empty.js                # stub for non-edge Node builtins (edge build)
├── build.mjs                     # esbuild bundle for the edge entry
├── wrangler.toml                 # default worker config (D1 binding + migrations)
└── wrangler.edge.toml            # edge gateway config (build step + D1 binding)
```

## Prerequisites

- A Cloudflare account with the **Workers** and **D1** products enabled.
- [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) (installed via
  `npm install` in this directory) and logged in: `npx wrangler login`.

## Quick start (default worker — sync + health)

```bash
cd cloud
npm install

# 1. Create the D1 database, then paste the printed database_id into wrangler.toml
npm run db:create

# 2. Apply the schema
npm run db:migrate            # remote
# npm run db:migrate:local    # against the local dev DB

# 3. Set the shared secret (MUST match the app's API_KEY_SECRET)
npx wrangler secret put API_KEY_SECRET
#    (for local dev, `cp .dev.vars.example .dev.vars` and edit it)

# 4. Run locally / deploy
npm run dev
npm run deploy
```

Verify:

```bash
curl https://<your-worker>.workers.dev/health
# → {"status":"ok","service":"9router-cloud","db":"ok", ...}
```

Then point the app at it: set `CLOUD_URL=https://<your-worker>.workers.dev` in the
9Router `.env` (or Dashboard → Settings → Cloud Sync).

## Edge gateway (optional — adds the LLM proxy)

The default worker is intentionally dependency-light so it always deploys. The
`/v1/embeddings` route reuses the `open-sse` engine, whose executor registry eagerly
imports a few Node-only builtins/packages that are never exercised at the edge. To
bundle it, run the hardened build (stubs those imports — see `build.mjs`):

```bash
cd cloud
npm run deploy:edge     # node build.mjs && wrangler deploy --config wrangler.edge.toml
```

This deploys a **separate** worker (`9router-cloud-edge`). Fetch-based providers work
at the edge; providers that shell out (`devin-cli`) or need TLS fingerprinting are
stubbed off and won't run there.

> The `embeddings.js` handler is covered by `tests/unit/embeddings.cloud.test.js`
> (the test mocks D1 + open-sse, so it runs without the Workers runtime). The test
> imports the handler file directly — it does not require the edge build.

## Authentication

Requests use the same API keys as the app: `sk-{machineId}-{keyId}-{crc8}`.
`API_KEY_SECRET` must match the app's so dashboard-generated keys validate at the edge.
Legacy keys (`sk-{random8}`, no embedded machineId) must call the
`/{machineId}/v1/...` URL path so the machine can be resolved.

## Data model (D1)

| Table       | Purpose                                                        |
| ----------- | -------------------------------------------------------------- |
| `machines`  | `machine_id` → JSON blob of full machine state                 |
| `api_keys`  | normalized index of API keys (fast lookup / revocation)        |
| `sync_meta` | per-machine sync `version` counter + `updated_at`              |

Schema changes: add a new file under `migrations/` and run `npm run db:migrate`.

## Notes & limits

- Secrets are never written to `wrangler.toml` — use `wrangler secret put` / `.dev.vars`.
- `usage`/`logs` stay on the app's local `~/.9router` store; the worker stores config,
  not request logs.
- D1 has no multi-statement client transactions; multi-write operations use
  `env.DB.batch()` (atomic) in `services/storage.js`.
