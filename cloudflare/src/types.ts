/**
 * Shared types for the 9Router Cloudflare Worker.
 * All types are Cloudflare-native (no Node/Bun types).
 */

/** Cloudflare Worker bindings — D1 + env vars. */
export interface Env {
  DB: D1Database;
  REQUIRE_API_KEY?: string;
  ADMIN_API_KEY?: string;
}

/** A provider connection record (from providerConnections table). */
export interface ProviderConnection {
  id: string;
  provider: string;
  authType: string;
  name?: string | null;
  email?: string | null;
  priority?: number | null;
  isActive: boolean;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  providerSpecificData?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A combo record (from combos table). */
export interface Combo {
  id: string;
  name: string;
  kind?: string | null;
  models: string[];
}

/** An API key record (from apiKeys table). */
export interface ApiKeyRecord {
  id: string;
  key: string;
  name?: string | null;
  isActive: boolean;
}

/** Settings blob (from settings table). */
export interface Settings {
  requireApiKey?: boolean;
  [key: string]: unknown;
}

/** Parsed model string: "provider/model" or alias. */
export interface ParsedModel {
  provider: string | null;
  model: string | null;
  isAlias: boolean;
  providerAlias: string | null;
}

/** Resolved model info after alias/combo resolution. */
export interface ModelInfo {
  provider: string | null;
  model: string;
}

/** Provider transport configuration (static, from registry). */
export interface ProviderTransport {
  baseUrl: string;
  format?: string;
  headers?: Record<string, string>;
  forceStream?: boolean;
  auth?: {
    header: string;
    scheme: "bearer" | "raw";
  };
}

/** Static provider definition (subset of registry entry). */
export interface ProviderDefinition {
  id: string;
  alias: string;
  aliases?: string[];
  transport: ProviderTransport;
  models: StaticModel[];
  passthroughModels?: boolean;
}

/** Static model definition (subset of registry model). */
export interface StaticModel {
  id: string;
  name?: string;
  kind?: string;
}

/** Result of a chat completion attempt. */
export interface ChatResult {
  success: boolean;
  response: Response;
  status?: number;
  error?: string;
  resetsAtMs?: number | null;
}

/** Error classification for fallback decisions. */
export interface FallbackDecision {
  shouldFallback: boolean;
  cooldownMs: number;
  newBackoffLevel?: number;
}
