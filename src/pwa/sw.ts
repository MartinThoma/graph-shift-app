/// <reference lib="webworker" />
/**
 * Service worker: versioned precache, consistent app shell, prompt-to-update.
 * Built separately into `sw.js` with the precache list injected at build time.
 */
import {
  classifyRequest,
  createCacheName,
  fetchPrecacheSet,
  selectStaleCaches,
  SHELL_KEY,
} from "./swLogic";

declare const __APP_VERSION__: string;
declare const __PRECACHE__: string[];

const sw = self as unknown as ServiceWorkerGlobalScope;
const VERSION = __APP_VERSION__;
const CACHE = createCacheName(VERSION);
const scope = new URL(sw.registration.scope);

function resolveKey(path: string): string {
  return new URL(path, scope).href;
}

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const set = await fetchPrecacheSet(VERSION, __PRECACHE__, {
        fetch: (url, init) => fetch(resolveKey(url), init),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });
      // Write the complete, verified set into a fresh cache.
      await caches.delete(CACHE);
      const cache = await caches.open(CACHE);
      await Promise.all([...set].map(([path, response]) => cache.put(resolveKey(path), response)));
      // The very first install activates right away; updates wait for the user.
      if (!sw.registration.active) await sw.skipWaiting();
    })().catch(async (error) => {
      await caches.delete(CACHE);
      throw error;
    }),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(selectStaleCaches(keys, CACHE).map((key) => caches.delete(key)));
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("message", (event) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === "SKIP_WAITING") void sw.skipWaiting();
  if (data?.type === "GET_VERSION") event.ports[0]?.postMessage({ version: VERSION });
});

sw.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin) return;
  const kind = classifyRequest(url, scope, request.mode);
  if (kind === "bypass") return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (kind === "navigate") {
        const shell = await cache.match(resolveKey(SHELL_KEY), { ignoreVary: true });
        if (shell) return shell;
        return fetch(request);
      }
      // ignoreVary: module scripts carry an Origin header the precache request lacked.
      const cached =
        (await cache.match(request.url, { ignoreVary: true })) ?? (await cache.match(request.url, { ignoreVary: true, ignoreSearch: true }));
      if (cached) return cached;
      try {
        return await fetch(request);
      } catch {
        return new Response("Offline and not cached", { status: 504, statusText: "Offline" });
      }
    })(),
  );
});
