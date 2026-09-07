/**
 * Model service — parse, alias resolution, combo detection.
 * Mirrors open-sse/services/model.js and src/sse/services/model.js
 * but reads from D1 instead of local SQLite.
 */

import type { Env, ParsedModel, ModelInfo } from "../types";
import {
  resolveProviderAlias,
  inferProviderFromModelName,
  isPassthroughProvider,
  getProvider,
} from "../providers/registry";
import { getModelAliases, getComboByName } from "./repository";

/**
 * Parse a model string: "provider/model" or "alias/model" or bare alias.
 * Mirrors open-sse/services/model.js parseModel().
 */
export function parseModel(modelStr: string): ParsedModel {
  if (!modelStr) {
    return { provider: null, model: null, isAlias: false, providerAlias: null };
  }

  if (modelStr.includes("/")) {
    const firstSlash = modelStr.indexOf("/");
    const providerOrAlias = modelStr.slice(0, firstSlash);
    const model = modelStr.slice(firstSlash + 1);
    const provider = resolveProviderAlias(providerOrAlias);
    return { provider, model, isAlias: false, providerAlias: providerOrAlias };
  }

  return {
    provider: null,
    model: modelStr,
    isAlias: true,
    providerAlias: null,
  };
}

/**
 * Resolve a model alias from the D1 kv store.
 * Format: { "alias": "provider/model" }
 * Mirrors resolveModelAliasFromMap() + getModelInfoCore().
 */
export async function resolveModelAlias(
  env: Env,
  alias: string
): Promise<ModelInfo | null> {
  const aliases = await getModelAliases(env);
  const resolved = aliases[alias];
  if (!resolved) return null;

  if (typeof resolved === "string" && resolved.includes("/")) {
    const slash = resolved.indexOf("/");
    const providerOrAlias = resolved.slice(0, slash);
    return {
      provider: resolveProviderAlias(providerOrAlias),
      model: resolved.slice(slash + 1),
    };
  }
  return null;
}

/**
 * Get full model info — parse, resolve alias, or infer provider.
 * Mirrors src/sse/services/model.js getModelInfo().
 */
export async function getModelInfo(
  env: Env,
  modelStr: string
): Promise<ModelInfo> {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    return { provider: parsed.provider, model: parsed.model ?? "" };
  }

  // Try alias resolution from D1
  const resolved = await resolveModelAlias(env, parsed.model ?? "");
  if (resolved) return resolved;

  // Check if it's a combo name
  const combo = await getComboByName(env, parsed.model ?? "");
  if (combo) {
    return { provider: null, model: parsed.model ?? "" };
  }

  // Fallback: infer provider from model name prefix
  return {
    provider: inferProviderFromModelName(parsed.model ?? ""),
    model: parsed.model ?? "",
  };
}

/**
 * Check if a model string is a combo and return its model list.
 * Mirrors src/sse/services/model.js getComboModels().
 */
export async function getComboModels(
  env: Env,
  modelStr: string
): Promise<string[] | null> {
  if (modelStr.includes("/")) return null;
  const combo = await getComboByName(env, modelStr);
  if (combo && combo.models.length > 0) return combo.models;
  return null;
}

/**
 * Check if a model is valid for a provider (static or passthrough).
 * Mirrors open-sse/config/providerModels.js isValidModel().
 */
export function isValidModel(providerId: string, modelId: string): boolean {
  if (isPassthroughProvider(providerId)) return true;
  const def = getProvider(providerId);
  if (!def) return false;
  return def.models.some((m) => m.id === modelId);
}
