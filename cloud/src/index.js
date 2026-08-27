// Default cloud worker entry — dependency-light and deployable as-is.
//
// Serves the D1-backed cloud-sync + auth + health surface only. It deliberately
// does NOT import the open-sse engine, so `wrangler deploy` bundles cleanly with
// no build step or shims. The full edge gateway (which adds the /v1/embeddings
// LLM proxy by reusing open-sse) lives in index.edge.js and is an opt-in build —
// see cloud/README.md.

import { route } from "./router.js";

export default {
  async fetch(request, env, ctx) {
    return route(request, env, ctx);
  },
};
