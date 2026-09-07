/**
 * Tests for the 9Router Cloudflare Worker.
 *
 * These tests validate the core logic without requiring a real Cloudflare
 * Workers environment. They use a mock D1Database and mock fetch.
 *
 * Run with: npm test
 */

import assert from "node:assert";
import { errorResponse, HTTP_STATUS, checkFallbackError, getModelLockKey } from "../src/services/errors.ts";
import { parseModel, isValidModel } from "../src/services/model.ts";
import { resolveProviderAlias, inferProviderFromModelName } from "../src/providers/registry.ts";
import { extractApiKey, sha256, isApiKeyRequired } from "../src/services/auth.ts";

// ── Mock D1 Database ──────────────────────────────────────────────────

// @ts-ignore — used only in tests that need D1 mocking (not all tests)
class MockD1 {
  private tables: Record<string, Record<string, unknown>[]> = {};

  constructor() {
    this.tables = {
      apiKeys: [],
      providerConnections: [],
      combos: [],
      kv: [],
      settings: [],
      _meta: [{ key: "schemaVersion", value: "1" }],
    };
  }

  prepare(sql: string) {
    const self = this;
    return {
      bind(...params: (string | number | null)[]) {
        return {
          async first() {
            const rows = self._execute(sql, params);
            return rows[0] || null;
          },
          async all() {
            const rows = self._execute(sql, params);
            return { results: rows, success: true };
          },
          async run() {
            self._execute(sql, params);
            return { success: true };
          },
        };
      },
      async first() {
        const rows = self._execute(sql, []);
        return rows[0] || null;
      },
      async all() {
        const rows = self._execute(sql, []);
        return { results: rows, success: true };
      },
      async run() {
        self._execute(sql, []);
        return { success: true };
      },
    };
  }

  private _execute(sql: string, params: (string | number | null)[]) {
    const lower = sql.toLowerCase().trim();

    if (lower.startsWith("select")) {
      const fromMatch = sql.match(/from\s+(\w+)/i);
      if (!fromMatch) return [];
      const table = fromMatch[1];
      let rows = [...(this.tables[table] || [])];

      if (sql.includes("WHERE")) {
        const whereMatch = sql.match(/where\s+(\w+)\s*=\s*\?/i);
        if (whereMatch) {
          const col = whereMatch[1];
          const val = params.shift();
          rows = rows.filter((r) => r[col] === val);
        }
        const whereMatch2 = sql.match(/where\s+(\w+)\s*=\s*\?\s*and\s+(\w+)\s*=\s*\?/i);
        if (whereMatch2) {
          const col1 = whereMatch2[1];
          const val1 = params.shift();
          const col2 = whereMatch2[2];
          const val2 = params.shift();
          rows = rows.filter((r) => r[col1] === val1 && r[col2] === val2);
        }
      }

      return rows;
    }

    if (lower.startsWith("insert")) {
      const intoMatch = sql.match(/into\s+(\w+)/i);
      if (!intoMatch) return [];
      const table = intoMatch[1];
      this.tables[table] = this.tables[table] || [];
      const colsMatch = sql.match(/\(([^)]+)\)/);
      const cols = colsMatch ? colsMatch[1].split(",").map((c) => c.trim()) : [];
      const row: Record<string, unknown> = {};
      for (let i = 0; i < cols.length; i++) {
        row[cols[i]] = params[i];
      }
      this.tables[table].push(row);
      return [];
    }

    if (lower.startsWith("update")) {
      const updateMatch = sql.match(/update\s+(\w+)\s+set\s+.*where\s+(\w+)\s*=\s*\?/i);
      if (!updateMatch) return [];
      const table = updateMatch[1];
      const whereCol = updateMatch[2];
      const whereVal = params[params.length - 1];
      const rows = this.tables[table] || [];
      for (const row of rows) {
        if (row[whereCol] === whereVal) {
          const setMatch = sql.match(/set\s+(.*?)\s+where/i);
          if (setMatch) {
            const sets = setMatch[1].split(",").map((s) => s.trim());
            let paramIdx = 0;
            for (const s of sets) {
              const colMatch = s.match(/(\w+)\s*=\s*\?/);
              if (colMatch) {
                row[colMatch[1]] = params[paramIdx++];
              }
            }
          }
        }
      }
      return [];
    }

    return [];
  }
}

