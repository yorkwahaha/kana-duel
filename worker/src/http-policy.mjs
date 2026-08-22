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
