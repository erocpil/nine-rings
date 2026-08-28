import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServiceWorkerSource } from "../plugins/vite-pwa-plugin";
import { isModuleLoadError } from "../src/lib/module-load-recovery";

const first = createServiceWorkerSource([
  "assets/index-abc.js",
  "assets/index-def.css",
  "assets/index-def.css.map",
  "assets/pdfjs-lazy.js",
  "assets/PdfReader-lazy.js",
  "assets/pdf.worker.min-lazy.mjs",
], "build-one");
const second = createServiceWorkerSource([
  "assets/index-abc.js",
  "assets/index-def.css",
], "build-two");

assert.match(first, /\/assets\/index-abc\.js/);
assert.match(first, /\/assets\/index-def\.css/);
assert.doesNotMatch(first, /index-def\.css\.map/);
assert.doesNotMatch(first, /\/assets\/pdfjs-lazy\.js/);
assert.doesNotMatch(first, /\/assets\/PdfReader-lazy\.js/);
assert.doesNotMatch(first, /\/assets\/pdf\.worker\.min-lazy\.mjs/);
assert.match(first, /SKIP_WAITING/);
assert.match(first, /caches\.open\(CACHE_NAME\)/);
assert.match(first, /cache\.match\(request\)/);
assert.match(first, /cached \|\| cache\.match\("\/index\.html"\)/);
assert.match(first, /cached \|\| fetch\(request\)/);
assert.doesNotMatch(first, /refreshNavigation/);
assert.doesNotMatch(first, /event\.waitUntil\(refresh/);
assert.doesNotMatch(first, /networkFirst/);
assert.equal(isModuleLoadError(new Error("Importing a module script failed.")), true);
assert.equal(isModuleLoadError(new TypeError("Failed to fetch dynamically imported module: /assets/EpubReader.js")), true);
assert.equal(isModuleLoadError(new Error("EPUB 文件解析失败")), false);
assert.notEqual(
  first.match(/const CACHE_NAME = "([^"]+)"/)?.[1],
  second.match(/const CACHE_NAME = "([^"]+)"/)?.[1],
  "每个构建版本必须使用独立缓存",
);

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /class="nr-boot-shell"/);
assert.match(html, /正在打开上次文档/);
assert.ok(
  html.indexOf("nr-boot-shell") < html.indexOf('/src/main.tsx'),
  "启动界面必须在应用脚本之前写入 HTML",
);

console.log("pwa-build.test.ts: all tests passed");
