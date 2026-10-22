// Local integration harness for the CDN + serverless routing configuration.
import http from "node:http";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "./build-vercel.mjs";
import { createServerlessHandler } from "../serverless.js";
const output = await mkdtemp(path.join(tmpdir(), "options-static-"));
await buildSite(process.env, output);
const api = createServerlessHandler({
  ...process.env,
  REQUIRE_DATABASE: process.env.REQUIRE_DATABASE || "false",
});
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
    req.query = {
      __route: url.pathname === "/health" ? "health" : url.pathname.slice(5),
    };
    if (!["GET", "HEAD"].includes(req.method)) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2_000_000) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      try {
        req.body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON." }));
        return;
      }
    }
    await api.handle(req, res);
    return;
  }
  let pathname =
    url.pathname === "/"
      ? "/index.html"
      : url.pathname === "/login"
        ? "/login.html"
        : url.pathname;
  const file = path.resolve(output, "." + pathname);
  if (!file.startsWith(output + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type":
        (types[path.extname(file)] || "application/octet-stream") +
        "; charset=utf-8",
      "Cache-Control": pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log(
    "Vercel local harness running on port " + (process.env.PORT || 3000),
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(async () => {
      await api.close();
      await rm(output, { recursive: true, force: true });
      process.exit(0);
    }),
  );
