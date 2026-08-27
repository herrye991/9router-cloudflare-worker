// Edge gateway entry — everything in index.js PLUS the /v1/embeddings LLM proxy,
// which reuses the open-sse engine (handleEmbeddingsCore).
//
// The open-sse executor registry eagerly imports a few Node-only builtins/packages
// that are never exercised at the edge, so this entry is bundled via the hardened
// build (cloud/build.mjs) and deployed with wrangler.edge.toml — not with the
// default `wrangler deploy`. See cloud/README.md.

import { route } from "./router.js";
import { handleEmbeddings } from "./handlers/embeddings.js";

export default {
  async fetch(request, env, ctx) {
    return route(request, env, ctx, { handleEmbeddings });
  },
};
