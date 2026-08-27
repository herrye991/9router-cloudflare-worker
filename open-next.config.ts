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

export default defineCloudflareConfig({
  // Default (no-op) config. Optional Cloudflare-native caching for ISR/SSR can be
  // enabled later — 9Router is mostly dynamic, so these are intentionally left off:
  //
  // import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
  // incrementalCache: r2IncrementalCache,
  //
  // enableCacheInterception: true,
});
