import assert from "node:assert/strict";
import test from "node:test";
import { originAllowed } from "../worker/src/http-policy.mjs";

const env = { ALLOWED_ORIGINS: "https://allowed.example" };

test("room APIs require an explicitly allowed Origin", () => {
  const request = (origin) => ({ headers: { get: () => origin } });
  assert.equal(originAllowed(request(null), env), false);
  assert.equal(originAllowed(request("https://blocked.example"), env), false);
  assert.equal(originAllowed(request("https://allowed.example"), env), true);
});
