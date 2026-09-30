import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOST = "127.0.0.1";
const PORT = 8001;
const LOCAL_CONNECT = " http://127.0.0.1:8787 ws://127.0.0.1:8787";
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const CSP_LOCAL_MARKER = "wss://kana-voice-match-online.yorkwahaha.workers.dev; object-src";

function localHtml(buffer) {
  const html = buffer.toString("utf8");
  if (!html.includes(CSP_LOCAL_MARKER)) throw new Error("CSP_LOCAL_INJECT_FAILED");
  return html.replace(
    CSP_LOCAL_MARKER,
    `wss://kana-voice-match-online.yorkwahaha.workers.dev${LOCAL_CONNECT}; object-src`
  );
}

http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${HOST}:${PORT}`).pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const target = path.resolve(ROOT, relative);
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) throw new Error("INVALID_PATH");
    const extension = path.extname(target).toLowerCase();
    let body = await fs.readFile(target);
    if (relative === "index.html") body = localHtml(body);
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": MIME[extension] || "application/octet-stream",
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  } catch (error) {
    const injectFailed = error?.message === "CSP_LOCAL_INJECT_FAILED";
    if (injectFailed) process.stderr.write("CSP marker missing; local Worker address was not injected\n");
    response.writeHead(injectFailed ? 500 : 404, { "content-type": "text/plain; charset=utf-8" });
    response.end(injectFailed ? "CSP marker missing; local Worker address was not injected" : "Not found");
  }
}).listen(PORT, HOST, () => {
  process.stdout.write(`Kana Voice Match: http://${HOST}:${PORT}\n`);
});
