/**
 * Provider fetch — execute a chat completion request against an upstream
 * provider using the standard Web `fetch()` API.
 *
 * Mirrors open-sse/executors/base.js + default.js but Cloudflare-native:
 * - No proxyAwareFetch (Cloudflare handles networking)
 * - No Node/Bun streams (Web Streams only)
 * - No OAuth token refresh (API-key providers only)
 */

import type { ProviderConnection, ProviderTransport } from "../types";
import { getProvider } from "./registry";

/** Build the upstream URL for a provider. */
export function buildUrl(transport: ProviderTransport): string {
  return transport.baseUrl;
}

/** Build request headers with auth from connection credentials. */
export function buildHeaders(
  transport: ProviderTransport,
  credentials: ProviderConnection,
  stream: boolean
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(transport.headers || {}),
  };

  const auth = transport.auth;
  const token = credentials.apiKey || credentials.accessToken || "";

  if (auth) {
    if (auth.scheme === "bearer") {
      headers[auth.header] = `Bearer ${token}`;
    } else {
      headers[auth.header] = token;
    }
  } else {
    // Default: Bearer auth
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  if (stream) {
    headers["Accept"] = "text/event-stream";
  }

  return headers;
}

/** Build the upstream request body. For OpenAI-compatible, passthrough. */
export function buildBody(
  body: Record<string, unknown>,
  model: string,
  stream: boolean
): Record<string, unknown> {
  return { ...body, model, stream };
}

/**
 * Execute a chat completion request against an upstream provider.
 * Returns the raw Response from fetch() — caller handles streaming/non-streaming.
 */
export async function executeChatCompletion(
  providerId: string,
  model: string,
  body: Record<string, unknown>,
  credentials: ProviderConnection,
  stream: boolean
): Promise<Response> {
  const def = getProvider(providerId);
  if (!def) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  const transport = def.transport;
  const url = buildUrl(transport);
  const headers = buildHeaders(transport, credentials, stream);
  const requestBody = buildBody(body, model, stream);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  return response;
}

/**
 * Parse an error response from the upstream provider.
 * Returns a human-readable error message.
 */
export async function parseUpstreamError(
  response: Response
): Promise<{ status: number; errorText: string }> {
  const status = response.status;
  const contentType = (response.headers.get("content-type") || "").toLowerCase();

  let errorText = "";
  if (contentType.includes("application/json")) {
    try {
      const data = await response.json();
      errorText =
        (data as Record<string, unknown>).error?.toString() ||
        (data as Record<string, unknown>).message?.toString() ||
        JSON.stringify(data);
    } catch {
      errorText = await response.text().catch(() => "");
    }
  } else {
    const text = await response.text().catch(() => "");
    const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
    errorText = (titleMatch?.[1] || text || "").replace(/<[^>]*>/g, "").trim().slice(0, 200);
  }

  return { status, errorText };
}
