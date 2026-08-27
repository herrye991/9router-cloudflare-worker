// Thin async wrapper around the Cloudflare D1 binding (env.DB).
//
// D1's client API is Promise-based:
//   DB.prepare(sql).bind(...params).first()  → row object | null
//   DB.prepare(sql).bind(...params).all()    → { results: [...], success, meta }
//   DB.prepare(sql).bind(...params).run()    → { success, meta }
//   DB.batch([prepared, ...])                → atomic multi-statement commit
//
// Centralizing here keeps SQL param binding consistent and makes the binding
// requirement (a missing `DB` binding) fail loudly with a clear message.

export function getDb(env) {
  const db = env?.DB;
  if (!db) {
    throw new Error(
      "D1 binding 'DB' is not configured. Add a [[d1_databases]] block with binding = \"DB\" to wrangler.toml.",
    );
  }
  return db;
}

/** First matching row as an object, or null. */
export async function first(env, sql, params = []) {
  return await getDb(env).prepare(sql).bind(...params).first();
}

/** All matching rows as an array of objects. */
export async function all(env, sql, params = []) {
  const res = await getDb(env).prepare(sql).bind(...params).all();
  return res?.results ?? [];
}

/** Execute a write (INSERT/UPDATE/DELETE). Returns D1's run metadata. */
export async function run(env, sql, params = []) {
  return await getDb(env).prepare(sql).bind(...params).run();
}

/**
 * Execute multiple writes atomically.
 * @param {object} env
 * @param {Array<{sql: string, params?: any[]}>} statements
 */
export async function batch(env, statements) {
  const db = getDb(env);
  const prepared = statements.map((s) => db.prepare(s.sql).bind(...(s.params || [])));
  return await db.batch(prepared);
}
