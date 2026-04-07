// tbr*a Service Worker — v1
// Minimal PWA: offline fallback + static asset caching

const CACHE_VERSION = "tbra-v5";
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

  // Navigation requests (page loads): network-first with generous timeout.
  // Vercel cold starts + Turso can take 5-8 seconds. We wait up to 8s before
  // falling back to the app shell. The app shell uses JS-based retry with
  // exponential backoff instead of meta-refresh loops that hammer the server.
  if (request.mode === "navigate") {
    const timeoutMs = 8000;
    event.respondWith(
      Promise.race([
        fetch(request),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs))
      ]).catch(() => {
        // Network failed or timed out — serve app shell with smart retry
        return caches.match(APP_SHELL_URL).then((shell) => {
          if (!shell) return caches.match(OFFLINE_URL);
          return shell.text().then((html) => {
            // Inject JS-based retry with exponential backoff instead of meta refresh
            const retryScript = `<script>
              (function(){
                var delay = 3000;
                var maxDelay = 15000;
                function retry() {
                  fetch(location.href, {method:'HEAD'}).then(function(r){
                    if(r.ok) location.reload();
                    else schedule();
                  }).catch(schedule);
                }
                function schedule() {
                  setTimeout(retry, delay);
                  delay = Math.min(delay * 1.5, maxDelay);
                }
                schedule();
              })();
            </script>`;
            const retryHtml = html.replace("</body>", retryScript + "\n</body>");
            return new Response(retryHtml, {
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
