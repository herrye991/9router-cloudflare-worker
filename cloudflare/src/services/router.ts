/**
 * Router service — the core of 9Router on Cloudflare.
 *
 * Handles:
 * - Provider/model resolution (alias, combo, inference)
 * - Connection selection (priority, availability, model locks)
 * - Fallback across connections (retry with next account)
 * - Streaming (Web Streams / SSE passthrough)
 * - Non-streaming (JSON passthrough)
 * - Error classification and cooldown
 *
 * Mirrors src/sse/handlers/chat.js + open-sse/handlers/chatCore.js
 * but Cloudflare-native: no Bun/Node, no proxy, no OAuth refresh.
 */

import type { Env, ProviderConnection, ChatResult } from "../types";
import {
  getProviderConnections,
  filterAvailableConnections,
  markConnectionUnavailable,
  clearConnectionError,
} from "./repository";
import { getModelInfo, getComboModels } from "./model";
import { executeChatCompletion, parseUpstreamError } from "../providers/fetcher";
import { getProvider } from "../providers/registry";
import {
  errorResponse,
  formatProviderError,
  checkFallbackError,
  getModelLockKey,
  HTTP_STATUS,
} from "./errors";

/** SSE headers for streaming responses. */
const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "Access-Control-Allow-Origin": "*",
};

/** Max fallback attempts (connections to try before giving up). */
const MAX_FALLBACK_ATTEMPTS = 10;

/**
 * Handle a single-provider chat with connection fallback.
 * Mirrors the retry loop in src/sse/handlers/chat.js.
 */
async function handleSingleChat(
  env: Env,
  body: Record<string, unknown>,
  provider: string,
  model: string
): Promise<Response> {
  const def = getProvider(provider);
  if (!def) {
    return errorResponse(HTTP_STATUS.NOT_FOUND, `Unknown provider: ${provider}`);
  }

  const connections = await getProviderConnections(env, {
    provider,
    isActive: true,
  });

  if (connections.length === 0) {
    return errorResponse(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      `No active connections for provider: ${provider}`
    );
  }

  const excludeIds = new Set<string>();
  let lastError = "";
  let lastStatus: number = HTTP_STATUS.SERVER_ERROR;

  for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt++) {
    const available = filterAvailableConnections(connections, model, excludeIds);

    if (available.length === 0) {
      return errorResponse(
        lastStatus === HTTP_STATUS.RATE_LIMITED
          ? HTTP_STATUS.RATE_LIMITED
          : HTTP_STATUS.SERVICE_UNAVAILABLE,
        formatProviderError(lastStatus, lastError) ||
          `All connections for ${provider} are unavailable`
      );
    }

    const conn = available[0];
    const stream = body.stream === true || def.transport.forceStream === true;

    const result = await executeRequest(env, body, provider, model, conn, stream);

    if (result.success) {
      await clearConnectionError(env, conn.id, model).catch(() => {});
      return result.response;
    }

    lastError = result.error || "Unknown error";
    lastStatus = result.status || HTTP_STATUS.SERVER_ERROR;

    const backoffLevel =
      ((conn as Record<string, unknown>).backoffLevel as number) || 0;
    const decision = checkFallbackError(lastStatus, lastError, backoffLevel);

    if (decision.shouldFallback) {
      const lockUntil = new Date(Date.now() + decision.cooldownMs).toISOString();
      await markConnectionUnavailable(env, conn.id, {
        modelLockKey: getModelLockKey(model),
        modelLockUntil: lockUntil,
        lastError: lastError.slice(0, 100),
        errorCode: lastStatus,
        backoffLevel: decision.newBackoffLevel ?? backoffLevel,
      }).catch(() => {});

      excludeIds.add(conn.id);
      continue;
    }

    return result.response;
  }

  return errorResponse(
    HTTP_STATUS.SERVICE_UNAVAILABLE,
    `All connections for ${provider}/${model} exhausted after ${MAX_FALLBACK_ATTEMPTS} attempts`
  );
}


/**
 * Handle a chat completion request.
 * This is the main entry point, called by the /v1/chat/completions route.
 */
export async function handleChatCompletion(
  env: Env,
  body: Record<string, unknown>,
  modelStr: string
): Promise<Response> {
  // 1. Resolve model info (alias, combo, or provider/model)
  const modelInfo = await getModelInfo(env, modelStr);
  if (!modelInfo.provider || !modelInfo.model) {
    return errorResponse(HTTP_STATUS.NOT_FOUND, `Model not found: ${modelStr}`);
  }

  // 2. Check if this is a combo (multi-model fallback chain)
  const comboModels = await getComboModels(env, modelStr);
  if (comboModels && comboModels.length > 0) {
    return handleComboChat(env, body, comboModels);
  }

  // 3. Single-model routing with connection fallback
  return handleSingleChat(env, body, modelInfo.provider, modelInfo.model);
}

/**
 * Execute a single request against a provider connection.
 * Returns success/failure with the Response object.
 */
async function executeRequest(
  _env: Env,
  body: Record<string, unknown>,
  provider: string,
  model: string,
  conn: ProviderConnection,
  stream: boolean
): Promise<ChatResult> {
  try {
    const response = await executeChatCompletion(provider, model, body, conn, stream);

    if (response.ok) {
      if (stream && response.body) {
        return {
          success: true,
          response: new Response(response.body, {
            status: response.status,
            headers: {
              ...SSE_HEADERS,
              "x-9router-provider": provider,
              "x-9router-connection": conn.id,
            },
          }),
        };
      }

      const data = await response.json();
      return {
        success: true,
        response: new Response(JSON.stringify(data), {
          status: response.status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "x-9router-provider": provider,
            "x-9router-connection": conn.id,
          },
        }),
      };
    }

    const { status, errorText } = await parseUpstreamError(response);
    return {
      success: false,
      response: errorResponse(status, formatProviderError(status, errorText)),
      status,
      error: errorText,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return {
      success: false,
      response: errorResponse(HTTP_STATUS.BAD_GATEWAY, `Provider fetch failed: ${msg}`),
      status: HTTP_STATUS.BAD_GATEWAY,
      error: msg,
    };
  }
}

/**
 * Handle a combo chat — try each model in the combo list in order.
 * Mirrors open-sse/services/combo.js handleComboChat() (simplified).
 */
async function handleComboChat(
  env: Env,
  body: Record<string, unknown>,
  comboModels: string[]
): Promise<Response> {
  let lastStatus: number = HTTP_STATUS.SERVER_ERROR;

  for (const modelStr of comboModels) {
    const modelInfo = await getModelInfo(env, modelStr);
    if (!modelInfo.provider || !modelInfo.model) continue;

    const result = await handleSingleChat(env, body, modelInfo.provider, modelInfo.model);

    if (result.status >= 200 && result.status < 300) {
      return result;
    }

    lastStatus = result.status;
  }

  return errorResponse(
    lastStatus,
    `All models in combo failed: ${comboModels.join(", ")}`
  );
}

