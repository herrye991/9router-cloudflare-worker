// Cloud-sync endpoints: pull/push a machine's 9Router state (providers, keys,
// aliases, combos, settings) to/from D1. This is the storage backend behind the
// app's "Cloud Sync" feature (CLOUD_URL).
//
// Auth: caller must present a Bearer API key that belongs to the target machine
// (new-format keys embed the machineId; legacy keys are matched by membership).

import { extractBearerToken, parseApiKey } from "../utils/apiKey.js";
import { getMachineData, saveMachineData, getSyncVersion, deleteMachineData } from "../services/storage.js";
import { json, errorJson } from "../utils/respond.js";
import * as log from "../utils/logger.js";

const TAG = "SYNC";

// Validate the Bearer token belongs to `machineId`. Returns { ok, data?, response? }.
async function authorize(request, env, machineId) {
  const token = extractBearerToken(request);
  if (!token) return { ok: false, response: errorJson(401, "Missing API key") };

  // Structural/secret validation (CRC for new-format keys).
  const parsed = await parseApiKey(token, env);
  if (!parsed) return { ok: false, response: errorJson(401, "Invalid API key format") };

  // A new-format key is bound to a specific machine — reject cross-machine use.
  if (parsed.isNewFormat && parsed.machineId && parsed.machineId !== machineId) {
    return { ok: false, response: errorJson(403, "API key does not belong to this machine") };
  }

  const data = await getMachineData(env, machineId);
  const keys = data?.apiKeys || [];
  const match = keys.some((k) => k && k.key === token && k.isActive !== false);
  if (!match) return { ok: false, response: errorJson(401, "Invalid API key") };

  return { ok: true, data, token };
}

/** GET /sync/{machineId} — pull machine state + sync version. */
export async function handleSyncPull(request, env, ctx, machineId) {
  if (!machineId) return errorJson(400, "Missing machineId");
  const auth = await authorize(request, env, machineId);
  if (!auth.ok) return auth.response;

  const version = await getSyncVersion(env, machineId);
  log.debug(TAG, `pull ${machineId} v${version.version}`);
  return json({ machineId, ...version, data: auth.data || null });
}

/** PUT|POST /sync/{machineId} — push machine state (body: { data } or raw state). */
export async function handleSyncPush(request, env, ctx, machineId) {
  if (!machineId) return errorJson(400, "Missing machineId");
  const auth = await authorize(request, env, machineId);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson(400, "Invalid JSON body");
  }

  const data = body?.data && typeof body.data === "object" ? body.data : body;
  try {
    await saveMachineData(env, machineId, data || {});
  } catch (e) {
    log.error(TAG, `save failed for ${machineId}: ${e.message}`);
    return errorJson(500, "Failed to save machine data");
  }
  const version = await getSyncVersion(env, machineId);
  log.debug(TAG, `push ${machineId} -> v${version.version}`);
  return json({ ok: true, machineId, ...version });
}

/** DELETE /sync/{machineId} — wipe a machine's state. */
export async function handleSyncDelete(request, env, ctx, machineId) {
  if (!machineId) return errorJson(400, "Missing machineId");
  const auth = await authorize(request, env, machineId);
  if (!auth.ok) return auth.response;
  await deleteMachineData(env, machineId);
  return json({ ok: true, machineId });
}
