import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

test("写入 HTML 测试产物不刷新正在编辑的页面", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeEditable();
  const marker = await page.evaluate(() => {
    const value = crypto.randomUUID();
    Object.assign(window, { artifactIsolationMarker: value });
    return value;
  });
  const output = testInfo.outputPath("watcher-probe.html");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, "<!doctype html><title>Test artifact</title>");
  // Exceed Vite's file-event debounce to observe a wrongly watched HTML file.
  await page.waitForTimeout(1000);
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { artifactIsolationMarker?: string }).artifactIsolationMarker,
  )).toBe(marker);
  await expect(page.locator(".ProseMirror")).toBeEditable();
});
