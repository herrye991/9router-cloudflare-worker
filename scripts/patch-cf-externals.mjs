#!/usr/bin/env node
// scripts/patch-cf-externals.mjs
//
// Post-Next.js-build patch for the Cloudflare Worker (OpenNext) build.
//
// PROBLEM
//   Next.js hard-codes `bun:sqlite` (and `bun:*` generally) as a webpack
//   "external" for the Node.js server bundle (see
//   next/dist/build/handle-externals.js: `request.startsWith("bun:")`).
//   `node:sqlite` and `better-sqlite3` are likewise externals. Webpack
//   therefore emits stub modules of the form:
//
//       <id>:a=>{"use strict";a.exports=require("bun:sqlite")}
//
//   These `require("bun:sqlite")` / `require("node:sqlite")` /
//   `require("better-sqlite3")` calls survive into the compiled
//   middleware.js and page chunks. When OpenNext then re-bundles those
//   files with esbuild for the Workers runtime, esbuild cannot resolve
//   `bun:sqlite` (it is a Bun-only built-in) and the build fails:
//
//       ✘ [ERROR] Could not resolve "bun:sqlite"
//
//   The webpack `resolve.alias` in next.config.mjs (which already maps
//   these to open-next/shims/node-stub.js) does NOT help here, because
//   webpack evaluates `externals` before `resolve.alias`, so the alias
//   never gets a chance to replace the import.
//
// SOLUTION
//   Run this script immediately after `next build` (via the
//   `buildCommand` in open-next.config.ts) and BEFORE OpenNext copies /
//   re-bundles the traced files with esbuild. It rewrites the
//   `require("<module>")` stubs in every compiled server chunk to a
//   throwing expression, so esbuild no longer needs to resolve the
//   Bun/Node-only modules. At runtime the app's DB driver already wraps
//   these imports in try/catch and falls back to sql.js, so the throw is
//   never reached in practice.
//
// This is a targeted string replacement (not an AST transform) because
// the webpack stub format is stable and minimal. It only touches the
// exact `a.exports=require("…")` stub pattern, so app code that merely
// mentions the module name in a string (e.g. a log message) is left
// untouched.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));

// When invoked with `--post-build`, only inject the fs polyfill into the
// already-generated .open-next/worker.js (the stub patching was done earlier
// via the `buildCommand` in open-next.config.ts, before OpenNext bundled).
const postBuildOnly = process.argv.includes("--post-build");

// Modules that Next.js hard-codes as webpack externals for the Node
// server build but that are NOT available in the Workers runtime.
// `bun:sqlite` is the one that breaks the OpenNext esbuild bundle;
// `node:sqlite` and `better-sqlite3` are patched too for consistency
// (they are handled by the edge stub at the webpack layer already, but
// their `require()` stubs would otherwise be left as unresolved
// bare requires in the final Worker bundle).
const EXTERNAL_MODULES = ["bun:sqlite", "node:sqlite", "better-sqlite3"];

