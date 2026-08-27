// Liveness/readiness probe. Performs a real D1 round-trip so a broken binding
// or unreachable database surfaces as 503 instead of a silent hang.
import { first } from "../services/d1.js";
import { json } from "../utils/respond.js";

export async function handleHealth(env) {
  let db = "ok";
  let ok = true;
  try {
    await first(env, `SELECT 1 AS one`, []);
  } catch (e) {
    db = `error: ${e.message}`;
    ok = false;
  }
  return json(
    {
      status: ok ? "ok" : "degraded",
      service: "9router-cloud",
      db,
      time: new Date().toISOString(),
    },
    ok ? 200 : 503,
  );
}
