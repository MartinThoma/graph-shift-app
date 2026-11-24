/**
 * Pure service-worker decision logic, kept free of SW globals for unit tests.
 *
 * Cache strategy (Cloudflare tolerant):
 * - Every build has a version id; its cache is `graph-shift-<version>`.
 * - Install fetches the shell (index.html) with a cache-buster and `no-store`
 *   and only accepts it when its `<meta name="app-version">` equals the
 *   worker's own version. A stale edge copy is retried, and if it never
 *   matches, install fails and the old worker keeps serving a consistent set.
 * - Hashed assets are immutable by name; unhashed files get a cache-buster.
 * - Navigations are served from the worker's own cached shell, so HTML and
 *   hashed chunks always come from the same build.
 */

export const CACHE_PREFIX = "graph-shift-";
export const SHELL_KEY = "index.html";

export function createCacheName(version: string): string {
  return `${CACHE_PREFIX}${version}`;
}

/** Whether an HTML document was built as the given version. */
export function checkHtmlMatchesVersion(html: string, version: string): boolean {
  const match = /<meta\s+name=["']app-version["']\s+content=["']([^"']+)["']/i.exec(html);
  return !!match && match[1] === version;
}

/** Whether a file name carries a content hash (e.g. `index-B2x9_aZq.js`). */
export function checkHashedAsset(path: string): boolean {
  return /[-.][A-Za-z0-9_-]{8,}\.(js|css|woff2?|ttf|png|svg|webp|wasm)$/.test(path) && path.startsWith("assets/");
}

/**
 * Compare build versions (`YYYYMMDDTHHMMSSZ-xxxxxx`). Returns <0, 0, >0.
 * Versions are ordered by their timestamp prefix, then lexically.
 */
export function compareVersions(a: string, b: string): number {
  if (a === b) return 0;
  const ta = a.split("-")[0];
  const tb = b.split("-")[0];
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a < b ? -1 : 1;
}

/** Extract `v` from a worker script URL like `sw.js?v=20260101T000000Z-abc`. */
export function parseVersionFromScriptUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /[?&]v=([^&#]+)/.exec(url);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export type UpdateAction = "none" | "register";

/**
 * Decide whether a newer build should be installed. `known` lists the versions
 * of the active, waiting and installing workers. Stale (older) version
 * payloads from a CDN never trigger a downgrade.
 */
export function decideUpdateAction(current: string, remote: string | null, known: (string | null)[]): UpdateAction {
  if (!remote || compareVersions(remote, current) <= 0) return "none";
  for (const version of known) if (version && compareVersions(version, remote) >= 0) return "none";
  return "register";
}

/** Caches that belong to this app but not to the given version. */
export function selectStaleCaches(keys: string[], currentName: string): string[] {
  return keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== currentName);
}

export type RequestKind = "navigate" | "bypass" | "asset";

/** Classify a same-origin GET request relative to the worker scope. */
export function classifyRequest(url: URL, scope: URL, mode: string): RequestKind {
  if (!url.pathname.startsWith(scope.pathname)) return "bypass";
  const path = url.pathname.slice(scope.pathname.length);
  if (path === "version.json" || path === "sw.js") return "bypass";
  if (mode === "navigate") return "navigate";
  return "asset";
}

export interface FetchLike {
  (url: string, init?: RequestInit): Promise<Response>;
}

export interface PrecacheDeps {
  fetch: FetchLike;
  sleep: (ms: number) => Promise<void>;
}

export class StaleShellError extends Error {
  constructor(version: string) {
    super(`The server kept returning a shell that is not version ${version}`);
    this.name = "StaleShellError";
  }
}

/**
 * Fetch every asset of a build. Resolves with key -> response only when the
 * whole set is consistent; the caller writes them into a fresh cache.
 */
export async function fetchPrecacheSet(
  version: string,
  assets: string[],
  deps: PrecacheDeps,
  attempts = 4,
): Promise<Map<string, Response>> {
  const results = new Map<string, Response>();
  for (const asset of assets) {
    if (asset === SHELL_KEY) {
      let accepted: Response | null = null;
      for (let attempt = 0; attempt < attempts && !accepted; attempt++) {
        if (attempt > 0) await deps.sleep(400 * 2 ** (attempt - 1));
        try {
          const response = await deps.fetch(`${SHELL_KEY}?__v=${encodeURIComponent(version)}&__a=${attempt}`, { cache: "no-store" });
          if (!response.ok) continue;
          const html = await response.text();
          if (checkHtmlMatchesVersion(html, version)) {
            accepted = new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
          }
        } catch {
          // network error: retry
        }
      }
      if (!accepted) throw new StaleShellError(version);
      results.set(SHELL_KEY, accepted);
      continue;
    }
    const hashed = checkHashedAsset(asset);
    let response: Response | null = null;
    for (let attempt = 0; attempt < attempts && !response; attempt++) {
      if (attempt > 0) await deps.sleep(400 * 2 ** (attempt - 1));
      const url = hashed && attempt === 0 ? asset : `${asset}?__v=${encodeURIComponent(version)}&__a=${attempt}`;
      try {
        const r = await deps.fetch(url, { cache: hashed && attempt === 0 ? "default" : "no-store" });
        if (r.ok) response = r;
      } catch {
        // retry
      }
    }
    if (!response) throw new Error(`Could not fetch ${asset}`);
    results.set(asset, response);
  }
  return results;
}
