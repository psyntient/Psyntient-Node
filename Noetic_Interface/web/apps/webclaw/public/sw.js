// Noetic Interface service worker — app-shell only, per the "PWA = shell
// only" product decision. Never intercepts /api/* (chat requires a live
// Gateway connection; there's nothing meaningful to serve offline there)
// or cross-origin requests.
//
// Three strategies, not one blanket stale-while-revalidate (the original
// version of this file used one, and it broke real navigation: the HTML
// document was served cache-first, so after a rebuild the cached HTML kept
// referencing content-hashed JS/CSS filenames that no longer existed on the
// (rebuilt) server, and CACHE_NAME never changed across deploys so the stale
// cache was never actually cleared - found via a real "ERR_FAILED" report,
// not proactively):
// - Navigation/HTML requests: network-first. Always get the current shell
//   when online (which then references the CURRENT asset hashes); only
//   fall back to cache when genuinely offline.
// - Content-hashed build assets (/assets/*): cache-first. Safe to cache
//   aggressively - the hash in the filename never changes meaning once
//   fetched, so a cache hit is always valid.
// - Everything else same-origin, including /brand/* icons and manifest.json:
//   network-first. These have STABLE filenames we edit in place (unlike
//   hashed build assets) - a real bug here (found 2026-08-25, not proactively):
//   they were lumped into the cache-first bucket above under the same
//   "filename never changes meaning" assumption, which is false for them.
//   Once cached, an edited icon was served stale forever, no revalidation,
//   no expiry - explains a real user report where the very first icon swap
//   showed up live (nothing cached yet) but every edit after didn't, even
//   after full app reinstalls, since the browser's Cache Storage survives
//   that. Small static images/JSON are cheap enough to always prefer network.
const CACHE_NAME = "noetic-shell-v3";

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
  const isHashedAsset = url.pathname.startsWith("/assets/");

  if (isNavigation || !isHashedAsset) {
    // Network-first: always prefer the current server response; only fall
    // back to a cached copy when genuinely offline.
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
