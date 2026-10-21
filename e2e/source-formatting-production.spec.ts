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
  // Wait for the actual source/type save, not a badge left from the old note.
  await expect.poll(() => page.evaluate(() => new Promise<string | undefined>((resolve, reject) => {
    const opening = indexedDB.open("nine_rings");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const transaction = db.transaction("notes", "readonly");
      const request = transaction.objectStore("notes").get(localStorage.getItem("nr:lastNote")!);
      request.onsuccess = () => resolve(request.result?.content?.metadata?.sourceLanguage);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    };
  }))).toBe("c");
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
  await page.locator(".source-indent-toast").getByRole("button", { name: "查看差异", exact: true }).click();
  const diff = page.getByRole("dialog", { name: "格式化差异", exact: true });
  await expect(diff).toBeVisible();
  await expect(diff.locator(".document-diff-scroll-pane").first()).toContainText("int main(){int other=2;return other;}");
  await expect(diff.locator(".document-diff-scroll-pane").last()).toContainText("int other = 2;");
  await diff.getByRole("button", { name: "关闭格式化差异", exact: true }).click();
  await page.getByRole("button", { name: "代码格式风格", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "自定义 .clang-format", exact: true }).click();
  const config = page.getByRole("dialog", { name: "代码格式配置", exact: true });
  await config.getByRole("textbox", { name: ".clang-format 配置", exact: true }).fill("# comment\nBasedOnStyle: LLVM\nIndentWidth: nope");
  await config.getByRole("button", { name: "使用此配置", exact: true }).click();
  await page.getByRole("button", { name: "格式化全文", exact: true }).click();
  await expect(config.getByRole("alert")).toContainText("IndentWidth: nope");
  await expect(config.getByRole("alert")).toContainText("第 3 行");
});
