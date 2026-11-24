#!/usr/bin/env node
/**
 * Serve dist/ on all interfaces. Uses PORT (default 4173) or, if that port is
 * busy, the next free one, then prints every URL the app is reachable at.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";

const startPort = Number(process.env.PORT) || 4173;

function checkPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "0.0.0.0");
  });
}

async function findFreePort(port) {
  for (let candidate = port; candidate < port + 50; candidate++) {
    if (await checkPortFree(candidate)) return candidate;
  }
  throw new Error(`No free port between ${port} and ${port + 49}`);
}

function listLocalAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((info) => info && info.family === "IPv4" && !info.internal)
    .map((info) => info.address);
}

const port = await findFreePort(startPort);
console.log("");
if (port !== startPort) console.log(`Port ${startPort} is in use; using ${port} instead.`);
console.log("Graph Shift is reachable at:");
console.log(`  http://localhost:${port}/`);
for (const address of listLocalAddresses()) console.log(`  http://${address}:${port}/`);
console.log("(Offline mode needs a service worker, which browsers allow only on localhost or HTTPS.)");
console.log("Press Ctrl+C to stop.\n");

const child = spawn("npx", ["vite", "preview", "--host", "0.0.0.0", "--port", String(port), "--strictPort", "--logLevel", "warn"], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
