import { describe, expect, it } from "vitest";
import {
  checkHashedAsset,
  checkHtmlMatchesVersion,
  classifyRequest,
  compareVersions,
  decideUpdateAction,
  fetchPrecacheSet,
  parseVersionFromScriptUrl,
  selectStaleCaches,
  StaleShellError,
} from "./swLogic";

const OLD = "20261101T100000Z-aaaaaa";
const NEW = "20261124T120000Z-bbbbbb";

function createHtml(version: string): string {
  return `<!doctype html><html><head><meta name="app-version" content="${version}"></head></html>`;
}

function createFetch(responses: Record<string, (() => Response)[]>) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    const path = url.split("?")[0];
    const queue = responses[path];
    if (!queue?.length) return new Response("missing", { status: 404 });
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    return next();
  };
  return { fetch, calls };
}

const noSleep = async () => {};

describe("Service worker precache", () => {
  it("accepts the shell only when it matches the worker's version", async () => {
    const { fetch, calls } = createFetch({
      "index.html": [() => new Response(createHtml(OLD)), () => new Response(createHtml(NEW))],
      "assets/index-Abcdefgh12.js": [() => new Response("js")],
    });
    const set = await fetchPrecacheSet(NEW, ["index.html", "assets/index-Abcdefgh12.js"], { fetch, sleep: noSleep });
    expect(await set.get("index.html")!.text()).toContain(NEW);
    expect(calls.filter((c) => c.startsWith("index.html"))).toHaveLength(2);
    expect(calls[0]).toMatch(/index\.html\?__v=/);
  });

  it("fails the install when the CDN keeps serving a stale shell, so the old worker stays", async () => {
    const { fetch } = createFetch({ "index.html": [() => new Response(createHtml(OLD))] });
    await expect(fetchPrecacheSet(NEW, ["index.html"], { fetch, sleep: noSleep })).rejects.toBeInstanceOf(StaleShellError);
  });

  it("retries hashed assets with a cache-buster when the first response fails", async () => {
    const { fetch, calls } = createFetch({
      "assets/app-Abcdefgh12.css": [() => new Response("", { status: 503 }), () => new Response("css")],
    });
    const set = await fetchPrecacheSet(NEW, ["assets/app-Abcdefgh12.css"], { fetch, sleep: noSleep });
    expect(await set.get("assets/app-Abcdefgh12.css")!.text()).toBe("css");
    expect(calls[0]).toBe("assets/app-Abcdefgh12.css");
    expect(calls[1]).toMatch(/\?__v=/);
  });

  it("fetches unhashed files with a cache-buster", async () => {
    const { fetch, calls } = createFetch({ "manifest.webmanifest": [() => new Response("{}")] });
    await fetchPrecacheSet(NEW, ["manifest.webmanifest"], { fetch, sleep: noSleep });
    expect(calls[0]).toMatch(/^manifest\.webmanifest\?__v=/);
  });

  it("fails when an asset is missing everywhere", async () => {
    const { fetch } = createFetch({});
    await expect(fetchPrecacheSet(NEW, ["assets/gone-Abcdefgh12.js"], { fetch, sleep: noSleep })).rejects.toThrow(/gone/);
  });
});

describe("Service worker update decisions", () => {
  it("orders versions by build timestamp", () => {
    expect(compareVersions(OLD, NEW)).toBeLessThan(0);
    expect(compareVersions(NEW, OLD)).toBeGreaterThan(0);
    expect(compareVersions(NEW, NEW)).toBe(0);
  });

  it("registers a newer remote version once", () => {
    expect(decideUpdateAction(OLD, NEW, [OLD])).toBe("register");
    expect(decideUpdateAction(OLD, NEW, [OLD, NEW])).toBe("none");
  });

  it("never downgrades when a CDN serves an older version payload", () => {
    expect(decideUpdateAction(NEW, OLD, [NEW])).toBe("none");
    expect(decideUpdateAction(NEW, null, [])).toBe("none");
  });

  it("reads the version from a worker script URL", () => {
    expect(parseVersionFromScriptUrl(`https://example.com/app/sw.js?v=${NEW}`)).toBe(NEW);
    expect(parseVersionFromScriptUrl("https://example.com/app/sw.js")).toBeNull();
  });

  it("deletes only this app's caches from other versions", () => {
    expect(selectStaleCaches(["graph-shift-a", "graph-shift-b", "other"], "graph-shift-b")).toEqual(["graph-shift-a"]);
  });

  it("detects the build version in HTML", () => {
    expect(checkHtmlMatchesVersion(createHtml(NEW), NEW)).toBe(true);
    expect(checkHtmlMatchesVersion(createHtml(OLD), NEW)).toBe(false);
    expect(checkHtmlMatchesVersion("<html></html>", NEW)).toBe(false);
  });

  it("recognizes content-hashed asset names", () => {
    expect(checkHashedAsset("assets/index-B2x9_aZq.js")).toBe(true);
    expect(checkHashedAsset("manifest.webmanifest")).toBe(false);
    expect(checkHashedAsset("icons/icon-192.png")).toBe(false);
  });

  it("serves navigations from the shell and lets version checks bypass the cache", () => {
    const scope = new URL("https://user.github.io/graph-shift-app/");
    expect(classifyRequest(new URL("https://user.github.io/graph-shift-app/?x=1"), scope, "navigate")).toBe("navigate");
    expect(classifyRequest(new URL("https://user.github.io/graph-shift-app/version.json?t=1"), scope, "cors")).toBe("bypass");
    expect(classifyRequest(new URL("https://user.github.io/graph-shift-app/sw.js?v=1"), scope, "no-cors")).toBe("bypass");
    expect(classifyRequest(new URL("https://user.github.io/graph-shift-app/assets/a-12345678.js"), scope, "cors")).toBe("asset");
    expect(classifyRequest(new URL("https://user.github.io/other/"), scope, "navigate")).toBe("bypass");
  });
});
