import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];

function checkPage(page, expectedEntry) {
  const html = read(page);
  const scripts = [...html.matchAll(/<script\\b[^>]*\\bsrc=["']([^"']+)["']/g)].map((match) => match[1]);
  const styles = [...html.matchAll(/<link\\b[^>]*\\brel=["']stylesheet["'][^>]*\\bhref=["']([^"']+)["']/g)].map((match) => match[1]);
  const localScripts = scripts.filter((src) => !/^https?:\\/\\//i.test(src));
  const localStyles = styles.filter((href) => !/^https?:\\/\\//i.test(href));
  const paths = localScripts.map((src) => src.split("?")[0].replace(/^\\.\\//, ""));

  if (new Set(paths).size !== paths.length) failures.push(page + ": duplicate local script reference");
  for (const path of [...paths, ...localStyles.map((href) => href.split("?")[0].replace(/^\\.\\//, ""))]) {
    if (!existsSync(join(root, path))) failures.push(page + ": missing local asset " + path);
  }

  const configIndex = paths.indexOf("config.js");
  const entryIndex = paths.indexOf(expectedEntry);
  if (configIndex < 0 || entryIndex < 0 || configIndex > entryIndex) {
    failures.push(page + ": config.js must load before " + expectedEntry);
  }
  return { html, paths };
}

const workspace = checkPage("index.html", "app.js");
const login = checkPage("login.html", "login.js");
const sw = read("sw.js");
const shell = [...sw.matchAll(/"\\.\\/([^"]+)"/g)].map((match) => match[1]);
for (const path of [...workspace.paths, ...login.paths]) {
  if (!shell.includes(path)) failures.push("sw.js: offline shell is missing " + path);
}

const sdkVersions = [workspace.html, login.html].map((html) =>
  html.match(/supabase-js@([^"']+)/)?.[1] ?? null
);
if (!sdkVersions[0] || sdkVersions[0] !== sdkVersions[1]) {
  failures.push("index.html and login.html must use the same pinned Supabase SDK version");
}
if (!read("app.js").includes("window.JEEVES_CONFIG.supabaseUrl")) {
  failures.push("app.js must use the shared Supabase config");
}
if (!read("login.js").includes("window.JEEVES_CONFIG.supabaseUrl")) {
  failures.push("login.js must use the shared Supabase config");
}

if (failures.length) {
  console.error(failures.join("\\n"));
  process.exitCode = 1;
} else {
  console.log("Web assets, script order, SDK versions and offline shell are consistent.");
}
