// D1-backed storage for per-machine 9Router state.
//
// Data model (see cloud/migrations/0001_initial.sql):
//   machines   — one row per machineId; `data` is a JSON blob holding the full
//                machine state ({ apiKeys, providers, modelAliases, combos, settings }).
//                This mirrors the main app's JSON-`data`-column convention.
//   api_keys   — slim normalized index of every machine's API keys, kept in sync
//                inside the same atomic batch so key → machine lookups and
//                revocation checks stay fast (no blob scan).
//   sync_meta  — per-machine sync version counter + last-updated timestamp.
//
// getMachineData returns the shape the edge handlers expect:
//   { machineId, apiKeys: [...], providers: { connId: {...} }, modelAliases: {...}, ... }

import { first, batch } from "./d1.js";

const nowIso = () => new Date().toISOString();

function safeParse(json, fallback) {
  try { return JSON.parse(json); } catch { return fallback; }
}

/**
 * Load a machine's full state.
 * @returns {Promise<object|null>} machineData, or null when the machine is unknown.
 */
export async function getMachineData(env, machineId) {
  if (!machineId) return null;
  const row = await first(env, `SELECT data FROM machines WHERE machine_id = ?`, [machineId]);
  if (!row) return null;
  const data = safeParse(row.data, {});
  return {
    ...data,
    machineId,
    apiKeys: Array.isArray(data.apiKeys) ? data.apiKeys : [],
    providers: data.providers && typeof data.providers === "object" ? data.providers : {},
    modelAliases: data.modelAliases && typeof data.modelAliases === "object" ? data.modelAliases : {},
    combos: Array.isArray(data.combos) ? data.combos : [],
    settings: data.settings && typeof data.settings === "object" ? data.settings : {},
  };
}

/**
 * Persist a machine's full state (upsert) and keep the api_keys index in sync,
 * all in one atomic D1 batch.
 * @param {object} env
 * @param {string} machineId
 * @param {object} data - machine state (apiKeys/providers/modelAliases/...).
 */
export async function saveMachineData(env, machineId, data) {
  if (!machineId) throw new Error("machineId is required");
  const ts = nowIso();
  // Never persist machineId twice (it's the row key).
  const { machineId: _omit, ...rest } = data || {};
  const blob = JSON.stringify(rest);

  const statements = [
    {
      sql: `INSERT INTO machines(machine_id, data, created_at, updated_at)
            VALUES(?, ?, ?, ?)
            ON CONFLICT(machine_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      params: [machineId, blob, ts, ts],
    },
    // Rebuild the api_keys index for this machine.
    { sql: `DELETE FROM api_keys WHERE machine_id = ?`, params: [machineId] },
  ];

  for (const k of rest.apiKeys || []) {
    if (!k || !k.key) continue;
    statements.push({
      sql: `INSERT OR REPLACE INTO api_keys(key, machine_id, label, is_active, created_at)
            VALUES(?, ?, ?, ?, ?)`,
      params: [k.key, machineId, k.label || k.name || null, k.isActive === false ? 0 : 1, k.createdAt || ts],
    });
  }

  statements.push({
    sql: `INSERT INTO sync_meta(machine_id, version, updated_at)
          VALUES(?, 1, ?)
          ON CONFLICT(machine_id) DO UPDATE SET version = version + 1, updated_at = excluded.updated_at`,
    params: [machineId, ts],
  });

  await batch(env, statements);
}

/** Remove a machine and its indexed keys/meta. */
export async function deleteMachineData(env, machineId) {
  await batch(env, [
    { sql: `DELETE FROM api_keys WHERE machine_id = ?`, params: [machineId] },
    { sql: `DELETE FROM sync_meta WHERE machine_id = ?`, params: [machineId] },
    { sql: `DELETE FROM machines WHERE machine_id = ?`, params: [machineId] },
  ]);
}

/** Resolve which machine owns an API key (uses the api_keys index). */
export async function getApiKeyOwner(env, key) {
  if (!key) return null;
  const row = await first(
    env,
    `SELECT machine_id AS machineId, is_active AS isActive FROM api_keys WHERE key = ?`,
    [key],
  );
  if (!row) return null;
  return { machineId: row.machineId, isActive: row.isActive === 1 || row.isActive === true };
}

/** Current sync version/timestamp for a machine. */
export async function getSyncVersion(env, machineId) {
  const row = await first(
    env,
    `SELECT version, updated_at AS updatedAt FROM sync_meta WHERE machine_id = ?`,
    [machineId],
  );
  return row ? { version: row.version, updatedAt: row.updatedAt } : { version: 0, updatedAt: null };
}
