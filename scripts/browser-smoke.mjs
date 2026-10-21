import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import path from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const dir = await mkdtemp("/tmp/chai-browser-");
const password = randomBytes(20).toString("hex");
const nextPassword = randomBytes(20).toString("hex");
const port = 3200;
const server = spawn(process.execPath, ["server.js"], {
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dir,
    DATABASE_URL: process.env.TEST_DATABASE_URL || "",
    REQUIRE_DATABASE: "false",
    ROOT_EMAIL: "test@example.com",
    ROOT_PASSWORD: password,
    NODE_ENV: "test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Server startup timeout")),
      15000,
    );
    server.once("error", reject);
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited ${code}`));
    });
    server.stdout.on("data", (d) => {
      if (d.toString().includes("running")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForURL("**/login");
  assert.ok((await page.title()).includes(process.env.APP_NAME || "Chai"));
  await page.locator("[name=email]").fill("test@example.com");
  await page.locator("[name=password]").fill(password);
  await page.getByRole("button", { name: "Sign in →" }).click();
  await page.locator("#password-dialog").waitFor({ state: "visible" });
  await page.locator("#password-form [name=current]").fill(password);
  await page.locator("#password-form [name=password]").fill(nextPassword);
  await page.locator("#password-form [name=confirm]").fill(nextPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await page.locator("#password-dialog").waitFor({ state: "hidden" });
  await page.locator("#add-trade").click();
  const form = page.locator("#trade-form");
  const expiry = new Date(Date.now() + 60 * 86400000)
    .toISOString()
    .slice(0, 10);
  await form.locator("[name=symbol]").fill("AAPL");
  await form.locator("[name=expiry]").fill(expiry);
  await form.locator("[name=strike]").fill("200");
  await form.locator("[name=premium]").fill("2.5");
  await form.locator("[name=fees]").fill("1");
  await form.getByRole("button", { name: "Save trade" }).click();
  await page.locator("#trade-dialog").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#collected").textContent(), "$250.00");
  assert.equal(await page.locator("#net").textContent(), "$0.00");
  assert.equal(await page.locator("#open").textContent(), "1");
  await page.locator("[data-close]").click();
  await page.locator("#close-form [name=premium]").fill("0.5");
  await page.locator("#close-form [name=fees]").fill("1");
  await page.locator("#close-form .primary").click();
  await page.locator("#close-dialog").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#net").textContent(), "+$198.00");
  assert.equal(await page.locator("#open").textContent(), "0");
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector("#net").textContent === "+$198.00",
  );
  const artifacts = process.env.ARTIFACT_DIR || "/tmp/chai-browser-artifacts";
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({
    path: path.join(artifacts, "dashboard-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(artifacts, "dashboard-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Mobile page must not overflow horizontally",
  );
  await page.locator("#logout").click();
  await page.waitForURL("**/login");
  await page.screenshot({
    path: path.join(artifacts, "login-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: sign-in, forced password change, trade entry, early close, $198 profit, saved reload, mobile layout and logout.",
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
  await rm(dir, { recursive: true, force: true });
}
