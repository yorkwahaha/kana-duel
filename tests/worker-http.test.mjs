import assert from "node:assert/strict";
import test from "node:test";
import { originAllowed, rateLimitAllowed } from "../worker/src/http-policy.mjs";

const env = { ALLOWED_ORIGINS: "https://allowed.example" };

test("room APIs require an explicitly allowed Origin", () => {
  const request = (origin) => ({ headers: { get: () => origin } });
  assert.equal(originAllowed(request(null), env), false);
  assert.equal(originAllowed(request("https://blocked.example"), env), false);
  assert.equal(originAllowed(request("https://allowed.example"), env), true);
});

test("room creation and joining can be rate limited by route and client address", async () => {
  const keys = [];
  const limiter = { limit: async ({ key }) => { keys.push(key); return { success: keys.length === 1 }; } };
  const request = { headers: { get: (name) => name === "cf-connecting-ip" ? "203.0.113.9" : "" } };
  assert.equal(await rateLimitAllowed(request, limiter, "create"), true);
  assert.equal(await rateLimitAllowed(request, limiter, "join"), false);
  assert.deepEqual(keys, ["create:203.0.113.9", "join:203.0.113.9"]);
});

test("missing rate-limit bindings fail open for unit and local environments", async () => {
  const request = { headers: { get: () => "" } };
  assert.equal(await rateLimitAllowed(request, undefined, "create"), true);
});
