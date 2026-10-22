import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createServerlessHandler } from "../serverless.js";
import { createApplication } from "../application.js";
import { publicStartupError } from "../startup-errors.js";

async function request(api, route) {
  let status, headers, body;
  await api.handle(
    { url: route, headers: {}, method: "GET" },
    {
      writeHead(code, value) {
        status = code;
        headers = value;
      },
      end(value) {
        body = JSON.parse(value);
      },
    },
  );
  return { status, headers, body };
}

test("Vercel missing DATABASE_URL fails safely without creating ephemeral storage", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "options-no-database-"));
  const api = createServerlessHandler({
    VERCEL: "1",
    REQUIRE_DATABASE: "false",
    DATA_DIR: dir,
    ROOT_PASSWORD: "private-root-password-never-publish",
  });
  try {
    for (const route of ["/health", "/api/login"]) {
      const result = await request(api, route);
      assert.equal(result.status, 503);
      assert.equal(result.headers["Cache-Control"], "no-store");
      assert.equal(result.body.code, "DATABASE_NOT_CONFIGURED");
      assert.match(result.body.error, /DATABASE_URL/);
      assert.doesNotMatch(JSON.stringify(result.body), /private-root/);
    }
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await api.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid connection URL reports a safe error without revealing credentials", async () => {
  const api = createServerlessHandler({
    VERCEL: "1",
    DATABASE_URL: "ostgresql://private-user:private-password@example.test/db",
  });
  const result = await request(api, "/health");
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "DATABASE_URL_INVALID");
  assert.doesNotMatch(JSON.stringify(result.body), /private-user|private-password|example.test/);
});

test("empty new database gives account setup guidance and closes storage", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "options-no-root-"));
  try {
    await assert.rejects(createApplication({ DATA_DIR: dir }), {
      code: "ROOT_ACCOUNT_NOT_CONFIGURED",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("database and unknown startup failures never expose driver messages", () => {
  for (const code of ["28P01", "ENOTFOUND", "unexpected-secret-code"]) {
    const result = publicStartupError({
      code,
      message: "postgresql://private-user:private-password@example.test/db",
      detail: "private-driver-detail",
    });
    assert.doesNotMatch(JSON.stringify(result), /private-|example.test|unexpected-secret/);
  }
  assert.equal(publicStartupError({ code: "28P01" }).code, "DATABASE_AUTH_FAILED");
  assert.equal(publicStartupError({ code: "ENOTFOUND" }).code, "DATABASE_UNREACHABLE");
  assert.equal(publicStartupError({}).code, "STARTUP_FAILED");
});
