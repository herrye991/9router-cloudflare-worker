// Shared request router for the cloud worker. Both entries (index.js = default
// dependency-light build, index.edge.js = full edge gateway) funnel through here.
//
// Routes:
//   GET  /                              → service info
//   GET  /health                        → liveness + D1 ping
//   GET  /sync/{machineId}              → pull machine state (authed)
//   PUT|POST /sync/{machineId}          → push machine state (authed)
//   DELETE /sync/{machineId}            → wipe machine state (authed)
//   POST [/ {machineId}/]/v1/embeddings → edge embeddings proxy (edge build only)
//
// The optional leading "/{machineId}" segment supports legacy API keys that don't
// embed a machineId (mirrors the hosted 9cli service).

import { handleHealth } from "./handlers/health.js";
import { handleSyncPull, handleSyncPush, handleSyncDelete } from "./handlers/sync.js";
import { handleOptions, addCorsHeaders } from "./utils/cors.js";
import { json, errorJson } from "./utils/respond.js";
import * as log from "./utils/logger.js";

const RESERVED = new Set(["v1", "sync", "health", "api"]);
const ID_RE = /^[a-z0-9]{4,32}$/i;

const ENDPOINTS = [
  "GET /health",
  "GET|PUT|DELETE /sync/{machineId}",
  "POST /v1/embeddings (edge build)",
  "POST /{machineId}/v1/embeddings (edge build)",
];

export async function route(request, env, ctx, handlers = {}) {
  if (request.method === "OPTIONS") return handleOptions();

  const url = new URL(request.url);
  let segments = url.pathname.split("/").filter(Boolean);

  try {
    if (segments.length === 0) {
      return addCorsHeaders(json({ service: "9router-cloud", ok: true, endpoints: ENDPOINTS }));
    }

    if (segments[0] === "health") {
      return addCorsHeaders(await handleHealth(env));
    }

    // Optional leading machineId segment.
    let machineIdOverride = null;
    if (!RESERVED.has(segments[0]) && ID_RE.test(segments[0])) {
      machineIdOverride = segments[0];
      segments = segments.slice(1);
    }

    // Cloud sync.
    if (segments[0] === "sync") {
      const machineId = machineIdOverride || segments[1] || null;
      if (request.method === "GET") return addCorsHeaders(await handleSyncPull(request, env, ctx, machineId));
      if (request.method === "PUT" || request.method === "POST") return addCorsHeaders(await handleSyncPush(request, env, ctx, machineId));
      if (request.method === "DELETE") return addCorsHeaders(await handleSyncDelete(request, env, ctx, machineId));
      return addCorsHeaders(errorJson(405, "Method not allowed"));
    }

    // Edge LLM proxy (only wired in the edge build).
    if (segments[0] === "v1" && segments[1] === "embeddings" && request.method === "POST") {
      if (typeof handlers.handleEmbeddings !== "function") {
        return addCorsHeaders(errorJson(
          503,
          "Embeddings edge route is not enabled in this build. Deploy the edge bundle (wrangler.edge.toml) — see cloud/README.md.",
        ));
      }
      return await handlers.handleEmbeddings(request, env, ctx, machineIdOverride);
    }

    return addCorsHeaders(errorJson(404, "Not found"));
  } catch (e) {
    log.error("ROUTER", `Unhandled error: ${e?.message || e}`);
    return addCorsHeaders(errorJson(500, "Internal error"));
  }
}
