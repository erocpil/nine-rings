import { expect, test, type Page } from "@playwright/test";
import { createServer, request as proxyRequest, type ServerResponse } from "node:http";
import { access, readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";

// Real SW requests bypass page.route(). A tiny deploy proxy allows tests to
// change releases and interrupt precaching while keeping the origin stable.
let revision = 1;
let blockDownload = false;
let failDownload = false;
let transientFailures = 0;
let serverUnavailable = false;
let pendingDownloads: ServerResponse[] = [];
let origin: string;
let source: string;
const server = createServer((req, res) => {
  if (serverUnavailable) { res.destroy(); return; }
  if (req.url === "/sw.js") {
    res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
    res.end(source
      .replace(/const CACHE_NAME = "([^"]+)";/, `const CACHE_NAME = "$1-test-${revision}";`)
      .replace("const PRECACHE = [", `const PRECACHE = ["/__pwa-test-${revision}.js",`)
      + `\nself.addEventListener("message", event => { if (event.data === "TEST_VERSION") event.ports[0].postMessage(${revision}); });`);
    return;
  }
  if (req.url?.startsWith("/__pwa-test-")) {
    if (blockDownload) { pendingDownloads.push(res); return; }
    const fail = failDownload || transientFailures > 0;
    if (transientFailures > 0) transientFailures--;
    res.writeHead(fail ? 503 : 200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
    res.end("/* deployment test marker */");
    return;
  }
  const upstream = proxyRequest(`http://localhost:8001${req.url}`, { method: req.method, headers: { ...req.headers, host: "localhost:8001" } }, (response) => {
    res.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(res);
  });
  upstream.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
});

function releaseDownloads() {
  blockDownload = false;
  for (const res of pendingDownloads) {
    res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
    res.end("/* downloaded */");
  }
  pendingDownloads = [];
}

async function activeVersion(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => { channel.port1.close(); resolve(event.data as number); };
    navigator.serviceWorker.controller!.postMessage("TEST_VERSION", [channel.port2]);
  }));
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  source = await readFile("dist/sw.js", "utf8");
  const precache = JSON.parse(source.match(/const PRECACHE = (.*);/)![1]) as string[];
  await Promise.all(precache.map((path) => access(`dist${path === "/" ? "/index.html" : path}`)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  releaseDownloads();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
test.beforeEach(async ({ page }) => {
  revision = 1;
  blockDownload = false;
  failDownload = false;
  transientFailures = 0;
  serverUnavailable = false;
  await page.goto(origin);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect.poll(() => activeVersion(page)).toBe(1);
});
test.afterEach(releaseDownloads);

test("手机 PWA 重启时接管已开始的新版下载，保存后升级且服务断开仍可重开", async ({ page }) => {
  revision = 2;
  blockDownload = true;
  await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).installing))).toBe(true);
  // register resolves with an existing installer, without a new updatefound.
  await page.reload();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  releaseDownloads();
  await expect(page.locator(".web-status-banner.update")).toBeVisible();
  await expect.poll(() => activeVersion(page)).toBe(1);
  await page.locator(".note-title").fill("升级前最后一次修改");
  await page.locator(".ProseMirror").fill("更新必须保存这段尚未防抖提交的正文");
  await Promise.all([
    page.waitForEvent("load"),
    page.locator(".web-status-banner").getByRole("button", { name: "保存并刷新" }).click(),
  ]);
  await expect(page.locator(".note-title")).toHaveValue("升级前最后一次修改");
  await expect(page.locator(".ProseMirror")).toContainText("尚未防抖提交的正文");
  await expect.poll(() => activeVersion(page)).toBe(2);
  // Cut the actual origin connection, including SW fetches. Unlike request
  // routing this cannot accidentally let the worker keep using the network.
  serverUnavailable = true;
  const navigation = await page.reload();
  expect(navigation?.fromServiceWorker()).toBe(true);
  await expect(page.locator(".note-title")).toHaveValue("升级前最后一次修改");
  await expect(page.locator(".ProseMirror")).toContainText("尚未防抖提交的正文");
});

test("新版下载失败保留旧版，设置可手动检查并重试升级", async ({ page }) => {
  revision = 2;
  failDownload = true;
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.locator(".settings-web-update [role=status]")).toContainText(/失败|未完成/);
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  await expect(page.locator(".settings-web-update")).toContainText("resource=/__pwa-test-2.js");
  await expect(page.locator(".settings-web-update")).toContainText("status=503");
  await expect.poll(() => activeVersion(page)).toBe(1);
  failDownload = false;
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.locator(".settings-web-update [role=status]")).toContainText("新版本已就绪");
  await Promise.all([
    page.waitForEvent("load"),
    page.locator(".settings-web-update").getByRole("button", { name: "保存并刷新" }).click(),
  ]);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect.poll(() => activeVersion(page)).toBe(2);
});

test("新版资源短暂失败时自动重试，不需要再次点击检查", async ({ page }) => {
  revision = 2;
  transientFailures = 1;
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.locator(".settings-web-update [role=status]")).toContainText("新版本已就绪");
  expect(transientFailures).toBe(0);
  await expect.poll(() => activeVersion(page)).toBe(1);
});
