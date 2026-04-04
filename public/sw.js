// tbr*a Service Worker — v1
// Minimal PWA: offline fallback + static asset caching

const CACHE_VERSION = "tbra-v3";
const OFFLINE_URL = "/offline.html";
const APP_SHELL_URL = "/app-shell.html";

// Pre-cache on install
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll([
        OFFLINE_URL,
        APP_SHELL_URL,
        "/icons/icon-192.png",
        "/icons/icon-512.png",
        "/icons/apple-touch-icon.png",
        "/manifest.webmanifest",
      ])
    )
  );
  // Activate immediately (don't wait for old SW to die)
  self.skipWaiting();
});

// Clean old caches on activate
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

// Fetch strategy
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== "GET") return;

  // Navigation requests (page loads): network-first with timeout fallback to app shell
  // If Vercel cold start takes >3 seconds, serve the cached app shell which auto-refreshes.
  // This prevents the 20+ second white screen on PWA cold starts.
  if (request.mode === "navigate") {
    const timeoutMs = 3000;
    event.respondWith(
      Promise.race([
        fetch(request),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs))
      ]).catch(() => {
        // Network failed or timed out — serve app shell with auto-refresh meta tag
        return caches.match(APP_SHELL_URL).then((shell) => {
          if (!shell) return caches.match(OFFLINE_URL);
          // Clone and inject a meta refresh so the page auto-retries after 1 second
          return shell.text().then((html) => {
            const refreshHtml = html.replace(
              "</head>",
              '<meta http-equiv="refresh" content="2">\n</head>'
            );
            return new Response(refreshHtml, {
              headers: { "Content-Type": "text/html" },
            });
          });
        });
      })
    );
    return;
  }

  // Static assets (JS, CSS, fonts, images): stale-while-revalidate
  const url = new URL(request.url);
  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".woff") ||
    url.pathname.endsWith(".css");

  if (isStaticAsset) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(request).then((cached) => {
          const fetchPromise = fetch(request)
            .then((response) => {
              // Only cache successful responses
              if (response.ok) {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => cached);

          // Return cached immediately, update in background
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Everything else: network only (API calls, dynamic content)
});
