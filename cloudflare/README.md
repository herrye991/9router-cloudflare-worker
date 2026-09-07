# 9Router Cloudflare Worker — Isolated Implementation

This directory contains a **standalone, Cloudflare Workers-compatible** port of 9Router. It is completely isolated from the original 9Router source — no files outside `cloudflare/` were modified.

## Audit Results

### Original Architecture

| Aspect | Original | Cloudflare Port |
|--------|----------|-----------------|
| **Runtime** | Next.js 16 + Express + Node/Bun | Cloudflare Workers (Hono) |
| **Database** | SQLite (better-sqlite3 / bun:sqlite / sql.js) | Cloudflare D1 |
| **Port** | 20127 (dev) / 20128 (prod) | Cloudflare Workers URL |
| **Frontend** | Next.js app (React dashboard) | None (API-only Worker) |
| **API** | Next.js route handlers (`src/app/api/`) | Hono routes |
| **Providers** | 100+ via `open-sse/providers/registry/` | 12 curated OpenAI-compatible |
| **Streaming** | Node/Bun ReadableStream + SSE transform | Web Streams (ReadableStream passthrough) |
| **Auth** | API keys in SQLite `apiKeys` table + settings | API keys in D1 `apiKeys` table + env vars |
| **Fallback** | Connection-level with model locks + backoff | Connection-level with model locks + backoff |

### Original Runtime & Database

- **Runtime**: Next.js 16 (Turbopack) with custom HTTP server (`custom-server.js`).
  Supports both Node.js and Bun (`dev:bun`, `build:bun`, `start:bun`).
- **Database**: SQLite via three adapters — `better-sqlite3` (native), `bun:sqlite` (Bun), `sql.js` (WASM).
- **Schema** (`src/lib/db/schema.js`): Tables: `_meta`, `settings`, `providerConnections`,
  `providerNodes`, `proxyPools`, `apiKeys`, `combos`, `kv`, `usageHistory`, `usageDaily`, `requestDetails`.

### Original API & Providers

- **Endpoints**: `/v1/models` (GET), `/v1/chat/completions` (POST), `/v1/messages` (Claude),
  `/v1/responses` (OpenAI Responses), `/v1/embeddings`, `/v1/images/generations`, etc.
- **Provider Registry** (`open-sse/providers/registry/`): 100+ providers with `id`, `alias`,
  `transport` (baseUrl, format, headers, auth), `models`, `serviceKinds`, OAuth config.
- **Executors** (`open-sse/executors/`): Specialized executors for OAuth providers with token refresh.

### Original Authentication

- API keys in `apiKeys` table (plaintext `key`, `isActive` flag).
- `requireApiKey` setting controls enforcement.
- `extractApiKey()`: checks `Authorization: Bearer` then `x-api-key` header.
- Dashboard auth: JWT + password, optional SAML/OIDC SSO.

### Original Streaming

- SSE via Node/Bun `ReadableStream` + transform streams.
- Format translation between OpenAI, Claude, Gemini, Responses API.
- Stream stall timeout: 360s (inter-chunk), 200s (time-to-first-token).

### Bun/Node-Specific Code (Incompatible with Cloudflare)

| Code | Why Incompatible |
|------|-----------------|
| `bun:sqlite`, `better-sqlite3`, `sql.js` | Local SQLite — replaced by D1 |
| `process.env` | Not in Workers — use `env` bindings |
| `fs`, `path` | No filesystem in Workers |
| `http`, `https`, `net`, `tls` | No raw TCP — use `fetch()` |
| `http-proxy-middleware` | No Express — use Hono |
| `socks-proxy-agent`, `undici` proxy | No outbound proxy in Workers |
| OAuth token refresh services | Complex multi-provider OAuth — API-key only |
| `src/mitm/`, `src/lib/tunnel/`, `src/lib/pxpipe/` | Node/Bun-specific — not applicable |

### Implementation Plan

1. ✅ Audit original repository (no source changes)
2. ✅ Run original app locally (port 20127, verified `/api/health` + `/v1/models`)
3. ⏳ Tunnel (cloudflared not available in this environment)
4. ✅ Worker skeleton (Hono entry point)
5. ✅ D1 migration + repository layer
6. ✅ Provider registry + model lookup
7. ✅ `/v1/models` + `/v1/chat/completions`
8. ✅ Streaming (Web Streams SSE passthrough)
9. ✅ Authentication (API key middleware)
10. ✅ Routing, alias, combo, fallback
11. ✅ Dependency optimization (Hono only)
12. ✅ Typecheck, test, dry-run, bundle size check


