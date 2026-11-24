/**
 * Page-side update detection. Checks a tiny `version.json` (cache-busted,
 * `no-store`) on startup, on focus/visibility and periodically. A newer
 * version registers `sw.js?v=<version>`: the new URL bypasses stale edge
 * caches and installs the matching worker, which precaches in the background.
 * Activation waits for the user's "Reload".
 */
import { decideUpdateAction, parseVersionFromScriptUrl } from "./swLogic";

export interface AutoUpdateOptions {
  version: string;
  onUpdateReady: () => void;
  /** Called right before reloading into the new version (flush state). */
  onBeforeReload?: () => void;
  intervalMs?: number;
}

export interface AutoUpdateController {
  checkNow: () => Promise<void>;
  applyUpdate: () => void;
  dispose: () => void;
}

const MIN_CHECK_GAP_MS = 60_000;

export function startAutoUpdate(options: AutoUpdateOptions): AutoUpdateController {
  const noop: AutoUpdateController = { checkNow: async () => {}, applyUpdate: () => location.reload(), dispose: () => {} };
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return noop;

  let registration: ServiceWorkerRegistration | null = null;
  let lastCheck = 0;
  let reloading = false;
  let disposed = false;

  const watchWorker = (worker: ServiceWorker | null): void => {
    if (!worker) return;
    const report = (): void => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) options.onUpdateReady();
    };
    report();
    worker.addEventListener("statechange", report);
  };

  const attach = (reg: ServiceWorkerRegistration): void => {
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) options.onUpdateReady();
    watchWorker(reg.installing);
    reg.addEventListener("updatefound", () => watchWorker(reg.installing));
  };

  const register = async (version: string): Promise<void> => {
    const reg = await navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(version)}`, {
      scope: "./",
      updateViaCache: "none",
    });
    attach(reg);
  };

  const checkNow = async (force = false): Promise<void> => {
    if (disposed || !navigator.onLine) return;
    const now = Date.now();
    if (!force && now - lastCheck < MIN_CHECK_GAP_MS) return;
    lastCheck = now;
    try {
      const response = await fetch(`./version.json?t=${now}`, { cache: "no-store" });
      if (!response.ok) return;
      const remote = ((await response.json()) as { version?: string }).version ?? null;
      const known = registration
        ? [registration.active, registration.waiting, registration.installing].map((w) => parseVersionFromScriptUrl(w?.scriptURL))
        : [];
      if (decideUpdateAction(options.version, remote, known) === "register" && remote) await register(remote);
      else await registration?.update().catch(() => {});
    } catch {
      // offline or blocked: try again later
    }
  };

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) {
      options.onBeforeReload?.();
      location.reload();
    }
  });

  void (async () => {
    try {
      const existing = await navigator.serviceWorker.getRegistration("./");
      // Never re-register an existing registration with this page's (possibly older) version.
      if (existing) attach(existing);
      else await register(options.version);
    } catch {
      // registration can fail in private modes; the app still works online
    }
    void checkNow(true);
  })();

  const onVisible = (): void => {
    if (document.visibilityState === "visible") void checkNow();
  };
  const onFocus = (): void => void checkNow();
  const onOnline = (): void => void checkNow(true);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);
  const timer = setInterval(() => void checkNow(), options.intervalMs ?? 15 * 60_000);

  return {
    checkNow: () => checkNow(true),
    applyUpdate: () => {
      const waiting = registration?.waiting;
      if (!waiting) {
        options.onBeforeReload?.();
        location.reload();
        return;
      }
      reloading = true;
      waiting.postMessage({ type: "SKIP_WAITING" });
    },
    dispose: () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    },
  };
}
