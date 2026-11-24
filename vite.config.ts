import { execSync } from "node:child_process";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import react from "@vitejs/plugin-react";
import { build, defineConfig, type Plugin } from "vite";

/** Build id: UTC timestamp (sortable) plus the git commit or a random suffix. */
function createBuildVersion(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  let suffix = Math.random().toString(36).slice(2, 8);
  try {
    suffix = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() + suffix.slice(0, 3);
  } catch {
    // not a git checkout
  }
  return `${stamp}-${suffix}`;
}

const APP_VERSION = process.env.APP_VERSION ?? createBuildVersion();

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * Emits `version.json` and builds `sw.js` with the precache list of every
 * file in the output, so the worker and the shell always agree on a version.
 */
function createPwaPlugin(): Plugin {
  let outDir = "dist";
  let root = process.cwd();
  return {
    name: "graph-shift-pwa",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml(html) {
      return html.replace(/%APP_VERSION%/g, APP_VERSION);
    },
    async closeBundle() {
      const files = listFiles(outDir)
        .map((file) => relative(outDir, file).split(sep).join("/"))
        .filter((file) => !/^(sw\.js|version\.json)$/.test(file) && !file.endsWith(".map") && !file.startsWith("."))
        .sort();
      await build({
        configFile: false,
        root,
        logLevel: "warn",
        publicDir: false,
        define: {
          __APP_VERSION__: JSON.stringify(APP_VERSION),
          __PRECACHE__: JSON.stringify(files),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          minify: true,
          lib: { entry: resolve(root, "src/pwa/sw.ts"), formats: ["iife"], name: "graphShiftServiceWorker", fileName: () => "sw.js" },
        },
      });
      writeFileSync(join(outDir, "version.json"), JSON.stringify({ version: APP_VERSION, files }, null, 1) + "\n");
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), createPwaPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    sourcemap: false,
  },
});