// ── Tests ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log("Running 9Router Cloudflare Worker tests...\n");

  // Test 1: errorResponse produces correct format
  {
    const res = errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    assert.strictEqual(res.status, 401);
    const body = (await res.json()) as { error: { type: string; message: string } };
    assert.strictEqual(body.error.type, "authentication_error");
    assert.strictEqual(body.error.message, "Invalid API key");
    console.log("✓ Test 1: errorResponse format");
  }

  // Test 2: checkFallbackError classifies rate limit
  {
    const result = checkFallbackError(429, "rate limit exceeded", 0);
    assert.strictEqual(result.shouldFallback, true);
    assert.ok(result.cooldownMs > 0);
    assert.ok(result.newBackoffLevel === 1);
    console.log("✓ Test 2: checkFallbackError rate limit");
  }

  // Test 3: checkFallbackError classifies auth error
  {
    const result = checkFallbackError(401, "invalid key", 0);
    assert.strictEqual(result.shouldFallback, true);
    assert.ok(result.cooldownMs > 0);
    console.log("✓ Test 3: checkFallbackError auth error");
  }

  // Test 4: parseModel parses provider/model format
  {
    const parsed = parseModel("openai/gpt-4o");
    assert.strictEqual(parsed.provider, "openai");
    assert.strictEqual(parsed.model, "gpt-4o");
    assert.strictEqual(parsed.isAlias, false);
    console.log("✓ Test 4: parseModel provider/model");
  }

  // Test 5: parseModel parses alias format
  {
    const parsed = parseModel("my-alias");
    assert.strictEqual(parsed.isAlias, true);
    assert.strictEqual(parsed.model, "my-alias");
    console.log("✓ Test 5: parseModel alias");
  }

  // Test 6: resolveProviderAlias resolves known aliases
  {
    assert.strictEqual(resolveProviderAlias("openai"), "openai");
    assert.strictEqual(resolveProviderAlias("unknown"), "unknown");
    console.log("✓ Test 6: resolveProviderAlias");
  }

  // Test 7: inferProviderFromModelName infers from prefix
  {
    assert.strictEqual(inferProviderFromModelName("gpt-4o"), "openai");
    assert.strictEqual(inferProviderFromModelName("claude-3"), "anthropic");
    assert.strictEqual(inferProviderFromModelName("unknown-model"), "openai");
    console.log("✓ Test 7: inferProviderFromModelName");
  }

  // Test 8: isValidModel checks static models
  {
    assert.strictEqual(isValidModel("openai", "gpt-4o"), true);
    assert.strictEqual(isValidModel("openai", "nonexistent-model"), false);
    assert.strictEqual(isValidModel("openrouter", "anything"), true);
    console.log("✓ Test 8: isValidModel");
  }

  // Test 9: getModelLockKey builds correct key
  {
    assert.strictEqual(getModelLockKey("gpt-4o"), "modelLock_gpt-4o");
    assert.strictEqual(getModelLockKey(null), "modelLock___all");
    console.log("✓ Test 9: getModelLockKey");
  }

  // Test 10: extractApiKey parses Bearer token
  {
    const req = new Request("https://example.com", {
      headers: { Authorization: "Bearer sk-test123" },
    });
    assert.strictEqual(extractApiKey(req), "sk-test123");
    console.log("✓ Test 10: extractApiKey Bearer");
  }

  // Test 11: extractApiKey parses x-api-key
  {
    const req = new Request("https://example.com", {
      headers: { "x-api-key": "sk-anthropic" },
    });
    assert.strictEqual(extractApiKey(req), "sk-anthropic");
    console.log("✓ Test 11: extractApiKey x-api-key");
  }

  // Test 12: sha256 produces consistent hash
  {
    const hash = await sha256("test");
    assert.strictEqual(hash.length, 64);
    const hash2 = await sha256("test");
    assert.strictEqual(hash, hash2);
    console.log("✓ Test 12: sha256 consistency");
  }

  // Test 13: isApiKeyRequired reads env var
  {
    const envTrue = { DB: new MockD1(), REQUIRE_API_KEY: "true" } as any;
    const envFalse = { DB: new MockD1(), REQUIRE_API_KEY: "false" } as any;
    assert.strictEqual(await isApiKeyRequired(envTrue), true);
    assert.strictEqual(await isApiKeyRequired(envFalse), false);
    console.log("✓ Test 13: isApiKeyRequired env var");
  }

  console.log("\n✅ All tests passed!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

