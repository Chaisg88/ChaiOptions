import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadBranding } from "../branding.js";
export async function buildSite(
  env = process.env,
  output = path.resolve("dist"),
) {
  const site = await loadBranding(env);
  await rm(output, { recursive: true, force: true });
  const assets = path.join(output, "assets", site.assetVersion);
  await mkdir(assets, { recursive: true });
  for (const name of site.assetNames) {
    let content = await readFile(path.join(site.root, name));
    if (name.endsWith(".svg"))
      content = content
        .toString()
        .replace(
          /\{\{(APP_NAME|APP_WORDMARK|APP_INITIAL|APP_SLUG|ASSET_VERSION)\}\}/g,
          (_, key) => site.templates[key],
        );
    await writeFile(path.join(assets, name), content);
  }
  for (const name of ["index.html", "login.html"]) {
    let html = (await readFile(path.join(site.root, name), "utf8")).replace(
      /\{\{(APP_NAME|APP_WORDMARK|APP_INITIAL|APP_SLUG|ASSET_VERSION)\}\}/g,
      (_, key) => site.templates[key],
    );
    for (const asset of site.assetNames)
      html = html.replaceAll(
        "/" + asset + "?v=" + site.assetVersion,
        "/assets/" + site.assetVersion + "/" + asset,
      );
    await writeFile(path.join(output, name), html);
  }
  return { output, assetVersion: site.assetVersion, appName: site.appName };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = await buildSite();
  console.log(
    "Static site built for " +
      result.appName +
      "; no database connection required.",
  );
}