// `fs` is a Node.js builtin that webpack also externals (even with the alias
// in next.config.mjs). In Workers (unenv), `fs.mkdirSync` / `fs.writeFileSync`
// / `fs.existsSync` throw "not implemented yet" — and several app modules
// call them at module-load time, crashing every page. We patch the
// `require("fs")` webpack stub to return a proxy that no-ops those methods
// while passing through the rest (readFileSync etc. work fine in Workers).
// The stub format after esbuild minification is:
//   `<id>:<param>=>{"use strict";<param>.exports=require("fs")}`
// where <param> can be `a`, `a2`, etc. — we match any single-letter+digit param.
// Match only webpack external stubs: `<param>.exports=require("fs")` where
// <param> is a short identifier (a, a2, b, etc.) — NOT our replacement code
// (which uses `__f`). The negative lookahead avoids matching our own injected
// `var __f=require("fs")` inside the replacement.
const fsStubRegex = /([a-z]\w?)\.exports=require\("fs"\)(?!["\w])/g;
const fsStubReplacement = (param) => `${param}.exports=(function(){var __f=require("fs");["mkdirSync","writeFileSync","appendFileSync","unlinkSync","renameSync","chmodSync","chownSync","copyFileSync","rmSync","rmdirSync"].forEach(function(m){try{__f[m]=function(){}}catch(e){}});["existsSync","accessSync"].forEach(function(m){try{__f[m]=function(){return false}}catch(e){}});return __f})()`;

// Build a single regex that matches the webpack external stub for any
// of the target modules, e.g.:
//   12345:a=>{"use strict";a.exports=require("bun:sqlite")}
// We capture the module name so we can embed it in the thrown error.
// The stub is always `a.exports=require("<module>")` — webpack uses the
// single-letter param `a` and double-quoted bare requires for externals.
const stubRegex = new RegExp(
  String.raw`a\.exports=require\("(${EXTERNAL_MODULES.map(escapeRegex).join("|")})"\)`,
  "g",
);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patchFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return 0;
  }
  let count = 0;
  // Patch fs external stub: no-op mkdirSync/writeFileSync/existsSync etc.
  const fsPatched = content.replace(fsStubRegex, (_match, param) => {
    count++;
    return fsStubReplacement(param);
  });
  // Patch bun:sqlite / node:sqlite / better-sqlite3 external stubs.
  const patched = fsPatched.replace(stubRegex, (_match, modName) => {
    count++;
    // Replace the `a.exports=require("mod")` stub with a getter that
    // throws. Using Object.defineProperty keeps the same `a` object
    // shape webpack expects (a module namespace with `.exports`).
    return `Object.defineProperty(a,"exports",{get:function(){throw new Error("[9router edge] \\"${modName}\\" is not available in the Cloudflare Workers runtime. Use the Node/Docker deployment for this feature.")}})`;
  });
  if (count > 0) {
    writeFileSync(filePath, patched, "utf8");
  }
  return count;
}

// Walk a directory and patch every .js file. Returns total replacements.
function patchDir(dir) {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += patchDir(full);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      total += patchFile(full);
    }
  }
  return total;
}

// The Next.js build output lives under .next/server. OpenNext copies
// traced files from .next/standalone/.next/server, so we patch both
// locations to be safe (the standalone copy is the one OpenNext reads).
const targets = [
  join(projectRoot, ".next", "server"),
  join(projectRoot, ".next", "standalone", ".next", "server"),
  // OpenNext copies traced files here before esbuild bundling — the esbuild
  // output (handler.mjs) also contains the webpack external stubs.
  join(projectRoot, ".open-next", "server-functions", "default", ".next", "server"),
];

let grandTotal = 0;

// The esbuild-bundled outputs are produced by OpenNext AFTER copying the
// traced files. The esbuild bundle inlines the webpack external stubs verbatim.
// These are patched in BOTH modes (pre-build via buildCommand, and post-build).
const bundledFiles = [
  join(projectRoot, ".open-next", "server-functions", "default", "handler.mjs"),
  join(projectRoot, ".open-next", "middleware", "handler.mjs"),
];
for (const f of bundledFiles) {
  const n = patchFile(f);
  if (n > 0) console.log(`[patch-cf-externals] Patched ${n} stub(s) in ${f}`);
  grandTotal += n;
}

// In the default (pre-build) mode, also patch the .next/server source files
// before OpenNext copies them. In --post-build mode, skip this (already done).
if (!postBuildOnly) {
  const targets = [
    join(projectRoot, ".next", "server"),
    join(projectRoot, ".next", "standalone", ".next", "server"),
    join(projectRoot, ".open-next", "server-functions", "default", ".next", "server"),
  ];
  for (const dir of targets) {
    const n = patchDir(dir);
    if (n > 0) console.log(`[patch-cf-externals] Patched ${n} stub(s) in ${dir}`);
    grandTotal += n;
  }
}

if (grandTotal === 0) {
  console.log("[patch-cf-externals] No external stubs found to patch (already clean or no server build).");
} else {
  console.log(`[patch-cf-externals] Done — ${grandTotal} stub(s) replaced with throwing shims.`);
}
