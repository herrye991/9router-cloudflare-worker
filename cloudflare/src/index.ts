/**
 * 9Router Cloudflare Worker — Entry Point
 *
 * A small Hono app that exposes OpenAI-compatible endpoints:
 *   GET  /                  — health/root
 *   GET  /v1/models         — list available models
 *   POST /v1/chat/completions — chat completion (streaming + non-streaming)
 *
 * All logic is Cloudflare-native: Hono + D1 + Web fetch + Web Streams.
 * No Bun, Node, SQLite-local, filesystem, or Express dependencies.
 */

import { Hono } from "hono";
import type { Env } from "./types";
import { checkAuth } from "./services/auth";
import { buildModelsList } from "./services/models";
import { handleChatCompletion } from "./services/router";
import { errorResponse, HTTP_STATUS } from "./services/errors";

const app = new Hono<{ Bindings: Env }>();

// ── CORS ─────────────────────────────────────────────────────────────

app.use("*", async (c, next) => {
  // Handle CORS preflight
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }
  await next();
  // Add CORS headers to all responses
  c.header("Access-Control-Allow-Origin", "*");
});

// ── Health ────────────────────────────────────────────────────────────

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// ── GET /v1/models ────────────────────────────────────────────────────

app.get("/v1/models", async (c) => {
  // Auth check
  const authError = await checkAuth(c.env, c.req.raw);
  if (authError) return authError;

  try {
    const data = await buildModelsList(c.env);
    return c.json({ object: "list", data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    return errorResponse(HTTP_STATUS.SERVER_ERROR, msg);
  }
});

// ── POST /v1/chat/completions ─────────────────────────────────────────

app.post("/v1/chat/completions", async (c) => {
  // Auth check
  const authError = await checkAuth(c.env, c.req.raw);
  if (authError) return authError;

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Validate model field
  const modelStr = body.model as string;
  if (!modelStr) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: model");
  }

  // Route the request
  const response = await handleChatCompletion(c.env, body, modelStr);
  return response;
});

// ── Fallback: serve static assets or 404 for API ──────────────────────
// Non-API paths fall through to the ASSETS binding (serves index.html for SPA).
// API paths that didn't match any route get a proper 404.

app.all("*", async (c) => {
  if (c.req.path.startsWith("/v1") || c.req.path.startsWith("/api")) {
    return errorResponse(
      HTTP_STATUS.NOT_FOUND,
      `Endpoint not found: ${c.req.method} ${c.req.path}`
    );
  }
  // Serve static assets (SPA dashboard)
  return c.env.ASSETS.fetch(c.req.raw);
});

// ── Export ────────────────────────────────────────────────────────────

export default app;
