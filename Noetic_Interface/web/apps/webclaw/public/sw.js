// Noetic Interface service worker — app-shell only, per the "PWA = shell
// only" product decision. Never intercepts /api/* (chat requires a live
// Gateway connection; there's nothing meaningful to serve offline there)
// or cross-origin requests.
//
// Two different strategies, not one blanket stale-while-revalidate (the
// original version of this file used one, and it broke real navigation:
// the HTML document was served cache-first, so after a rebuild the cached
// HTML kept referencing content-hashed JS/CSS filenames that no longer
// existed on the (rebuilt) server, and CACHE_NAME never changed across
// deploys so the stale cache was never actually cleared - found via a
// real "ERR_FAILED" report, not proactively):
// - Navigation/HTML requests: network-first. Always get the current shell
//   when online (which then references the CURRENT asset hashes); only
//   fall back to cache when genuinely offline.
// - Everything else same-origin (JS/CSS/images): cache-first. Safe to
//   cache aggressively - content-hashed filenames never change meaning
//   once fetched, so a cache hit is always valid.
const CACHE_NAME = "noetic-shell-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  const isNavigation = request.mode === "navigate" || request.destination === "document";

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
