#!/usr/bin/env node
/**
 * Production build check:
 * - every versioned asset has a content hash in its file name,
 * - index.html, version.json and sw.js agree on one build version,
 * - the service worker precaches exactly the files in dist,
 * - no runtime code points at external hosts (zero server dependencies).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const errors = [];
const fail = (message) => errors.push(message);

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

if (!existsSync(dist)) {
  console.error("dist/ does not exist; run vite build first");
  process.exit(1);
}

const files = listFiles(dist).map((f) => relative(dist, f).split(sep).join("/"));
const html = readFileSync(join(dist, "index.html"), "utf8");
const versionFile = JSON.parse(readFileSync(join(dist, "version.json"), "utf8"));
const sw = readFileSync(join(dist, "sw.js"), "utf8");

// 1. Content hashes
const assets = files.filter((f) => f.startsWith("assets/"));
if (!assets.some((f) => f.endsWith(".js"))) fail("no JS bundle in assets/");
for (const asset of assets) {
  if (!/-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(asset)) fail(`asset without content hash: ${asset}`);
}

// 2. One version everywhere
const meta = /<meta name="app-version" content="([^"]+)"/.exec(html)?.[1];
if (!meta) fail("index.html has no app-version meta");
if (meta !== versionFile.version) fail(`index.html version ${meta} != version.json ${versionFile.version}`);
if (!sw.includes(versionFile.version)) fail("sw.js does not embed the build version");

// 3. index.html only references relative, hashed bundles
for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (/^https?:/.test(ref) || ref.startsWith("/")) fail(`index.html has a non-relative reference: ${ref}`);
  if (/\.(js|css)$/.test(ref) && !/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(ref)) fail(`unhashed bundle reference: ${ref}`);
}

// 4. Precache list == dist files (sw.js embeds the same list as version.json)
const expected = files.filter((f) => f !== "sw.js" && f !== "version.json").sort();
const listed = [...(versionFile.files ?? [])].sort();
const missing = expected.filter((f) => !listed.includes(f));
const extra = listed.filter((f) => !expected.includes(f));
if (missing.length) fail(`not precached: ${missing.join(", ")}`);
if (extra.length) fail(`precached but missing from dist: ${extra.join(", ")}`);
for (const f of listed) if (!sw.includes(f)) fail(`sw.js does not precache ${f}`);

// 5. No external hosts at runtime
const allowedHosts = new Set(["www.w3.org", "react.dev", "reactjs.org", "fb.me"]);
for (const file of files.filter((f) => /\.(js|css|html|webmanifest)$/.test(f))) {
  const text = readFileSync(join(dist, file), "utf8");
  for (const [, host] of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
    if (!allowedHosts.has(host.toLowerCase())) fail(`${file} references external host ${host}`);
  }
}

if (errors.length) {
  console.error("Build check failed:\n  - " + errors.join("\n  - "));
  process.exit(1);
}
console.log(`Build check passed: version ${versionFile.version}, ${assets.length} hashed assets, ${listed.length} precached files, no external hosts.`);
