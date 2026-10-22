import { createApplication } from "./application.js";
import { publicStartupError } from "./startup-errors.js";
export function createServerlessHandler(env = process.env) {
  let ready;
  return {
    async handle(req, res) {
      const original = new URL(req.url, "http://localhost");
      const route =
        req.query?.__route ||
        original.searchParams.get("__route") ||
        original.pathname.replace(/^\/api\//, "").replace(/^\//, "");
      if (
        !["health", "me", "login", "logout", "password", "trades"].includes(
          route,
        )
      ) {
        res.writeHead(404, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ error: "Not found." }));
        return;
      }
      req.url = route === "health" ? "/health" : "/api/" + route;
      try {
        ready ||= createApplication({
          ...env,
          REQUIRE_DATABASE: env.VERCEL
            ? "true"
            : env.REQUIRE_DATABASE || "true",
          NODE_ENV: env.VERCEL ? "production" : env.NODE_ENV,
        });
        const app = await ready;
        await app.handle(req, res);
      } catch (error) {
        ready = undefined;
        const failure = publicStartupError(error);
        console.error("API initialization failed:", failure.code);
        if (!res.headersSent)
          res.writeHead(503, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
        res.end(JSON.stringify(failure));
      }
    },
    async close() {
      if (ready) {
        const app = await ready;
        await app.close();
        ready = undefined;
      }
    },
  };
}
