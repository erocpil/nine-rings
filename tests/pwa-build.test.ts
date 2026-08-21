import assert from "node:assert/strict";
import { createServiceWorkerSource } from "../plugins/vite-pwa-plugin";

const first = createServiceWorkerSource([
  "assets/index-abc.js",
  "assets/index-def.css",
  "assets/index-def.css.map",
], "build-one");
const second = createServiceWorkerSource([
  "assets/index-abc.js",
  "assets/index-def.css",
], "build-two");

assert.match(first, /\/assets\/index-abc\.js/);
assert.match(first, /\/assets\/index-def\.css/);
assert.doesNotMatch(first, /index-def\.css\.map/);
assert.match(first, /SKIP_WAITING/);
assert.match(first, /networkFirst\(request, "\/index\.html"\)/);
assert.notEqual(
  first.match(/const CACHE_NAME = "([^"]+)"/)?.[1],
  second.match(/const CACHE_NAME = "([^"]+)"/)?.[1],
  "每个构建版本必须使用独立缓存",
);

console.log("pwa-build.test.ts: all tests passed");
