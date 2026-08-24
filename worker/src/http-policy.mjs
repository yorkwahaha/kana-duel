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
