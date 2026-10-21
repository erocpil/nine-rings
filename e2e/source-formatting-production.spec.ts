import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

test("生产包本地 WASM 格式化在 CSP 下运行，冷启动离线可用", async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  // The desktop WebView permits WASM compilation, not JavaScript eval.
  await context.route("**/*", async route => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(),
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'" } });
  });
  await createBlankDocument(page, "离线代码整理");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await page.locator(".editor-status-bar").getByRole("button", { name: "文件格式", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "C/C++", exact: true }).click();
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  await expect(area).toBeEditable();
  await area.fill("int main(){int value=1;return value;}");
  await page.getByRole("button", { name: "格式化全文", exact: true }).click();
  await expect(area).toContainText("int value = 1;");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // Wait for real installation, then restart offline without a live Worker.
  await expect.poll(() => page.evaluate(async () => {
    const keys = await caches.keys();
    for (const key of keys) {
      const urls = (await (await caches.open(key)).keys()).map(request => request.url);
      if (urls.some(url => /clang-format-.*\.wasm$/.test(url)) && urls.some(url => /source-format\.worker-.*\.js$/.test(url))) return true;
    }
    return false;
  })).toBe(true);
  await expect(page.getByRole("button", { name: "格式化全文", exact: true })).toBeEnabled();
  await context.unrouteAll();
  await context.setOffline(true);
  await page.reload();
  await expect(area).toBeEditable();
  await area.fill("int main(){int other=2;return other;}");
  await page.getByRole("button", { name: "格式化全文", exact: true }).click();
  await expect(area).toContainText("int other = 2;");
});
