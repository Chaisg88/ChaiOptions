import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
export async function loadBranding(env = process.env) {
  const root = path.resolve(
    fileURLToPath(new URL("./public/", import.meta.url)),
  );
  const appName = env.APP_NAME || "Chai";
  const wordmark =
    env.APP_WORDMARK ||
    (appName === "Chai"
      ? "chai"
      : appName.replace(/Options$/i, "").toLowerCase());
  const appSlug = env.APP_SLUG || "chai-options";
  if (
    !/^[A-Za-z0-9 ]{1,40}$/.test(appName) ||
    !/^[a-z0-9]{1,20}$/.test(wordmark) ||
    !/^[a-z0-9-]{1,40}$/.test(appSlug)
  )
    throw new Error("Invalid app branding configuration");
  const assetNames = [
    "app.js",
    "finance.js",
    "login.js",
    "style.css",
    "favicon.svg",
  ];
  const assetHash = createHash("sha256")
    .update(appName)
    .update(env.VERCEL_GIT_COMMIT_SHA || env.RENDER_GIT_COMMIT || "");
  for (const name of assetNames)
    assetHash.update(await readFile(path.join(root, name)));
  const assetVersion = assetHash.digest("hex").slice(0, 16);
  const templates = {
    APP_NAME: appName,
    APP_WORDMARK: wordmark,
    APP_INITIAL: wordmark[0],
    APP_SLUG: appSlug,
    ASSET_VERSION: assetVersion,
  };

  return { root, appName, appSlug, assetNames, assetVersion, templates };
}
