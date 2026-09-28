import assert from "node:assert/strict";
import test from "node:test";
import { allowSocketMessage, originAllowed, rateLimitAllowed, readJson } from "../worker/src/http-policy.mjs";

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

test("readJson parses objects and rejects invalid or oversized bodies", async () => {
  const ok = new Request("https://example.test/rooms", { method: "POST", body: '{"a":1}' });
  assert.deepEqual(await readJson(ok), { a: 1 });
  const empty = new Request("https://example.test/rooms", { method: "POST", body: "" });
  assert.deepEqual(await readJson(empty), {});
  const bad = new Request("https://example.test/rooms", { method: "POST", body: "{" });
  await assert.rejects(readJson(bad), /INVALID_JSON/);
  const huge = "x".repeat((256 * 1024) + 1);
  const oversized = new Request("https://example.test/rooms", { method: "POST", body: huge });
  await assert.rejects(readJson(oversized), /PAYLOAD_TOO_LARGE/);
});

test("readJson aborts a stream that exceeds the cap without a content-length", async () => {
  const chunks = [new Uint8Array(200 * 1024), new Uint8Array(200 * 1024)];
  let index = 0;
  const request = {
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true };
            return { done: false, value: chunks[index++] };
          },
          async cancel() {},
        };
      },
    },
  };
  await assert.rejects(readJson(request), /PAYLOAD_TOO_LARGE/);
  assert.equal(index, 2);
});

test("socket messages are limited per seat and recover in the next window", () => {
  const buckets = new Map();
  for (let i = 0; i < 30; i += 1) assert.equal(allowSocketMessage(buckets, 0, 1000), true);
  assert.equal(allowSocketMessage(buckets, 0, 1000), false);
  assert.equal(allowSocketMessage(buckets, 1, 1000), true);
  assert.equal(allowSocketMessage(buckets, 0, 11000), true);
});
