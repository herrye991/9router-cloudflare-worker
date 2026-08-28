// OpenNext configuration for deploying the full 9Router Next.js app to Cloudflare
// Workers via @opennextjs/cloudflare. See docs/CLOUDFLARE.md for the runbook and the
// (significant) list of features that are degraded/unavailable at the edge.
//
// NOTE: 9Router is a local-first routing gateway. Many server features depend on
// Node-only capabilities (child_process for tunnels/MITM/CLI tools, fs for local
// config + OAuth import, node-machine-id, native SQLite). Those are stubbed for the
// edge build and will throw if invoked at runtime. App state is ephemeral at the edge
// unless the DB layer is wired to D1 (a follow-up — the repo layer is synchronous
// today, D1 is async-only).

import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig({
  // Default (no-op) config. Optional Cloudflare-native caching for ISR/SSR can be
  // enabled later — 9Router is mostly dynamic, so these are intentionally left off:
  //
  // import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
  // incrementalCache: r2IncrementalCache,
  //
  // enableCacheInterception: true,
});

// ── buildCommand ─────────────────────────────────────────────────────────
// OpenNext runs `buildCommand` (instead of the default `npm run build`) to
// produce the Next.js build, then copies the traced files and re-bundles
// them with esbuild for the Workers runtime.
//
// Next.js hard-codes `bun:sqlite` (and every `bun:*` module) as a webpack
// "external" for the Node.js server bundle — see
// `next/dist/build/handle-externals.js` (`request.startsWith("bun:")`).
// `node:sqlite` and `better-sqlite3` are externals too. Webpack therefore
// emits stub modules `a.exports=require("bun:sqlite")` that survive into
// the compiled middleware.js and page chunks. When OpenNext re-bundles
// those files with esbuild, esbuild cannot resolve `bun:sqlite` (a
// Bun-only built-in) and the build fails:
//
//     ✘ [ERROR] Could not resolve "bun:sqlite"
//
// The `resolve.alias` in next.config.mjs (which maps these to
// open-next/shims/node-stub.js) does NOT help: webpack evaluates
// `externals` before `resolve.alias`, so the alias never replaces the
// import. There is no Next.js / OpenNext config option to add an esbuild
// alias or plugin for the middleware/server re-bundle either.
//
// The fix runs `scripts/patch-cf-externals.mjs` right after `next build`
// (and before OpenNext copies the traced files): it rewrites the
// `require("bun:sqlite")` / `require("node:sqlite")` /
// `require("better-sqlite3")` stubs in every compiled server chunk to a
// throwing getter, so esbuild no longer needs to resolve them. At
// runtime the app's DB driver already wraps these in try/catch and
// falls back to sql.js, so the throw is never reached in practice.
//
// `CF_WORKER_BUILD=true` is set by the `build:cf`/`preview:cf`/`deploy:cf`
// npm scripts and is inherited by this subprocess; it switches
// next.config.mjs to the edge build profile (webpack aliases for
// Node-only modules, `serverExternalPackages: []`, no `output: standalone`
// — OpenNext forces standalone via `NEXT_PRIVATE_STANDALONE` regardless).
config.buildCommand = "npm run build && node scripts/patch-cf-externals.mjs";

export default config;
