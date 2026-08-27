// Edge embeddings handler — OpenAI-compatible /v1/embeddings.
//
// Reuses the provider-agnostic open-sse engine for model resolution, account
// fallback math, and the upstream call (handleEmbeddingsCore). Auth + per-machine
// credential storage are D1-backed (services/storage.js).
//
// Contract (covered by tests/unit/embeddings.cloud.test.js):
//   OPTIONS                      → 200, CORS headers, empty body
//   missing Bearer               → 401 "Missing API key"
//   unparsable key               → 401 "Invalid API key format"
//   legacy key, no machineId     → 400 (point at the /{machineId}/... endpoint)
//   key not in machine.apiKeys   → 401 "Invalid API key"
//   bad JSON / no model / no input / unmapped model → 400
//   no provider credentials      → 400 "No credentials ..."
//   all accounts rate-limited    → 429 + Retry-After
//   non-fallback upstream error  → propagated as-is

import { getModelInfoCore } from "../../../open-sse/services/model.js";
import { handleEmbeddingsCore } from "../../../open-sse/handlers/embeddingsCore.js";
import { errorResponse, unavailableResponse } from "../../../open-sse/utils/error.js";
import {
  checkFallbackError,
  getUnavailableUntil,
  getEarliestRateLimitedUntil,
  formatRetryAfter,
  filterAvailableAccounts,
} from "../../../open-sse/services/accountFallback.js";
import { HTTP_STATUS } from "../../../open-sse/config/runtimeConfig.js";
import { extractBearerToken, parseApiKey } from "../utils/apiKey.js";
import { getMachineData, saveMachineData } from "../services/storage.js";
import { handleOptions, addCorsHeaders } from "../utils/cors.js";
import * as log from "../utils/logger.js";

const TAG = "EMBEDDINGS";

// Upstream statuses that justify switching to another account of the same provider.
// Other 4xx client errors are returned to the caller directly.
const FALLBACK_STATUSES = new Set([
  HTTP_STATUS.UNAUTHORIZED,
  HTTP_STATUS.FORBIDDEN,
  HTTP_STATUS.REQUEST_TIMEOUT,
  HTTP_STATUS.RATE_LIMITED,
  HTTP_STATUS.SERVER_ERROR,
  HTTP_STATUS.BAD_GATEWAY,
  HTTP_STATUS.SERVICE_UNAVAILABLE,
  HTTP_STATUS.GATEWAY_TIMEOUT,
]);

function isValidKeyForMachine(machineData, token) {
  const keys = machineData?.apiKeys;
  if (!Array.isArray(keys)) return false;
  return keys.some((k) => k && k.key === token && k.isActive !== false);
}

// Flatten machineData.providers (map keyed by connectionId) into a prioritized
// account list for `provider`. Lower `priority` wins; undefined sorts last.
function selectAccounts(machineData, provider) {
  const providers = machineData?.providers || {};
  const list = [];
  for (const [id, p] of Object.entries(providers)) {
    if (!p || typeof p !== "object") continue;
    if (p.provider !== provider) continue;
    if (p.isActive === false) continue;
    list.push({ id, ...p });
  }
  list.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  return list;
}

// Strip control/metadata fields; keep credential + provider-specific fields.
function buildCredentials(account) {
  const {
    id, provider, isActive, priority, status,
    rateLimitedUntil, backoffLevel, lastError, errorCode,
    ...rest
  } = account;
  return {
    ...rest,
    connectionId: id,
    apiKey: account.apiKey ?? rest.apiKey ?? null,
    accessToken: account.accessToken ?? rest.accessToken ?? null,
  };
}

/**
 * @param {Request} request
 * @param {object} env - Worker env bindings (DB, API_KEY_SECRET, ...)
 * @param {object} ctx - Worker execution context
 * @param {string|null} machineIdOverride - from the /{machineId}/v1/... URL path (legacy keys)
 */
