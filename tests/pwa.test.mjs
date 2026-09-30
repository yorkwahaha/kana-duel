import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function harness() {
  const stores = new Map();
  const listeners = new Map();
  const fetched = [];
  let offline = false;
  const base = "https://example.test/kana-duel/";
  const absolute = (key) => new URL(typeof key === "string" ? key : key.url, base).href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(keys) { for (const key of keys) store.set(absolute(key), new Response("shell")); },
        async match(key) { return store.get(absolute(key))?.clone(); },
        async put(key, response) { store.set(absolute(key), response.clone()); },
        async keys() { return [...store.keys()].map((url) => new Request(url)); },
        async delete(key) { return store.delete(absolute(key)); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const context = vm.createContext({ URL, Response, Request, caches,
    fetch: async (request) => { fetched.push(absolute(request)); if (offline) throw new Error("offline"); return new Response("network"); },
    self: { location: new URL(`${base}service-worker.js`), registration: { scope: base }, clients: { claim: async () => {} },
      addEventListener: (type, listener) => listeners.set(type, listener) },
  });
  vm.runInContext(fs.readFileSync(new URL("../service-worker.js", import.meta.url), "utf8"), context);
  const request = (url, mode = "cors") => ({ url: absolute(url), mode, method: "GET" });
  return { context, listeners, stores, caches, fetched, request, setOffline: () => { offline = true; } };
}

test("PWA manifest uses relative scope and real PNGs of declared dimensions", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.webmanifest", import.meta.url)));
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.start_url, "./");
  for (const icon of manifest.icons) {
    const bytes = fs.readFileSync(new URL(`../${icon.src}`, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
});

test("every precached shell URL exists and includes the current page scripts and styles", () => {
  const h = harness();
  const urls = vm.runInContext("SHELL", h.context);
  for (const url of urls) {
    const relative = new URL(url).pathname.slice("/kana-duel/".length) || "index.html";
    assert.ok(fs.existsSync(new URL(`../${relative}`, import.meta.url)), relative);
  }
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const match of html.matchAll(/(?:src|href)="((?:game[^" ]*|online|questions[^" ]*|pwa)\.js[^" ]*|(?:styles|special-vfx)\.css[^" ]*)"/g)) {
    assert.ok(urls.includes(new URL(match[1], "https://example.test/kana-duel/").href), match[1]);
  }
});

test("installed shell opens offline at a Pages subpath and ignores invite query cache", async () => {
  const h = harness();
  let install;
  h.listeners.get("install")({ waitUntil(promise) { install = promise; } });
  await install;
  h.setOffline();
  const response = await h.context.routeRequest(h.request("./?room=AB2C3D", "navigate"));
  assert.equal(await response.text(), "shell");
  assert.ok([...h.stores.values()].every((store) => [...store.keys()].every((url) => !url.includes("room="))));
});

test("API, credentials, video and cross-origin requests never enter caches", async () => {
  const h = harness();
  for (const url of ["rooms/AB2C3D", "assets/anim/ao-cast.mp4", "game.js?token=secret", "https://api.example.test/rooms"]) {
    await h.context.routeRequest(h.request(url));
  }
  assert.equal([...h.stores.values()].reduce((size, store) => size + store.size, 0), 0);
});

test("on-demand media cache is bounded and obsolete owned caches are removed", async () => {
  const h = harness();
  for (let i = 0; i < 60; i++) await h.context.routeRequest(h.request(`assets/audio/questions/fish-92428785/q${i}.mp3`));
  assert.ok([...h.stores.values()].reduce((size, store) => size + store.size, 0) <= 48);
  await h.caches.open("kana-duel-old-shell");
  await h.caches.open("unrelated-app-cache");
  let activate;
  h.listeners.get("activate")({ waitUntil(promise) { activate = promise; } });
  await activate;
  assert.equal(h.stores.has("kana-duel-old-shell"), false);
  assert.equal(h.stores.has("unrelated-app-cache"), true);
});
