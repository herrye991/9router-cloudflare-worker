/**
 * Static provider registry for the Cloudflare Worker.
 *
 * This is a **curated subset** of the original 9Router provider registry
 * (open-sse/providers/registry/). Only providers that are:
 *   1. OpenAI-compatible (POST /v1/chat/completions, Bearer auth)
 *   2. API-key authenticated (no OAuth, no cookie, no local server)
 *   3. Cloudflare-safe (no Bun/Node/filesystem dependencies)
 *
 * are included here. The original registry has 100+ providers; most rely on
 * OAuth token refresh, local proxies, or Bun/Node-specific executors that
 * cannot run in a Cloudflare Worker. This subset covers the common
 * OpenAI-compatible API-key providers.
 *
 * To add a provider: add an entry to PROVIDERS with id, alias, transport,
 * and a models array. The router will pick it up automatically.
 */

import type { ProviderDefinition } from "../types";

export const PROVIDERS: Record<string, ProviderDefinition> = {
  openai: {
    id: "openai",
    alias: "openai",
    transport: {
      baseUrl: "https://api.openai.com/v1/chat/completions",
      forceStream: true,
      auth: { header: "Authorization", scheme: "bearer" },
    },
    models: [
      { id: "gpt-5.4", name: "GPT-5.4" },
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
      { id: "gpt-5.4-nano", name: "GPT-5.4 Nano" },
      { id: "gpt-5.2", name: "GPT-5.2" },
      { id: "gpt-5.1", name: "GPT-5.1" },
      { id: "gpt-5", name: "GPT-5" },
      { id: "gpt-5-mini", name: "GPT-5 Mini" },
      { id: "gpt-5-nano", name: "GPT-5 Nano" },
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
      { id: "gpt-4.1-nano", name: "GPT-4.1 Nano" },
      { id: "o3", name: "O3" },
      { id: "o3-mini", name: "O3 Mini" },
      { id: "o3-pro", name: "O3 Pro" },
      { id: "o4-mini", name: "O4 Mini" },
      { id: "o1", name: "O1" },
      { id: "o1-mini", name: "O1 Mini" },
    ],
  },

  anthropic: {
    id: "anthropic",
    alias: "anthropic",
    transport: {
      baseUrl: "https://api.anthropic.com/v1/messages",
      format: "claude",
      headers: { "anthropic-version": "2023-06-01" },
      auth: { header: "x-api-key", scheme: "raw" },
    },
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
    ],
  },

  openrouter: {
    id: "openrouter",
    alias: "openrouter",
    transport: {
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
      headers: {
        "HTTP-Referer": "https://9router.workers.dev",
        "X-Title": "9Router Cloudflare Worker",
      },
      auth: { header: "Authorization", scheme: "bearer" },
    },
    models: [],
    passthroughModels: true,
  },

  deepseek: {
    id: "deepseek",
    alias: "deepseek",
    transport: {
      baseUrl: "https://api.deepseek.com/v1/chat/completions",
      auth: { header: "Authorization", scheme: "bearer" },
    },
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
    ],
  },

  groq: {
    id: "groq",
    alias: "groq",
    transport: {
      baseUrl: "https://api.groq.com/openai/v1/chat/completions",
      auth: { header: "Authorization", scheme: "bearer" },
    },
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
    ],
  },

  fireworks: {
    id: "fireworks",
    alias: "fireworks",
    transport: {
      baseUrl: "https://api.fireworks.ai/inference/v1/chat/completions",
      auth: { header: "Authorization", scheme: "bearer" },
    },
    models: [],
    passthroughModels: true,
  },

  together: {
    id: "together",
    alias: "together",
    transport: {
      baseUrl: "https://api.together.xyz/v1/chat/completions",
      auth: { header: "Authorization", scheme: "bearer" },
    },
    models: [],
    passthroughModels: true,
  },

  mistral: {
    id: "mistral",
    alias: "mistral",
    transport: {
      baseUrl: "https://api.mistral.ai/v1/chat/completions",
      auth: { header: "Authorization", scheme: "bearer" },
    },
    models: [
      { id: "mistral-large-latest", name: "Mistral Large Latest" },
      { id: "mistral-small-latest", name: "Mistral Small Latest" },
      { id: "open-mistral-nemo", name: "Open Mistral Nemo" },
    ],
  },

  cerebras: {
    id: "cerebras",
    alias: "cerebras",
    transport: {
      baseUrl: "https://api.cerebras.ai/v1/chat/completions",
      auth: { header: "Authorization", scheme: "bearer" },
    },
    models: [],
    passthroughModels: true,
  },

  xai: {
    id: "xai",
    alias: "xai",
    transport: {
      baseUrl: "https://api.x.ai/v1/chat/completions",
      auth: { header: "Authorization", scheme: "bearer" },
    },
    models: [
      { id: "grok-4", name: "Grok 4" },
      { id: "grok-3", name: "Grok 3" },
      { id: "grok-2", name: "Grok 2" },
    ],
  },

  perplexity: {
    id: "perplexity",
    alias: "perplexity",
    transport: {
      baseUrl: "https://api.perplexity.ai/chat/completions",
      auth: { header: "Authorization", scheme: "bearer" },
    },
    models: [
      { id: "sonar-pro", name: "Sonar Pro" },
      { id: "sonar", name: "Sonar" },
    ],
  },

  cohere: {
    id: "cohere",
    alias: "cohere",
    transport: {
      baseUrl: "https://api.cohere.ai/v1/chat/completions",
      auth: { header: "Authorization", scheme: "bearer" },
    },
    models: [
      { id: "command-r-plus", name: "Command R+" },
      { id: "command-r", name: "Command R" },
    ],
  },
};

/** Alias → provider ID mapping (built from PROVIDERS). */
export const ALIAS_TO_ID: Record<string, string> = {};
for (const def of Object.values(PROVIDERS)) {
  ALIAS_TO_ID[def.id] = def.id;
  ALIAS_TO_ID[def.alias] = def.id;
  for (const a of def.aliases || []) ALIAS_TO_ID[a] = def.id;
}

/** Resolve a provider alias to its canonical ID. */
export function resolveProviderAlias(aliasOrId: string): string {
  return ALIAS_TO_ID[aliasOrId] || aliasOrId;
}

/** Get a provider definition by ID or alias. */
export function getProvider(idOrAlias: string): ProviderDefinition | undefined {
  const id = resolveProviderAlias(idOrAlias);
  return PROVIDERS[id];
}

/** Providers that accept any model name (passthrough). */
export function isPassthroughProvider(providerId: string): boolean {
  return PROVIDERS[providerId]?.passthroughModels === true;
}

/**
 * Infer provider from model name prefix (fallback when no provider/alias given).
 * Matches the original 9Router MODEL_PREFIX_PROVIDERS logic.
 */
const MODEL_PREFIX_PROVIDERS: [RegExp, string][] = [
  [/^claude-/, "anthropic"],
  [/^gemini-/, "openrouter"],
  [/^gpt-/, "openai"],
  [/^o[134]/, "openai"],
  [/^deepseek-/, "deepseek"],
  [/^llama-/, "groq"],
  [/^mistral-/, "mistral"],
  [/^mixtral-/, "mistral"],
  [/^grok-/, "xai"],
  [/^sonar/, "perplexity"],
  [/^command-/, "cohere"],
];

export function inferProviderFromModelName(modelName: string): string {
  if (!modelName) return "openai";
  const m = modelName.toLowerCase();
  return MODEL_PREFIX_PROVIDERS.find(([re]) => re.test(m))?.[1] || "openai";
}

