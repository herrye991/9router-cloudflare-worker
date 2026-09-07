/**
 * Error utilities — OpenAI-compatible error responses.
 * Mirrors open-sse/config/errorConfig.js and open-sse/utils/error.js
 * but Cloudflare-native (no Node/Bun dependencies).
 */

import type { FallbackDecision } from "../types";

// HTTP status codes
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ACCEPTABLE: 406,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

// OpenAI-compatible error types
const ERROR_TYPES: Record<number, { type: string; code: string }> = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "insufficient_quota" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" },
};

const DEFAULT_MESSAGES: Record<number, string> = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "You exceeded your current quota",
  404: "Model not found",
  406: "Model not supported",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway - upstream provider error",
  503: "Service temporarily unavailable",
  504: "Gateway timeout",
};

/** Build an OpenAI-compatible JSON error Response. */
export function errorResponse(
  status: number,
  message: string,
  extra?: Record<string, unknown>
): Response {
  const errorType = ERROR_TYPES[status] || ERROR_TYPES[500];
  const body = {
    error: {
      message,
      type: errorType.type,
      code: errorType.code,
      param: null,
      ...extra,
    },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/** Format a provider error message (sanitized, no stack traces). */
export function formatProviderError(
  status: number,
  errorText: string
): string {
  const base = DEFAULT_MESSAGES[status] || "Provider error";
  if (!errorText) return base;
  // Clamp and sanitize — never expose raw upstream HTML/stack
  const clean = String(errorText)
    .replace(/<[^>]*>/g, "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 200);
  return clean || base;
}

// ── Fallback classification ──────────────────────────────────────────

const BACKOFF_CONFIG = {
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15,
};

const TRANSIENT_COOLDOWN_MS = 30 * 1000;
const COOLDOWN_LONG = 2 * 60 * 1000;
const COOLDOWN_SHORT = 5 * 1000;

const ERROR_RULES: Array<{
  text?: string;
  status?: number;
  cooldownMs?: number;
  backoff?: boolean;
}> = [
  { text: "no credentials", cooldownMs: COOLDOWN_LONG },
  { text: "request not allowed", cooldownMs: COOLDOWN_SHORT },
  { text: "improperly formed request", cooldownMs: COOLDOWN_LONG },
  { text: "rate limit", backoff: true },
  { text: "too many requests", backoff: true },
  { text: "quota exceeded", backoff: true },
  { text: "capacity", backoff: true },
  { text: "overloaded", backoff: true },
  { status: 401, cooldownMs: COOLDOWN_LONG },
  { status: 402, cooldownMs: COOLDOWN_LONG },
  { status: 403, cooldownMs: COOLDOWN_LONG },
  { status: 404, cooldownMs: COOLDOWN_LONG },
  { status: 429, backoff: true },
];

function getQuotaCooldown(backoffLevel: number): number {
  const level = Math.max(0, backoffLevel - 1);
  const cooldown = BACKOFF_CONFIG.base * Math.pow(2, level);
  return Math.min(cooldown, BACKOFF_CONFIG.max);
}

/**
 * Check if an error should trigger fallback to the next connection.
 * Mirrors open-sse/services/accountFallback.js checkFallbackError().
 */
export function checkFallbackError(
  status: number,
  errorText: string,
  backoffLevel = 0
): FallbackDecision {
  const lower = errorText
    ? (typeof errorText === "string" ? errorText : JSON.stringify(errorText)).toLowerCase()
    : "";

  for (const rule of ERROR_RULES) {
    if (rule.text && lower && lower.includes(rule.text)) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return {
          shouldFallback: true,
          cooldownMs: getQuotaCooldown(newLevel),
          newBackoffLevel: newLevel,
        };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs! };
    }
    if (rule.status && rule.status === status) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return {
          shouldFallback: true,
          cooldownMs: getQuotaCooldown(newLevel),
          newBackoffLevel: newLevel,
        };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs! };
    }
  }

  return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS };
}

/** Build the model lock key for a connection. */
export function getModelLockKey(model: string | null): string {
  return model ? `modelLock_${model}` : "modelLock___all";
}
