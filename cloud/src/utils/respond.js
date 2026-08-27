// Dependency-light JSON responders for the default worker (health/sync/auth).
// The edge LLM handlers use open-sse's errorResponse instead (fuller OpenAI shape);
// this keeps the default bundle free of any open-sse import.

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export function errorJson(status, message, extra = {}) {
  return json({ error: { message, ...extra } }, status);
}
