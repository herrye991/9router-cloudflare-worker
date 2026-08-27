-- 9router-cloud — initial D1 schema.
-- Applied with: wrangler d1 migrations apply DB   (remote)
--               wrangler d1 migrations apply DB --local   (local dev)

-- One row per 9Router machine. `data` is a JSON blob holding the full machine
-- state ({ apiKeys, providers, modelAliases, combos, settings }) — mirrors the
-- main app's JSON `data`-column convention.
CREATE TABLE IF NOT EXISTS machines (
  machine_id TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Slim normalized index of every machine's API keys, kept in sync atomically by
-- saveMachineData(). Enables fast key → machine lookups and revocation checks.
CREATE TABLE IF NOT EXISTS api_keys (
  key        TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  label      TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_machine ON api_keys(machine_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active  ON api_keys(is_active);

-- Per-machine sync version counter + last-updated timestamp (drives cloud sync).
CREATE TABLE IF NOT EXISTS sync_meta (
  machine_id TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
