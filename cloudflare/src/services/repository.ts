/**
 * D1 Repository layer — lightweight prepared statements.
 * No ORM. No SQL interpolation from user input.
 *
 * Tables: apiKeys, providerConnections, combos, kv, settings
 * Mirrors the original src/lib/db/repos/ but adapted for Cloudflare D1
 * (async, prepared statements via db.bind()).
 */

import type {
  Env,
  ProviderConnection,
  Combo,
  ApiKeyRecord,
  Settings,
} from "../types";

// ── Helpers ──────────────────────────────────────────────────────────

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToConnection(row: Record<string, unknown>): ProviderConnection {
  const data = parseJson<Record<string, unknown>>(row.data as string, {});
  return {
    ...data,
    id: row.id as string,
    provider: row.provider as string,
    authType: row.authType as string,
    name: (row.name as string) ?? null,
    email: (row.email as string) ?? null,
    priority: (row.priority as number) ?? null,
    isActive: (row.isActive as number) === 1,
  } as ProviderConnection;
}

function rowToCombo(row: Record<string, unknown>): Combo {
  return {
    id: row.id as string,
    name: row.name as string,
    kind: (row.kind as string) ?? null,
    models: parseJson<string[]>(row.models as string, []),
  };
}

// ── API Keys ─────────────────────────────────────────────────────────

export async function getApiKey(
  env: Env,
  key: string
): Promise<ApiKeyRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM apiKeys WHERE key = ?")
    .bind(key)
    .first();
  if (!row) return null;
  return {
    id: row.id as string,
    key: row.key as string,
    name: (row.name as string) ?? null,
    isActive: (row.isActive as number) === 1,
  };
}

export async function validateApiKey(env: Env, key: string): Promise<boolean> {
  const rec = await getApiKey(env, key);
  if (!rec) return false;
  return rec.isActive;
}

export async function listApiKeys(env: Env): Promise<ApiKeyRecord[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM apiKeys ORDER BY createdAt ASC"
  ).all();
  return (result.results || []).map((row) => ({
    id: row.id as string,
    key: row.key as string,
    name: (row.name as string) ?? null,
    isActive: (row.isActive as number) === 1,
  }));
}

// ── Provider Connections ─────────────────────────────────────────────

export async function getProviderConnections(
  env: Env,
  filter: { provider?: string; isActive?: boolean } = {}
): Promise<ProviderConnection[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.provider) {
    where.push("provider = ?");
    params.push(filter.provider);
  }
  if (filter.isActive !== undefined) {
    where.push("isActive = ?");
    params.push(filter.isActive ? 1 : 0);
  }
  const sql = `SELECT * FROM providerConnections${
    where.length ? ` WHERE ${where.join(" AND ")}` : ""
  }`;
  const stmt = env.DB.prepare(sql);
  const result = params.length
    ? await stmt.bind(...params).all()
    : await stmt.all();
  const list = (result.results || []).map((row) =>
    rowToConnection(row as unknown as Record<string, unknown>)
  );
  list.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  return list;
}

export async function getConnectionById(
  env: Env,
  id: string
): Promise<ProviderConnection | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM providerConnections WHERE id = ?"
  )
    .bind(id)
    .first();
  if (!row) return null;
  return rowToConnection(row as unknown as Record<string, unknown>);
}

/** Check if a model lock is active on a connection. */
export function isModelLockActive(
  conn: ProviderConnection,
  model: string | null
): boolean {
  const key = model ? `modelLock_${model}` : "modelLock___all";
  const expiry = (conn as Record<string, unknown>)[key] as string | undefined;
  if (!expiry) return false;
  return new Date(expiry).getTime() > Date.now();
}

/** Filter out unavailable connections (model lock or rate limit active). */
export function filterAvailableConnections(
  connections: ProviderConnection[],
  model: string | null,
  excludeIds: Set<string> = new Set()
): ProviderConnection[] {
  const now = Date.now();
  return connections.filter((conn) => {
    if (excludeIds.has(conn.id)) return false;
    if (!conn.isActive) return false;
    // Check rate limit
    const rateLimited = (conn as Record<string, unknown>).rateLimitedUntil as
      | string
      | undefined;
    if (rateLimited) {
      const t = new Date(rateLimited).getTime();
      if (Number.isFinite(t) && t > now) return false;
    }
    // Check model lock
    if (isModelLockActive(conn, model)) return false;
    if (isModelLockActive(conn, null)) return false;
    return true;
  });
}

