// Service worker di Vesuvio: l'app funziona anche offline.
// - interfaccia: rete prima (aggiornamenti immediati), cache se offline;
// - motori (file grandi): cache prima, scaricati una volta sola.
const VERSION = "1.0.0";
const SHELL = "vesuvio-shell-" + VERSION;
const CORES = "vesuvio-cores-ejs-4.2.3";

const SHELL_FILES = [
  "./", "index.html", "play.html", "manifest.webmanifest", "css/app.css",
  "js/home.js", "js/play.js", "js/engine.js", "js/session.js", "js/store.js", "js/db.js", "js/util.js",
  "js/rominfo.js", "js/zip.js", "js/settings.js", "js/themes.js", "js/controls.js", "js/icons.js", "js/ui.js",
  "assets/icon.svg", "assets/icon-180.png", "assets/icon-192.png", "assets/icon-512.png", "assets/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if ((key.startsWith("vesuvio-shell-") && key !== SHELL) || (key.startsWith("vesuvio-cores-") && key !== CORES)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(req, { signal: ctrl.signal, cache: "no-cache" });
    clearTimeout(t);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CORES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/cores/")) event.respondWith(cacheFirst(event.request));
  else event.respondWith(networkFirst(event.request));
});
