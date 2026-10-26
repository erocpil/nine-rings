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
let transientBodyFailures = 0;
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
  if (req.url === "/icon-192.png" && transientBodyFailures > 0) {
    transientBodyFailures--;
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": "99999", "Cache-Control": "no-store" });
    res.flushHeaders();
    res.write("incomplete image body");
    setTimeout(() => res.destroy(), 50);
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
  const openedPages: Page[] = [];
  page.context().on("page", opened => openedPages.push(opened));
  (page as Page & { updateOpenedPages?: Page[] }).updateOpenedPages = openedPages;
  revision = 1;
  blockDownload = false;
  failDownload = false;
  transientFailures = 0;
  transientBodyFailures = 0;
  serverUnavailable = false;
  await page.goto(origin);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect.poll(() => activeVersion(page)).toBe(1);
});
test.afterEach(async ({ page }) => {
  releaseDownloads();
  expect((page as Page & { updateOpenedPages?: Page[] }).updateOpenedPages).toEqual([]);
  expect(page.context().pages()).toEqual([page]);
});

test("手机 PWA 重启时接管已开始的新版下载，保存后升级且服务断开仍可重开", async ({ page }) => {
  revision = 2;
  blockDownload = true;
  await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).installing))).toBe(true);
  await page.keyboard.press("Alt+,");
  await expect(page.locator(".settings-web-update [role=status]")).toContainText(/正在下载并安装新版，请保持联网。下载进度：\d+%（\d+\/\d+ 项，已下载 [\d.]+ MB）/);
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  // register resolves with an existing installer, without a new updatefound.
  await page.reload();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.keyboard.press("Alt+,");
  // Re-registration may wait behind the existing installation. Until it
  // resolves, only the check itself is observable by the reopened page.
  await expect(page.locator(".settings-web-update [role=status]")).toHaveText(/正在(?:检查新版，请保持联网|下载并安装新版，请保持联网。下载进度：.*)/);
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
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
  await expect.poll(() => page.evaluate(() => {
    const values = JSON.parse(sessionStorage.getItem("nr:pwa-update-events:v1") ?? "[]") as Array<{event: string; navigation: string; expectedReload: boolean}>;
    return values.some(value => value.event === "boot" && value.navigation === "reload" && value.expectedReload);
  })).toBe(true);
  // Cut the actual origin connection, including SW fetches. Unlike request
  // routing this cannot accidentally let the worker keep using the network.
  serverUnavailable = true;
  const navigation = await page.reload();
  expect(navigation?.fromServiceWorker()).toBe(true);
  await expect(page.locator(".note-title")).toHaveValue("升级前最后一次修改");
  await expect(page.locator(".ProseMirror")).toContainText("尚未防抖提交的正文");
});

test("桌面普通网页从设置保存刷新，仅当前标签重载且保留最后编辑", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => sessionStorage.setItem("pwa-update-tab-proof", "original"));
  revision = 2;
  await page.keyboard.press("Alt+,");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.locator(".settings-web-update [role=status]")).toContainText("新版本已就绪");
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.locator(".ProseMirror").fill("桌面设置更新保留的最后编辑");
  await page.keyboard.press("Alt+,");
  await Promise.all([
    page.waitForEvent("load"),
    page.locator(".settings-web-update").getByRole("button", { name: "保存并刷新", exact: true }).click(),
  ]);
  await expect(page.locator(".ProseMirror")).toContainText("桌面设置更新保留的最后编辑");
  await expect.poll(() => activeVersion(page)).toBe(2);
  expect(await page.evaluate(() => sessionStorage.getItem("pwa-update-tab-proof"))).toBe("original");
  expect(page.url()).toBe(origin + "/");
});

test("新版下载失败保留旧版，设置可手动检查并重试升级", async ({ page }) => {
  revision = 2;
  failDownload = true;
  await page.keyboard.press("Alt+,");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  // The production service worker precaches hundreds of real assets before it
  // can report the injected marker failure. Give slower CI runners time to
  // finish that install attempt instead of treating visible download progress
  // as a failed update.
  await expect(page.locator(".settings-web-update [role=status]")).toContainText(/失败|未完成/, { timeout: 30_000 });
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
  await page.keyboard.press("Alt+,");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.locator(".settings-web-update [role=status]")).toContainText("新版本已就绪");
  expect(transientFailures).toBe(0);
  await expect.poll(() => activeVersion(page)).toBe(1);
});

