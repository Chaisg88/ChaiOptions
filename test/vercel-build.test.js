import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSite } from "../scripts/build-vercel.mjs";

test("Vercel login page builds without database credentials and contains no secrets", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "options-build-"));
  try {
    const built = await buildSite(
      {
        APP_NAME: "Chai",
        DATABASE_URL: "must-never-be-published",
        ROOT_PASSWORD: "also-private",
      },
      output,
    );
    const login = await readFile(path.join(output, "login.html"), "utf8");
    assert.match(login, /login-form/);
    assert.match(login, /Sign in — Chai/);
    assert.doesNotMatch(login, /\{\{APP_|must-never-be-published|also-private/);
    assert.match(
      login,
      new RegExp("/assets/" + built.assetVersion + "/login.js"),
    );
    const script = await readFile(
      path.join(output, "assets", built.assetVersion, "app.js"),
      "utf8",
    );
    assert.match(script, /\.\/finance\.js/);
    assert.ok(
      (
        await readFile(
          path.join(output, "assets", built.assetVersion, "finance.js"),
        )
      ).length > 0,
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
test("JeanOptions static build keeps its own brand", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "jean-build-"));
  try {
    await buildSite(
      { APP_NAME: "JeanOptions", APP_SLUG: "jean-options" },
      output,
    );
    const html = await readFile(path.join(output, "index.html"), "utf8");
    assert.match(html, /JeanOptions/);
    assert.match(html, /data-app-slug="jean-options"/);
    assert.doesNotMatch(html, /\{\{APP_/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
