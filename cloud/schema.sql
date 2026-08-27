-- 9router-cloud — full D1 schema (reference / one-shot apply).
-- This mirrors cloud/migrations/. Prefer `wrangler d1 migrations apply` so changes
-- are tracked; this file is provided for inspection or a manual bootstrap:
--   wrangler d1 execute DB --file=./schema.sql          (remote)
--   wrangler d1 execute DB --local --file=./schema.sql  (local dev)

CREATE TABLE IF NOT EXISTS machines (
  machine_id TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  key        TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  label      TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_machine ON api_keys(machine_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active  ON api_keys(is_active);

CREATE TABLE IF NOT EXISTS sync_meta (
  machine_id TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
