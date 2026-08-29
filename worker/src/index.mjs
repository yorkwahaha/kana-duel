import { DurableObject } from "cloudflare:workers";
import { originAllowed, rateLimitAllowed } from "./http-policy.mjs";
import {
  ROOM_TTL_MS,
  applyAttack,
  applySkill,
  applySkip,
  applySubmit,
  configureRoom,
  createRoomState,
  joinRoom,
  leaveRoom,
  nextTimedEffectAt,
  publicRoomState,
  roomExpired,
  sanitizeRoomCode,
  seatForToken,
  setConnected,
  setReady,
  settleTimedEffects,
} from "./room-core.mjs";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomString(length, alphabet = ROOM_ALPHABET) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > 256 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
  return JSON.parse(text || "{}");
}

function websocketToken(request) {
  const protocols = String(request.headers.get("sec-websocket-protocol") || "")
    .split(",")
    .map((value) => value.trim());
  return protocols.find((value) => value.startsWith("kana-token."))?.slice("kana-token.".length) || "";
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  return origin && originAllowed(request, env) ? {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  } : { vary: "Origin" };
}

function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request, env)).forEach(([name, value]) => headers.set(name, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function roomStub(env, code) {
  return env.ROOMS.getByName(code);
}

function proxyRoom(env, code, path, init) {
  return roomStub(env, code).fetch(`https://room.internal${path}`, init);
}

export class RoomObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.initialized = ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get("room")) || null;
    });
  }

  async save() {
    if (!this.room) return;
    await this.ctx.storage.put("room", this.room);
    const expiryAt = this.room.lastActiveAt + ROOM_TTL_MS;
    const timedEffectAt = nextTimedEffectAt(this.room);
    await this.ctx.storage.setAlarm(timedEffectAt > 0 ? Math.min(expiryAt, timedEffectAt) : expiryAt);
  }

  send(ws, payload) {
    if (ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(payload)); } catch (_) {}
  }

  broadcast() {
    if (!this.room) return;
    this.ctx.getWebSockets().forEach((ws) => {
      const { seat } = ws.deserializeAttachment() || {};
      this.send(ws, { type: "state", room: publicRoomState(this.room, seat) });
    });
  }

  async fetch(request) {
    await this.initialized;
    const url = new URL(request.url);
    if (url.pathname === "/create" && request.method === "POST") {
      if (this.room && !roomExpired(this.room)) return json({ error: "ROOM_EXISTS" }, 409);
      const body = await readJson(request);
      try {
        this.room = createRoomState({
          roomCode: body.roomCode,
          hostName: body.playerName,
          hostToken: body.token,
          config: body.config,
          deck: body.deck,
        });
      } catch (error) {
        return json({ error: error.message || "INVALID_ROOM" }, 400);
      }
      await this.save();
      return json({ token: body.token, room: publicRoomState(this.room, 0) }, 201);
    }
    if (!this.room || roomExpired(this.room)) return json({ error: "ROOM_NOT_FOUND" }, 404);
    if (url.pathname === "/join" && request.method === "POST") {
      const body = await readJson(request);
      const result = joinRoom(this.room, { name: body.playerName, token: body.token });
      if (!result.ok) return json({ error: result.error }, result.error === "ROOM_FULL" ? 409 : 400);
      await this.save();
      this.broadcast();
      return json({ token: body.token, room: publicRoomState(this.room, result.seat) });
    }
    if (url.pathname === "/leave" && request.method === "POST") {
      const body = await readJson(request);
      const seat = seatForToken(this.room, body.token);
      if (seat < 0) return json({ error: "INVALID_SESSION" }, 401);
      const result = leaveRoom(this.room, seat);
      if (!result.ok) return json({ error: result.error }, 400);
      await this.save();
      this.broadcast();
      return json({ ok: true });
    }
    if (url.pathname === "/ws" && request.headers.get("upgrade") === "websocket") {
      const seat = seatForToken(this.room, websocketToken(request));
      if (seat < 0) return json({ error: "INVALID_SESSION" }, 401);
      this.ctx.getWebSockets(`seat:${seat}`).forEach((previous) => {
        try { previous.close(4001, "Reconnected from another tab"); } catch (_) {}
      });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [`seat:${seat}`]);
      server.serializeAttachment({ seat });
      setConnected(this.room, seat, true);
      await this.save();
      this.broadcast();
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "sec-websocket-protocol": "kana-voice-match-v1" },
      });
    }
    return json({ error: "NOT_FOUND" }, 404);
  }

  async webSocketMessage(ws, raw) {
    await this.initialized;
    if (!this.room || typeof raw !== "string") return;
    const { seat } = ws.deserializeAttachment() || {};
    const player = this.room.players[seat];
    if (!player) return;
    let command;
    try { command = JSON.parse(raw); } catch (_) {
      this.send(ws, { type: "error", code: "INVALID_MESSAGE" });
      return;
    }
    if (command.type === "sync") {
      this.send(ws, { type: "state", room: publicRoomState(this.room, seat) });
      return;
    }
    if (command.actionId && player.lastActionId === command.actionId) {
      this.send(ws, { type: "state", room: publicRoomState(this.room, seat) });
      return;
    }
    if (command.version !== this.room.version) {
      this.send(ws, { type: "error", code: "STALE_STATE", room: publicRoomState(this.room, seat) });
      return;
    }
    let result = { ok: false, error: "UNKNOWN_COMMAND" };
    if (command.type === "ready") result = setReady(this.room, seat, command);
    else if (command.type === "configure") result = configureRoom(this.room, seat, command.config, command.deck);
    else if (command.type === "submit") result = applySubmit(this.room, seat, command);
    else if (command.type === "skip") result = applySkip(this.room, seat);
    else if (command.type === "attack") result = applyAttack(this.room, seat);
    else if (command.type === "skill") result = applySkill(this.room, seat, command.skill);
    else if (command.type === "leave") result = leaveRoom(this.room, seat);
    if (!result.ok) {
      // A due regeneration tick may have settled before this command was rejected.
      // Persist and show that authoritative timer change even though the requested action failed.
      if (this.room.version !== command.version) {
        await this.save();
        this.broadcast();
      }
      this.send(ws, { type: "error", code: result.error, room: publicRoomState(this.room, seat) });
      return;
    }
    const current = this.room.players[seat];
    if (current) current.lastActionId = command.actionId || current.lastActionId;
    await this.save();
    this.broadcast();
  }

  async markDisconnected(ws) {
    await this.initialized;
    if (!this.room) return;
    const { seat } = ws.deserializeAttachment() || {};
    const another = this.ctx.getWebSockets(`seat:${seat}`)
      .some((candidate) => candidate !== ws && candidate.readyState === WebSocket.OPEN);
    if (!another && setConnected(this.room, seat, false)) {
      await this.save();
      this.broadcast();
    }
  }

  async webSocketClose(ws) { await this.markDisconnected(ws); }
  async webSocketError(ws) { await this.markDisconnected(ws); }
  async alarm() {
    await this.initialized;
    if (!roomExpired(this.room)) {
      const heals = settleTimedEffects(this.room);
      await this.save();
      if (heals.length) this.broadcast();
      return;
    }
    this.ctx.getWebSockets().forEach((ws) => { try { ws.close(4000, "Room expired"); } catch (_) {} });
    this.room = null;
    await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "kana-voice-match-online" }, 200, cors);
    }
    if (request.method === "OPTIONS") {
      return originAllowed(request, env) ? new Response(null, { status: 204, headers: cors }) : json({ error: "ORIGIN_NOT_ALLOWED" }, 403, cors);
    }
    if (!originAllowed(request, env)) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403, cors);
    if (url.pathname === "/rooms" && request.method === "POST") {
      if (!await rateLimitAllowed(request, env.CREATE_RATE_LIMITER, "create")) {
        return json({ error: "RATE_LIMITED" }, 429, { ...cors, "retry-after": "60" });
      }
      let body;
      try { body = await readJson(request); } catch (error) { return json({ error: error.message || "INVALID_JSON" }, 400, cors); }
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomString(6);
        const token = randomString(32, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_");
        const response = await proxyRoom(env, code, "/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, roomCode: code, token }),
        });
        if (response.status !== 409) return withCors(response, request, env);
      }
      return json({ error: "ROOM_CODE_UNAVAILABLE" }, 503, cors);
    }
    const join = url.pathname.match(/^\/rooms\/([A-Z2-9]{6})\/join$/i);
    if (join && request.method === "POST") {
      if (!await rateLimitAllowed(request, env.JOIN_RATE_LIMITER, "join")) {
        return json({ error: "RATE_LIMITED" }, 429, { ...cors, "retry-after": "60" });
      }
      const code = sanitizeRoomCode(join[1]);
      let body;
      try { body = await readJson(request); } catch (error) { return json({ error: error.message || "INVALID_JSON" }, 400, cors); }
      const token = randomString(32, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_");
      return withCors(await proxyRoom(env, code, "/join", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, token }),
      }), request, env);
    }
    const leave = url.pathname.match(/^\/rooms\/([A-Z2-9]{6})\/leave$/i);
    if (leave && request.method === "POST") {
      const body = await readJson(request).catch(() => ({}));
      return withCors(await proxyRoom(env, sanitizeRoomCode(leave[1]), "/leave", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: body.token }),
      }), request, env);
    }
    const ws = url.pathname.match(/^\/rooms\/([A-Z2-9]{6})\/ws$/i);
    if (ws && request.headers.get("upgrade") === "websocket") {
      return proxyRoom(env, sanitizeRoomCode(ws[1]), "/ws", {
        headers: {
          upgrade: "websocket",
          "sec-websocket-protocol": request.headers.get("sec-websocket-protocol") || "",
        },
      });
    }
    return json({ error: "NOT_FOUND" }, 404, cors);
  },
};
