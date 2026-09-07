/**
 * Authentication middleware — API key validation.
 * Mirrors src/sse/services/auth.js extractApiKey() + isValidApiKey()
 * but Cloudflare-native (reads from D1, uses Web Crypto for hashing if needed).
 */

import type { Env } from "../types";
import { validateApiKey, getSettings } from "./repository";
import { errorResponse, HTTP_STATUS } from "./errors";

/**
 * Extract API key from request headers.
 * Checks Authorization: Bearer <key> and x-api-key (Anthropic style).
 */
export function extractApiKey(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) return xApiKey;

  return null;
}

/**
 * Check if API key authentication is required.
 * Reads from settings (requireApiKey) or env var (REQUIRE_API_KEY).
 */
export async function isApiKeyRequired(env: Env): Promise<boolean> {
  // Env var takes precedence (set in wrangler.jsonc vars)
  if (env.REQUIRE_API_KEY === "true") return true;
  if (env.REQUIRE_API_KEY === "false") return false;

  // Otherwise check settings in D1
  const settings = await getSettings(env);
  return settings.requireApiKey === true;
}

/**
 * Validate an API key against D1.
 */
export async function isValidApiKey(env: Env, key: string): Promise<boolean> {
  if (!key) return false;
  return validateApiKey(env, key);
}

/**
 * Auth middleware for Hono — enforces API key if required.
 * Returns an error Response if auth fails, or null if auth passes.
 */
export async function checkAuth(
  env: Env,
  request: Request
): Promise<Response | null> {
  const required = await isApiKeyRequired(env);
  if (!required) return null; // Auth not required

  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
  }

  const valid = await isValidApiKey(env, apiKey);
  if (!valid) {
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  return null; // Auth passed
}

/**
 * Hash a string using Web Crypto SHA-256.
 * Used for securely comparing API keys if needed (not for storage —
 * the original 9Router stores keys in plaintext in the apiKeys table).
 */
export async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
