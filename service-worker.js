/* global self, caches, Response */
// Change VERSION whenever shell files change; activation waits for old tabs to close.
const VERSION = "20261001-3";
const PREFIX = "kana-duel-";
const SHELL_CACHE = `${PREFIX}${VERSION}-shell`;
const MEDIA_CACHE = `${PREFIX}${VERSION}-media`;
const scopeUrl = new URL(self.registration.scope);
const scriptVersion = "20261001";
const SHELL = ["./", "index.html", "manifest.webmanifest", "assets/cover.png", "assets/icons/icon-192.png", "assets/icons/icon-512.png",
  "assets/audio/questions/manifest.json", `styles.css?v=${scriptVersion}`, `special-vfx.css?v=${scriptVersion}`,
  ...["questions-data", "questions-expansion-data", "game-content", "game-audio", "game-vfx", "online", "game", "game-online"].map((name) => `${name}.js?v=${scriptVersion}`),
  "game-learning.js?v=20261001", "pwa.js?v=20261001",
  ...["ao", "rin", "ya", "go", "ran", "gen", "sho", "yo"].map((name) => `assets/characters/${name}.webp`),
].map((path) => new URL(path, scopeUrl).href);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== SHELL_CACHE && name !== MEDIA_CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Serial cache writes keep the 48-entry bound even with concurrent media requests.
let mediaWrites = Promise.resolve();
async function routeRequest(request) {
  const url = new URL(request.url);
  const sameScope = url.origin === scopeUrl.origin && url.pathname.startsWith(scopeUrl.pathname);
  if (request.method !== "GET" || !sameScope) return fetch(request);
  const relative = url.pathname.slice(scopeUrl.pathname.length);
  if (request.mode === "navigate" && (relative === "" || relative === "index.html")) {
    // Never persist navigation URLs containing invite or other parameters.
    try { return await fetch(request); }
    catch {
      const cached = await (await caches.open(SHELL_CACHE)).match(new URL("index.html", scopeUrl).href);
      return cached || new Response("首次使用需先連網載入遊戲。", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  }
  if (SHELL.includes(url.href)) {
    const cache = await caches.open(SHELL_CACHE);
    return await cache.match(request) || fetch(request);
  }
  const media = !url.search && /^assets\/(audio\/questions\/fish-92428785\/[a-z0-9_]+\.mp3|characters\/[a-z0-9-]+\.webp|sfx\/[a-z0-9_]+\.mp3|bgm\/[a-z0-9-]+\.ogg)$/.test(relative);
  if (!media) return fetch(request);
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Audio HTML elements can request byte ranges; cache only complete 200 bodies.
  if (response.status === 200 && response.type !== "opaque") {
    const copy = response.clone();
    mediaWrites = mediaWrites.catch(() => {}).then(async () => {
      await cache.put(request, copy);
      const keys = await cache.keys();
      for (const key of keys.slice(0, Math.max(0, keys.length - 48))) await cache.delete(key);
    });
    await mediaWrites.catch(() => {});
  }
  return response;
}
self.addEventListener("fetch", (event) => { event.respondWith(routeRequest(event.request)); });
