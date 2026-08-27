// Hardened esbuild bundle for the FULL edge gateway (src/index.edge.js), which reuses
// the open-sse engine. The open-sse executor registry eagerly imports some Node-only
// builtins/packages that are never exercised at the edge; we stub or externalize them
// so the bundle builds. The dependency-light default worker (src/index.js) needs NO
// build step — only run this for the edge entry.
//
//   node build.mjs   →  dist/index.edge.js
//
// Note: best-effort. If you add an open-sse provider that pulls a new Node-only
// dependency, add it to STUB or EXTERNAL below.

import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EMPTY = path.resolve(ROOT, "shims/empty.js");

// Statically imported but unused at the edge → stub so module init can't crash.
const STUB = new Set([
  "child_process", "node:child_process",
  "readline", "node:readline",
  "fs", "node:fs",
]);

// Only reached via conditional/dynamic imports (proxy paths) that don't run at the
// edge → keep external (resolved, if ever called, to the runtime/polyfill).
const EXTERNAL_PACKAGES = new Set(["undici", "got-scraping", "socks-proxy-agent"]);

// Bare Node builtin specifiers (without the node: prefix) that Workers' nodejs_compat
// provides at runtime → externalize so esbuild doesn't try to resolve them to files.
const BARE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "console", "crypto", "diagnostics_channel", "dns",
  "events", "http", "http2", "https", "net", "os", "path", "perf_hooks", "process",
  "querystring", "stream", "string_decoder", "timers", "tls", "tty", "url", "util",
  "worker_threads", "zlib",
]);

const edgeStubs = {
  name: "edge-stubs",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (STUB.has(args.path)) return { path: EMPTY };
      if (EXTERNAL_PACKAGES.has(args.path)) return { path: args.path, external: true };
      if (args.path.startsWith("node:")) return { path: args.path, external: true };
      if (BARE_BUILTINS.has(args.path)) return { path: args.path, external: true };
      return null;
    });
  },
};

await build({
  entryPoints: [path.resolve(ROOT, "src/index.edge.js")],
  outfile: path.resolve(ROOT, "dist/index.edge.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  conditions: ["worker", "browser"],
  sourcemap: false,
  minify: false,
  plugins: [edgeStubs],
  logLevel: "info",
});

console.log("[cloud] built dist/index.edge.js");
