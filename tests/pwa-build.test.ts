import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServiceWorkerSource } from "../plugins/vite-pwa-plugin";

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
assert.match(first, /caches\.match\(request\)/);
assert.match(first, /cached \|\| caches\.match\("\/index\.html"\)/);
assert.match(first, /event\.waitUntil\(refresh/);
assert.doesNotMatch(first, /networkFirst/);
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
