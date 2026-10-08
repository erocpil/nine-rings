import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

async function verifyProductionSearch(page: Page) {
  const csp = JSON.parse(
    readFileSync(
      new URL("../src-tauri/tauri.conf.json", import.meta.url),
      "utf8",
    ),
  ).app.security.csp;
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": csp },
    });
  });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await page.locator(".note-title").fill("PCRE2 离线验证");
  await page.locator(".ProseMirror").fill("foo42");
  await expect(page.locator(".save-status-saved")).toBeVisible();
  const checkFind = async () => {
    await page.keyboard.press("Alt+f");
    const bar = page.locator(".editor-find-bar");
    await bar
      .getByRole("checkbox", { name: "正则表达式（Perl）", exact: true })
      .check();
    await bar.getByLabel("在当前文档中查找").fill(String.raw`foo\K\d+`);
    await expect(bar.locator(".editor-find-count")).toHaveText("0/1");
    await bar.getByRole("button", { name: "下一处匹配", exact: true }).click();
    await expect(page.locator(".search-match-active")).toHaveText("42");
    await bar.getByRole("button", { name: "关闭查找", exact: true }).click();
  };
  await checkFind();
  await page.keyboard.press("ControlOrMeta+Shift+f");
  const dialog = page.getByRole("dialog", { name: "全局搜索", exact: true });
  await dialog
    .getByRole("checkbox", { name: "正则表达式（Perl）", exact: true })
    .check();
  await dialog
    .getByRole("textbox", { name: "全局搜索", exact: true })
    .fill(String.raw`foo\K\d+`);
  await expect(dialog.locator(".search-hit")).toHaveCount(1);
  await dialog.locator(".search-hit").click();
  await expect(page.locator(".search-match-active")).toHaveText("42");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const wasmCached = await page.evaluate(async () => {
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys())
        if (request.url.endsWith(".wasm")) return true;
    return false;
  });
  expect(wasmCached).toBe(true);
  await page.unroute("**/");
  return checkFind;
}

test("生产正文与全局 Perl 搜索在 Tauri CSP 下加载且 WASM 已预缓存", async ({
  page,
}) => {
  await verifyProductionSearch(page);
});

test("生产 PWA 离线重启后仍可加载 Perl 正则引擎", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Playwright WebKit 在离线重载导航进入 Service Worker 前报内部错误；在线 CSP 和预缓存另有双浏览器验证。",
  );
  const checkFind = await verifyProductionSearch(page);
  await context.setOffline(true);
  await page.reload();
  expect(
    await page.evaluate(() =>
      fetch("/__search_offline_probe__").then(
        () => true,
        () => false,
      ),
    ),
  ).toBe(false);
  await expect(page.locator(".note-title")).toHaveValue("PCRE2 离线验证");
  await checkFind();
});
