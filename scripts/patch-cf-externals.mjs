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

// Modules that Next.js hard-codes as webpack externals for the Node
// server build but that are NOT available in the Workers runtime.
// `bun:sqlite` is the one that breaks the OpenNext esbuild bundle;
// `node:sqlite` and `better-sqlite3` are patched too for consistency
// (they are handled by the edge stub at the webpack layer already, but
// their `require()` stubs would otherwise be left as unresolved
// bare requires in the final Worker bundle).
const EXTERNAL_MODULES = ["bun:sqlite", "node:sqlite", "better-sqlite3"];

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
  const patched = content.replace(stubRegex, (_match, modName) => {
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
];

let grandTotal = 0;
for (const dir of targets) {
  const n = patchDir(dir);
  if (n > 0) console.log(`[patch-cf-externals] Patched ${n} stub(s) in ${dir}`);
  grandTotal += n;
}

if (grandTotal === 0) {
  console.log("[patch-cf-externals] No external stubs found to patch (already clean or no server build).");
} else {
  console.log(`[patch-cf-externals] Done — ${grandTotal} stub(s) replaced with throwing shims.`);
}