/** Update connection error state (cooldown, model lock). */
export async function markConnectionUnavailable(
  env: Env,
  id: string,
  update: {
    modelLockKey?: string;
    modelLockUntil?: string | null;
    testStatus?: string;
    lastError?: string;
    errorCode?: number;
    backoffLevel?: number;
  }
): Promise<void> {
  const existing = await env.DB.prepare(
    "SELECT data FROM providerConnections WHERE id = ?"
  )
    .bind(id)
    .first();
  if (!existing) return;
  const dataObj = parseJson<Record<string, unknown>>(
    existing.data as string,
    {}
  );

  if (update.modelLockKey && update.modelLockUntil !== undefined) {
    dataObj[update.modelLockKey] = update.modelLockUntil;
  }
  dataObj.testStatus = update.testStatus ?? "unavailable";
  dataObj.lastError = update.lastError ?? null;
  dataObj.errorCode = update.errorCode ?? null;
  dataObj.lastErrorAt = new Date().toISOString();
  if (update.backoffLevel !== undefined) dataObj.backoffLevel = update.backoffLevel;

  await env.DB.prepare(
    "UPDATE providerConnections SET data = ?, updatedAt = ? WHERE id = ?"
  )
    .bind(JSON.stringify(dataObj), new Date().toISOString(), id)
    .run();
}

/** Clear connection error on successful request. */
export async function clearConnectionError(
  env: Env,
  id: string,
  model: string | null
): Promise<void> {
  const existing = await env.DB.prepare(
    "SELECT data FROM providerConnections WHERE id = ?"
  )
    .bind(id)
    .first();
  if (!existing) return;
  const dataObj = parseJson<Record<string, unknown>>(
    existing.data as string,
    {}
  );

  const now = Date.now();
  const lockKeys = Object.keys(dataObj).filter((k) =>
    k.startsWith("modelLock_")
  );

  for (const k of lockKeys) {
    if (model && k === `modelLock_${model}`) {
      delete dataObj[k];
      continue;
    }
    if (model && k === "modelLock___all") {
      delete dataObj[k];
      continue;
    }
    const expiry = dataObj[k] as string;
    if (typeof expiry === "string") {
      const t = new Date(expiry).getTime();
      if (Number.isFinite(t) && t <= now) delete dataObj[k];
    }
  }

  const remainingActive = lockKeys.some((k) => {
    if (dataObj[k] === undefined) return false;
    const t = new Date(dataObj[k] as string).getTime();
    return Number.isFinite(t) && t > now;
  });

  if (!remainingActive) {
    dataObj.testStatus = "active";
    dataObj.lastError = null;
    dataObj.errorCode = null;
    dataObj.lastErrorAt = null;
    dataObj.backoffLevel = 0;
  }

  await env.DB.prepare(
    "UPDATE providerConnections SET data = ?, updatedAt = ? WHERE id = ?"
  )
    .bind(JSON.stringify(dataObj), new Date().toISOString(), id)
    .run();
}


// ── Combos ───────────────────────────────────────────────────────────

export async function getComboByName(
  env: Env,
  name: string
): Promise<Combo | null> {
  const row = await env.DB.prepare("SELECT * FROM combos WHERE name = ?")
    .bind(name)
    .first();
  if (!row) return null;
  return rowToCombo(row as unknown as Record<string, unknown>);
}

export async function listCombos(env: Env): Promise<Combo[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM combos ORDER BY createdAt ASC"
  ).all();
  return (result.results || []).map((row) =>
    rowToCombo(row as unknown as Record<string, unknown>)
  );
}

// ── KV Store (modelAliases, customModels) ────────────────────────────

export async function getModelAliases(
  env: Env
): Promise<Record<string, string>> {
  const result = await env.DB.prepare(
    "SELECT key, value FROM kv WHERE scope = 'modelAliases'"
  ).all();
  const map: Record<string, string> = {};
  for (const row of result.results || []) {
    map[row.key as string] = row.value as string;
  }
  return map;
}

export async function getCustomModels(
  env: Env
): Promise<Record<string, unknown>[]> {
  const result = await env.DB.prepare(
    "SELECT key, value FROM kv WHERE scope = 'customModels'"
  ).all();
  const list: Record<string, unknown>[] = [];
  for (const row of result.results || []) {
    const v = parseJson<Record<string, unknown>>(row.value as string, {});
    list.push(v);
  }
  return list;
}

// ── Settings ──────────────────────────────────────────────────────────

export async function getSettings(env: Env): Promise<Settings> {
  const row = await env.DB.prepare("SELECT data FROM settings WHERE id = 1")
    .first();
  if (!row) return {};
  return parseJson<Settings>(row.data as string, {});
}

