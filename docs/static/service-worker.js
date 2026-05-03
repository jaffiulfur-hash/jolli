const JOLLI_CACHE = "jolli-mobile-v1";

const FILES_TO_CACHE = [
    "/",
    "/static/style.css",
    "/static/app.js",
    "/static/manifest.json"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(JOLLI_CACHE).then((cache) => {
            return cache.addAll(FILES_TO_CACHE);
        })
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) => key !== JOLLI_CACHE)
                    .map((key) => caches.delete(key))
            );
        })
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") {
        return;
    }

    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});