test("图标返回200后正文中断会重试，完整缓存后才能升级", async ({ page }) => {
  revision = 2;
  transientBodyFailures = 1;
  await page.keyboard.press("Alt+,");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.locator(".settings-web-update [role=status]")).toContainText("新版本已就绪");
  expect(transientBodyFailures).toBe(0);
  await expect.poll(() => activeVersion(page)).toBe(1);
  await Promise.all([
    page.waitForEvent("load"),
    page.locator(".settings-web-update").getByRole("button", { name: "保存并刷新" }).click(),
  ]);
  await expect.poll(() => activeVersion(page)).toBe(2);
  serverUnavailable = true;
  expect(await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const icon = new Image();
    icon.onload = () => resolve(icon.naturalWidth);
    icon.onerror = () => reject(new Error("cached icon is incomplete"));
    icon.src = "/icon-192.png";
  }))).toBe(192);
});

async function waitingVersion(page: Page) {
  return page.evaluate(async () => {
    const worker = (await navigator.serviceWorker.ready).waiting;
    if (!worker) return null;
    return new Promise<number>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data as number); };
      worker.postMessage("TEST_VERSION", [channel.port2]);
    });
  });
}

test("已下载但未刷新时继续检查后续部署，最终保存并启用最新版本", async ({ page }) => {
  await page.keyboard.press("Alt+,");
  const check = page.getByRole("button", { name: "检查更新", exact: true });
  revision = 2;
  await check.click();
  await expect.poll(() => waitingVersion(page)).toBe(2);
  await expect(check).toBeEnabled();
  await expect.poll(() => activeVersion(page)).toBe(1);
  revision = 3;
  blockDownload = true;
  await check.click();
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).installing))).toBe(true);
  await expect(page.locator(".settings-web-update [role=status]")).toContainText("正在下载并安装新版");
  await expect.poll(() => activeVersion(page)).toBe(1);
  await expect.poll(() => waitingVersion(page)).toBe(2);
  releaseDownloads();
  await expect.poll(() => waitingVersion(page)).toBe(3);
  await expect(check).toBeEnabled();
  await check.click();
  await expect(check).toBeEnabled();
  await expect.poll(() => waitingVersion(page)).toBe(3);
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.locator(".note-title").fill("连续部署前的最后修改");
  await page.locator(".ProseMirror").fill("等待更新不应丢失当前编辑");
  await Promise.all([
    page.waitForEvent("load"),
    page.locator(".web-status-banner").getByRole("button", { name: "保存并刷新" }).click(),
  ]);
  await expect.poll(() => activeVersion(page)).toBe(3);
  await expect(page.locator(".note-title")).toHaveValue("连续部署前的最后修改");
  await expect(page.locator(".ProseMirror")).toContainText("等待更新不应丢失当前编辑");
});

for (const width of [390, 1280]) {
  test(`无新版检查后保持设置内焦点，Esc 直接退出 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.keyboard.press("Alt+,");
    const settings = page.locator(".settings-panel");
    await expect(settings).toBeVisible();
    const check = settings.locator(".settings-update-check");
    await check.click();
    await expect(settings.locator(".settings-web-update [role=status]")).toContainText("未发现待安装的新版本");
    await expect(check).toBeEnabled();
    await expect(check).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
  });
}


test("下载超过页面等待期限后完成会清除超时，并在原标签保存刷新", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install();
  revision = 2;
  blockDownload = true;
  await page.keyboard.press("Alt+,");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  const status = page.locator(".settings-web-update [role=status]");
  await expect(status).toContainText("正在下载并安装新版");
  await page.clock.fastForward(60_001);
  await expect(status).toContainText("更新等待超时");
  releaseDownloads();
  await expect(status).toContainText("新版本已就绪");
  await expect(status).not.toContainText("失败");
  await Promise.all([
    page.waitForEvent("load"),
    page.locator(".settings-web-update").getByRole("button", { name: "保存并刷新" }).click(),
  ]);
  await expect.poll(() => activeVersion(page)).toBe(2);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const events = JSON.parse(sessionStorage.getItem("nr:pwa-update-events:v1") ?? "[]") as Array<{event: string; navigation: string; expectedReload: boolean}>;
    return events;
  })).toContainEqual(expect.objectContaining({ event: "boot", expectedReload: true }));
  expect(page.context().pages()).toEqual([page]);
});

// Navigation evidence is exported with local diagnostics; no page URL or note content is collected.