### Required Endpoints & Tables

**Endpoints:**
- `GET /` — health/info
- `GET /v1/models` — OpenAI-compatible models list
- `POST /v1/chat/completions` — OpenAI-compatible chat (streaming + non-streaming)

**D1 Tables:** `apiKeys`, `providerConnections`, `combos`, `kv`, `settings`, `_meta`

### Limitations

- **Provider subset**: Only 12 OpenAI-compatible API-key providers. OAuth providers not ported.
- **No format translation**: OpenAI-compatible passthrough only (Anthropic uses native `/v1/messages`).
- **No dashboard**: API-only Worker.
- **No MITM/tunnel/pxpipe**: Node/Bun-specific, not applicable.
- **No usage tracking**: Can be added later.
- **No proxy pools**: Cloudflare handles networking.

## File Structure

```
cloudflare/
├── src/
│   ├── index.ts              # Hono entry point (routes)
│   ├── types.ts              # Shared TypeScript types
│   ├── providers/
│   │   ├── registry.ts       # Static provider definitions (12 providers)
│   │   └── fetcher.ts        # Upstream fetch executor (Web fetch)
│   └── services/
│       ├── repository.ts     # D1 repository layer (prepared statements)
│       ├── model.ts          # Model parsing, alias, combo resolution
│       ├── router.ts         # Core routing, fallback, streaming
│       ├── auth.ts           # API key authentication middleware
│       ├── models.ts         # /v1/models list builder
│       └── errors.ts         # Error classification + OpenAI error format
├── migrations/
│   └── 0001_init.sql         # D1 initial migration
├── tests/
│   └── worker.test.ts        # 13 unit tests (core logic)
├── package.json              # Dependencies: hono, wrangler, typescript
├── tsconfig.json             # TypeScript config (ES2022, strict)
├── wrangler.jsonc            # Worker config (D1 binding, vars)
└── README.md                 # This file
```


## Supported Providers

| Provider | Alias | Auth | Passthrough |
|----------|-------|------|-------------|
| OpenAI | `openai` | Bearer | No |
| Anthropic | `anthropic` | x-api-key | No |
| OpenRouter | `openrouter` | Bearer | Yes |
| DeepSeek | `deepseek` | Bearer | No |
| Groq | `groq` | Bearer | No |
| Fireworks | `fireworks` | Bearer | Yes |
| Together | `together` | Bearer | Yes |
| Mistral | `mistral` | Bearer | No |
| Cerebras | `cerebras` | Bearer | Yes |
| xAI | `xai` | Bearer | No |
| Perplexity | `perplexity` | Bearer | No |
| Cohere | `cohere` | Bearer | No |

## Deployment

```bash
cd cloudflare
npm install

# Create D1 database (copy database_id into wrangler.jsonc)
npx wrangler d1 create 9router-db

# Apply migrations
npx wrangler d1 migrations apply 9router-db --remote

# Typecheck + test
npm run typecheck
npm test

# Dry-run (verify bundle size)
npm run deploy -- --dry-run

# Deploy
npm run deploy
```

## Configuration

Set in `wrangler.jsonc` under `vars`:
- `REQUIRE_API_KEY` — `"true"` to enforce API key auth, `"false"` to allow anonymous
- `ADMIN_API_KEY` — admin key (future use)

## Running the Original App Locally

```bash
# From repository root
npm install
npx next dev --port 20127

# Verify
curl http://localhost:20127/api/health  # → {"ok":true}
curl http://localhost:20127/v1/models   # → {"object":"list","data":[...]}
```

## Tunnel for Inspection

```bash
cloudflared tunnel --url http://localhost:20127
# Use the generated URL to inspect endpoints
```

> **Note**: `cloudflared` was not available in the build environment. The original app was
> verified locally on port 20127 — both `/api/health` and `/v1/models` responded correctly.

## Bundle Size

- **Total Upload**: 112.24 KiB
- **Gzip**: 27.05 KiB
- **Limit**: 3 MB (Cloudflare Workers)
- **Status**: ✅ Far below limit

## Runtime Dependencies

| Dependency | Purpose |
|-----------|---------|
| `hono` | Web framework (routing, middleware) |

No Node.js polyfills, no SQLite, no Express, no Next.js.

