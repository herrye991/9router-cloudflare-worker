-- 9Router Cloudflare D1 — Initial Migration
-- Derived from the original 9Router SQLite schema (src/lib/db/schema.js)
-- Only tables required for /v1/models and /v1/chat/completions are included:
--   apiKeys, providerConnections, combos, kv (modelAliases/customModels), settings

-- API keys for client authentication
CREATE TABLE IF NOT EXISTS apiKeys (
  id         TEXT PRIMARY KEY,
  key        TEXT UNIQUE NOT NULL,
  name       TEXT,
  machineId  TEXT,
  isActive   INTEGER DEFAULT 1,
  createdAt  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key);

-- Provider connections (credentials/accounts)
CREATE TABLE IF NOT EXISTS providerConnections (
  id         TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,
  authType   TEXT NOT NULL,
  name       TEXT,
  email      TEXT,
  priority   INTEGER,
  isActive   INTEGER DEFAULT 1,
  data       TEXT NOT NULL,
  createdAt  TEXT NOT NULL,
  updatedAt  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider);
CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive);
CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority);

-- Combos (model fusion / fallback chains)
CREATE TABLE IF NOT EXISTS combos (
  id         TEXT PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  kind       TEXT,
  models     TEXT NOT NULL,
  createdAt  TEXT NOT NULL,
  updatedAt  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name);

-- Key-value store (modelAliases, customModels, mitmAlias, settings fragments)
CREATE TABLE IF NOT EXISTS kv (
  scope TEXT NOT NULL,
  key   TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope);

-- Settings (single-row JSON blob, id=1)
CREATE TABLE IF NOT EXISTS settings (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

-- Meta (schema version tracking)
CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO _meta (key, value) VALUES ('schemaVersion', '1');
