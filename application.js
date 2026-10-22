import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { openStorage } from "./storage.js";
import { loadBranding } from "./branding.js";

export async function createApplication(env = process.env) {
  const { root, appName, assetNames, assetVersion, templates } =
    await loadBranding(env);
  const dataDir = path.resolve(env.DATA_DIR || "./data");
  if (env.REQUIRE_DATABASE === "true" && !env.DATABASE_URL)
    throw new Error(
      "Configure DATABASE_URL in the hosting environment to connect permanent storage.",
    );
  const db = await openStorage({
    databaseUrl: env.DATABASE_URL,
    dataDir,
    schema: env.DB_SCHEMA || "public",
    poolSize: env.VERCEL ? 1 : 5,
  });
  const hash = (value) => {
    const salt = randomBytes(16).toString("hex");
    return salt + ":" + scryptSync(value, salt, 64).toString("hex");
  };
  function verify(value, stored) {
    const [salt, key] = stored.split(":");
    const candidate = scryptSync(value, salt, 64);
    return timingSafeEqual(candidate, Buffer.from(key, "hex"));
  }
  if (!(await db.get("SELECT id FROM users LIMIT 1"))) {
    const email = env.ROOT_EMAIL?.trim().toLowerCase(),
      password = env.ROOT_PASSWORD;
    if (!email || !password || password.length < 12 || password.length > 128)
      throw new Error(
        "First startup requires ROOT_EMAIL and ROOT_PASSWORD (at least 12 characters). Configure environment variables; do not put credentials in source.",
      );
    await db.run(
      "INSERT INTO users(email,password) VALUES (?,?) ON CONFLICT(email) DO NOTHING",
      email,
      hash(password),
    );
  }
  const secure = env.NODE_ENV === "production";
  const cookie = (token, age) =>
    `chai_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? "; Secure" : ""}`;
  const digest = (token) => createHash("sha256").update(token).digest("hex");
  await db.run("DELETE FROM login_attempts WHERE expires<?", Date.now());
  const types = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
  };
  function validDate(v) {
    return (
      typeof v === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v
    );
  }
  function validTrade(t) {
    const nonnegative = (v) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e9;
    return (
      t &&
      typeof t.id === "string" &&
      /^[a-zA-Z0-9-]{1,80}$/.test(t.id) &&
      typeof t.symbol === "string" &&
      /^[A-Z0-9.^/-]{1,12}$/.test(t.symbol) &&
      ["sell_put", "sell_call", "buy_put"].includes(t.strategy) &&
      validDate(t.date) &&
      validDate(t.expiry) &&
      t.expiry >= t.date &&
      Number.isInteger(t.quantity) &&
      t.quantity > 0 &&
      t.quantity <= 100000 &&
      Number.isInteger(t.multiplier) &&
      t.multiplier > 0 &&
      t.multiplier <= 100000 &&
      nonnegative(t.strike) &&
      t.strike > 0 &&
      nonnegative(t.premium) &&
      nonnegative(t.fees) &&
      (!t.notes || (typeof t.notes === "string" && t.notes.length <= 500)) &&
      (!t.close ||
        (validDate(t.close.date) &&
          t.close.date >= t.date &&
          nonnegative(t.close.premium) &&
          nonnegative(t.close.fees)))
    );
  }
  const handle = async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    const send = (code, data) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    try {
      if (url.pathname === "/health") {
        await db.ping();
        return send(200, { status: "ok" });
      }
      if (url.pathname.startsWith("/api/")) {
        let body = {};
        if (!["GET", "HEAD"].includes(req.method)) {
          if (
            req.headers["x-chai-request"] !== "1" ||
            !req.headers["content-type"]?.startsWith("application/json") ||
            req.headers["sec-fetch-site"] === "cross-site"
          )
            return send(403, { error: "Request not allowed." });
          try {
            if (req.body !== undefined) {
              body =
                typeof req.body === "string" || Buffer.isBuffer(req.body)
                  ? JSON.parse(req.body.toString())
                  : req.body;
              if (Buffer.byteLength(JSON.stringify(body)) > 2_000_000)
                return send(413, { error: "File too large." });
            } else {
              const chunks = [];
              let size = 0;
              for await (const part of req) {
                size += part.length;
                if (size > 2_000_000)
                  return send(413, { error: "File too large." });
                chunks.push(part);
              }
              body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            }
            if (!body || typeof body !== "object" || Array.isArray(body))
              return send(400, { error: "Invalid JSON object." });
          } catch {
            return send(400, { error: "Invalid JSON." });
          }
        }
        const token = req.headers.cookie
          ?.split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("chai_session="))
          ?.slice(13);
        const user = token
          ? await db.get(
              "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?",
              digest(token),
              Date.now(),
            )
          : null;
        if (url.pathname === "/api/login" && req.method === "POST") {
          if (
            typeof body.email !== "string" ||
            body.email.length > 320 ||
            typeof body.password !== "string" ||
            body.password.length > 1024
          )
            return send(400, { error: "Enter your email and password." });
          const forwarded = env.VERCEL
            ? req.headers["x-vercel-forwarded-for"]
            : null;
          const ip =
            typeof forwarded === "string"
              ? forwarded.split(",")[0].trim()
              : req.socket?.remoteAddress || "unknown";
          const key = digest(ip + "|" + body.email.trim().toLowerCase());
          const now = Date.now();
          const attempt = await db.get(
            `INSERT INTO login_attempts(key,count,expires) VALUES(?,1,?)
            ON CONFLICT(key) DO UPDATE SET
            count=CASE WHEN login_attempts.expires<=? THEN 1 ELSE login_attempts.count+1 END,
            expires=CASE WHEN login_attempts.expires<=? THEN excluded.expires ELSE login_attempts.expires END
            RETURNING count,expires`,
            key,
            now + 15 * 60 * 1000,
            now,
            now,
          );
          if (attempt.count > 10)
            return send(429, {
              error: "Too many attempts. Try again in 15 minutes.",
            });
          const account = await db.get(
            "SELECT * FROM users WHERE email=?",
            body.email.trim().toLowerCase(),
          );
          const matched = account
            ? verify(body.password, account.password)
            : (scryptSync(body.password, "dummy-salt", 64), false);
          if (!matched) {
            return send(401, { error: "Email or password is incorrect." });
          }
          await db.run("DELETE FROM login_attempts WHERE key=?", key);
          await db.run("DELETE FROM sessions WHERE expires<?", now);
          const next = randomBytes(32).toString("hex");
          await db.run(
            "INSERT INTO sessions VALUES(?,?,?)",
            digest(next),
            account.id,
            now + 7 * 86400000,
          );
          res.setHeader("Set-Cookie", cookie(next, 7 * 86400));
          return send(200, {
            email: account.email,
            mustChange: !!account.must_change,
          });
        }
        if (!user) return send(401, { error: "Please sign in." });
        if (url.pathname === "/api/me" && req.method === "GET")
          return send(200, {
            email: user.email,
            mustChange: !!user.must_change,
          });
        if (url.pathname === "/api/logout" && req.method === "POST") {
          await db.run("DELETE FROM sessions WHERE token=?", digest(token));
          res.setHeader("Set-Cookie", cookie("", 0));
          return send(200, { ok: true });
        }
        if (url.pathname === "/api/password" && req.method === "POST") {
          if (
            typeof body.current !== "string" ||
            typeof body.password !== "string" ||
            body.current.length > 1024 ||
            body.password.length < 12 ||
            body.password.length > 128
          )
            return send(400, {
              error: "Use a password between 12 and 128 characters.",
            });
          if (!verify(body.current, user.password))
            return send(400, { error: "Current password is incorrect." });
          if (body.current === body.password)
            return send(400, { error: "Choose a different password." });
          await db.run(
            "UPDATE users SET password=?, must_change=0 WHERE id=?",
            hash(body.password),
            user.id,
          );
          await db.run(
            "DELETE FROM sessions WHERE user_id=? AND token<>?",
            user.id,
            digest(token),
          );
          return send(200, { ok: true });
        }
        if (user.must_change)
          return send(403, {
            error: "Change your temporary password first.",
            mustChange: true,
          });
        if (url.pathname === "/api/trades" && req.method === "GET")
          return send(200, await db.snapshot(user.id));
        if (url.pathname === "/api/trades" && req.method === "POST") {
          const trades = body.trades;
          if (!Number.isInteger(body.revision) || body.revision < 0)
            return send(400, { error: "Invalid record revision." });
          if (
            !Array.isArray(trades) ||
            trades.length > 5000 ||
            !trades.every(validTrade) ||
            new Set(trades.map((t) => t.id)).size !== trades.length
          )
            return send(400, {
              error: "Invalid trade data. Check dates, prices and quantities.",
            });
          const revision = await db.replace(user.id, body.revision, trades);
          if (revision === null)
            return send(409, {
              error:
                "Your records changed in another window. Reload before saving to avoid overwriting them.",
            });
          return send(200, { ok: true, revision });
        }
        return send(404, { error: "Not found." });
      }
      let pathname = url.pathname;
      if (pathname === "/") pathname = "/index.html";
      if (pathname === "/login") pathname = "/login.html";
      const file = path.resolve(root, "." + pathname);
      if (!file.startsWith(root + path.sep))
        return send(403, { error: "Forbidden." });
      try {
        let data = await readFile(file);
        if ([".html", ".svg"].includes(path.extname(file)))
          data = data
            .toString()
            .replace(
              /\{\{(APP_NAME|APP_WORDMARK|APP_INITIAL|APP_SLUG|ASSET_VERSION)\}\}/g,
              (_, key) => templates[key],
            );
        if (pathname === "/app.js")
          data = data
            .toString()
            .replace('"./finance.js"', `"./finance.js?v=${assetVersion}"`);
        if (assetNames.includes(path.basename(file))) {
          const etag =
            '"' + createHash("sha256").update(data).digest("hex") + '"';
          res.setHeader("ETag", etag);
          res.setHeader(
            "Cache-Control",
            url.searchParams.get("v") === assetVersion
              ? "public, max-age=31536000, immutable"
              : "public, max-age=0, must-revalidate",
          );
          if (
            req.headers["if-none-match"]
              ?.split(",")
              .some(
                (value) =>
                  value.trim() === "*" ||
                  value.trim().replace(/^W\//, "") === etag,
              )
          ) {
            res.writeHead(304);
            res.end();
            return;
          }
        }
        res.writeHead(200, {
          "Content-Type":
            (types[path.extname(file)] || "application/octet-stream") +
            "; charset=utf-8",
        });
        res.end(data);
      } catch {
        send(404, { error: "Not found." });
      }
    } catch (error) {
      console.error("Request failed:", error.message);
      if (!res.headersSent)
        send(500, { error: "Something went wrong. Please try again." });
      else res.end();
    }
  };
  return { handle, close: () => db.close() };
}
