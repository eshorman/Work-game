// Keeps Eevie's games working with no internet.
// If you ever change the icons or manifest, bump this version so devices refresh them.
const CACHE = "eevie-v1";

const CORE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Grandstander:wght@600;800;900&display=swap";

// Grab the font stylesheet and its font files during install, so even the very first offline launch looks right.
async function cacheFonts(cache){
  try{
    const res = await fetch(FONT_CSS);
    if (!res.ok) return;
    await cache.put(FONT_CSS, res.clone());
    const css = await res.text();
    const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g)].map(m => m[1]);
    await Promise.all(urls.map(u => fetch(u, { mode: "cors" }).then(r => r.ok ? cache.put(u, r) : null).catch(() => null)));
  }catch(e){ /* no font offline just means the fallback rounded font is used */ }
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    await cacheFonts(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("eevie-") && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function withTimeout(ms, promise){
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // The page itself: try the network briefly so your edits show up, otherwise use the saved copy.
  if (req.mode === "navigate"){
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try{
        const res = await withTimeout(3000, fetch(req));
        if (res.ok) cache.put("./index.html", res.clone());
        return res;
      }catch(e){
        return (await cache.match("./index.html")) || (await cache.match("./")) || Response.error();
      }
    })());
    return;
  }

  // Icons, manifest and other files from the site: saved copy first, network as backup.
  if (url.origin === self.location.origin){
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Google Fonts: saved copy first, refresh in the background when online.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"){
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreVary: true });
      const network = fetch(req).then(res => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; }).catch(() => null);
      if (hit){ event.waitUntil(network); return hit; }
      return (await network) || Response.error();
    })());
  }
});
