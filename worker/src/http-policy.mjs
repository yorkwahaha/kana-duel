function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function originAllowed(request, env) {
  const origin = request.headers.get("origin");
  return !!origin && allowedOrigins(env).includes(origin);
}

export async function rateLimitAllowed(request, limiter, action) {
  if (!limiter?.limit) return true;
  const forwarded = String(request.headers.get("cf-connecting-ip") || "")
    || String(request.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || "local";
  const result = await limiter.limit({ key: `${action}:${forwarded}` });
  return result.success;
}

const MAX_JSON_BYTES = 256 * 1024;

export async function readJson(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const parts = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_JSON_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw new Error("INVALID_JSON"); }
}

// Per-seat socket budget. Every overflow is rejected; the caller answers each one.
export function allowSocketMessage(buckets, seat, now, limit = 30, windowMs = 10000) {
  const bucket = buckets.get(seat) || { start: now, count: 0 };
  if (now - bucket.start >= windowMs) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  buckets.set(seat, bucket);
  return bucket.count <= limit;
}
