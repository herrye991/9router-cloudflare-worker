// CORS helpers shared by all cloud worker handlers.

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, X-9Router-Token-Saver",
  "Access-Control-Max-Age": "86400",
};

/** Answer a CORS preflight. 200 + empty body (matches the embeddings test contract). */
export function handleOptions() {
  return new Response(null, { status: 200, headers: { ...CORS_HEADERS } });
}

/**
 * Return a copy of `response` with CORS headers applied. We rebuild the Response
 * (rather than mutating) because headers on a fetched/forwarded Response may be
 * immutable in some runtimes.
 */
export function addCorsHeaders(response) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}
