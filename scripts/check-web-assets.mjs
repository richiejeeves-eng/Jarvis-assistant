import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];

function localPath(value) {
  const path = value.split("?")[0];
  return path.startsWith("./") ? path.slice(2) : path;
}

function checkPage(page, expectedEntry) {
  const html = read(page);
  const scripts = [...html.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map((match) => match[1]);
  const styles = [...html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/g)].map((match) => match[1]);
  const paths = scripts
    .filter((src) => !src.startsWith("http://") && !src.startsWith("https://"))
    .map(localPath);
  const localStyles = styles
    .filter((href) => !href.startsWith("http://") && !href.startsWith("https://"))
    .map(localPath);

  if (new Set(paths).size !== paths.length) failures.push(page + ": duplicate local script reference");
  for (const path of [...paths, ...localStyles]) {
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
const shell = sw.split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith('"./'))
  .map((line) => line.slice(3).replace(/",?$/, ""));
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
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Web assets, script order, SDK versions and offline shell are consistent.");
}
