/**
 * Models list builder — builds the /v1/models response.
 * Mirrors src/app/api/v1/models/route.js buildModelsList()
 * but Cloudflare-native: reads connections + aliases + custom models from D1.
 */

import type { Env } from "../types";
import { getProvider, isPassthroughProvider } from "../providers/registry";
import { getProviderConnections, getModelAliases, getCustomModels, listCombos } from "./repository";

interface ModelEntry {
  id: string;
  object: string;
  owned_by: string;
  kind?: string;
}

/**
 * Build the list of available models for /v1/models.
 * Combines:
 * 1. Static models from provider registry (for providers with connections)
 * 2. Passthrough models (provider-level, any model name)
 * 3. Custom models from D1 kv store
 * 4. Combo names as virtual models
 * 5. Aliases as virtual models
 */
export async function buildModelsList(env: Env): Promise<ModelEntry[]> {
  const models: ModelEntry[] = [];
  const seenIds = new Set<string>();

  // 1. Get all active connections to know which providers are configured
  const connections = await getProviderConnections(env, { isActive: true });
  const configuredProviders = new Set(connections.map((c) => c.provider));

  // 2. Add static models for each configured provider
  for (const providerId of configuredProviders) {
    const def = getProvider(providerId);
    if (!def) continue;

    for (const model of def.models) {
      if (model.kind && model.kind !== "llm") continue; // Only LLM models
      const id = `${def.alias}/${model.id}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      models.push({
        id,
        object: "model",
        owned_by: def.alias,
      });
    }

    // Passthrough providers expose a single virtual entry
    if (isPassthroughProvider(providerId)) {
      const id = `${def.alias}/`;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        models.push({
          id: def.alias,
          object: "model",
          owned_by: def.alias,
        });
      }
    }
  }

  // 3. Add custom models from D1
  const customModels = await getCustomModels(env);
  for (const cm of customModels) {
    const providerAlias = cm.providerAlias as string;
    const modelId = cm.id as string;
    const type = (cm.type as string) || "llm";
    if (type !== "llm") continue;
    const id = `${providerAlias}/${modelId}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    models.push({
      id,
      object: "model",
      owned_by: providerAlias,
    });
  }

  // 4. Add combo names as virtual models
  const combos = await listCombos(env);
  for (const combo of combos) {
    if (seenIds.has(combo.name)) continue;
    seenIds.add(combo.name);
    models.push({
      id: combo.name,
      object: "model",
      owned_by: "combo",
    });
  }

  // 5. Add aliases as virtual models
  const aliases = await getModelAliases(env);
  for (const alias of Object.keys(aliases)) {
    if (seenIds.has(alias)) continue;
    seenIds.add(alias);
    models.push({
      id: alias,
      object: "model",
      owned_by: "alias",
    });
  }

  return models;
}
