// Server statico minimale per sviluppo e test.
// Uso: node tools/serve.mjs [porta] [--isolated]
// --isolated aggiunge COOP/COEP (necessari per i core multi-thread).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const port = Number(process.argv.find((a) => /^\d+$/.test(a)) || 8080);
const isolated = process.argv.includes("--isolated");
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".nds": "application/octet-stream", ".txt": "text/plain",
};

export function startServer(p = port, iso = isolated) {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (path.endsWith("/")) path += "index.html";
      const file = normalize(join(root, path));
      if (!file.startsWith(root)) throw new Error("fuori root");
      const st = await stat(file);
      if (!st.isFile()) throw new Error("non file");
      const headers = { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" };
      if (iso) {
        headers["Cross-Origin-Opener-Policy"] = "same-origin";
        headers["Cross-Origin-Embedder-Policy"] = "require-corp";
      }
      res.writeHead(200, headers);
      res.end(await readFile(file));
    } catch (_) {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((r) => server.listen(p, "127.0.0.1", () => r(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().then(() => console.log(`http://127.0.0.1:${port}/ ${isolated ? "(cross-origin isolated)" : ""}`));
}
