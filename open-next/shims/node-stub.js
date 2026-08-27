// Stub for Node-only modules that the 9Router app imports but that are NOT available
// in the Cloudflare Workers runtime (even with nodejs_compat). Aliased here by
// next.config.mjs during the CF build so the bundle compiles. Any actual CALL throws a
// clear, catchable error — the app's DB driver / feature code already treats these as
// "unavailable" and falls back or degrades.
//
// Covered modules: child_process (+ node:), node:sqlite, bun:sqlite, better-sqlite3,
// node-machine-id, open, socks-proxy-agent, got-scraping.
//
// If the edge build surfaces another Node-only import, add it to the alias list in
// next.config.mjs (and a matching export here).

const unavailable = (name) =>
  new Error(
    `[9router edge] "${name}" is not available in the Cloudflare Workers runtime. ` +
      `Use the Node/Docker deployment for this feature.`,
  );

// Default export doubles as a callable (e.g. `open(url)`) and a constructable
// (e.g. `new Database(path)` from better-sqlite3) — both throw on use.
export default function nodeOnlyModule() {
  throw unavailable("node-only module");
}

// ─── child_process ──────────────────────────────────────────────────────────
export function exec() { throw unavailable("child_process.exec"); }
export function execSync() { throw unavailable("child_process.execSync"); }
export function execFile() { throw unavailable("child_process.execFile"); }
export function execFileSync() { throw unavailable("child_process.execFileSync"); }
export function spawn() { throw unavailable("child_process.spawn"); }
export function spawnSync() { throw unavailable("child_process.spawnSync"); }
export function fork() { throw unavailable("child_process.fork"); }

// ─── node-machine-id ────────────────────────────────────────────────────────
export function machineIdSync() { throw unavailable("node-machine-id.machineIdSync"); }
export async function machineId() { throw unavailable("node-machine-id.machineId"); }