export async function handleEmbeddings(request, env, ctx, machineIdOverride = null) {
  // CORS preflight
  if (request.method === "OPTIONS") return handleOptions();

  // ── Auth ───────────────────────────────────────────────────────────────────
  const token = extractBearerToken(request);
  if (!token) return addCorsHeaders(errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key"));

  const parsed = await parseApiKey(token, env);
  if (!parsed) return addCorsHeaders(errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key format"));

  const machineId = machineIdOverride || parsed.machineId;
  if (!machineId) {
    return addCorsHeaders(errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      "This legacy API key has no embedded machineId. Call the /{machineId}/v1/embeddings endpoint or generate a new key.",
    ));
  }

  const machineData = await getMachineData(env, machineId);
  if (!machineData || !isValidKeyForMachine(machineData, token)) {
    return addCorsHeaders(errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key"));
  }

  // ── Body validation ────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return addCorsHeaders(errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body"));
  }
  if (!body || !body.model) return addCorsHeaders(errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model"));
  if (body.input === undefined || body.input === null) {
    return addCorsHeaders(errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input"));
  }

  // ── Resolve provider/model ─────────────────────────────────────────────────
  const modelInfo = await getModelInfoCore(body.model, machineData.modelAliases || {});
  if (!modelInfo || !modelInfo.provider || !modelInfo.model) {
    return addCorsHeaders(errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format"));
  }
  const { provider, model } = modelInfo;

  // ── Account selection + fallback ───────────────────────────────────────────
  const accounts = selectAccounts(machineData, provider);
  if (accounts.length === 0) {
    return addCorsHeaders(errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials configured for provider '${provider}'`));
  }

  const available = filterAvailableAccounts(accounts);
  if (available.length === 0) {
    const earliest = getEarliestRateLimitedUntil(accounts);
    log.warn(TAG, `${provider} | all ${accounts.length} account(s) rate-limited`);
    return addCorsHeaders(unavailableResponse(
      HTTP_STATUS.RATE_LIMITED,
      "All accounts are rate limited",
      earliest,
      formatRetryAfter(earliest),
    ));
  }

  let lastStatus = HTTP_STATUS.SERVICE_UNAVAILABLE;
  let lastError = "All accounts unavailable";

  for (const account of available) {
    const credentials = buildCredentials(account);
    let result;
    try {
      result = await handleEmbeddingsCore({
        body,
        modelInfo: { provider, model },
        credentials,
        log,
      });
    } catch (e) {
      result = { success: false, status: HTTP_STATUS.BAD_GATEWAY, error: e.message };
    }

    if (result && result.success) {
      return addCorsHeaders(result.response);
    }

    const status = result?.status ?? HTTP_STATUS.BAD_GATEWAY;
    const message = result?.error ?? "Upstream error";

    // Non-fallback error (e.g. 400) — return directly without cycling accounts.
    if (!FALLBACK_STATUSES.has(status)) {
      return addCorsHeaders(result.response || errorResponse(status, message));
    }

    // Mark the account unavailable (exponential backoff), persist, try next.
    const { cooldownMs, newBackoffLevel } = checkFallbackError(status, message, account.backoffLevel || 0);
    const { id, ...accountData } = account;
    machineData.providers[id] = {
      ...accountData,
      status: "unavailable",
      rateLimitedUntil: cooldownMs > 0 ? getUnavailableUntil(cooldownMs) : (account.rateLimitedUntil ?? null),
      backoffLevel: newBackoffLevel ?? (account.backoffLevel || 0),
      lastError: message,
      errorCode: status,
    };
    lastStatus = status;
    lastError = message;
    log.warn(TAG, `${provider} | account ${id} unavailable (${status}) → next account`);
    try {
      await saveMachineData(env, machineId, machineData);
    } catch (e) {
      log.warn(TAG, `failed to persist fallback state: ${e.message}`);
    }
  }

  // All accounts exhausted.
  const earliest = getEarliestRateLimitedUntil(Object.values(machineData.providers || {}));
  if (earliest) {
    return addCorsHeaders(unavailableResponse(lastStatus, lastError, earliest, formatRetryAfter(earliest)));
  }
  return addCorsHeaders(errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError));
}

