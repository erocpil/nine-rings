import { expect, test } from "@playwright/test";
import { openMobileSettings } from "./helpers/mobile-settings";

for (const width of [1280, 390]) {
  test.describe(`备份测量 ${width}`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: width === 390 });
    test("分析真实导出、复制聚合报告，不请求 GitHub，Esc 保留设置页", async ({ page }) => {
      const githubRequests: string[] = [];
      await page.route("https://api.github.com/**", route => {
        githubRequests.push(route.request().method());
        return route.abort();
      });
      await page.goto("/");
      await expect(page.locator(".ProseMirror")).toBeVisible();
      await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { api } = await load("/src/lib/api.ts");
        await api.notes.create({ title: "PRIVATE_MEASUREMENT_TITLE", date: "2026-10-14", content: { ops: [{ insert: "PRIVATE_MEASUREMENT_BODY\n" }, { insert: { image: "data:image/png;base64,AAAA" } }] } });
        const original = api.export.data;
        api.export.data = async () => {
          const source = await original();
          const { measureBackupJson } = await load("/src/lib/backup-measurement.ts");
          Object.assign(window, { expectedMeasurement: measureBackupJson(source) });
          return source;
        };
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => Object.assign(window, { copiedMeasurement: text }) } });
      });
      if (width === 390) await openMobileSettings(page);
      else await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("button", { name: /^云端同步/ }).click();
      await page.getByRole("button", { name: "备份测量", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "备份测量", exact: true });
      await dialog.getByRole("button", { name: "分析本地快照", exact: true }).click();
      await expect(dialog.getByRole("table", { name: "备份字节构成" })).toBeVisible();
      await expect(dialog).toContainText("逐字节对账：完整");
      await dialog.getByRole("button", { name: "复制测量报告" }).click();
      await expect(dialog.getByRole("status")).toContainText("已复制");
      const result = await page.evaluate(() => {
        const state = window as Window & { copiedMeasurement: string; expectedMeasurement: { totalBytes: number; bytes: unknown; counts: unknown } };
        return { copied: state.copiedMeasurement, expected: state.expectedMeasurement };
      });
      const report = JSON.parse(result.copied);
      expect(report.analysis.totalBytes).toBe(result.expected.totalBytes);
      expect(report.analysis.bytes).toEqual(result.expected.bytes);
      expect(report.analysis.counts).toEqual(result.expected.counts);
      expect(report.analysis.counts.inlineImages).toBeGreaterThan(0);
      expect(result.copied).not.toContain("PRIVATE_MEASUREMENT");
      expect(githubRequests).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "云端同步", exact: true })).toBeVisible();
    });
  });
}
